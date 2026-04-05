"use server";

import { readFile } from "fs/promises";
import path from "path";
import {
  parseProductPrices,
  parseSalesData,
  parseStrategyData,
  parseTimeslotSalesData,
  parseDisplayFullQuantity,
} from "@/lib/parsers/excel-parser";
import {
  calculateMonthlyTargets,
  calculateDailyTargets,
  calculateSalesBaselines,
  calculateProductSuggestions,
  calculateTimeSlotSuggestions,
} from "@/lib/engine/forecast-engine";
import {
  BusinessRules,
  PlanningRules,
  Product,
  ProductStrategy,
  DailySalesRecord,
  ProductSalesBaseline,
  MonthlyTarget,
  DailyTarget,
  ProductSuggestion,
  TimeSlotSuggestion,
  ImportResult,
  Holiday,
  TimeslotSalesRecord,
} from "@/lib/types";
import { query, execute } from "@/lib/db";

// ========== DB Row Types ==========
interface ProductRow {
  id: number;
  category: string;
  name: string;
  name_en: string;
  price: number;
  pack_multiple: number;
  unit_type: string;
  display_full_quantity: number;
}

interface StrategyRow {
  id: number;
  product_name: string;
  positioning: string;
  category: string;
  cold_hot: string;
  sales_ratio: number;
  target_tc: number | null;
  audience: string;
  break_stock_time: string;
  sort_order: number;
}

interface BaselineRow {
  id: number;
  product_name: string;
  avg_monday_to_thursday: number;
  avg_friday: number;
  avg_weekend: number;
  total_sales: number;
  day_count: number;
}

interface BusinessRuleRow {
  id: number;
  rule_key: string;
  rule_value: string;
}

interface FixedScheduleRow {
  id: number;
  product_name: string;
  time_slots: string;
}

interface AliasRow {
  id: number;
  alias: string;
  standard_name: string;
}

interface HolidayRow {
  id: number;
  date: string;
  name: string;
  type: string;
  coefficient: number | null;
  note: string;
}

// ========== Converters ==========
function rowToProduct(row: ProductRow): Product {
  return {
    id: `product-${row.id}`,
    category: row.category,
    name: row.name,
    nameEn: row.name_en,
    price: row.price,
    packMultiple: row.pack_multiple,
    unitType: row.unit_type as "batch" | "individual",
    displayFullQuantity: row.display_full_quantity || 0,
  };
}

function rowToStrategy(row: StrategyRow): ProductStrategy {
  return {
    productName: row.product_name,
    positioning: row.positioning as "TOP" | "潜在TOP" | "其他",
    category: row.category,
    coldHot: row.cold_hot as "冷" | "热",
    salesRatio: row.sales_ratio,
    targetTC: row.target_tc,
    audience: row.audience,
    breakStockTime: row.break_stock_time,
    sortOrder: row.sort_order,
  };
}

function rowToBaseline(row: BaselineRow): ProductSalesBaseline {
  return {
    productName: row.product_name,
    avgMondayToThursday: row.avg_monday_to_thursday,
    avgFriday: row.avg_friday,
    avgWeekend: row.avg_weekend,
    totalSales: row.total_sales,
    dayCount: row.day_count,
  };
}

// ========== Build BusinessRules from DB ==========
async function buildBusinessRulesFromDB(): Promise<BusinessRules> {
  const rows = await query<BusinessRuleRow>("SELECT rule_key, rule_value FROM business_rule");
  const map: Record<string, unknown> = {};
  for (const row of rows) {
    map[row.rule_key] = JSON.parse(row.rule_value);
  }

  return {
    firstMonthRevenue: (map.firstMonthRevenue as number) || 1640000,
    operationEnhancement: (map.operationEnhancement as number) || 0.02,
    marketEnhancement: (map.marketEnhancement as number) || 0.04,
    totalEnhancement: (map.totalEnhancement as number) || 0.06,
    monthlyCoefficients: (map.monthlyCoefficients as Record<string, number>) || {},
    weekdayWeights: (map.weekdayWeights as BusinessRules["weekdayWeights"]) || {
      mondayToThursday: 1.0,
      friday: 1.2,
      weekend: 1.35,
    },
    shipmentFormula: (map.shipmentFormula as BusinessRules["shipmentFormula"]) || {
      tastingWasteRate: 0.06,
      waterBarRate: 0.11,
      shipmentRate: 0.95,
    },
    baselineOverrides: (map.baselineOverrides as BusinessRules["baselineOverrides"]) || {},
  };
}

