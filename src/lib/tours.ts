/**
 * Nội dung hướng dẫn lần đầu cho từng trang (components/tour.tsx hiển thị).
 * target = phần tử có data-tour="<tên>" trên trang; liệt kê nhiều tên thì lấy cái đầu tiên đang hiện
 * (điện thoại và desktop có bố cục khác nhau). Bước có target không có trên trang (VD danh sách trống) bị bỏ qua.
 * Bước không có target hiện ở giữa màn hình.
 */

export type TourStep = { target?: string | string[]; title: string; body: string };

export type TourId =
  | "home"
  | "items"
  | "item"
  | "new-item"
  | "movements"
  | "scan"
  | "categories"
  | "locations"
  | "import"
  | "trash"
  | "account"
  | "labels";

export const TOURS: Record<TourId, TourStep[]> = {
  home: [
    {
      title: "Chào mừng đến Kho linh kiện",
      body: "Vài bước ngắn để làm quen. Mỗi trang có hướng dẫn riêng khi mở lần đầu; bấm nút ? cạnh tiêu đề để xem lại.",
    },
    {
      target: "home-empty",
      title: "Bắt đầu từ đây",
      body: "Kho đang trống: tạo vài danh mục, vị trí cất rồi thêm mặt hàng đầu tiên. Có sẵn danh sách trong Excel thì dùng Nhập từ file.",
    },
    {
      target: "home-stats",
      title: "Tình hình kho",
      body: "Số mặt hàng, số món sắp hết / hết hàng và giá trị ước tính. Bấm vào một ô để xem danh sách tương ứng.",
    },
    {
      target: "home-low",
      title: "Cần mua thêm",
      body: "Các món đã tụt xuống mức tối thiểu. Đặt mức tối thiểu cho từng mặt hàng để app nhắc; bật báo qua Telegram / email ở trang Tài khoản.",
    },
    {
      target: "nav-add",
      title: "Thêm mặt hàng",
      body: "Nút này luôn ở đây. Chỉ cần nhập tên, các thông tin khác bổ sung sau cũng được.",
    },
    {
      target: "nav-scan",
      title: "Quét mã",
      body: "Quét nhãn QR hoặc mã vạch SKU / MPN để mở ngay mặt hàng, rồi nhập / xuất tại chỗ.",
    },
    {
      target: "nav",
      title: "Các trang khác",
      body: "Danh mục, Vị trí cất, Nhập từ file, Thùng rác và Tài khoản nằm ở đây.",
    },
  ],
  items: [
    {
      target: "items-search",
      title: "Tìm và lọc",
      body: "Gõ tên, SKU, MPN, tag hay thông số, có dấu hay không dấu đều được. Lọc thêm theo loại, danh mục, vị trí, tình trạng.",
    },
    {
      target: "items-qty",
      title: "Chỉnh nhanh số lượng",
      body: "Bấm + / − để nhập hoặc xuất 1 đơn vị, có ghi lịch sử. Nhập số lượng lớn hay kiểm kê thì mở mặt hàng.",
    },
    {
      target: "items-row",
      title: "Xem chi tiết",
      body: "Bấm vào tên để xem ảnh, thông số, lịch sử và nhập / xuất.",
    },
    {
      target: "items-tools",
      title: "Nhập, xuất, in nhãn",
      body: "Nhập hàng loạt từ Excel, xuất CSV theo bộ lọc đang chọn, in nhãn QR cho các mặt hàng đang lọc.",
    },
    {
      target: "items-view",
      title: "Dạng hiển thị",
      body: "Chuyển giữa danh sách và lưới ảnh.",
    },
  ],
  item: [
    {
      target: "item-stock",
      title: "Tồn kho",
      body: "Số lượng hiện có, mức tối thiểu, giá trị và vị trí cất của mặt hàng.",
    },
    {
      target: "item-movement",
      title: "Nhập / Xuất / Kiểm kê",
      body: "Nhập: mua thêm. Xuất: lấy ra dùng. Kiểm kê: đặt lại theo số đếm thực tế. Ghi dự án hoặc nguồn hàng để sau này tra lại.",
    },
    {
      target: "item-media",
      title: "Ảnh và tài liệu",
      body: "Chụp ảnh bằng camera, thêm video hoặc datasheet. Ảnh đầu tiên tự thành ảnh đại diện.",
    },
    {
      target: "item-actions",
      title: "Thao tác",
      body: "In nhãn QR dán lên hộp, nhân bản thành món tương tự, hoặc xoá (vào thùng rác, khôi phục được trong 30 ngày).",
    },
    {
      target: "item-history",
      title: "Lịch sử",
      body: "Mọi thay đổi số lượng, kèm nguồn: web, agent nào hay nhập file.",
    },
  ],
  "new-item": [
    {
      target: "new-basic",
      title: "Chỉ cần tên",
      body: "Tên là trường bắt buộc duy nhất. Loại, danh mục, SKU và thông số bổ sung khi cần.",
    },
    {
      target: "new-stock",
      title: "Số lượng và vị trí",
      body: "Đặt mức tối thiểu để được nhắc khi sắp hết, chọn vị trí cất để sau này tìm nhanh.",
    },
    {
      target: "new-media",
      title: "Ảnh",
      body: "Chụp hoặc chọn ảnh ngay lúc thêm; ảnh được tải lên sau khi lưu.",
    },
    {
      target: "new-save",
      title: "Lưu",
      body: "Thanh lưu luôn nằm ở cuối màn hình, không cần cuộn xuống hết form.",
    },
  ],
  movements: [
    {
      target: "mv-search",
      title: "Tìm giao dịch",
      body: "Tìm theo tên mặt hàng, dự án / nguồn hoặc ghi chú.",
    },
    {
      target: "mv-type",
      title: "Lọc theo loại",
      body: "Chỉ xem Nhập, Xuất hoặc Kiểm kê.",
    },
    {
      target: "mv-list",
      title: "Từng thay đổi",
      body: "Mỗi dòng ghi số thay đổi, số còn lại, thời gian và nguồn thực hiện: web, agent nào hay nhập file.",
    },
  ],
  scan: [
    {
      target: "scan-camera",
      title: "Hướng camera vào mã",
      body: "Đọc nhãn QR của app, mã vạch hoặc QR chứa SKU / MPN (kể cả nhãn túi LCSC). Cho phép trình duyệt dùng camera khi được hỏi.",
    },
    {
      target: "scan-manual",
      title: "Hoặc gõ mã",
      body: "Nhập SKU, MPN hoặc mã vị trí (VD A1-03). Mã không khớp sẽ được đem đi tìm trong kho.",
    },
    {
      title: "Chưa có nhãn?",
      body: "In nhãn QR ở trang mặt hàng, danh sách kho hoặc Vị trí cất rồi dán lên hộp, ngăn tủ.",
    },
  ],
  categories: [
    {
      target: "cat-seed",
      title: "Tạo nhanh",
      body: "Một lần bấm là có bộ danh mục điện tử phổ biến; sửa, xoá lại tuỳ ý.",
    },
    {
      target: "tax-add",
      title: "Thêm danh mục",
      body: "Danh mục lồng được nhiều cấp, VD Tụ điện › Tụ gốm.",
    },
    {
      target: "tax-list",
      title: "Cây danh mục",
      body: "Số bên phải là số mặt hàng (gồm cả mục con), bấm để xem. Các nút thêm mục con, sửa, xoá nằm cuối mỗi dòng.",
    },
  ],
  locations: [
    {
      target: "tax-add",
      title: "Thêm vị trí",
      body: "Tủ, kệ, hộp, ngăn… lồng nhiều cấp. Đặt mã / nhãn dán (VD A1-03) để quét mã cho nhanh.",
    },
    {
      target: "tax-list",
      title: "Danh sách vị trí",
      body: "Bấm số mặt hàng để xem đồ đang cất ở đó.",
    },
    {
      target: "loc-labels",
      title: "In nhãn vị trí",
      body: "Dán nhãn QR lên tủ, hộp: quét là ra danh sách đồ bên trong.",
    },
  ],
  import: [
    {
      target: "import-template",
      title: "File mẫu",
      body: "Tải file mẫu để xem các cột. File Xuất CSV của kho cũng nhập lại được.",
    },
    {
      target: "import-file",
      title: "Chọn file hoặc dán bảng",
      body: "Chọn file .csv, hoặc copy các ô trong Excel / Google Sheets (kể cả dòng tiêu đề) rồi dán vào ô bên dưới.",
    },
    {
      target: "import-options",
      title: "Tuỳ chọn",
      body: "Dòng trùng ID / SKU thì cập nhật hay bỏ qua; có tự tạo danh mục, vị trí chưa có hay không.",
    },
    {
      target: "import-run",
      title: "Xem trước rồi mới nhập",
      body: "Xem trước không ghi gì. Kiểm tra từng dòng thêm mới / cập nhật / lỗi rồi mới bấm Nhập.",
    },
  ],
  trash: [
    {
      title: "Thùng rác",
      body: "Mặt hàng bị xoá (trên web hay qua agent) nằm ở đây 30 ngày, vẫn giữ ảnh và lịch sử, sau đó tự xoá hẳn.",
    },
    {
      target: "trash-list",
      title: "Khôi phục hoặc xoá hẳn",
      body: "Khôi phục đưa mặt hàng về kho. Xoá hẳn thì không lấy lại được.",
    },
  ],
  account: [
    {
      target: "acc-notify",
      title: "Thông báo sắp hết hàng",
      body: "Kết nối Telegram hoặc bật email để được báo ngay khi một món tụt xuống mức tối thiểu.",
    },
    {
      target: "acc-tokens",
      title: "Kết nối trợ lý AI",
      body: "Dán địa chỉ MCP vào Claude (hoặc tạo API token) để trợ lý AI tìm, thêm, nhập / xuất hàng giúp bạn.",
    },
    {
      target: "acc-tour",
      title: "Xem lại hướng dẫn",
      body: "Bấm đây để các hướng dẫn hiện lại từ đầu ở mọi trang.",
    },
  ],
  labels: [
    {
      target: "labels-size",
      title: "Chọn cỡ nhãn",
      body: "40×25, 50×30 hoặc 70×40 mm, hợp giấy decal cắt sẵn hoặc máy in nhãn.",
    },
    {
      target: "labels-print",
      title: "In",
      body: "Khi in: chọn lề Không / Tối thiểu và tỉ lệ 100%. QR quét bằng camera thường cũng mở đúng trang.",
    },
  ],
};
