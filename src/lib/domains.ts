import type { Domain, ItemKind } from "@/db/schema";

/**
 * Ba kho trong một app — mọi thứ khác nhau giữa các kho nằm ở đây (tên gọi, loại, đơn vị, thông số gợi ý,
 * trường nào hiện trong form, danh mục tạo sẵn, vai trò của trợ lý). Màu giao diện: globals.css
 * (html[data-domain="…"]), chọn kho: cookie DOMAIN_COOKIE.
 */

export type { Domain };
export const DOMAINS: readonly Domain[] = ["electronics", "wardrobe", "pantry"];
export const DEFAULT_DOMAIN: Domain = "electronics";
/** Cookie chọn kho — đọc được từ JS (script đặt màu trước khi vẽ trang), không phải bí mật */
export const DOMAIN_COOKIE = "inv_domain";

export const isDomain = (v: unknown): v is Domain => typeof v === "string" && (DOMAINS as string[]).includes(v);
export const toDomain = (v: unknown): Domain => (isDomain(v) ? v : DEFAULT_DOMAIN);

export type DomainConfig = {
  id: Domain;
  /** Tên ngắn trên nút chuyển kho */
  label: string;
  /** Tên kho đầy đủ */
  space: string;
  /** Biểu tượng (tên icon lucide, map trong components/domain-icon.tsx) */
  icon: "cpu" | "shirt" | "carrot";
  /** Gọi một món: "mặt hàng" / "món đồ" / "thực phẩm" */
  noun: string;
  description: string;
  kinds: ItemKind[];
  defaultKind: ItemKind;
  units: string[];
  defaultUnit: string;
  specPresets: Partial<Record<ItemKind, string[]>>;
  /** Tiêu đề mục thông số trong form */
  specsTitle: string;
  /** Nhãn ô hãng sản xuất (null = ẩn) */
  manufacturerLabel: string | null;
  showMpn: boolean;
  showPackage: boolean;
  showDatasheet: boolean;
  /** Có hạn sử dụng (thực phẩm) */
  showExpiry: boolean;
  placeholders: { name: string; sku: string; tags: string; supplier: string; location: string };
  supplierSuggestions: string[];
  /** Danh mục tạo sẵn: [cha, [con…]] */
  categoryPresets: [string, string[]][];
  /** Vị trí tạo sẵn */
  locationPresets: [string, string[]][];
  assistant: {
    /** Lời chào trong khung chat trống */
    intro: string;
    suggestions: string[];
    /** Thêm vào system prompt: vai trò + cách brainstorm của kho này */
    role: string;
  };
};

const ELECTRONICS: DomainConfig = {
  id: "electronics",
  label: "Linh kiện",
  space: "Kho linh kiện",
  icon: "cpu",
  noun: "mặt hàng",
  description: "Linh kiện, module, dụng cụ và vật tư điện tử",
  kinds: ["component", "module", "tool", "consumable", "equipment", "other"],
  defaultKind: "component",
  units: ["cái", "con", "bộ", "chiếc", "cuộn", "mét", "gram", "hộp", "túi", "tấm", "lọ", "cặp"],
  defaultUnit: "cái",
  specPresets: {
    component: ["Giá trị", "Điện áp", "Dòng", "Công suất", "Sai số"],
    module: ["Điện áp hoạt động", "Giao tiếp", "Kích thước", "Chip chính"],
    tool: ["Công suất", "Kích thước", "Nguồn"],
    consumable: ["Đường kính", "Thành phần", "Khối lượng"],
    equipment: ["Dải đo", "Độ chính xác", "Nguồn"],
  },
  specsTitle: "Thông số kỹ thuật",
  manufacturerLabel: "Hãng sản xuất",
  showMpn: true,
  showPackage: true,
  showDatasheet: true,
  showExpiry: false,
  placeholders: {
    name: "VD: Điện trở 10kΩ 1/4W, ESP32-WROOM-32, Mỏ hàn T12…",
    sku: "R-10K-0805",
    tags: "smd, arduino, nguồn…",
    supplier: "banlinhkien, Hshop, Shopee…",
    location: "Tủ A › Ngăn 3",
  },
  supplierSuggestions: ["Ban Linh Kiện", "Hshop", "Điện Tử Tương Lai", "Shopee", "LCSC", "AliExpress"],
  categoryPresets: [
    ["Điện trở", ["Điện trở cắm (THT)", "Điện trở dán (SMD)", "Biến trở / Triết áp"]],
    ["Tụ điện", ["Tụ gốm", "Tụ hoá", "Tụ tantalum", "Tụ film"]],
    ["Cuộn cảm & Biến áp", []],
    ["Diode", ["Diode chỉnh lưu", "Diode zener", "Diode schottky", "LED"]],
    ["Transistor", ["BJT", "MOSFET", "IGBT / Triac / SCR"]],
    ["IC", ["Vi điều khiển", "IC nguồn / ổn áp", "Op-amp", "IC logic", "IC driver", "IC nhớ"]],
    ["Module", ["Module cảm biến", "Module truyền thông", "Module nguồn", "Màn hình", "Board phát triển"]],
    ["Đầu nối & Dây", ["Header / Jumper", "Terminal", "Jack / USB", "Dây điện"]],
    ["Công tắc & Nút nhấn", []],
    ["Relay", []],
    ["Thạch anh & Dao động", []],
    ["Cầu chì & Bảo vệ", []],
    ["Pin & Nguồn", []],
    ["Cơ khí", ["Ốc vít / Trụ đồng", "Vỏ hộp", "Quạt / Tản nhiệt"]],
    ["Dụng cụ", ["Dụng cụ hàn", "Dụng cụ đo", "Dụng cụ cắt / kìm", "Dụng cụ khác"]],
    ["Vật tư tiêu hao", ["Thiếc hàn", "Nhựa thông / Flux", "Băng keo / Ống co nhiệt", "Phíp đồng / PCB"]],
  ],
  locationPresets: [
    ["Tủ linh kiện", ["Ngăn 1", "Ngăn 2", "Ngăn 3"]],
    ["Hộp module", []],
    ["Bàn làm việc", []],
  ],
  assistant: {
    intro: "Hỏi về hàng tồn, tìm linh kiện, brainstorm mạch DIY từ những gì đang có.",
    suggestions: [
      "Với linh kiện đang có, làm được mạch gì vui?",
      "Làm mạch nháy LED 555 thì còn thiếu gì?",
      "Linh kiện nào sắp hết cần mua thêm?",
      "Tìm tụ gốm 100nF",
    ],
    role:
      "Bạn là trợ lý kho linh kiện điện tử và bạn đồng hành DIY. Khi brainstorm mạch / dự án: xem kho thật bằng " +
      "inventory_snapshot, đề xuất mạch làm được với linh kiện sẵn có (sơ đồ khối ngắn gọn, danh sách linh kiện kèm " +
      "giá trị, lưu ý an toàn điện), chỉ rõ món nào ĐÃ CÓ trong kho (kèm link) và món nào CÒN THIẾU. Phần còn thiếu " +
      "thì gọi add_shopping_items luôn (ghi chú dùng cho mạch nào) — app hiện nút Xác nhận, không hỏi lại bằng lời.",
  },
};