// ========== Build PlanningRules from DB ==========
async function buildPlanningRulesFromDB(): Promise<PlanningRules> {
  const ruleRows = await query<BusinessRuleRow>("SELECT rule_key, rule_value FROM business_rule");
  const map: Record<string, unknown> = {};
  for (const row of ruleRows) {
    map[row.rule_key] = JSON.parse(row.rule_value);
  }

  const scheduleRows = await query<FixedScheduleRow>("SELECT product_name, time_slots FROM fixed_shipment_schedule");
  const fixedShipmentSchedule: Record<string, string[]> = {};
  for (const row of scheduleRows) {
    fixedShipmentSchedule[row.product_name] = JSON.parse(row.time_slots);
  }

  return {
    timeSlots: (map.timeSlots as string[]) || ["10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00"],
    restockLeadTime: (map.restockLeadTime as PlanningRules["restockLeadTime"]) || { hot: "提前40分钟-1个小时", cold: "提前4个小时" },
    reductionLeadTime: (map.reductionLeadTime as PlanningRules["reductionLeadTime"]) || { hot: "提前2个小时", cold: "提前4个小时" },
    topPriorityRestock: (map.topPriorityRestock as boolean) ?? true,
    breakStockThresholds: (map.breakStockThresholds as Record<string, string>) || {},
    fixedShipmentSchedule,
  };
}

// ========== Import Actions ==========
export async function importProductPrices(formData: FormData): Promise<ImportResult> {
  try {
    const file = formData.get("file") as File;
    if (!file) return { success: false, totalRows: 0, importedRows: 0, skippedRows: 0, errors: ["No file provided"] };

    const buffer = await file.arrayBuffer();
    const products = await parseProductPrices(buffer);

    // Clear and insert into DB
    await execute("DELETE FROM product");
    for (const p of products) {
      await execute(
        `INSERT INTO product (category, name, name_en, price, pack_multiple, unit_type)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (name) DO UPDATE SET category=EXCLUDED.category, name_en=EXCLUDED.name_en, price=EXCLUDED.price, pack_multiple=EXCLUDED.pack_multiple, unit_type=EXCLUDED.unit_type`,
        [p.category, p.name, p.nameEn, p.price, p.packMultiple, p.unitType]
      );
    }

    return { success: true, totalRows: products.length, importedRows: products.length, skippedRows: 0, errors: [] };
  } catch (error) {
    return { success: false, totalRows: 0, importedRows: 0, skippedRows: 0, errors: [String(error)] };
  }
}

