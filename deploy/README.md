# CI/CD: GitHub Actions, deploy lên máy chủ riêng

Workflow [`ci-cd.yml`](../.github/workflows/ci-cd.yml) chạy như sau:

```
push main ─► Build (GitHub, ubuntu-latest) ──thành công──────────────┐
                 │ không nhận được runner (hết quota)                ├─► Deploy (self-hosted)
                 └─► Build (self-hosted, dự phòng) ──thành công───────┘
pull_request ─► chỉ Build (lint + typecheck + build image), không push, không deploy
```

Commit chỉ sửa file `*.md` thì không chạy gì.

- **Build** gồm `npm ci`, lint, typecheck, build image Docker rồi push lên GHCR `ghcr.io/<owner>/inventory` với tag `<sha>` và `latest`. Các bước dùng chung nằm trong composite action [`app-ci`](../.github/actions/app-ci/action.yml).
- **Dự phòng** chỉ chạy khi job GitHub *chưa chạy được bước nào* (hết phút, chạm spending limit). Lỗi code thật thì không build lại.
  - Biến repo `CI_RUNNER=minisforum` bỏ hẳn job GitHub; `CI_RUNNER=github` tắt dự phòng.
  - Chạy tay: Actions → CI/CD → *Run workflow* → chọn `runner`.
- **Deploy** dùng [`deploy-container.sh`](deploy-container.sh):
  - pull image theo sha, thay container `inventory`, chờ healthcheck `/api/health` (kiểm tra cả kết nối Postgres);
  - không healthy thì **chạy lại image cũ** và báo đỏ;
  - giữ 3 image gần nhất trên máy và 10 bản trên GHCR;
  - container chỉ bind `127.0.0.1:3040`, có giới hạn RAM/CPU, log rotation 3 × 20 MB.
- **Migration DB** chạy tự động mỗi lần container khởi động (`src/instrumentation.ts`), không cần bước riêng.

## Chuẩn bị (một lần)

1. **Runner:** một self-hosted runner (cấp repo hoặc org) có label `minisforum` (đổi label thì sửa cả `ci-cd.yml` và `.github/actionlint.yaml`). Nếu job deploy đứng ở trạng thái *Queued*, vào Org → Settings → Actions → Runner groups và cho repo `inventory` dùng group chứa runner.
2. **Postgres / MinIO** trên máy chủ:
   - Postgres: role `inventory` là chủ DB `inventory`; các role khác (trừ superuser) không kết nối được vào DB này. Migration tự chạy bằng role này.
   - MinIO: user `inventory-app` gắn policy `inventory-rw`, chỉ đọc/ghi/xoá trong `inventory-bucket` và không tạo được bucket khác.
   - Container app chạy trong network `local-services` (`DOCKER_NETWORK`), cùng network với container `postgres` và `minio`, nên gọi `postgres:5432` và `minio:9000` theo tên.
3. **Tên miền HTTPS** (Cloudflare Tunnel, reverse proxy…) trỏ tới `http://localhost:3040`.
4. **Google OAuth:** thêm `<APP_BASE_URL>/api/auth/google/callback` vào *Authorized redirect URIs* của OAuth client.

## Bí mật: file local là nguồn gốc

```bash
cp deploy/.env.production.example deploy/.env.production   # gitignore, chỉ nằm trên máy dev
# điền DATABASE_URL, MINIO_*, GOOGLE_*, APP_BASE_URL…
bash deploy/sync-secrets.sh --dry-run   # xem sẽ đặt gì (không in giá trị)
bash deploy/sync-secrets.sh             # tạo Environment production + đặt secret/variable
```

File tải về từ bên thứ ba (JSON OAuth client của Google…) để trong `deploy/secrets/` (đã gitignore).

| Environment `production` | Tên | Ghi chú |
|---|---|---|
| Secret | `DATABASE_URL` | **Bắt buộc.** `postgres://inventory:***@postgres:5432/inventory` |
| Secret | `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY` | **Bắt buộc** |
| Secret | `GOOGLE_CLIENT_SECRET` | **Bắt buộc** |
| Variable | `GOOGLE_CLIENT_ID`, `APP_BASE_URL` | **Bắt buộc.** `APP_BASE_URL` là tên miền public (https) |
| Variable | `MINIO_ENDPOINT`, `MINIO_BUCKET` | **Bắt buộc.** `minio`, `inventory-bucket` |
| Variable | `MINIO_PORT`, `MINIO_USE_SSL` | Mặc định `9000`, `false` |
| Variable | `COOKIE_SECURE` | Mặc định `true` (chạy sau HTTPS) |
| Variable | `MAX_UPLOAD_MB` | Mặc định `500` |
| Variable | `APP_PORT`, `APP_MEM_LIMIT`, `APP_CPU_LIMIT`, `DOCKER_NETWORK` | `3040`, `768m`, `1.5`, `local-services` |

`ALLOW_DEV_LOGIN` **không** được truyền vào container production.

## Chạy tay

```bash
docker build -t inventory:local .
# thử script deploy với image local (đặt đủ biến như trong ci-cd.yml)
SKIP_PULL=1 NAME=inventory IMAGE=inventory:local PORT_MAP=127.0.0.1:3040:3000 NETWORK=inventory \
  PASS_ENV="DATABASE_URL MINIO_ENDPOINT ..." bash deploy/deploy-container.sh
```

Kiểm tra workflow trước khi push: `docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:latest`.
