import ExcelJS from 'exceljs';
import postgres from 'postgres';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { ssl: 'require' });

async function main() {
  // 1. Create table if not exists
  await sql`
    CREATE TABLE IF NOT EXISTS daily_revenue (
      date VARCHAR(10) NOT NULL,
      revenue DOUBLE PRECISION NOT NULL DEFAULT 0,
      CONSTRAINT uk_daily_revenue_date UNIQUE (date)
    )
  `;
  console.log('daily_revenue table ensured.');

  // 2. Read Excel
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('data/销售汇总表2026_01_01~2026_04_09.xlsx');
  const ws = wb.worksheets[0];

  let imported = 0;
  for (let i = 2; i <= ws.rowCount; i++) {
    const row = ws.getRow(i);
    const rawDate = row.getCell(2).value;
    const revenue = row.getCell(3).value as number;

    if (!rawDate || !revenue) continue;

    // Convert date: "2026/04/09" -> "2026-04-09"
    let dateStr: string;
    if (rawDate instanceof Date) {
      dateStr = rawDate.toISOString().slice(0, 10);
    } else {
      dateStr = String(rawDate).replace(/\//g, '-');
    }

    // Normalize to YYYY-MM-DD
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      dateStr = `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
    }

    await sql`
      INSERT INTO daily_revenue (date, revenue)
      VALUES (${dateStr}, ${revenue})
      ON CONFLICT (date) DO UPDATE SET revenue = EXCLUDED.revenue
    `;
    imported++;
  }

  console.log(`Imported ${imported} daily revenue records.`);
  await sql.end();
}

main().catch(e => { console.error(e); process.exit(1); });
