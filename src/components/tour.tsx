"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CircleHelp, X } from "lucide-react";
import { TOURS, type TourId, type TourStep } from "@/lib/tours";

/**
 * Hướng dẫn lần đầu: tự chạy khi mở một trang lần đầu trên trình duyệt này, chỉ vào từng phần
 * (data-tour="…") kèm lời giải thích. Đã xem lưu trong localStorage; nút ? (TourButton) chạy lại,
 * resetTours() bật lại toàn bộ.
 */

const STORAGE_KEY = "kho:tours-seen";
const START_EVENT = "kho:tour-start";
/** Chờ nội dung (Suspense) hiện ra tối đa bao lâu trước khi bắt đầu với những gì đang có */
const WAIT_MS = 2500;

function readSeen(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function markSeen(id: TourId) {
  try {
    const seen = new Set(readSeen());
    seen.add(id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...seen]));
  } catch {}
}

/** Bật lại mọi hướng dẫn (trang Tài khoản) */
export function resetTours() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

export function startTour(id: TourId) {
  window.dispatchEvent(new CustomEvent(START_EVENT, { detail: id }));
}

/** Phần tử đầu tiên khớp target và đang hiện trên màn hình (bỏ qua bản ẩn của bố cục điện thoại / desktop) */
function findTarget(step: TourStep): HTMLElement | null {
  if (!step.target) return null;
  for (const name of Array.isArray(step.target) ? step.target : [step.target]) {
    for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`)) {
      if (el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden") return el;
    }
  }
  return null;
}

type Box = { top: number; left: number; width: number; height: number };
const PAD = 6;
const MARGIN = 12;

export function Tour({ id }: { id: TourId }) {
  const [steps, setSteps] = useState<TourStep[] | null>(null);
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [view, setView] = useState({ w: 0, h: 0 });
  const [cardH, setCardH] = useState(180);
  const cardRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);

  /** Bắt đầu với các bước có mặt trên trang lúc này */
  const begin = useCallback(() => {
    const available = TOURS[id].filter((s) => !s.target || findTarget(s));
    if (!available.length) return;
    markSeen(id);
    setSteps(available);
    setIndex(0);
  }, [id]);

  const close = useCallback(() => setSteps(null), []);

  // Tự chạy lần đầu: đợi các phần tử cần chỉ hiện ra (trang stream dần), tối đa WAIT_MS
  useEffect(() => {
    if (readSeen().includes(id)) return;
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const targeted = TOURS[id].filter((s) => s.target);
      const allThere = targeted.every((s) => findTarget(s));
      if ((allThere && Date.now() - started > 400) || Date.now() - started > WAIT_MS) begin();
      else timer = setTimeout(tick, 200);
    };
    timer = setTimeout(tick, 200);
    return () => clearTimeout(timer);
  }, [id, begin]);

  // Nút ? gọi startTour(id)
  useEffect(() => {
    const onStart = (e: Event) => {
      if ((e as CustomEvent).detail === id) begin();
    };
    window.addEventListener(START_EVENT, onStart);
    return () => window.removeEventListener(START_EVENT, onStart);
  }, [id, begin]);

  const step = steps?.[index];

  // Cuộn tới phần tử của bước hiện tại
  useEffect(() => {
    if (!step) return;
    const el = findTarget(step);
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.top < 64 || r.bottom > window.innerHeight - 96) {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
    }
  }, [step]);

  // Theo dõi vị trí phần tử (cuộn, đổi cỡ màn hình, nội dung dịch chuyển) mỗi khung hình khi đang mở
  useEffect(() => {
    if (!step) return;
    let frame = 0;
    const loop = () => {
      const el = findTarget(step);
      const r = el?.getBoundingClientRect();
      const next = r ? { top: r.top, left: r.left, width: r.width, height: r.height } : null;
      setBox((prev) =>
        prev && next && Math.abs(prev.top - next.top) < 0.5 && Math.abs(prev.left - next.left) < 0.5 &&
        Math.abs(prev.width - next.width) < 0.5 && Math.abs(prev.height - next.height) < 0.5
          ? prev
          : next,
      );
      setView((v) => (v.w === window.innerWidth && v.h === window.innerHeight ? v : { w: window.innerWidth, h: window.innerHeight }));
      frame = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(frame);
  }, [step]);

  // Chiều cao thật của thẻ để đặt trên / dưới phần tử cho đúng
  useEffect(() => {
    const card = cardRef.current;
    if (!step || !card) return;
    const ro = new ResizeObserver(() => setCardH(card.offsetHeight));
    ro.observe(card);
    return () => ro.disconnect();
  }, [step]);

  useEffect(() => {
    if (step) primaryRef.current?.focus({ preventScroll: true });
  }, [step]);

  const last = !!steps && index === steps.length - 1;
  const next = useCallback(() => (last ? close() : setIndex((i) => i + 1)), [last, close]);
  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  useEffect(() => {
    if (!step) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, close, next, back]);

  if (!steps || !step) return null;

  // Vị trí thẻ: dưới phần tử nếu đủ chỗ, không thì trên, không nữa thì ghim đáy màn hình; không có phần tử → giữa
  const width = Math.min(360, (view.w || 360) - MARGIN * 2);
  let cardStyle: React.CSSProperties;
  if (!box) {
    cardStyle = { width, left: "50%", top: "50%", transform: "translate(-50%, -50%)" };
  } else {
    const left = Math.min(Math.max(box.left + box.width / 2 - width / 2, MARGIN), view.w - width - MARGIN);
    const below = box.top + box.height + PAD + MARGIN;
    const above = box.top - PAD - MARGIN - cardH;
    // Kẹp trong màn hình: phần tử có thể đang ở ngoài khung nhìn (đang cuộn tới)
    const clampTop = (top: number) => Math.min(Math.max(top, MARGIN), view.h - cardH - MARGIN);
    if (below + cardH <= view.h - MARGIN) cardStyle = { width, left, top: clampTop(below) };
    else if (above >= MARGIN) cardStyle = { width, left, top: clampTop(above) };
    else cardStyle = { width, left: (view.w - width) / 2, bottom: `calc(${MARGIN}px + env(safe-area-inset-bottom, 0px))` };
  }

  return (
    <div className="fixed inset-0 z-[60]">
      {/* Chặn bấm vào trang phía sau trong lúc xem hướng dẫn */}
      <div className={`absolute inset-0 ${box ? "" : "bg-black/55"}`} onClick={close} />
      {box && (
        <div
          className="pointer-events-none absolute rounded-xl ring-2 ring-accent transition-all duration-200 motion-reduce:transition-none"
          style={{
            top: box.top - PAD,
            left: box.left - PAD,
            width: box.width + PAD * 2,
            height: box.height + PAD * 2,
            boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.55)",
          }}
        />
      )}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        className="card absolute p-4 shadow-2xl transition-[top,left] duration-200 motion-reduce:transition-none"
        style={cardStyle}
      >
        <div className="mb-1 flex items-start justify-between gap-3">
          <p className="text-xs font-medium text-muted tabular-nums">
            {index + 1} / {steps.length}
          </p>
          <button type="button" onClick={close} aria-label="Đóng hướng dẫn" className="-m-2 grid size-9 place-items-center rounded-lg text-muted hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>
        <h2 id="tour-title" className="text-base font-bold">
          {step.title}
        </h2>
        <p id="tour-body" className="mt-1 text-sm leading-relaxed text-muted">
          {step.body}
        </p>
        <div className="mt-4 flex items-center gap-2">
          <div className="mr-auto flex gap-1" aria-hidden="true">
            {steps.map((_, i) => (
              <span key={i} className={`h-1.5 rounded-full transition-all ${i === index ? "w-4 bg-accent" : "w-1.5 bg-border"}`} />
            ))}
          </div>
          {index > 0 ? (
            <button type="button" onClick={back} className="btn-ghost btn-sm">
              Quay lại
            </button>
          ) : (
            <button type="button" onClick={close} className="btn-ghost btn-sm">
              Bỏ qua
            </button>
          )}
          <button ref={primaryRef} type="button" onClick={next} className="btn-primary btn-sm">
            {last ? "Xong" : "Tiếp"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Nút ? cạnh tiêu đề trang: xem lại hướng dẫn của trang này */
export function TourButton({ id, className = "" }: { id: TourId; className?: string }) {
  return (
    <button
      type="button"
      onClick={() => startTour(id)}
      title="Hướng dẫn trang này"
      aria-label="Hướng dẫn trang này"
      className={`grid size-8 shrink-0 place-items-center rounded-full text-muted transition hover:bg-surface-2 hover:text-foreground pointer-coarse:size-10 ${className}`}
    >
      <CircleHelp className="size-4.5" />
    </button>
  );
}

/** Trang Tài khoản: bật lại mọi hướng dẫn */
export function ResetToursButton() {
  const [done, setDone] = useState(false);
  return (
    <div data-tour="acc-tour" className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted">
        {done ? "Đã bật lại. Hướng dẫn sẽ hiện khi bạn mở từng trang." : "Hướng dẫn tự hiện ở lần đầu mở mỗi trang."}
      </p>
      {!done && (
        <button
          type="button"
          className="btn-secondary"
          onClick={() => {
            resetTours();
            setDone(true);
          }}
        >
          <CircleHelp className="size-4" /> Xem lại hướng dẫn
        </button>
      )}
    </div>
  );
}
