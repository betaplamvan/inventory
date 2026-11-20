// Tạo ảnh VietQR ủng hộ tác giả cho README (docs/support-qr.png) từ src/lib/author.ts.
// Chạy lại sau khi sửa thông tin tác giả:  npx tsx scripts/gen-support-qr.ts
import QRCode from "qrcode";
import { AUTHOR, authorSupportEnabled } from "../src/lib/author";
import { vietqrPayload } from "../src/lib/vietqr";

if (!authorSupportEnabled()) {
  console.error("src/lib/author.ts chưa có BIN / số tài khoản hợp lệ");
  process.exit(1);
}
// Mã tĩnh (không điền số tiền) để người xem README tự nhập số tiền
const payload = vietqrPayload({ bin: AUTHOR.bank.bin, accountNo: AUTHOR.bank.accountNo, note: AUTHOR.note });
QRCode.toFile("docs/support-qr.png", payload, { margin: 2, width: 480, errorCorrectionLevel: "M" }).then(() =>
  console.log("Đã tạo docs/support-qr.png"),
);
