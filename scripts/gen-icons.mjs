// Tạo icon app từ logo (tủ ngăn kéo vàng đen): public/icons/* và src/app/favicon.ico.
// Chạy lại khi đổi logo:  node scripts/gen-icons.mjs   (hình phải khớp src/components/logo.tsx)
import { mkdirSync, writeFileSync } from "node:fs";
import sharp from "sharp";

const BLACK = "#1A1A17";
const WHITE = "#FFFFFF";
const YELLOW = "#F5B800";

/** Hình logo trong hệ toạ độ 48×48 */
const glyph = (fg, accent) => `
  <rect x="9" y="10.5" width="30" height="27" rx="3.5" fill="none" stroke="${fg}" stroke-width="2.8"/>
  <path d="M9 24h30" stroke="${fg}" stroke-width="2.8"/>
  <rect x="18.5" y="15" width="11" height="5" rx="1.3" fill="${accent}"/>
  <rect x="18.5" y="28.5" width="11" height="5" rx="1.3" fill="${accent}"/>
  <path d="M13.5 37.5v3.5M34.5 37.5v3.5" stroke="${fg}" stroke-width="2.8" stroke-linecap="round"/>`;

/**
 * rounded: bo góc (icon thường); không bo = tràn nền (maskable / Apple tự cắt).
 * scale: tỉ lệ hình so với ô — maskable để nhỏ hơn cho nằm trong vùng an toàn.
 */
const svg = ({ rounded, scale }) => {
  const size = 48 * scale;
  const off = (48 - size) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="512" height="512">
  <rect width="48" height="48" rx="${rounded ? 12.5 : 0}" fill="${BLACK}"/>
  <g transform="translate(${off} ${off}) scale(${scale})">${glyph(WHITE, YELLOW)}</g>
</svg>`;
};

const png = (opts, size) => sharp(Buffer.from(svg(opts))).resize(size, size).png().toBuffer();

/** File .ico chứa các ảnh PNG (mọi trình duyệt hiện nay đều đọc được) */
function ico(images) {
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, data }, i) => {
    const e = 6 + i * 16;
    header.writeUInt8(size >= 256 ? 0 : size, e);
    header.writeUInt8(size >= 256 ? 0 : size, e + 1);
    header.writeUInt16LE(1, e + 4); // planes
    header.writeUInt16LE(32, e + 6); // bpp
    header.writeUInt32LE(data.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...images.map((i) => i.data)]);
}

mkdirSync("public/icons", { recursive: true });
const any = { rounded: true, scale: 0.78 };
const full = { rounded: false, scale: 0.6 };
writeFileSync("public/icons/icon.svg", svg(any));
writeFileSync("public/icons/icon-192.png", await png(any, 192));
writeFileSync("public/icons/icon-512.png", await png(any, 512));
writeFileSync("public/icons/maskable-512.png", await png(full, 512));
writeFileSync("public/icons/apple-touch-icon.png", await png({ rounded: false, scale: 0.72 }, 180));
// Favicon nhỏ: hình to hơn trong ô cho rõ ở 16px
const fav = { rounded: true, scale: 0.9 };
writeFileSync(
  "src/app/favicon.ico",
  ico(await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await png(fav, size) })))),
);
console.log("Đã tạo public/icons/* và src/app/favicon.ico");