export async function importSalesData(formData: FormData): Promise<ImportResult> {
  try {
    const file = formData.get("file") as File;
    if (!file) return { success: false, totalRows: 0, importedRows: 0, skippedRows: 0, errors: ["No file provided"] };

    const buffer = await file.arrayBuffer();
    const products = await getProducts();
    const { records, unmatchedProducts } = await parseSalesData(buffer, products);

    // Save sales records to DB
    await execute("DELETE FROM daily_sales_record");
    const BATCH = 500;
    for (let i = 0; i < records.length; i += BATCH) {
      const batch = records.slice(i, i + BATCH);
      const placeholders = batch.map(() => "(?, ?, ?, ?, ?)").join(",");
      const flat = batch.flatMap((r) => [r.productName, r.standardName, r.quantity, r.date, r.dayOfWeek]);
      await execute(
        `INSERT INTO daily_sales_record (product_name, standard_name, quantity, date, day_of_week) VALUES ${placeholders}`,
        flat
      );
    }

    // Calculate and save baselines
    const businessRules = await buildBusinessRulesFromDB();
    const baselines = calculateSalesBaselines(records, products, businessRules.baselineOverrides);
    await execute("DELETE FROM product_sales_baseline");
    for (const b of baselines) {
      await execute(
        `INSERT INTO product_sales_baseline (product_name, avg_monday_to_thursday, avg_friday, avg_weekend, total_sales, day_count)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [b.productName, b.avgMondayToThursday, b.avgFriday, b.avgWeekend, b.totalSales, b.dayCount]
      );
    }

    return { success: true, totalRows: records.length, importedRows: records.length, skippedRows: 0, errors: [], unmatchedProducts };
  } catch (error) {
    return { success: false, totalRows: 0, importedRows: 0, skippedRows: 0, errors: [String(error)] };
  }
}

export async function importStrategyData(formData: FormData): Promise<ImportResult> {
  try {
    const file = formData.get("file") as File;
    if (!file) return { success: false, totalRows: 0, importedRows: 0, skippedRows: 0, errors: ["No file provided"] };

    const buffer = await file.arrayBuffer();
    const strategies = await parseStrategyData(buffer);

    await execute("DELETE FROM product_strategy");
    const seen = new Set<string>();
    let sortOrder = 0;
    for (const s of strategies) {
      if (seen.has(s.productName)) continue;
      seen.add(s.productName);
      sortOrder++;
      await execute(
        `INSERT INTO product_strategy (product_name, positioning, category, cold_hot, sales_ratio, target_tc, audience, break_stock_time, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (product_name) DO UPDATE SET positioning=EXCLUDED.positioning, category=EXCLUDED.category, cold_hot=EXCLUDED.cold_hot,
         sales_ratio=EXCLUDED.sales_ratio, target_tc=EXCLUDED.target_tc, audience=EXCLUDED.audience, break_stock_time=EXCLUDED.break_stock_time, sort_order=EXCLUDED.sort_order`,
        [s.productName, s.positioning, s.category, s.coldHot, s.salesRatio, s.targetTC, s.audience, s.breakStockTime, sortOrder]
      );
    }

    return { success: true, totalRows: strategies.length, importedRows: strategies.length, skippedRows: 0, errors: [] };
  } catch (error) {
    return { success: false, totalRows: 0, importedRows: 0, skippedRows: 0, errors: [String(error)] };
  }
}

// ========== Auto-import from data directory ==========
export async function autoImportFromDataDir(): Promise<{
  products: ImportResult;
  sales: ImportResult;
  strategy: ImportResult;
  timeslot: ImportResult;
}> {
  const dataDir = path.join(process.cwd(), "data");

  // Import products
  let productResult: ImportResult;
  try {
    const buf = await readFile(path.join(dataDir, "产品价格信息与倍数.xlsx"));
    const products = await parseProductPrices(buf.buffer as ArrayBuffer);

    await execute("DELETE FROM product");
    for (const p of products) {
      await execute(
        `INSERT INTO product (category, name, name_en, price, pack_multiple, unit_type)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (name) DO UPDATE SET category=EXCLUDED.category, name_en=EXCLUDED.name_en, price=EXCLUDED.price, pack_multiple=EXCLUDED.pack_multiple, unit_type=EXCLUDED.unit_type`,
        [p.category, p.name, p.nameEn, p.price, p.packMultiple, p.unitType]
      );
    }

    // Import display full quantity (满柜数量)
    try {
      const dfqBuf = await readFile(path.join(dataDir, "kl陈列满柜单品数量.xlsx"));
      const dfqMap = await parseDisplayFullQuantity(dfqBuf.buffer as ArrayBuffer);
      for (const [name, qty] of dfqMap) {
        await execute(
          "UPDATE product SET display_full_quantity = ? WHERE name = ?",
          [qty, name]
        );
      }
    } catch {
      // File may not exist, skip silently
    }

    productResult = { success: true, totalRows: products.length, importedRows: products.length, skippedRows: 0, errors: [] };
  } catch (e) {
    productResult = { success: false, totalRows: 0, importedRows: 0, skippedRows: 0, errors: [String(e)] };
  }

  // Import strategy
  let strategyResult: ImportResult;
  try {
    const buf = await readFile(path.join(dataDir, "产品销售策略.xlsx"));
    const strategies = await parseStrategyData(buf.buffer as ArrayBuffer);

    await execute("DELETE FROM product_strategy");
    const seen = new Set<string>();
    let sortOrder = 0;
    for (const s of strategies) {
      if (seen.has(s.productName)) continue;
      seen.add(s.productName);
      sortOrder++;
      await execute(
        `INSERT INTO product_strategy (product_name, positioning, category, cold_hot, sales_ratio, target_tc, audience, break_stock_time, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (product_name) DO UPDATE SET positioning=EXCLUDED.positioning, category=EXCLUDED.category, cold_hot=EXCLUDED.cold_hot,
         sales_ratio=EXCLUDED.sales_ratio, target_tc=EXCLUDED.target_tc, audience=EXCLUDED.audience, break_stock_time=EXCLUDED.break_stock_time, sort_order=EXCLUDED.sort_order`,
        [s.productName, s.positioning, s.category, s.coldHot, s.salesRatio, s.targetTC, s.audience, s.breakStockTime, sortOrder]
      );
    }
    strategyResult = { success: true, totalRows: strategies.length, importedRows: strategies.length, skippedRows: 0, errors: [] };
  } catch (e) {
    strategyResult = { success: false, totalRows: 0, importedRows: 0, skippedRows: 0, errors: [String(e)] };
  }

  // Import sales
  let salesResult: ImportResult;
  try {
    const products = await getProducts();
    const buf = await readFile(path.join(dataDir, "单品销售数量1.1-4.2.xlsx"));
    const { records, unmatchedProducts } = await parseSalesData(buf.buffer as ArrayBuffer, products);

    await execute("DELETE FROM daily_sales_record");
    const BATCH = 500;
    for (let i = 0; i < records.length; i += BATCH) {
      const batch = records.slice(i, i + BATCH);
      const placeholders = batch.map(() => "(?, ?, ?, ?, ?)").join(",");
      const flat = batch.flatMap((r) => [r.productName, r.standardName, r.quantity, r.date, r.dayOfWeek]);
      await execute(
        `INSERT INTO daily_sales_record (product_name, standard_name, quantity, date, day_of_week) VALUES ${placeholders}`,
        flat
      );
    }

    // Calculate and save baselines
    const businessRules = await buildBusinessRulesFromDB();
    const baselines = calculateSalesBaselines(records, products, businessRules.baselineOverrides);
    await execute("DELETE FROM product_sales_baseline");
    for (const b of baselines) {
      await execute(
        `INSERT INTO product_sales_baseline (product_name, avg_monday_to_thursday, avg_friday, avg_weekend, total_sales, day_count)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [b.productName, b.avgMondayToThursday, b.avgFriday, b.avgWeekend, b.totalSales, b.dayCount]
      );
    }

    salesResult = { success: true, totalRows: records.length, importedRows: records.length, skippedRows: 0, errors: [], unmatchedProducts };
  } catch (e) {
    salesResult = { success: false, totalRows: 0, importedRows: 0, skippedRows: 0, errors: [String(e)] };
  }

  // Import timeslot sales data
  let timeslotResult: ImportResult;
  try {
    const products = await getProducts();
    const fs = await import("fs");
    const timeslotDir = path.join(dataDir, "时段销售");
    if (fs.existsSync(timeslotDir)) {
      const files = fs.readdirSync(timeslotDir).filter((f: string) => f.endsWith(".xlsx"));
      if (files.length > 0) {
        const buf = await readFile(path.join(timeslotDir, files[0]));
        const { records: tsRecords, unmatchedProducts: tsUnmatched } = await parseTimeslotSalesData(buf.buffer as ArrayBuffer, products);

        await execute("DELETE FROM timeslot_sales_record");
        for (const r of tsRecords) {
          await execute(
            `INSERT INTO timeslot_sales_record (product_name, day_type, time_slot, avg_quantity, sample_count)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (product_name, day_type, time_slot) DO UPDATE SET avg_quantity=EXCLUDED.avg_quantity, sample_count=EXCLUDED.sample_count`,
            [r.productName, r.dayType, r.timeSlot, r.avgQuantity, r.sampleCount]
          );
        }
        timeslotResult = { success: true, totalRows: tsRecords.length, importedRows: tsRecords.length, skippedRows: 0, errors: [], unmatchedProducts: tsUnmatched };
      } else {
        timeslotResult = { success: false, totalRows: 0, importedRows: 0, skippedRows: 0, errors: ["时段销售目录下无 xlsx 文件"] };
      }
    } else {
      timeslotResult = { success: false, totalRows: 0, importedRows: 0, skippedRows: 0, errors: ["时段销售目录不存在"] };
    }
  } catch (e) {
    timeslotResult = { success: false, totalRows: 0, importedRows: 0, skippedRows: 0, errors: [String(e)] };
  }

  return { products: productResult, sales: salesResult, strategy: strategyResult, timeslot: timeslotResult };
}

// ========== Data Retrieval ==========
export async function getBusinessRules(): Promise<BusinessRules> {
  return buildBusinessRulesFromDB();
}

export async function getPlanningRules(): Promise<PlanningRules> {
  return buildPlanningRulesFromDB();
}

export async function getProducts(): Promise<Product[]> {
  const rows = await query<ProductRow>("SELECT * FROM product ORDER BY id");
  return rows.map(rowToProduct);
}

export async function getStrategies(): Promise<ProductStrategy[]> {
  const rows = await query<StrategyRow>("SELECT * FROM product_strategy ORDER BY sort_order, id");
  return rows.map(rowToStrategy);
}

export async function getSalesBaselines(): Promise<ProductSalesBaseline[]> {
  const rows = await query<BaselineRow>("SELECT * FROM product_sales_baseline ORDER BY id");
  return rows.map(rowToBaseline);
}

// ========== Forecast Actions ==========
export async function generateMonthlyTargets(year: number): Promise<MonthlyTarget[]> {
  const businessRules = await buildBusinessRulesFromDB();
  return calculateMonthlyTargets(businessRules, year);
}

export async function generateMonthlyTargetsWithCustomCoefficients(
  year: number,
  customCoefficients: Record<string, number>
): Promise<MonthlyTarget[]> {
  const businessRules = await buildBusinessRulesFromDB();
  const customRules: BusinessRules = {
    ...businessRules,
    monthlyCoefficients: customCoefficients,
  };
  return calculateMonthlyTargets(customRules, year);
}

export async function generateDailyTargetsWithCustomRevenue(
  monthlyTarget: MonthlyTarget
): Promise<DailyTarget[]> {
  const businessRules = await buildBusinessRulesFromDB();
  return calculateDailyTargets(monthlyTarget, businessRules);
}

export async function generateDailyTargets(monthlyTarget: MonthlyTarget): Promise<DailyTarget[]> {
  const businessRules = await buildBusinessRulesFromDB();
  return calculateDailyTargets(monthlyTarget, businessRules);
}

export async function generateProductSuggestions(
  dailyTarget: DailyTarget
): Promise<ProductSuggestion[]> {
  const products = await getProducts();
  const baselines = await getSalesBaselines();
  const strategies = await getStrategies();
  const timeslotRecords = await getTimeslotSalesRecords();
  const businessRules = await buildBusinessRulesFromDB();
  return calculateProductSuggestions(dailyTarget, products, baselines, strategies, timeslotRecords, businessRules.productBoosts);
}

export async function generateTimeSlotSuggestions(
  productSuggestions: ProductSuggestion[],
  dailyTarget: DailyTarget
): Promise<TimeSlotSuggestion[]> {
  const planningRules = await buildPlanningRulesFromDB();
  const timeslotHistory = await getTimeslotSalesRecords(dailyTarget.dayType);
  return calculateTimeSlotSuggestions(productSuggestions, dailyTarget, planningRules, timeslotHistory);
}

// ========== Full Forecast for a Date ==========
export async function generateFullForecast(
  year: number,
  month: number,
  day?: number
): Promise<{
  monthlyTargets: MonthlyTarget[];
  dailyTargets: DailyTarget[];
  productSuggestions: Record<string, ProductSuggestion[]>;
  timeSlotSuggestions: Record<string, TimeSlotSuggestion[]>;
}> {
  const businessRules = await buildBusinessRulesFromDB();
  const planningRules = await buildPlanningRulesFromDB();
  const products = await getProducts();
  const baselines = await getSalesBaselines();
  const strategies = await getStrategies();
  const allTimeslotHistory = await getTimeslotSalesRecords();

  const monthlyTargets = calculateMonthlyTargets(businessRules, year);
  const targetMonth = monthlyTargets.find((t) => t.month === month);
  if (!targetMonth) throw new Error(`Month ${month} not found`);

  const dailyTargets = calculateDailyTargets(targetMonth, businessRules);

  const productSuggestionsMap: Record<string, ProductSuggestion[]> = {};
  const timeSlotSuggestionsMap: Record<string, TimeSlotSuggestion[]> = {};

  const daysToProcess = day
    ? dailyTargets.filter((d) => d.date === `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`)
    : dailyTargets;

  for (const dt of daysToProcess) {
    const prodSugg = calculateProductSuggestions(dt, products, baselines, strategies, allTimeslotHistory, businessRules.productBoosts);
    productSuggestionsMap[dt.date] = prodSugg;
    const dayTypeHistory = allTimeslotHistory.filter((r) => r.dayType === dt.dayType);
    timeSlotSuggestionsMap[dt.date] = calculateTimeSlotSuggestions(prodSugg, dt, planningRules, dayTypeHistory);
  }

  return { monthlyTargets, dailyTargets, productSuggestions: productSuggestionsMap, timeSlotSuggestions: timeSlotSuggestionsMap };
}

// ========== Rules Management Actions ==========
export async function getBusinessRulesFromDB(): Promise<BusinessRules> {
  return buildBusinessRulesFromDB();
}

export async function updateBusinessRule(key: string, value: unknown): Promise<void> {
  await execute(
    `INSERT INTO business_rule (rule_key, rule_value) VALUES (?, ?)
     ON CONFLICT (rule_key) DO UPDATE SET rule_value = EXCLUDED.rule_value`,
    [key, JSON.stringify(value)]
  );
}

export async function getFixedShipmentSchedules(): Promise<Record<string, string[]>> {
  const rows = await query<FixedScheduleRow>("SELECT product_name, time_slots FROM fixed_shipment_schedule");
  const result: Record<string, string[]> = {};
  for (const row of rows) {
    result[row.product_name] = JSON.parse(row.time_slots);
  }
  return result;
}

export async function updateFixedShipmentSchedule(productName: string, timeSlots: string[]): Promise<void> {
  await execute(
    `INSERT INTO fixed_shipment_schedule (product_name, time_slots) VALUES (?, ?)
     ON CONFLICT (product_name) DO UPDATE SET time_slots = EXCLUDED.time_slots`,
    [productName, JSON.stringify(timeSlots)]
  );
}

export async function deleteFixedShipmentSchedule(productName: string): Promise<void> {
  await execute("DELETE FROM fixed_shipment_schedule WHERE product_name = ?", [productName]);
}

export async function getProductAliases(): Promise<Record<string, string>> {
  const rows = await query<AliasRow>("SELECT alias, standard_name FROM product_alias");
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.alias] = row.standard_name;
  }
  return result;
}

