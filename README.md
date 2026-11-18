# Kho linh kiện

App tự quản lý linh kiện, module, dụng cụ và vật tư điện tử. Đăng nhập bằng Google, mỗi tài khoản có một kho riêng.

**Stack:** Next.js 16 (App Router, Server Actions) · PostgreSQL 17 + Drizzle ORM · MinIO (ảnh / video / datasheet) · Tailwind CSS 4

## Tính năng

- **Kho hàng**: tìm kiếm tiếng Việt có dấu hoặc không dấu ("tu gom" ra "Tụ gốm"), lọc theo loại / danh mục / vị trí / tình trạng, xem dạng danh sách hoặc lưới, nút **+ / −** chỉnh nhanh số lượng
- **Mặt hàng**: tên, SKU riêng, hãng, MPN, package, bảng thông số tuỳ ý (có gợi ý theo loại), tag, đơn vị (cái/mét/cuộn…, cho phép số lẻ như 0,5 cuộn thiếc), mức tối thiểu, đơn giá, nhà cung cấp, link mua, link datasheet
- **Ảnh / video / tài liệu** lưu trên MinIO: kéo thả để upload, tự tạo thumbnail cho ảnh, xem video tua được, chọn ảnh đại diện, xem toàn màn hình
- **Nhập / Xuất / Kiểm kê**: mỗi lần đổi số lượng đều ghi lịch sử, kèm dự án hoặc nguồn hàng, ghi chú, giá nhập. Không cho xuất quá số đang có
- **Danh mục & vị trí cất** dạng cây nhiều cấp (Tủ A › Ngăn 3). Có nút tạo sẵn bộ danh mục điện tử phổ biến
- **Tổng quan**: tổng số mặt hàng, giá trị kho, danh sách cần mua thêm, các lần nhập/xuất gần đây
- **Xuất CSV** theo bộ lọc đang chọn, mở thẳng bằng Excel được
- **Đăng nhập bằng Google (OAuth)**, mỗi tài khoản có kho riêng. App không lưu mật khẩu (xem mục bên dưới)
- Giao diện có bản cho điện thoại và chế độ tối. File đi qua Next nên chỉ cần mở **1 cổng** là điện thoại trong mạng LAN dùng được

## Đăng nhập bằng Google

Thiết kế giống okia:

- **Luồng OAuth:** Authorization Code + PKCE (S256), xử lý hoàn toàn trên server. `state` và `code_verifier` lưu trong cookie httpOnly 10 phút.
- **Kiểm tra `id_token`:** xác minh chữ ký bằng JWKS của Google (RS256), kiểm tra `aud` và `iss`, bắt buộc `email_verified`.
- **Tài khoản:** bảng `users` cùng `auth_identities` (provider + Google `sub`). Lần đăng nhập đầu tiên thì tạo user; nếu đã có user trùng email thì liên kết vào user đó.
- **Phiên:** cookie httpOnly chứa token ngẫu nhiên, DB chỉ lưu SHA-256 của token. Phiên kéo dài 30 ngày và tự gia hạn khi dùng. Có "đăng xuất thiết bị khác" và xoá tài khoản.
- **Tách dữ liệu:** mọi truy vấn, Server Action và API đều lọc theo tài khoản đang đăng nhập.
- **Dữ liệu cũ:** dữ liệu tạo trước khi có tài khoản được gán cho tài khoản đầu tiên đăng nhập.

### Tạo Google OAuth Client

1. Vào https://console.cloud.google.com/apis/credentials (tạo project nếu chưa có).
2. Mở **OAuth consent screen**, chọn *External* và điền tên app cùng email. Trong lúc thử, thêm Gmail của bạn vào *Test users*.
3. Vào **Credentials → Create credentials → OAuth client ID** và chọn loại **Web application**:
   - *Authorized JavaScript origins:* `http://localhost:3000`
   - *Authorized redirect URIs:* `http://localhost:3000/api/auth/google/callback`
