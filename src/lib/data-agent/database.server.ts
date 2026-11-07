import "server-only";

import { Pool, type PoolClient } from "pg";

const globalForDataAgent = globalThis as typeof globalThis & { dataAgentPool?: Pool };

export class DataAgentError extends Error {
  constructor(readonly code: "NOT_CONFIGURED" | "VERSION_NOT_FOUND" | "INVALID_METRIC" | "INVALID_SERIES" | "BUSY", message: string) {
    super(message);
  }
}

// Adapted from Greensystem's sandboxSql. A failed rollback discards the connection.
export async function readDataAgent<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
  const connectionString = process.env.DATA_AGENT_DATABASE_URL?.trim();
  if (!connectionString) throw new DataAgentError("NOT_CONFIGURED", "请配置数据库 Agent 的只读连接。");
  if (!globalForDataAgent.dataAgentPool) {
    const pool = new Pool({ connectionString, max: 3, connectionTimeoutMillis: 4000, idleTimeoutMillis: 15000 });
    pool.on("error", () => console.warn("Data agent lost an idle PostgreSQL connection."));
    globalForDataAgent.dataAgentPool = pool;
  }
  const client = await globalForDataAgent.dataAgentPool.connect();
  let discard: Error | undefined;
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL ROLE green_agent_ro");
    await client.query("SET LOCAL search_path = pg_catalog");
    await client.query("SET LOCAL timezone = 'UTC'");
    await client.query("SET LOCAL statement_timeout = '4s'");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { discard = new Error("Data agent transaction cleanup failed"); }
    throw error;
  } finally {
    client.release(discard);
  }
}
