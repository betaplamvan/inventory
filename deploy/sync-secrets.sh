#!/usr/bin/env bash
# Đẩy cấu hình từ deploy/.env.production (file local, gitignore) lên GitHub — file local là nguồn gốc.
#   bash deploy/sync-secrets.sh            # đẩy mọi biến có giá trị
#   bash deploy/sync-secrets.sh --dry-run  # chỉ liệt kê sẽ đẩy gì (không in giá trị)
# Cần gh CLI đã đăng nhập, quyền admin repo. Biến rỗng hoặc còn chứa ${...} chưa thay → bỏ qua.
set -euo pipefail

# Mặc định: repo GitHub của thư mục hiện tại (đặt REPO=<owner>/<repo> để chọn repo khác)
REPO="${REPO:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}"
FILE="$(dirname "$0")/.env.production"
# Bí mật (gh secret set) — Environment production
ENV_SECRETS="DATABASE_URL MINIO_ACCESS_KEY MINIO_SECRET_KEY GOOGLE_CLIENT_SECRET TELEGRAM_BOT_TOKEN SMTP_PASS"
# Biến không mật (gh variable set) — Environment production
ENV_VARS="MINIO_ENDPOINT MINIO_PORT MINIO_USE_SSL MINIO_BUCKET GOOGLE_CLIENT_ID APP_BASE_URL COOKIE_SECURE MAX_UPLOAD_MB SMTP_HOST SMTP_PORT SMTP_USER SMTP_FROM APP_PORT APP_MEM_LIMIT APP_CPU_LIMIT DOCKER_NETWORK"
DRY=0; [ "${1:-}" = "--dry-run" ] && DRY=1

[ -f "$FILE" ] || { echo "Không thấy $FILE (chép từ deploy/.env.production.example)"; exit 1; }
set -a
# shellcheck disable=SC1090
. "$FILE"
set +a

push() { # push <tên> — Secret của Environment production
  local name="$1"
  local value="${!name:-}"
  if [ -z "$value" ]; then echo "  bỏ qua $name (rỗng)"; return; fi
  if [[ "$value" == *'${'* || "$value" == *'://:@'* ]]; then echo "  bỏ qua $name (thiếu giá trị con)"; return; fi
  if [ "$DRY" = 1 ]; then echo "  sẽ đặt secret $name"; return; fi
  printf '%s' "$value" | gh secret set "$name" -R "$REPO" -e production >/dev/null && echo "  ✔ secret $name"
}

push_var() { # push_var <tên> — Variable (không mật) của Environment production
  local name="$1"
  local value="${!name:-}"
  if [ -z "$value" ]; then echo "  bỏ qua $name (rỗng)"; return; fi
  if [ "$DRY" = 1 ]; then echo "  sẽ đặt variable $name"; return; fi
  gh variable set "$name" -R "$REPO" -e production --body "$value" >/dev/null && echo "  ✔ variable $name"
}

if [ "$DRY" = 0 ]; then
  # Tạo Environment production nếu chưa có (idempotent)
  gh api -X PUT "repos/$REPO/environments/production" >/dev/null && echo "Environment production: OK"
fi
echo "Environment production — secret:"
for n in $ENV_SECRETS; do push "$n"; done
echo "Environment production — variable:"
for n in $ENV_VARS; do push_var "$n"; done