4. Chép **Client ID** và **Client secret** vào `.env` (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`), rồi khởi động lại server.

> **Lưu ý:** Google chỉ chấp nhận redirect URI dạng `http://` cho `localhost`. Muốn đăng nhập từ máy khác hoặc điện thoại, app phải có
> **tên miền chạy HTTPS** (Cloudflare Tunnel, Tailscale Funnel, reverse proxy…). Khi đó:
>
> - đặt `APP_BASE_URL=https://ten-mien-cua-ban` và `COOKIE_SECURE=true`;
> - thêm `https://ten-mien-cua-ban/api/auth/google/callback` vào danh sách redirect URI trên Google.

Khi phát triển, có thể đặt `ALLOW_DEV_LOGIN=true` để hiện ô "đăng nhập thử" bằng email bất kỳ, không qua Google (giống `dev-login` của okia).
Ô này **tự tắt khi chạy production**.

## Chạy khi phát triển

Cần có: Node.js 20+ và Docker.

```bash
cp .env.example .env          # rồi sửa mật khẩu nếu muốn
npm install
npm run services:up           # khởi động Postgres (cổng 5433) + MinIO (9000, console 9001)
npm run dev                   # http://localhost:3000
npm run db:seed -- ban@gmail.com   # (tuỳ chọn) thêm dữ liệu mẫu cho tài khoản (đăng nhập 1 lần trước)
```

Khi server khởi động sẽ **tự chạy migration** và **tự tạo bucket MinIO**.

## Chạy production bằng Docker

```bash
cp .env.example .env          # điền GOOGLE_CLIENT_ID/SECRET, APP_BASE_URL, MINIO_SECRET_KEY…
docker compose --profile app up -d --build
```

Mở `http://<ip-máy>:3000`. Dữ liệu nằm trong 2 volume Docker là `pgdata` và `miniodata`.

## MCP cho AI agent

App có sẵn **MCP server** (Streamable HTTP) tại `<APP_BASE_URL>/api/mcp`. Claude Code, Claude Desktop, Cursor… dùng nó để đọc và thêm dữ liệu vào kho.

1. Vào **Tài khoản → API token cho AI agent** và tạo token:
   - quyền *đọc + ghi* hoặc *chỉ đọc*;
   - có thời hạn;
   - token chỉ hiện một lần;
   - mỗi token chỉ thấy kho của người tạo.
2. Chép lệnh cấu hình hiện ngay dưới token. Với Claude Code:

   ```bash
   claude mcp add --transport http kho-linh-kien https://inventory.nguyenducquan.io.vn/api/mcp      --header "Authorization: Bearer inv_…"
   ```

| Tool | Việc |
|---|---|
| `inventory_overview` | Tổng quan: số mặt hàng, giá trị kho, cần mua thêm, giao dịch gần đây |
| `search_items` | Tìm / lọc mặt hàng (không phân biệt dấu), theo danh mục, vị trí, loại, tình trạng |
| `get_item` | Chi tiết mặt hàng, thông số, link, ảnh/tài liệu, lịch sử |
| `get_item_images` | Trả ảnh (thumbnail) để agent xem trực tiếp |
| `list_categories`, `list_locations`, `list_movements` | Cây danh mục / vị trí, lịch sử nhập xuất |
| `create_item`, `update_item` | Thêm / sửa mặt hàng. Danh mục và vị trí truyền bằng tên, ví dụ `"Tụ điện > Tụ gốm"`; `createMissing` để tự tạo |
| `record_movement` | Nhập / xuất / kiểm kê, có ghi lịch sử, không cho xuất quá số đang có |
| `create_category`, `create_location` | Tạo danh mục / vị trí |
| `create_upload_url` | Xin link upload ngắn hạn cho 1 mặt hàng; agent `curl` file thẳng lên (xem dưới) |

Không có tool xoá: xoá chỉ làm được trên giao diện web. Token *chỉ đọc* bị chặn mọi tool ghi.

### Gắn ảnh / file

Nội dung file **không** đi qua MCP (model phải chép lại từng ký tự base64, rất tốn token). Thay vào đó agent gọi `create_upload_url` để lấy link upload rồi POST file thẳng lên:

```bash
curl -sS -X POST "https://inventory.nguyenducquan.io.vn/api/media/upload?t=up_…&filename=hop-nhua.jpg" \
  --data-binary @photos/hop-nhua.jpg
```

- Link chỉ upload được vào đúng 1 mặt hàng, mặc định hết hạn sau 15 phút (tối đa 60) và nhận tối đa 10 file (tối đa 50).
- Thu hồi API token thì link tạo từ token đó cũng mất hiệu lực.
- Loại file đoán theo đuôi `filename` nếu không gửi `Content-Type`. Nhận ảnh, video, PDF.
- Ảnh đầu tiên tự thành ảnh đại diện; thêm `&cover=1` để đổi.

Script cũng có thể upload bằng API token quyền ghi: `POST /api/media/upload?itemId=<id>&filename=<tên>` kèm header `Authorization: Bearer inv_…`.

## CI/CD

Push lên `main` sẽ build image (GHCR) rồi tự deploy lên **minisforum** qua GitHub Actions, theo mô hình của okia.
Xem [deploy/README.md](deploy/README.md).

## Lệnh hữu ích

| Lệnh | Tác dụng |
|---|---|
| `npm run db:generate` | Tạo migration sau khi sửa `src/db/schema.ts` |
| `npm run db:migrate` | Áp dụng migration (thường không cần, vì server tự chạy khi khởi động) |
| `npm run db:studio` | Mở Drizzle Studio để xem và sửa DB |
| `npm run typecheck` | Kiểm tra TypeScript |
| `docker compose down -v` | **Xoá sạch** DB và file (mất toàn bộ dữ liệu) |

## Ghi chú về MinIO

MinIO đã ngừng phát hành image Docker bản community (`minio/minio` không còn trên Docker Hub). Project này dùng
[`pgsty/minio`](https://hub.docker.com/r/pgsty/minio), một bản fork do cộng đồng duy trì, tương thích hoàn toàn.
Muốn đổi image thì đặt biến `MINIO_IMAGE` trong `.env`.

Console MinIO: http://localhost:9001 (đăng nhập bằng `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY`).

## Cấu trúc

```
src/
  app/(app)/          các trang: tổng quan, kho hàng, chi tiết, nhập/xuất, danh mục, vị trí
  app/api/media/      upload (stream lên MinIO) và đọc file (hỗ trợ Range cho video)
  app/api/export/     xuất CSV
  actions/            Server Actions (thêm/sửa/xoá, nhập/xuất, danh mục…)
  db/schema.ts        schema Drizzle
  lib/queries.ts      truy vấn dữ liệu
  lib/storage.ts      MinIO client
  lib/auth/           Google OAuth (PKCE + JWKS), phiên đăng nhập, liên kết tài khoản
  app/api/auth/       /google (bắt đầu), /google/callback, /dev-login
  app/api/mcp/        MCP server (Streamable HTTP, Bearer token)
  lib/mcp/server.ts   định nghĩa các tool MCP
  lib/inventory/      nghiệp vụ ghi dữ liệu dùng chung cho web và MCP
  proxy.ts            chuyển về /login khi chưa có cookie phiên
drizzle/              file migration SQL
scripts/seed.ts       dữ liệu mẫu
```
