import postgres from "postgres";

let sql: ReturnType<typeof postgres> | null = null;

export function getSQL(): ReturnType<typeof postgres> {
  if (!sql) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL environment variable is required");
    }
    sql = postgres(url, {
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10,
    });
  }
  return sql;
}

// 便捷查询方法
export async function query<T = Record<string, unknown>>(
  sqlStr: string,
  params?: unknown[]
): Promise<T[]> {
  const db = getSQL();
  if (params && params.length > 0) {
    // 将 ? 占位符转换为 $1, $2, ... 格式
    let idx = 0;
    const pgSql = sqlStr.replace(/\?/g, () => `$${++idx}`);
    const result = await db.unsafe(pgSql, params as (string | number | boolean | null)[]);
    return result as unknown as T[];
  }
  const result = await db.unsafe(sqlStr);
  return result as unknown as T[];
}

// 便捷执行方法（INSERT/UPDATE/DELETE）
export async function execute(
  sqlStr: string,
  params?: unknown[]
): Promise<{ affectedRows: number; insertId: number }> {
  const db = getSQL();
  let result;
  if (params && params.length > 0) {
    let idx = 0;
    const pgSql = sqlStr.replace(/\?/g, () => `$${++idx}`);
    result = await db.unsafe(pgSql, params as (string | number | boolean | null)[]);
  } else {
    result = await db.unsafe(sqlStr);
  }
  return { affectedRows: result.count ?? 0, insertId: 0 };
}