const WARDROBE: DomainConfig = {
  id: "wardrobe",
  label: "Quần áo",
  space: "Tủ quần áo",
  icon: "shirt",
  noun: "món đồ",
  description: "Áo, quần, váy, giày dép và phụ kiện",
  kinds: ["top", "bottom", "dress", "outerwear", "shoes", "accessory", "other"],
  defaultKind: "top",
  units: ["chiếc", "cái", "đôi", "bộ"],
  defaultUnit: "chiếc",
  specPresets: {
    top: ["Màu", "Size", "Chất liệu", "Kiểu dáng", "Mùa", "Phong cách"],
    bottom: ["Màu", "Size", "Chất liệu", "Kiểu dáng", "Mùa", "Phong cách"],
    dress: ["Màu", "Size", "Chất liệu", "Độ dài", "Dịp", "Phong cách"],
    outerwear: ["Màu", "Size", "Chất liệu", "Độ ấm", "Phong cách"],
    shoes: ["Màu", "Size", "Chất liệu", "Kiểu", "Dịp"],
    accessory: ["Màu", "Chất liệu", "Loại", "Dịp"],
  },
  specsTitle: "Đặc điểm",
  manufacturerLabel: "Thương hiệu",
  showMpn: false,
  showPackage: false,
  showDatasheet: false,
  showExpiry: false,
  placeholders: {
    name: "VD: Sơ mi oxford trắng, Quần kaki be, Giày lười da nâu…",
    sku: "AO-01",
    tags: "công sở, đi chơi, mùa hè…",
    supplier: "Uniqlo, Shopee, chợ…",
    location: "Tủ quần áo › Ngăn kéo 2",
  },
  supplierSuggestions: ["Uniqlo", "Zara", "H&M", "Routine", "Shopee", "Lazada"],
  categoryPresets: [
    ["Áo", ["Áo thun", "Sơ mi", "Áo len", "Áo polo"]],
    ["Quần", ["Quần jean", "Quần kaki", "Quần short", "Quần âu"]],
    ["Váy / đầm", []],
    ["Áo khoác", ["Áo khoác nhẹ", "Áo khoác dày"]],
    ["Giày dép", ["Giày thể thao", "Giày da", "Dép / sandal"]],
    ["Phụ kiện", ["Túi", "Mũ", "Thắt lưng", "Trang sức"]],
    ["Đồ ngủ / mặc nhà", []],
  ],
  locationPresets: [
    ["Tủ quần áo", ["Ngăn treo", "Ngăn kéo 1", "Ngăn kéo 2"]],
    ["Kệ giày", []],
    ["Vali / hộp đồ trái mùa", []],
  ],
  assistant: {
    intro: "Hỏi về tủ đồ, nhờ phối đồ theo dịp / thời tiết từ những món đang có.",
    suggestions: [
      "Phối cho tôi một bộ đi cà phê cuối tuần",
      "Đi phỏng vấn mặc gì với đồ đang có?",
      "Tủ đồ còn thiếu món cơ bản nào?",
      "Áo nào hợp với quần kaki be?",
    ],
    role:
      "Bạn là trợ lý tủ quần áo và stylist cá nhân. Khi phối đồ: xem tủ đồ thật bằng inventory_snapshot (màu, size, " +
      "chất liệu, mùa, phong cách nằm trong thông số), gợi ý 2–3 bộ phối theo dịp / thời tiết người dùng nói, giải " +
      "thích ngắn vì sao hợp (màu, tỷ lệ, chất liệu), chỉ dùng món ĐÃ CÓ (kèm link). Nếu thêm một món sẽ hoàn thiện " +
      "bộ phối hoặc tủ đồ thiếu món cơ bản, gọi add_shopping_items luôn (ghi chú cho bộ phối nào) — app hiện nút Xác nhận.",
  },
};

