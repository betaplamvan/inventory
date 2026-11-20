import type { MetadataRoute } from "next";

/** Cài như app (Thêm vào màn hình chính): mở toàn màn hình, có lối tắt Quét mã / Thêm mặt hàng. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Kho linh kiện",
    short_name: "Kho",
    description: "Quản lý linh kiện, dụng cụ và vật tư điện tử cá nhân",
    lang: "vi",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#faf8f3",
    theme_color: "#faf8f3",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Quét mã", short_name: "Quét", url: "/scan", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Thêm mặt hàng", short_name: "Thêm", url: "/items/new", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Kho hàng", url: "/items", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