export async function updateProductAlias(alias: string, standardName: string): Promise<void> {
  await execute(
    `INSERT INTO product_alias (alias, standard_name) VALUES (?, ?)
     ON CONFLICT (alias) DO UPDATE SET standard_name = EXCLUDED.standard_name`,
    [alias, standardName]
  );
}

export async function deleteProductAlias(alias: string): Promise<void> {
  await execute("DELETE FROM product_alias WHERE alias = ?", [alias]);
}

// ========== Holiday Management Actions ==========
export async function getHolidays(year?: number, month?: number): Promise<Holiday[]> {
  let sql = "SELECT * FROM holiday";
  const params: (string | number)[] = [];

  if (year && month) {
    const prefix = `${year}-${String(month).padStart(2, "0")}`;
    sql += " WHERE date LIKE ?";
    params.push(`${prefix}%`);
  } else if (year) {
    sql += " WHERE date LIKE ?";
    params.push(`${year}%`);
  }

  sql += " ORDER BY date";
  const rows = await query<HolidayRow>(sql, params);
  return rows.map((row) => ({
    id: row.id,
    date: row.date,
    name: row.name,
    type: row.type as Holiday["type"],
    coefficient: row.coefficient ?? undefined,
    note: row.note,
  }));
}

export async function addHoliday(holiday: Omit<Holiday, "id">): Promise<void> {
  await execute(
    `INSERT INTO holiday (date, name, type, coefficient, note) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (date) DO UPDATE SET name=EXCLUDED.name, type=EXCLUDED.type, coefficient=EXCLUDED.coefficient, note=EXCLUDED.note`,
    [holiday.date, holiday.name, holiday.type, holiday.coefficient ?? null, holiday.note]
  );
}

