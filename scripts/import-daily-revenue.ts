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
      transaction_count INT,
      avg_transaction_value DOUBLE PRECISION,
      CONSTRAINT uk_daily_revenue_date UNIQUE (date)
    )
  `;

  // 2. ALTER TABLE to add new columns if they don't exist
  await sql`
    DO $$ BEGIN
      ALTER TABLE daily_revenue ADD COLUMN IF NOT EXISTS transaction_count INT;
      ALTER TABLE daily_revenue ADD COLUMN IF NOT EXISTS avg_transaction_value DOUBLE PRECISION;
    END $$;
  `;
  console.log('daily_revenue table ensured (with transaction columns).');

  // 3. Import revenue data from sales summary Excel
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('data/销售汇总表2026_01_01~2026_04_09.xlsx');
  const ws = wb.worksheets[0];

  let imported = 0;
  for (let i = 2; i <= ws.rowCount; i++) {
    const row = ws.getRow(i);
    const rawDate = row.getCell(2).value;
    const revenue = row.getCell(3).value as number;

    if (!rawDate || !revenue) continue;

    let dateStr: string;
    if (rawDate instanceof Date) {
      dateStr = rawDate.toISOString().slice(0, 10);
    } else {
      dateStr = String(rawDate).replace(/\//g, '-');
    }

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

  // 4. Import transaction data (客单数/客单价)
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.readFile('data/客单数客单价.xlsx');
  const ws2 = wb2.worksheets[0];

  let txImported = 0;
  for (let i = 2; i <= ws2.rowCount; i++) {
    const row = ws2.getRow(i);
    // Columns: 币种(A), 营业日期(B), 账单数(C), 人均营业额(D)
    const rawDate = row.getCell(2).value;
    const transactionCount = row.getCell(3).value as number;
    const avgTransactionValue = row.getCell(4).value as number;

    if (!rawDate || transactionCount == null) continue;

    let dateStr: string;
    if (rawDate instanceof Date) {
      dateStr = rawDate.toISOString().slice(0, 10);
    } else {
      dateStr = String(rawDate).replace(/\//g, '-');
    }

    const parts = dateStr.split('-');
    if (parts.length === 3) {
      dateStr = `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
    }

    await sql`
      INSERT INTO daily_revenue (date, revenue, transaction_count, avg_transaction_value)
      VALUES (${dateStr}, 0, ${transactionCount}, ${avgTransactionValue || 0})
      ON CONFLICT (date) DO UPDATE SET
        transaction_count = EXCLUDED.transaction_count,
        avg_transaction_value = EXCLUDED.avg_transaction_value
    `;
    txImported++;
  }
  console.log(`Imported ${txImported} transaction records.`);

  await sql.end();
}

main().catch(e => { console.error(e); process.exit(1); });
