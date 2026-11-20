import Link from "next/link";
import { Suspense } from "react";
import QRCode from "qrcode";
import { ChevronLeft, Tags } from "lucide-react";
import type { ItemKind } from "@/db/schema";
import { PrintButton } from "@/components/print-button";
import { EmptyState, PageHeader, Skeleton, qs } from "@/components/ui";
import { ITEM_KINDS } from "@/lib/constants";
import { MAX_LABELS, itemLabelUrl, locationLabelUrl } from "@/lib/labels";
import { getLocationTree, listAllItems, type StockFilter } from "@/lib/queries";

export const metadata = { title: "In nhãn QR" };

/** Cỡ nhãn (mm). Giấy decal A4 cắt sẵn hoặc máy in nhãn nhiệt đều in được. */
const SIZES = {
  s: { label: "Nhỏ 40×25", w: 40, h: 25, qr: 19, font: 2.6 },
  m: { label: "Vừa 50×30", w: 50, h: 30, qr: 24, font: 3 },
  l: { label: "Lớn 70×40", w: 70, h: 40, qr: 32, font: 3.6 },
} as const;
type SizeKey = keyof typeof SIZES;

type Label = { key: string; url: string; title: string; lines: string[] };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
const idList = (v: string | undefined) =>
  (v ?? "")
    .split(",")
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, MAX_LABELS);

export default function LabelsPage(props: PageProps<"/labels">) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Labels searchParams={props.searchParams} />
    </Suspense>
  );
}

async function Labels({ searchParams }: { searchParams: PageProps<"/labels">["searchParams"] }) {
  const sp = await searchParams;
  const size: SizeKey = (one(sp.size) as SizeKey) in SIZES ? (one(sp.size) as SizeKey) : "m";
  const S = SIZES[size];
  const locParam = one(sp.locations);

  let labels: Label[];
  let back: { href: string; label: string };
  if (locParam) {
    const tree = await getLocationTree();
    const ids = locParam === "all" ? null : new Set(idList(locParam));
    labels = tree
      .filter((l) => !ids || ids.has(l.id))
      .slice(0, MAX_LABELS)
      .map((l) => ({
        key: `l${l.id}`,
        url: locationLabelUrl(l.id),
        title: l.name,
        lines: [l.code ? `Mã: ${l.code}` : "", l.path !== l.name ? l.path : ""].filter(Boolean),
      }));
    back = { href: "/locations", label: "Vị trí cất" };
  } else {
    const kind = one(sp.kind);
    const ids = one(sp.items);
    const rows = await listAllItems(
      {
        ids: ids ? idList(ids) : undefined,
        q: one(sp.q),
        kind: ITEM_KINDS.includes(kind as ItemKind) ? (kind as ItemKind) : undefined,
        categoryId: Number(one(sp.category)) || undefined,
        locationId: Number(one(sp.location)) || undefined,
        stock: one(sp.stock) as StockFilter,
      },
      MAX_LABELS,
    );
    labels = rows.map((it) => ({
      key: `i${it.id}`,
      url: itemLabelUrl(it.id),
      title: it.name,
      lines: [[it.sku, it.package].filter(Boolean).join(" · "), it.location?.name ?? ""].filter(Boolean),
    }));
    back =
      ids && idList(ids).length === 1
        ? { href: `/items/${idList(ids)[0]}`, label: "Mặt hàng" }
        : { href: "/items", label: "Kho hàng" };
  }

  const svgs = await Promise.all(
    labels.map((l) => QRCode.toString(l.url, { type: "svg", margin: 0, errorCorrectionLevel: "M" })),
  );
  const current = Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, one(v)]));

  return (
    <>
      <div className="print:hidden">
        <PageHeader
          title="In nhãn QR"
          tour="labels"
          description={`${labels.length} nhãn${labels.length >= MAX_LABELS ? ` (tối đa ${MAX_LABELS} mỗi lần)` : ""}. Quét bằng camera điện thoại hoặc nút Quét mã trong app để mở đúng ${locParam ? "vị trí" : "mặt hàng"}.`}
          back={
            <Link href={back.href} className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
              <ChevronLeft className="size-4" /> {back.label}
            </Link>
          }
          actions={<PrintButton disabled={!labels.length} />}
        />
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm" data-tour="labels-size">
          <span className="text-muted">Cỡ nhãn:</span>
          <div className="flex rounded-lg border border-border bg-surface p-0.5">
            {(Object.keys(SIZES) as SizeKey[]).map((k) => (
              <Link
                key={k}
                href={`/labels${qs({ ...current, size: k === "m" ? undefined : k })}`}
                replace
                className={`rounded-md px-3 py-1.5 pointer-coarse:py-2 ${k === size ? "bg-surface-2 font-medium" : "text-muted hover:text-foreground"}`}
              >
                {SIZES[k].label}
              </Link>
            ))}
          </div>
          <span className="text-xs text-muted">Khi in: chọn khổ giấy, lề “Không” / “Tối thiểu”, tỉ lệ 100%.</span>
        </div>
      </div>

      {labels.length === 0 ? (
        <EmptyState icon={<Tags className="size-10" />} title="Không có gì để in" />
      ) : (
        <div className="flex flex-wrap gap-[2mm] print:gap-0">
          {labels.map((l, i) => (
            <div
              key={l.key}
              className="flex break-inside-avoid items-center gap-[2mm] overflow-hidden rounded-md border border-border bg-white p-[2mm] text-black print:rounded-none print:border-dashed print:border-zinc-300"
              style={{ width: `${S.w}mm`, height: `${S.h}mm` }}
            >
              <div
                className="shrink-0 [&_svg]:size-full"
                style={{ width: `${S.qr}mm`, height: `${S.qr}mm` }}
                // SVG do thư viện qrcode tạo từ link của chính app
                dangerouslySetInnerHTML={{ __html: svgs[i] }}
              />
              <div className="flex min-w-0 flex-1 flex-col justify-center gap-[0.6mm] leading-tight" style={{ fontSize: `${S.font}mm` }}>
                <p className="line-clamp-3 font-semibold break-words">{l.title}</p>
                {l.lines.map((line, j) => (
                  <p key={j} className="truncate text-zinc-600" style={{ fontSize: `${S.font * 0.85}mm` }}>
                    {line}
                  </p>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
