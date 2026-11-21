import type { Metadata, Viewport } from "next";
import { Be_Vietnam_Pro, JetBrains_Mono } from "next/font/google";
import { DOMAINS, DOMAIN_COOKIE, DEFAULT_DOMAIN } from "@/lib/domains";
import "./globals.css";

// Be Vietnam Pro: thiết kế cho tiếng Việt (dấu chồng gọn, không đè dòng); không có bản variable nên liệt kê độ đậm
const sans = Be_Vietnam_Pro({
  variable: "--font-be-vietnam",
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700", "800"],
});

const mono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin", "vietnamese"],
});

export const metadata: Metadata = {
  title: { default: "Kho đồ", template: "%s · Kho đồ" },
  description: "Quản lý linh kiện điện tử, tủ quần áo và tủ bếp — kèm trợ lý gợi ý mạch DIY, phối đồ, món ăn",
  applicationName: "Kho đồ",
  icons: {
    icon: [
      { url: "/icons/icon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
  // iOS: mở từ màn hình chính thành app toàn màn hình
  appleWebApp: { capable: true, title: "Kho", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Tràn viền (tai thỏ / thanh home) — các thanh cố định tự chừa env(safe-area-inset-*)
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf8f3" },
    { media: "(prefers-color-scheme: dark)", color: "#131311" },
  ],
};

/** Đặt màu theo kho (cookie) trước khi trang được vẽ — không nháy màu, không cần server đọc cookie ở layout */
const DOMAIN_SCRIPT = `try{var m=document.cookie.match(/(?:^|; )${DOMAIN_COOKIE}=([a-z]+)/);var d=m&&${JSON.stringify(DOMAINS)}.indexOf(m[1])>=0?m[1]:"${DEFAULT_DOMAIN}";document.documentElement.dataset.domain=d}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: data-domain do script ở trên đặt, server không biết trước
    <html lang="vi" className={`${sans.variable} ${mono.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: DOMAIN_SCRIPT }} />
      </head>
      <body className="min-h-full font-sans">{children}</body>
    </html>
  );
}