const PANTRY: DomainConfig = {
  id: "pantry",
  label: "Thực phẩm",
  space: "Tủ bếp",
  icon: "carrot",
  noun: "thực phẩm",
  description: "Tủ lạnh, ngăn đá và kệ đồ khô",
  kinds: ["produce", "protein", "dairy", "grain", "spice", "drink", "snack", "cooked", "other"],
  defaultKind: "produce",
  units: ["g", "kg", "ml", "lít", "quả", "củ", "bó", "gói", "hộp", "chai", "lon", "lọ", "cái"],
  defaultUnit: "g",
  specPresets: {
    produce: ["Xuất xứ", "Độ tươi"],
    protein: ["Phần", "Cách bảo quản"],
    dairy: ["Loại", "Đã mở"],
    grain: ["Loại", "Khối lượng tịnh"],
    spice: ["Loại", "Đã mở"],
    drink: ["Dung tích", "Loại"],
    cooked: ["Món", "Nấu ngày"],
  },
  specsTitle: "Thông tin thêm",
  manufacturerLabel: "Thương hiệu",
  showMpn: false,
  showPackage: false,
  showDatasheet: false,
  showExpiry: true,
  placeholders: {
    name: "VD: Trứng gà, Cà chua, Gạo ST25, Nước mắm…",
    sku: "TP-01",
    tags: "ăn sáng, healthy, nấu lẩu…",
    supplier: "Bách Hoá Xanh, WinMart, chợ…",
    location: "Tủ lạnh › Ngăn mát",
  },
  supplierSuggestions: ["Bách Hoá Xanh", "WinMart", "Co.op Mart", "Chợ", "Shopee", "GrabMart"],
  categoryPresets: [
    ["Rau củ quả", ["Rau lá", "Củ", "Trái cây"]],
    ["Thịt cá trứng", ["Thịt", "Hải sản", "Trứng", "Đậu phụ"]],
    ["Sữa & chế phẩm", []],
    ["Đồ khô", ["Gạo", "Mì / bún / phở khô", "Đồ hộp"]],
    ["Gia vị", ["Nước chấm", "Gia vị khô", "Dầu ăn"]],
    ["Đồ uống", []],
    ["Đồ ăn vặt", []],
  ],
  locationPresets: [
    ["Tủ lạnh", ["Ngăn mát", "Ngăn rau", "Cánh tủ"]],
    ["Ngăn đá", []],
    ["Kệ đồ khô", []],
    ["Tủ gia vị", []],
  ],
  assistant: {
    intro: "Hỏi tủ bếp còn gì, nhờ gợi ý món nấu được từ nguyên liệu đang có.",
    suggestions: [
      "Tối nay nấu được món gì với đồ đang có?",
      "Đồ gì sắp hết hạn, nấu gì cho kịp?",
      "Lên thực đơn 3 ngày, còn thiếu gì thì thêm vào danh sách mua",
      "Còn bao nhiêu trứng?",
    ],
    role:
      "Bạn là trợ lý tủ bếp và đầu bếp gia đình. Khi gợi ý món: xem nguyên liệu thật bằng inventory_snapshot (số " +
      "lượng, hạn sử dụng), ưu tiên dùng đồ SẮP HẾT HẠN, gợi ý 2–3 món kèm nguyên liệu (ghi rõ món nào ĐÃ CÓ, kèm " +
      "link) và các bước nấu ngắn gọn. Nguyên liệu còn thiếu thì gọi add_shopping_items luôn (ghi chú cho món nào) — " +
      "app hiện nút Xác nhận, không hỏi lại bằng lời. Người dùng nói đã nấu xong thì có thể đề nghị trừ kho các nguyên liệu đã dùng bằng " +
      "record_movement (type out).",
  },
};

export const DOMAIN_CONFIG: Record<Domain, DomainConfig> = {
  electronics: ELECTRONICS,
  wardrobe: WARDROBE,
  pantry: PANTRY,
};

export const domainConfig = (d: Domain) => DOMAIN_CONFIG[d];

/** Loại hàng thuộc kho nào ("other" thuộc mọi kho) */
export const kindAllowed = (domain: Domain, kind: ItemKind) => DOMAIN_CONFIG[domain].kinds.includes(kind);

/** Số ngày coi là "sắp hết hạn" */
export const EXPIRING_DAYS = 3;
