import { CodeXml, Globe, Heart, HeartHandshake } from "lucide-react";
import { SupportScreen } from "@/components/support-screen";
import { EmptyState, PageHeader } from "@/components/ui";
import { AUTHOR, authorSupportEnabled } from "@/lib/author";

export const metadata = { title: "Ủng hộ tác giả" };

/** Trang tĩnh: thông tin tác giả nằm trong code (src/lib/author.ts), giống nhau trên mọi bản deploy. */
export default function SupportPage() {
  const by = AUTHOR.name ? ` của ${AUTHOR.name}` : "";
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Ủng hộ tác giả" tour="support" />
      {!authorSupportEnabled() ? (
        <EmptyState icon={<HeartHandshake className="size-10" />} title="Cảm ơn bạn đã quan tâm!">
          Phần ủng hộ chưa được cấu hình trong bản này.
        </EmptyState>
      ) : (
        <div className="space-y-4">
          <section className="card flex gap-4 p-4 sm:p-5">
            <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-accent text-on-accent">
              <Heart className="size-6" />
            </span>
            <div className="min-w-0 space-y-1.5 text-sm">
              <p>
                Kho linh kiện là dự án <b>mã nguồn mở, miễn phí</b>
                {by}. Nếu app có ích cho bạn, dù bạn dùng bản này hay tự deploy, có thể mời tác giả một ly cà phê để
                tiếp tục làm thêm tính năng.
              </p>
              <p className="text-muted">Ủng hộ là tự nguyện và đi thẳng tới tác giả, không mở khoá tính năng nào.</p>
              <div className="flex flex-col items-start gap-1 pt-1">
                {AUTHOR.sourceUrl && (
                  <a
                    href={AUTHOR.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 font-medium text-accent-strong hover:underline"
                  >
                    <CodeXml className="size-4" /> Mã nguồn · tặng một sao cũng là ủng hộ
                  </a>
                )}
                {AUTHOR.appUrl && (
                  <a
                    href={AUTHOR.appUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 font-medium text-accent-strong hover:underline"
                  >
                    <Globe className="size-4" /> Bản chính thức của tác giả · dùng ngay không cần tự cài
                  </a>
                )}
              </div>
            </div>
          </section>
          <SupportScreen bank={AUTHOR.bank} note={AUTHOR.note} />
        </div>
      )}
    </div>
  );
}
