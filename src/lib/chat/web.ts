import "server-only";
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";

/**
 * Tra cứu web cho trợ lý chat: tìm qua SearXNG tự host (SEARCH_URL) và đọc nội dung một trang.
 * read_webpage chạy trên máy chủ nhà (cùng mạng với các dịch vụ khác) nên CHẶN mọi địa chỉ nội bộ:
 * kiểm tra IP ngay lúc kết nối (hook lookup → chống DNS rebinding) và lại sau mỗi lần chuyển hướng.
 */

export const webSearchConfigured = () => !!process.env.SEARCH_URL;

const UA = "Mozilla/5.0 (compatible; KhoDo/1.0; +https://github.com/betaplamvan/inventory)";
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_TEXT = 8000;
const TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 3;

export class WebError extends Error {}

/* ------------------------------------------------------------------ */
/* Tìm kiếm (SearXNG)                                                  */
/* ------------------------------------------------------------------ */

export type SearchResult = { title: string; url: string; snippet: string };

export async function webSearch(query: string, opts: { language?: string; limit?: number } = {}) {
  const base = (process.env.SEARCH_URL || "").replace(/\/+$/, "");
  if (!base) throw new WebError("Chưa cấu hình SEARCH_URL");
  const u = new URL(`${base}/search`);
  u.searchParams.set("q", query);
  u.searchParams.set("format", "json");
  if (opts.language && opts.language !== "auto") u.searchParams.set("language", opts.language);
  let res: Response;
  try {
    res = await fetch(u, {
      // X-Real-IP: SearXNG (bot detection) ghi lỗi nếu request không có IP nguồn — app gọi nội bộ nên đặt cố định
      headers: { Accept: "application/json", "X-Real-IP": "127.0.0.1" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new WebError(`Không kết nối được máy tìm kiếm: ${(err as Error).message}`);
  }
  if (!res.ok) throw new WebError(`Máy tìm kiếm trả lỗi HTTP ${res.status}`);
  const data = (await res.json()) as { results?: { title?: string; url?: string; content?: string }[] };
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const r of data.results ?? []) {
    if (!r.url || seen.has(r.url)) continue;
    seen.add(r.url);
    out.push({ title: (r.title ?? "").trim(), url: r.url, snippet: (r.content ?? "").replace(/\s+/g, " ").trim().slice(0, 300) });
    if (out.length >= (opts.limit ?? 8)) break;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Đọc trang — chặn địa chỉ nội bộ                                     */
/* ------------------------------------------------------------------ */

function v4ToInt(ip: string) {
  return ip.split(".").reduce((n, p) => (n << 8) + Number(p), 0) >>> 0;
}
const V4_BLOCKED: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // CGNAT / Tailscale
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

/** Địa chỉ không phải internet công cộng (loopback, LAN, Tailscale, link-local, multicast…) */
export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const n = v4ToInt(ip);
    return V4_BLOCKED.some(([base, bits]) => (n >>> (32 - bits)) === (v4ToInt(base) >>> (32 - bits)));
  }
  if (net.isIPv6(ip)) {
    const s = ip.toLowerCase();
    const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return (
      s === "::" ||
      s === "::1" ||
      /^f[cd]/.test(s) || // fc00::/7 ULA
      /^fe[89ab]/.test(s) || // fe80::/10 link-local
      /^ff/.test(s) || // multicast
      s.startsWith("64:ff9b:") || // NAT64 có thể trỏ về IPv4 nội bộ
      s.startsWith("2001:db8:")
    );
  }
  return true;
}

/** Hook phân giải tên miền: loại bỏ nếu BẤT KỲ địa chỉ nào là nội bộ */
const safeLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 0);
    const list = addresses as dns.LookupAddress[];
    if (!list.length || list.some((a) => isPrivateIp(a.address))) {
      return callback(new WebError(`Không được truy cập địa chỉ nội bộ (${hostname})`), "", 0);
    }
    if (options.all) return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list);
    callback(null, list[0].address, list[0].family);
  });
};

type Fetched = { url: string; contentType: string; body: Buffer };

