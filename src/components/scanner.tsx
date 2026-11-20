"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Camera, CameraOff, Loader2, ScanLine, Search } from "lucide-react";
import { resolveScan } from "@/actions/scan";

/** API BarcodeDetector (Chrome / Edge Android, Safari 17+): đọc được cả QR lẫn mã vạch 1D. */
type Detector = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> };
type DetectorCtor = {
  new (opts?: { formats?: string[] }): Detector;
  getSupportedFormats?: () => Promise<string[]>;
};

const WANTED = ["qr_code", "code_128", "code_39", "ean_13", "ean_8", "upc_a", "upc_e", "data_matrix", "itf"];

async function makeDetector(): Promise<((v: HTMLVideoElement, c: HTMLCanvasElement) => Promise<string | null>) | null> {
  const Ctor = (globalThis as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
  if (Ctor) {
    try {
      const supported = (await Ctor.getSupportedFormats?.()) ?? WANTED;
      const formats = WANTED.filter((f) => supported.includes(f));
      if (formats.length) {
        const det = new Ctor({ formats });
        return async (video) => (await det.detect(video))[0]?.rawValue ?? null;
      }
    } catch {}
  }
  // Dự phòng (Firefox, Safari cũ): jsQR — chỉ đọc QR
  const { default: jsQR } = await import("jsqr");
  return async (video, canvas) => {
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return null;
    // Thu nhỏ khung hình cho nhanh, đủ nét để đọc QR
    const scale = Math.min(1, 640 / Math.max(w, h));
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" })?.data ?? null;
  };
}

export function Scanner() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<"idle" | "starting" | "scanning" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const [pending, start] = useTransition();
  const busy = useRef(false);
  /** Trang còn mở không — getUserMedia trả về sau khi đã rời trang thì phải tắt camera ngay */
  const alive = useRef(true);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const open = useCallback(
    (code: string) => {
      if (busy.current) return;
      busy.current = true;
      setFound(code);
      start(async () => {
        const res = await resolveScan(code);
        if (res.ok) {
          stop();
          navigator.vibrate?.(60);
          router.push(res.href);
        } else {
          setError(res.error);
          // Cho quét tiếp sau một nhịp, tránh đọc lại đúng mã vừa lỗi liên tục
          setTimeout(() => {
            busy.current = false;
          }, 1500);
        }
      });
    },
    [router, stop],
  );

  const startCamera = useCallback(async () => {
    setError(null);
    setFound(null);
    busy.current = false;
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("error");
      setError("Trình duyệt không cho dùng camera (cần mở app qua https). Hãy nhập mã bên dưới.");
      return;
    }
    setStatus("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      if (!alive.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = stream;
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();
      setStatus("scanning");
    } catch (err) {
      stop();
      setStatus("error");
      const name = (err as DOMException)?.name;
      setError(
        name === "NotAllowedError"
          ? "Chưa được cấp quyền camera. Cho phép camera cho trang này trong cài đặt trình duyệt rồi thử lại."
          : name === "NotFoundError"
            ? "Không tìm thấy camera trên thiết bị này."
            : "Không mở được camera. Hãy nhập mã bên dưới.",
      );
    }
  }, [stop]);

  // Vòng đọc khung hình khi camera đang chạy
  useEffect(() => {
    if (status !== "scanning") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    (async () => {
      const detect = await makeDetector();
      const tick = async () => {
        if (cancelled) return;
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (detect && video && canvas && video.readyState >= 2 && !busy.current) {
          try {
            const code = (await detect(video, canvas))?.trim();
            if (code && !cancelled) open(code);
          } catch {}
        }
        timer = setTimeout(tick, 180);
      };
      tick();
    })();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [status, open]);

  // Mở trang là bật camera luôn; rời trang thì tắt
  useEffect(() => {
    alive.current = true;
    const t = setTimeout(startCamera, 0);
    return () => {
      alive.current = false;
      clearTimeout(t);
      stop();
    };
  }, [startCamera, stop]);

  return (
    <div className="space-y-4">
      <div className="card relative aspect-[3/4] overflow-hidden bg-black sm:aspect-video">
        <video ref={videoRef} playsInline muted className="size-full object-cover" />
        <canvas ref={canvasRef} className="hidden" />
        {status === "scanning" && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="relative aspect-square w-3/5 max-w-72 rounded-2xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]">
              <ScanLine className="absolute top-1/2 left-1/2 size-10 -translate-x-1/2 -translate-y-1/2 text-white/60" />
            </div>
          </div>
        )}
        {(status === "starting" || pending) && (
          <div className="absolute inset-0 grid place-items-center bg-black/40 text-white">
            <div className="flex flex-col items-center gap-2 text-sm">
              <Loader2 className="size-6 animate-spin" />
              {pending && found ? <span className="max-w-64 truncate px-4">{found}</span> : "Đang mở camera…"}
            </div>
          </div>
        )}
        {(status === "idle" || status === "error") && (
          <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-white/80">
            <div className="flex flex-col items-center gap-3">
              <CameraOff className="size-8" />
              <button type="button" className="btn-primary" onClick={startCamera}>
                <Camera className="size-4" /> Bật camera
              </button>
            </div>
          </div>
        )}
      </div>

      {error && <p className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</p>}

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!manual.trim()) return;
          busy.current = false;
          setError(null);
          open(manual.trim());
        }}
      >
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <input
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder="Hoặc nhập SKU / MPN / mã vị trí"
            className="input pl-9"
            enterKeyHint="go"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>
        <button type="submit" className="btn-secondary" disabled={pending || !manual.trim()}>
          Mở
        </button>
      </form>

      <p className="text-xs text-muted">
        Nhận: nhãn QR in từ app (mặt hàng / vị trí), mã vạch hoặc QR chứa SKU, MPN (cả nhãn túi LCSC), mã vị trí như{" "}
        <span className="font-mono">A1-03</span>. Mã không khớp sẽ được đem đi tìm trong kho.
      </p>
    </div>
  );
}