export async function updateHoliday(id: number, holiday: Partial<Holiday>): Promise<void> {
  const fields: string[] = [];
  const params: (string | number | null)[] = [];

  if (holiday.date !== undefined) { fields.push("date=?"); params.push(holiday.date); }
  if (holiday.name !== undefined) { fields.push("name=?"); params.push(holiday.name); }
  if (holiday.type !== undefined) { fields.push("type=?"); params.push(holiday.type); }
  if (holiday.coefficient !== undefined) { fields.push("coefficient=?"); params.push(holiday.coefficient ?? null); }
  if (holiday.note !== undefined) { fields.push("note=?"); params.push(holiday.note); }

  if (fields.length === 0) return;
  params.push(id);
  await execute(`UPDATE holiday SET ${fields.join(", ")} WHERE id = ?`, params);
}

export async function deleteHoliday(id: number): Promise<void> {
  await execute("DELETE FROM holiday WHERE id = ?", [id]);
}

export async function batchAddHolidays(holidays: Omit<Holiday, "id">[]): Promise<void> {
  for (const h of holidays) {
    await addHoliday(h);
  }
}

// ========== Timeslot Sales Data Actions ==========
interface TimeslotSalesRow {
  id: number;
  product_name: string;
  day_type: string;
  time_slot: string;
  avg_quantity: number;
  sample_count: number;
}

