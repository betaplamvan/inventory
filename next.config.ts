import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  cacheComponents: true,
  partialPrefetching: true,
  serverExternalPackages: ["minio", "sharp", "nodemailer"],
  experimental: {
    // Trang "Nhập từ file" gửi nội dung CSV qua Server Action (mặc định chỉ 1MB)
    serverActions: { bodySizeLimit: "3mb" },
  },
  outputFileTracingIncludes: {
    "/*": ["./drizzle/**/*"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
