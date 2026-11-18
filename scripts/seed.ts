/**
 * Tạo dữ liệu mẫu cho 1 tài khoản (tài khoản phải đăng nhập ít nhất 1 lần trước).
 *   npm run db:seed -- ban@gmail.com
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { count, eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { buildSearchText } from "../src/lib/item-input";

try {
  process.loadEnvFile(".env");
} catch {}

const client = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
const db = drizzle(client, { schema });
const { categories, locations, items, stockMovements, users } = schema;

async function main() {
  const email = (process.argv[2] || "").trim().toLowerCase();
  if (!email) {
    console.error("Cách dùng: npm run db:seed -- <email-tài-khoản>");
    process.exitCode = 1;
    return;
  }
  const [user] = await db.select().from(users).where(eq(users.email, email));
  if (!user) {
    console.error(`Chưa có tài khoản ${email}. Hãy đăng nhập vào app ít nhất 1 lần trước.`);
    process.exitCode = 1;
    return;
  }
  const userId = user.id;
  const [{ n }] = await db.select({ n: count() }).from(items).where(eq(items.userId, userId));
  if (n > 0) {
    console.log(`Tài khoản ${email} đã có ${n} mặt hàng — bỏ qua seed.`);
    return;
  }

  const cat = async (name: string, parentId: number | null = null, sortOrder = 0) =>
    (await db.insert(categories).values({ name, parentId, sortOrder, userId }).returning())[0].id;
  const loc = async (name: string, code: string | null, parentId: number | null = null) =>
    (await db.insert(locations).values({ name, code, parentId, userId }).returning())[0].id;

  const cRes = await cat("Điện trở", null, 0);
  const cResTht = await cat("Điện trở cắm (THT)", cRes);
  const cCap = await cat("Tụ điện", null, 1);
  const cCapCer = await cat("Tụ gốm", cCap);
  const cCapEl = await cat("Tụ hoá", cCap);
  const cDiode = await cat("Diode", null, 2);
  const cLed = await cat("LED", cDiode);
  const cTr = await cat("Transistor", null, 3);
  const cIc = await cat("IC", null, 4);
  const cMcu = await cat("Vi điều khiển", cIc);
  const cReg = await cat("IC nguồn / ổn áp", cIc);
  const cMod = await cat("Module", null, 5);
  const cSensor = await cat("Module cảm biến", cMod);
  const cConn = await cat("Đầu nối & Dây", null, 6);
  const cTool = await cat("Dụng cụ", null, 7);
  const cSupply = await cat("Vật tư tiêu hao", null, 8);

  const lCab = await loc("Tủ linh kiện A", "A");
  const lA1 = await loc("Ngăn A1", "A1", lCab);
  const lA2 = await loc("Ngăn A2", "A2", lCab);
  const lA3 = await loc("Ngăn A3", "A3", lCab);
  const lBox = await loc("Hộp module", "BOX-M");
  const lDesk = await loc("Bàn làm việc", "DESK");
  const lShelf = await loc("Kệ dụng cụ", "SHELF");

  type Seed = Omit<schema.NewItem, "searchText">;
  const data: Seed[] = [
    { name: "Điện trở 10kΩ 1/4W", sku: "R-10K", kind: "component", categoryId: cResTht, locationId: lA1, package: "THT", specs: [{ key: "Giá trị", value: "10kΩ" }, { key: "Công suất", value: "0.25W" }, { key: "Sai số", value: "1%" }], unit: "con", quantity: 180, minQuantity: 50, unitPrice: 100, supplier: "Ban Linh Kiện", tags: ["resistor", "pull-up"] },
    { name: "Điện trở 220Ω 1/4W", sku: "R-220", kind: "component", categoryId: cResTht, locationId: lA1, package: "THT", specs: [{ key: "Giá trị", value: "220Ω" }, { key: "Công suất", value: "0.25W" }], unit: "con", quantity: 35, minQuantity: 50, unitPrice: 100, supplier: "Ban Linh Kiện", tags: ["resistor", "led"] },
    { name: "Tụ gốm 104 (100nF) 50V", sku: "C-104", kind: "component", categoryId: cCapCer, locationId: lA2, package: "THT", specs: [{ key: "Giá trị", value: "100nF" }, { key: "Điện áp", value: "50V" }], unit: "con", quantity: 120, minQuantity: 30, unitPrice: 200, supplier: "Ban Linh Kiện", tags: ["decoupling"] },
    { name: "Tụ hoá 470µF 25V", sku: "C-470U-25", kind: "component", categoryId: cCapEl, locationId: lA2, package: "Radial 8x12", specs: [{ key: "Giá trị", value: "470µF" }, { key: "Điện áp", value: "25V" }], unit: "con", quantity: 8, minQuantity: 10, unitPrice: 1500, supplier: "Ban Linh Kiện" },
    { name: "LED đỏ 5mm", sku: "LED-5-R", kind: "component", categoryId: cLed, locationId: lA3, package: "5mm", specs: [{ key: "Màu", value: "Đỏ" }, { key: "Vf", value: "2V" }], unit: "con", quantity: 60, minQuantity: 20, unitPrice: 300, tags: ["led"] },
    { name: "Transistor 2N2222", sku: "Q-2N2222", kind: "component", categoryId: cTr, locationId: lA3, manufacturer: "onsemi", mpn: "P2N2222AG", package: "TO-92", specs: [{ key: "Loại", value: "NPN" }, { key: "Ic", value: "600mA" }], unit: "con", quantity: 0, minQuantity: 10, unitPrice: 500, datasheetUrl: "https://www.onsemi.com/pdf/datasheet/p2n2222a-d.pdf" },
    { name: "IC 555 Timer", sku: "IC-NE555", kind: "component", categoryId: cIc, locationId: lA3, manufacturer: "Texas Instruments", mpn: "NE555P", package: "DIP-8", unit: "con", quantity: 12, minQuantity: 5, unitPrice: 3000 },
    { name: "IC ổn áp AMS1117-3.3", sku: "IC-AMS1117-33", kind: "component", categoryId: cReg, locationId: lA3, manufacturer: "AMS", mpn: "AMS1117-3.3", package: "SOT-223", specs: [{ key: "Điện áp ra", value: "3.3V" }, { key: "Dòng", value: "1A" }], unit: "con", quantity: 4, minQuantity: 5, unitPrice: 2500 },
    { name: "ATmega328P-PU", sku: "MCU-328P", kind: "component", categoryId: cMcu, locationId: lA3, manufacturer: "Microchip", mpn: "ATMEGA328P-PU", package: "DIP-28", unit: "con", quantity: 3, minQuantity: 1, unitPrice: 65000, tags: ["arduino", "avr"] },
    { name: "Kit ESP32 DevKit V1 (WROOM-32)", sku: "MOD-ESP32", kind: "module", categoryId: cMod, locationId: lBox, specs: [{ key: "Chip chính", value: "ESP32-D0WD" }, { key: "Giao tiếp", value: "WiFi, BLE" }, { key: "Điện áp hoạt động", value: "3.3V" }], unit: "cái", quantity: 2, minQuantity: 1, unitPrice: 120000, tags: ["wifi", "iot"] },
    { name: "Cảm biến nhiệt độ độ ẩm DHT22", sku: "SEN-DHT22", kind: "module", categoryId: cSensor, locationId: lBox, unit: "cái", quantity: 1, minQuantity: 2, unitPrice: 85000, tags: ["sensor"] },
    { name: "Dây cắm breadboard đực-đực 20cm (40 sợi)", sku: "WIRE-MM-20", kind: "consumable", categoryId: cConn, locationId: lDesk, unit: "bộ", quantity: 3, minQuantity: 1, unitPrice: 15000 },
    { name: "Mỏ hàn T12 (tay hàn + điều khiển)", sku: "TOOL-T12", kind: "tool", categoryId: cTool, locationId: lShelf, specs: [{ key: "Công suất", value: "72W" }], unit: "bộ", quantity: 1, minQuantity: 0, unitPrice: 650000 },
    { name: "Đồng hồ vạn năng UNI-T UT33D+", sku: "EQ-UT33D", kind: "equipment", categoryId: cTool, locationId: lShelf, manufacturer: "UNI-T", unit: "cái", quantity: 1, minQuantity: 0, unitPrice: 320000 },
    { name: "Thiếc hàn 0.8mm 100g", sku: "SUP-SOLDER-08", kind: "consumable", categoryId: cSupply, locationId: lDesk, specs: [{ key: "Đường kính", value: "0.8mm" }, { key: "Thành phần", value: "Sn63/Pb37" }], unit: "cuộn", quantity: 0.5, minQuantity: 1, unitPrice: 75000 },
    { name: "Ống co nhiệt mix size (bộ 127 ống)", sku: "SUP-HEATSHRINK", kind: "consumable", categoryId: cSupply, locationId: lDesk, unit: "bộ", quantity: 1, minQuantity: 0, unitPrice: 30000 },
  ];

  for (const d of data) {
    const [row] = await db
      .insert(items)
      .values({ ...d, userId, searchText: buildSearchText({ ...d, tags: d.tags ?? [], specs: d.specs ?? [] }) })
      .returning();
    if ((d.quantity ?? 0) > 0) {
      await db.insert(stockMovements).values({
        itemId: row.id,
        type: "in",
        delta: d.quantity!,
        balanceAfter: d.quantity!,
        unitPrice: d.unitPrice ?? null,
        note: "Tồn kho ban đầu",
      });
    }
  }
  console.log(`Đã tạo ${data.length} mặt hàng mẫu cho ${email}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => client.end());
