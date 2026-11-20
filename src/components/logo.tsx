/**
 * Logo Kho linh kiện: tủ ngăn kéo có nhãn dán. Màu theo chế độ sáng / tối qua biến --logo-* trong globals.css
 * (sáng: nền đen, nét trắng, nhãn vàng; tối: nền vàng, nét đen).
 * Icon app / favicon (public/icons, src/app/favicon.ico) vẽ cùng hình này — sửa thì sửa cả scripts/gen-icons.mjs.
 */
export function Logo({ className = "size-8" }: { className?: string }) {
  return (
    <span className={`grid shrink-0 place-items-center rounded-[26%] bg-logo-bg ${className}`}>
      <svg viewBox="0 0 48 48" fill="none" className="size-[70%]" aria-hidden="true">
        <rect x="9" y="10.5" width="30" height="27" rx="3.5" strokeWidth="2.8" className="stroke-logo-fg" />
        <path d="M9 24h30" strokeWidth="2.8" className="stroke-logo-fg" />
        <rect x="18.5" y="15" width="11" height="5" rx="1.3" className="fill-logo-accent" />
        <rect x="18.5" y="28.5" width="11" height="5" rx="1.3" className="fill-logo-accent" />
        <path d="M13.5 37.5v3.5M34.5 37.5v3.5" strokeWidth="2.8" strokeLinecap="round" className="stroke-logo-fg" />
      </svg>
    </span>
  );
}
