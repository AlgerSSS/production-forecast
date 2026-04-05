import "dotenv/config";
import mysql from "mysql2/promise";
import { readFileSync } from "fs";
import path from "path";
import ExcelJS from "exceljs";

const DATABASE_URL = process.env.DATABASE_URL || "mysql://root:20010709@localhost:3306/production_forecast";

function resolveAlias(name: string, aliases: Record<string, string>): string {
  if (!name) return "";
  const trimmed = name.trim();
  const resolved = aliases[trimmed] || trimmed;
  if (resolved === "_REMOVED_") return "";
  return resolved;
}

async function main() {
  const pool = mysql.createPool(DATABASE_URL);
  console.log("🌱 Starting database seed...\n");

  // ========== 1. Seed Business Rules ==========
  console.log("📝 Seeding business rules...");
  const brPath = path.join(process.cwd(), "config", "business-rules.json");
  const br = JSON.parse(readFileSync(brPath, "utf-8"));

  const businessRules: [string, string][] = [
    ["firstMonthRevenue", JSON.stringify(br.firstMonthRevenue)],
    ["operationEnhancement", JSON.stringify(br.operationEnhancement)],
    ["marketEnhancement", JSON.stringify(br.marketEnhancement)],
    ["totalEnhancement", JSON.stringify(br.totalEnhancement)],
    ["monthlyCoefficients", JSON.stringify(br.monthlyCoefficients)],
    ["weekdayWeights", JSON.stringify(br.weekdayWeights)],
    ["shipmentFormula", JSON.stringify(br.shipmentFormula)],
    ["baselineOverrides", JSON.stringify(br.baselineOverrides || {})],
  ];

  for (const [key, value] of businessRules) {
    await pool.execute(
      `INSERT INTO business_rule (rule_key, rule_value) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE rule_value = VALUES(rule_value)`,
      [key, value]
    );
  }
  console.log(`  ✅ ${businessRules.length} business rules saved`);

  // ========== 2. Seed Planning Rules ==========
  console.log("📝 Seeding planning rules...");
  const prPath = path.join(process.cwd(), "config", "planning-rules.json");
  const pr = JSON.parse(readFileSync(prPath, "utf-8"));

  const planningKeys = ["timeSlots", "restockLeadTime", "reductionLeadTime", "topPriorityRestock", "breakStockThresholds"];
  for (const key of planningKeys) {
    if (pr[key] !== undefined) {
      await pool.execute(
        `INSERT INTO business_rule (rule_key, rule_value) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE rule_value = VALUES(rule_value)`,
        [key, JSON.stringify(pr[key])]
      );
    }
  }
  console.log(`  ✅ ${planningKeys.length} planning rules saved`);

  // Fixed shipment schedule
  const schedule: Record<string, string[]> = pr.fixedShipmentSchedule || {};
  const schedEntries = Object.entries(schedule);
  for (const [productName, timeSlots] of schedEntries) {
    await pool.execute(
      `INSERT INTO fixed_shipment_schedule (product_name, time_slots) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE time_slots = VALUES(time_slots)`,
      [productName, JSON.stringify(timeSlots)]
    );
  }
  console.log(`  ✅ ${schedEntries.length} fixed shipment schedules saved`);

  // ========== 3. Seed Product Aliases ==========
  console.log("📝 Seeding product aliases...");
  const aliasPath = path.join(process.cwd(), "config", "product-aliases.json");
  const aliasRaw = JSON.parse(readFileSync(aliasPath, "utf-8"));
  const aliases: Record<string, string> = aliasRaw.aliases || {};

  const aliasEntries = Object.entries(aliases);
  for (const [alias, standardName] of aliasEntries) {
    await pool.execute(
      `INSERT INTO product_alias (alias, standard_name) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE standard_name = VALUES(standard_name)`,
      [alias, standardName]
    );
  }
  console.log(`  ✅ ${aliasEntries.length} product aliases saved`);

  // ========== 4. Seed Products from Excel ==========
  console.log("📦 Importing products from Excel...");
  const prodFile = path.join(process.cwd(), "data", "产品价格信息与倍数.xlsx");
  const wb1 = new ExcelJS.Workbook();
  await wb1.xlsx.readFile(prodFile);
  const sheet1 = wb1.worksheets[0];

  await pool.execute("DELETE FROM product");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const productInserts: any[][] = [];
  let lastCategory = "";
  sheet1.eachRow((row, rowNum) => {
    if (rowNum <= 1) return;
    const values = row.values as unknown[];
    const category = (values[1] as string) || "";
    const name = (values[2] as string) || "";
    const nameEn = (values[3] as string) || "";
    const price = Number(values[4]) || 0;
    const multipleRaw = values[5];

    if (!name || !price) return;

    let packMultiple = 1;
    let unitType = "batch";
    if (typeof multipleRaw === "string" && multipleRaw === "个") {
      unitType = "individual";
    } else {
      packMultiple = Number(multipleRaw) || 1;
    }

    const cat = category || lastCategory;
    if (category) lastCategory = category;

    productInserts.push([cat, name.trim(), nameEn?.trim() || "", price, packMultiple, unitType]);
  });

  for (const p of productInserts) {
    await pool.execute(
      `INSERT INTO product (category, name, name_en, price, pack_multiple, unit_type) VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE category=VALUES(category), name_en=VALUES(name_en), price=VALUES(price), pack_multiple=VALUES(pack_multiple), unit_type=VALUES(unit_type)`,
      p
    );
  }
  console.log(`  ✅ ${productInserts.length} products imported`);

  // ========== 5. Seed Strategies from Excel ==========
  console.log("📊 Importing strategies from Excel...");
  const stratFile = path.join(process.cwd(), "data", "产品销售策略.xlsx");
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.readFile(stratFile);
  const sheet2 = wb2.worksheets[0];

  await pool.execute("DELETE FROM product_strategy");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stratInserts: any[][] = [];
  const seenStrat = new Set<string>();

  sheet2.eachRow((row, rowNum) => {
    if (rowNum <= 1) return;
    const values = row.values as unknown[];
    const positioning = String(values[2] || "").trim();
    const rawName = String(values[4] || "").trim();
    const coldHot = String(values[5] || "").trim();
    const salesRatio = Number(values[6]) || 0;
    const targetTCRaw = values[7];
    const audience = String(values[8] || "").trim();
    const breakStockRaw = values[9];

    if (!rawName) return;

    const cleanName = resolveAlias(rawName, aliases);
    if (!cleanName || seenStrat.has(cleanName)) return;
    seenStrat.add(cleanName);

    let targetTC: number | null = null;
    if (typeof targetTCRaw === "number") {
      targetTC = targetTCRaw;
    } else if (typeof targetTCRaw === "string" && targetTCRaw !== "—" && targetTCRaw !== "-") {
      targetTC = Number(targetTCRaw) || null;
    }

    let breakStockTime = "";
    if (breakStockRaw instanceof Date) {
      breakStockTime = `${breakStockRaw.getHours().toString().padStart(2, "0")}:${breakStockRaw.getMinutes().toString().padStart(2, "0")}`;
    } else if (typeof breakStockRaw === "string") {
      breakStockTime = breakStockRaw.trim();
    }

    stratInserts.push([
      cleanName, positioning, String(values[3] || "").trim(),
      coldHot, salesRatio, targetTC, audience, breakStockTime,
    ]);
  });

  for (const s of stratInserts) {
    await pool.execute(
      `INSERT INTO product_strategy (product_name, positioning, category, cold_hot, sales_ratio, target_tc, audience, break_stock_time)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE positioning=VALUES(positioning), category=VALUES(category), cold_hot=VALUES(cold_hot),
       sales_ratio=VALUES(sales_ratio), target_tc=VALUES(target_tc), audience=VALUES(audience), break_stock_time=VALUES(break_stock_time)`,
      s
    );
  }
  console.log(`  ✅ ${stratInserts.length} strategies imported`);

  // ========== 6. Seed Sales Data from Excel ==========
  console.log("📈 Importing sales data from Excel...");
  const salesFile = path.join(process.cwd(), "data", "单品销售数量1.1-4.2.xlsx");
  const wb3 = new ExcelJS.Workbook();
  await wb3.xlsx.readFile(salesFile);
  const sheet3 = wb3.worksheets[0];

  await pool.execute("DELETE FROM daily_sales_record");

  const excludeKeywords = [
    "拿铁", "咖啡", "柠檬茶", "酸奶昔", "提拉米苏", "抹茶拿铁",
    "泰奶", "纸香片", "咖啡杯", "帆布包", "冰箱贴", "耳机包",
    "陶瓷", "海盐贝果", "罗马面包", "京都冰抹茶",
  ];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const salesInserts: any[][] = [];

  sheet3.eachRow((row, rowNum) => {
    if (rowNum <= 1) return;
    const values = row.values as unknown[];
    const rawName = String(values[1] || "").trim();
    const quantity = Number(values[2]) || 0;
    const dateRaw = values[3];

    if (!rawName || rawName === "总计" || !dateRaw) return;
    if (excludeKeywords.some((kw) => rawName.includes(kw))) return;

    const standardName = resolveAlias(rawName, aliases);

    let dateStr = "";
    if (dateRaw instanceof Date) {
      dateStr = dateRaw.toISOString().split("T")[0];
    } else if (typeof dateRaw === "string") {
      const d = new Date(dateRaw);
      if (!isNaN(d.getTime())) dateStr = d.toISOString().split("T")[0];
    }
    if (!dateStr) return;

    const dayOfWeek = new Date(dateStr).getDay();
    salesInserts.push([rawName, standardName, quantity, dateStr, dayOfWeek]);
  });

  // Batch insert in chunks of 500
  const BATCH_SIZE = 500;
  for (let i = 0; i < salesInserts.length; i += BATCH_SIZE) {
    const batch = salesInserts.slice(i, i + BATCH_SIZE);
    const placeholders = batch.map(() => "(?, ?, ?, ?, ?)").join(",");
    const flat = batch.flat();
    await pool.execute(
      `INSERT INTO daily_sales_record (product_name, standard_name, quantity, date, day_of_week) VALUES ${placeholders}`,
      flat
    );
  }
  console.log(`  ✅ ${salesInserts.length} sales records imported`);

  console.log("\n🎉 Database seed complete!");
  await pool.end();
}

main().catch((e) => {
  console.error("❌ Seed error:", e);
  process.exit(1);
});
