# SearXNG — tra web cho trợ lý chat

Trợ lý chat có hai tool tra web: `web_search` (tìm) và `read_webpage` (đọc một trang). Tìm kiếm đi qua
[SearXNG](https://docs.searxng.org/) tự host — gom kết quả từ nhiều máy tìm kiếm, miễn phí, không cần API key.

SearXNG chạy **trong cùng docker network với container app**, không mở cổng ra ngoài: chỉ app gọi được
(`http://searxng:8080`), người ngoài internet không dùng ké được.

## Cài trên máy chủ (một lần)

```bash
cd deploy/searxng                       # chép thư mục này lên máy chủ
echo "SEARXNG_SECRET=$(openssl rand -hex 32)" > .env
# Nếu network của app khác local-services: thêm DOCKER_NETWORK=<tên network> vào .env
docker compose up -d
docker compose logs -f searxng          # chờ dòng "Listening at: http://0.0.0.0:8080"
```

Kiểm tra từ bên trong network (không cần mở cổng):

```bash
docker run --rm --network local-services curlimages/curl -s "http://searxng:8080/search?q=ne555&format=json" | head -c 300
```

Rồi bật tra web cho app:

1. Thêm `SEARCH_URL=http://searxng:8080` vào `deploy/.env.production`.
2. `bash deploy/sync-secrets.sh` (đẩy thành variable của Environment production).
3. Chạy lại job Deploy (Actions → CI/CD → Re-run) hoặc push commit tiếp theo.

Không có `SEARCH_URL` thì trợ lý vẫn chạy bình thường, chỉ không có hai tool tra web.

## Ghi chú

- `settings.yml`: bật định dạng `json` (app cần), tắt `limiter` (chỉ dùng nội bộ nên không cần Valkey/Redis chống bot).
- Cập nhật SearXNG: `docker compose pull && docker compose up -d`.
- Một số máy tìm kiếm thỉnh thoảng chặn / bắt captcha; SearXNG tự bỏ qua máy đó và dùng các máy còn lại.
- An toàn: `read_webpage` chỉ đọc link http/https công khai — chặn localhost, LAN (10.x, 172.16–31.x, 192.168.x),
  Tailscale (100.64/10), link-local, IPv6 nội bộ; kiểm tra lúc kết nối (chống DNS rebinding) và sau mỗi lần chuyển hướng.
  Nội dung web được đánh dấu là dữ liệu tham khảo; mọi thao tác ghi vẫn phải bấm Xác nhận.
