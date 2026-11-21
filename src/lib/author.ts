/**
 * Thông tin tác giả Kho đồ, hiện ở trang "Ủng hộ tác giả" (/support) trên MỌI bản deploy,
 * kể cả bản người khác clone về tự chạy. Tiền ủng hộ đi thẳng tới tác giả, không qua máy chủ nào.
 *
 * Bạn fork dự án? Cứ giữ nguyên để ủng hộ tác giả gốc nếu muốn — cảm ơn bạn!
 * Thiếu BIN hoặc số tài khoản thì phần ủng hộ tự ẩn.
 */
export const AUTHOR = {
  /** Tên hiển thị của tác giả */
  name: "Nguyen Duc Quan",
  /** Link mã nguồn (GitHub…), để trống thì không hiện */
  sourceUrl: "https://github.com/betaplamvan/inventory",
  /** Bản do tác giả deploy, dùng ngay không cần tự cài; để trống thì không hiện */
  appUrl: "https://inventory.nguyenducquan.io.vn",
  bank: {
    /** Mã BIN ngân hàng, 6 số — tra ở https://api.vietqr.io/v2/banks */
    bin: "970422",
    /** Tên ngân hàng hiển thị */
    name: "MB Bank",
    /** Số tài khoản */
    accountNo: "0941672663",
    /** Tên chủ tài khoản, in hoa không dấu như trên app ngân hàng */
    accountName: "NGUYEN DUC QUAN",
  },
  /** Nội dung chuyển khoản điền sẵn (ASCII, ≤ 25 ký tự) để tác giả biết tiền đến từ app */
  note: "UNG HO KHO LINH KIEN",
} as const;

export const authorSupportEnabled = () =>
  /^\d{6}$/.test(AUTHOR.bank.bin) && /^[0-9A-Za-z]{4,19}$/.test(AUTHOR.bank.accountNo);
