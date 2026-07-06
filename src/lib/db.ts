import "server-only";

import mysql, { type FieldPacket, type ResultSetHeader, type RowDataPacket } from "mysql2/promise";

type DbGlobal = typeof globalThis & {
  pigouAiDbPool?: mysql.Pool;
};

export type DbValue = string | number | boolean | Date | Buffer | null;
type SerializedDbValue = string | number | boolean | null;

const globalForDb = globalThis as DbGlobal;

function getDbApiConfig() {
  const baseUrl = process.env.DATABASE_API_BASE_URL?.replace(/\/+$/, "");
  const apiKey = process.env.DATABASE_API_KEY;

  if (!baseUrl || !apiKey) {
    return null;
  }

  return { baseUrl, apiKey };
}

export function getDbPool() {
  if (getDbApiConfig()) {
    throw new Error("当前使用 DATABASE_API_BASE_URL，不应直接创建 MySQL 连接池。");
  }

  if (!process.env.DATABASE_URL) {
    throw new Error("服务端未配置 DATABASE_URL。");
  }

  if (!globalForDb.pigouAiDbPool) {
    globalForDb.pigouAiDbPool = mysql.createPool({
      uri: process.env.DATABASE_URL,
      waitForConnections: true,
      connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT ?? "4"),
      queueLimit: 0,
      timezone: "Z",
      supportBigNumbers: true,
    });
  }

  return globalForDb.pigouAiDbPool;
}

export async function queryRows<T extends RowDataPacket[]>(
  sql: string,
  values: DbValue[] = [],
): Promise<T> {
  const apiConfig = getDbApiConfig();
  if (apiConfig) {
    // Vercel 不直连 ECS 3306；生产通过带鉴权的 ECS DB API 访问本机 MySQL。
    const response = await requestDatabaseApi(apiConfig, "query", sql, values);
    return response.rows as T;
  }

  const [rows] = await getDbPool().query<T>(sql, values);
  return rows;
}

export async function execute(
  sql: string,
  values: DbValue[] = [],
): Promise<ResultSetHeader> {
  const apiConfig = getDbApiConfig();
  if (apiConfig) {
    return (await requestDatabaseApi(apiConfig, "execute", sql, values)).result as ResultSetHeader;
  }

  const [result] = await getDbPool().execute<ResultSetHeader>(sql, values);
  return result;
}

export async function transaction<T>(
  callback: (connection: mysql.PoolConnection) => Promise<T>,
): Promise<T> {
  const connection = await getDbPool().getConnection();
  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export function firstRow<T extends RowDataPacket>(rows: T[]): T | null {
  return rows.length > 0 ? rows[0] : null;
}

export type QueryResult = [RowDataPacket[] | ResultSetHeader, FieldPacket[]];

async function requestDatabaseApi(
  config: { baseUrl: string; apiKey: string },
  mode: "query" | "execute",
  sql: string,
  values: DbValue[],
): Promise<{ rows?: unknown[]; result?: Partial<ResultSetHeader> }> {
  const response = await fetch(`${config.baseUrl}/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      mode,
      sql,
      values: values.map(serializeDbValue),
    }),
  });

  const body = (await response.json().catch(() => null)) as
    | { message?: string; rows?: unknown[]; result?: Partial<ResultSetHeader> }
    | null;

  if (!response.ok) {
    throw new Error(body?.message || "数据库接口请求失败。");
  }

  return body ?? {};
}

function serializeDbValue(value: DbValue): SerializedDbValue {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 23).replace("T", " ");
  }
  if (Buffer.isBuffer(value)) {
    return value.toString("base64");
  }
  return value;
}
