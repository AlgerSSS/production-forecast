import ExcelJS from 'exceljs';
import postgres from 'postgres';
import dotenv from 'dotenv';
import path from 'path';
import productAliasConfig from '../config/product-aliases.json';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('DATABASE_URL not set'); process.exit(1); }
const sql = postgres(DATABASE_URL, { ssl: 'require' });

const aliasMap: Record<string, string> = (productAliasConfig as { aliases: Record<string, string> }).aliases;
function resolveProductName(name: string): string {
  if (!name) return '';
  const trimmed = name.trim();
  const resolved = aliasMap[trimmed] || trimmed;
  if (resolved === '_REMOVED_') return '';
  return resolved;
}

const EXCLUDE_KEYWORDS = [
  '拿铁','咖啡','柠檬茶','酸奶昔','提拉米苏','抹茶拿铁','泰奶',
  '纸香片','咖啡杯','帆布包','冰箱贴','耳机包','陶瓷','海盐贝果','罗马面包','京都冰抹茶',
];

function parseDate(raw: unknown): string {
  if (raw instanceof Date) return raw.toISOString().split('T')[0];
  if (typeof raw === 'string') {
    const s = raw.replace(/\//g, '-');
    const parts = s.split('-');
    if (parts.length === 3) return `${parts[0]}-${parts[1].padStart(2,'0')}-${parts[2].padStart(2,'0')}`;
  }
  return '';
}

// PLACEHOLDER_IMPORT_FUNCTIONS

async function main() {
  // ===== 1. 导入菜品汇总表 -> daily_sales_record =====
  console.log('=== 导入菜品汇总表 (daily_sales_record) ===');
  const wb1 = new ExcelJS.Workbook();
  await wb1.xlsx.readFile('data/菜品汇总表2026_01_01~2026_04_09.xlsx');
  const ws1 = wb1.worksheets[0];

  // Load products from DB
  const products = await sql`SELECT name FROM product`;
  const productNameSet = new Set(products.map(p => p.name));
  const unmatchedSet = new Set<string>();

  interface SalesRow { productName: string; standardName: string; quantity: number; date: string; dayOfWeek: number; }
  const records: SalesRow[] = [];

  ws1.eachRow((row, rowNum) => {
    if (rowNum <= 1) return;
    const values = row.values as unknown[];
    // col1=营业日期, col2=菜品名称, col3=销售数量
    const dateStr = parseDate(values[1]);
    const rawName = String(values[2] || '').trim();
    const quantity = Number(values[3]) || 0;

    if (!rawName || rawName === '总计' || !dateStr) return;
    if (EXCLUDE_KEYWORDS.some(kw => rawName.includes(kw))) return;

    const standardName = resolveProductName(rawName);
    if (!productNameSet.has(standardName)) unmatchedSet.add(rawName);

    const dow = new Date(dateStr + 'T00:00:00').getDay();
    records.push({ productName: rawName, standardName, quantity, date: dateStr, dayOfWeek: dow });
  });

  // Clear and batch insert
  await sql`DELETE FROM daily_sales_record`;
  const BATCH = 500;
  for (let i = 0; i < records.length; i += BATCH) {
    const batch = records.slice(i, i + BATCH);
    await sql`
      INSERT INTO daily_sales_record (product_name, standard_name, quantity, date, day_of_week)
      SELECT * FROM unnest(
        ${sql.array(batch.map(r => r.productName))}::text[],
        ${sql.array(batch.map(r => r.standardName))}::text[],
        ${sql.array(batch.map(r => r.quantity))}::int[],
        ${sql.array(batch.map(r => r.date))}::text[],
        ${sql.array(batch.map(r => r.dayOfWeek))}::int[]
      )
    `;
  }
  console.log(`Imported ${records.length} sales records. Unmatched: ${[...unmatchedSet].join(', ') || 'none'}`);

  // Recalculate baselines
  // ... (handled by existing app logic on next load)

  // ===== 2. 导入时段菜品汇总表 -> timeslot_sales_record =====
  await importTimeslotData();

  await sql.end();
  console.log('Done!');
}

async function importTimeslotData() {
  console.log('\n=== 导入时段菜品汇总表 (timeslot_sales_record) ===');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('data/菜品汇总表2026_01_01~2026_04_09（时段）.xlsx');
  const ws = wb.worksheets[0];

  const products = await sql`SELECT name FROM product`;
  const productNameSet = new Set(products.map(p => p.name));
  const unmatchedSet = new Set<string>();

  const SYSTEM_SLOTS = ['10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00'];

  // Accumulator: product -> dayType -> timeSlot -> { totalQty, days }
  const acc: Record<string, Record<string, Record<string, { totalQty: number; days: Set<string> }>>> = {};

  ws.eachRow((row, rowNum) => {
    if (rowNum <= 1) return;
    const values = row.values as unknown[];
    // col1=营业日期, col2=菜品名称, col3=开台时段, col4=销售数量
    const dateStr = parseDate(values[1]);
    const rawName = String(values[2] || '').trim();
    const slotRaw = String(values[3] || '').trim();
    const quantity = Number(values[4]) || 0;

    if (!rawName || rawName === '总计' || !dateStr || !slotRaw) return;
    if (EXCLUDE_KEYWORDS.some(kw => rawName.includes(kw))) return;

    const standardName = resolveProductName(rawName);
    if (!standardName || !productNameSet.has(standardName)) {
      unmatchedSet.add(rawName);
      return;
    }

    const dow = new Date(dateStr + 'T00:00:00').getDay();
    let dayType: string;
    if (dow === 0 || dow === 6) dayType = 'weekend';
    else if (dow === 5) dayType = 'friday';
    else dayType = 'mondayToThursday';

    const slotMatch = slotRaw.match(/^(\d{1,2}):00/);
    if (!slotMatch) return;
    const hour = parseInt(slotMatch[1], 10);
    const mappedSlot = `${String(hour).padStart(2, '0')}:00`;
    if (!SYSTEM_SLOTS.includes(mappedSlot)) return;

    if (!acc[standardName]) acc[standardName] = {};
    if (!acc[standardName][dayType]) acc[standardName][dayType] = {};
    if (!acc[standardName][dayType][mappedSlot]) {
      acc[standardName][dayType][mappedSlot] = { totalQty: 0, days: new Set() };
    }
    acc[standardName][dayType][mappedSlot].totalQty += quantity;
    acc[standardName][dayType][mappedSlot].days.add(dateStr);
  });

  // Build records
  interface TSRecord { productName: string; dayType: string; timeSlot: string; avgQuantity: number; sampleCount: number; }
  const tsRecords: TSRecord[] = [];
  for (const [product, dayTypes] of Object.entries(acc)) {
    for (const [dayType, slots] of Object.entries(dayTypes)) {
      for (const [slot, data] of Object.entries(slots)) {
        tsRecords.push({
          productName: product,
          dayType,
          timeSlot: slot,
          avgQuantity: Math.round((data.totalQty / data.days.size) * 10) / 10,
          sampleCount: data.days.size,
        });
      }
    }
  }

  await sql`DELETE FROM timeslot_sales_record`;
  for (const r of tsRecords) {
    await sql`
      INSERT INTO timeslot_sales_record (product_name, day_type, time_slot, avg_quantity, sample_count)
      VALUES (${r.productName}, ${r.dayType}, ${r.timeSlot}, ${r.avgQuantity}, ${r.sampleCount})
      ON CONFLICT (product_name, day_type, time_slot) DO UPDATE SET
        avg_quantity = EXCLUDED.avg_quantity, sample_count = EXCLUDED.sample_count
    `;
  }
  console.log(`Imported ${tsRecords.length} timeslot records. Unmatched: ${[...unmatchedSet].join(', ') || 'none'}`);
}

main().catch(e => { console.error(e); process.exit(1); });