export async function getTimeslotSalesRecords(dayType?: string): Promise<TimeslotSalesRecord[]> {
  let sql = "SELECT * FROM timeslot_sales_record";
  const params: string[] = [];
  if (dayType) {
    sql += " WHERE day_type = ?";
    params.push(dayType);
  }
  sql += " ORDER BY product_name, time_slot";
  const rows = await query<TimeslotSalesRow>(sql, params);
  return rows.map((r) => ({
    productName: r.product_name,
    dayType: r.day_type as TimeslotSalesRecord["dayType"],
    timeSlot: r.time_slot,
    avgQuantity: r.avg_quantity,
    sampleCount: r.sample_count,
  }));
}

export async function importTimeslotSalesData(
  records: TimeslotSalesRecord[]
): Promise<ImportResult> {
  try {
    await execute("DELETE FROM timeslot_sales_record");
    for (const r of records) {
      await execute(
        `INSERT INTO timeslot_sales_record (product_name, day_type, time_slot, avg_quantity, sample_count)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE avg_quantity=VALUES(avg_quantity), sample_count=VALUES(sample_count)`,
        [r.productName, r.dayType, r.timeSlot, r.avgQuantity, r.sampleCount]
      );
    }
    return { success: true, totalRows: records.length, importedRows: records.length, skippedRows: 0, errors: [] };
  } catch (error) {
    return { success: false, totalRows: 0, importedRows: 0, skippedRows: 0, errors: [String(error)] };
  }
}

export async function hasTimeslotSalesData(): Promise<boolean> {
  const rows = await query<{ cnt: number }>("SELECT COUNT(*) as cnt FROM timeslot_sales_record");
  return (rows[0] as { cnt: number }).cnt > 0;
}