function getOnce(url: URL): Promise<Fetched | { redirect: string }> {
  return new Promise((resolve, reject) => {
    if (net.isIP(url.hostname.replace(/^\[|\]$/g, "")) && isPrivateIp(url.hostname.replace(/^\[|\]$/g, ""))) {
      return reject(new WebError("Không được truy cập địa chỉ nội bộ"));
    }
    const mod = url.protocol === "https:" ? https : http;
    const req = mod.get(
      url,
      {
        lookup: safeLookup,
        timeout: TIMEOUT_MS,
        headers: {
          "User-Agent": UA,
          Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
          "Accept-Language": "vi,en;q=0.8",
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          return resolve({ redirect: new URL(res.headers.location, url).toString() });
        }
        if (status >= 400) {
          res.resume();
          return reject(new WebError(`Trang trả lỗi HTTP ${status}`));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > MAX_BYTES) {
            res.destroy();
            resolve({ url: url.toString(), contentType: String(res.headers["content-type"] ?? ""), body: Buffer.concat(chunks) });
            return;
          }
          chunks.push(c);
        });
        res.on("end", () =>
          resolve({ url: url.toString(), contentType: String(res.headers["content-type"] ?? ""), body: Buffer.concat(chunks) }),
        );
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new WebError("Quá thời gian tải trang")));
    req.on("error", (err) => reject(err instanceof WebError ? err : new WebError(`Không tải được trang: ${err.message}`)));
  });
}

async function safeGet(raw: string): Promise<Fetched> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new WebError("URL không hợp lệ");
  }
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new WebError("Chỉ đọc được link http / https");
    if (url.username || url.password) throw new WebError("Không hỗ trợ URL có tài khoản");
    const r = await getOnce(url);
    if ("redirect" in r) {
      url = new URL(r.redirect);
      continue;
    }
    return r;
  }
  throw new WebError("Chuyển hướng quá nhiều lần");
}

/* ------------------------------------------------------------------ */
/* HTML → chữ                                                          */
/* ------------------------------------------------------------------ */

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decodeEntities(s: string) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export function htmlToText(html: string) {
  const title = decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "")
    .replace(/\s+/g, " ")
    .trim();
  let s = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|iframe|canvas|form|select)\b[\s\S]*?<\/\1>/gi, " ");
  // Ưu tiên phần nội dung chính nếu có
  const main = s.match(/<(article|main)\b[^>]*>([\s\S]*?)<\/\1>/i)?.[2];
  if (main && main.length > 500) s = main;
  s = s
    .replace(/<(nav|header|footer|aside)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<h([1-6])[^>]*>/gi, (_m, n: string) => `\n\n${"#".repeat(Number(n))} `)
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<(br|hr)\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|tr|table|ul|ol|h[1-6]|blockquote|pre|dd|dt)>/gi, "\n")
    .replace(/<t[dh][^>]*>/gi, " | ")
    .replace(/<[^>]+>/g, " ");
  s = decodeEntities(s)
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trim())
    // Bỏ dòng chỉ còn ký tự trang trí (gạch đầu dòng rỗng, ô bảng rỗng)
    .map((l) => (/^[-|•·*\s]+$/.test(l) ? "" : l))
    .filter((l, i, arr) => l || (i > 0 && arr[i - 1]))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { title, text: s };
}

function decodeBody(body: Buffer, contentType: string) {
  const charset = contentType.match(/charset=([\w-]+)/i)?.[1] ?? body.subarray(0, 2048).toString("latin1").match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1];
  try {
    return new TextDecoder(charset || "utf-8").decode(body);
  } catch {
    return new TextDecoder("utf-8").decode(body);
  }
}

/** Đọc một trang: trả tiêu đề + nội dung dạng chữ (cắt bớt). PDF / ảnh / file nhị phân → báo không đọc được. */
export async function readWebpage(url: string) {
  const r = await safeGet(url);
  const ct = r.contentType.toLowerCase();
  if (ct.includes("application/pdf")) {
    throw new WebError("Link là file PDF — chưa đọc được nội dung PDF, hãy dùng đoạn trích từ kết quả tìm kiếm hoặc trang HTML khác");
  }
  if (ct && !/text\/|html|xml|json/.test(ct)) throw new WebError(`Không đọc được loại nội dung ${ct.split(";")[0]}`);
  const raw = decodeBody(r.body, ct);
  const { title, text } = /html|xml/.test(ct) || /^\s*</.test(raw) ? htmlToText(raw) : { title: "", text: raw.trim() };
  const truncated = text.length > MAX_TEXT;
  return { url: r.url, title, text: truncated ? `${text.slice(0, MAX_TEXT)}\n…(đã cắt bớt)` : text, truncated };
}
