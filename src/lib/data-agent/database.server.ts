import "server-only";

import { Pool, type PoolClient } from "pg";

const globalForDataAgent = globalThis as typeof globalThis & { dataAgentPool?: Pool };

export class DataAgentError extends Error {
  constructor(readonly code: "NOT_CONFIGURED" | "VERSION_NOT_FOUND" | "INVALID_METRIC" | "INVALID_SERIES" |
    "INVALID_REGION" | "PROJECT_NOT_FOUND" | "SESSION_CONFLICT" | "REVIEW_CONFLICT" | "BUSY", message: string) {
    super(message);
  }
}

const writePools = new Map<string, Pool>();

async function connectDataAgent(pool: Pool) {
  try {
    return await pool.connect();
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : null;
    const disconnected = error instanceof Error && /connection (terminated|timeout)|timeout exceeded when trying to connect/i.test(error.message);
    if (!disconnected && !["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT"].includes(String(code))) throw error;
    // Retry acquisition before BEGIN so no statement or write is replayed.
    return pool.connect();
  }
}

export async function runDataAgentWrite<T>(
  role: "green_agent_context" | "green_agent_review",
  run: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const connectionString = (role === "green_agent_context"
    ? process.env.DATA_AGENT_STATE_DATABASE_URL : process.env.DATA_AGENT_REVIEW_DATABASE_URL)?.trim();
  if (!connectionString) throw new DataAgentError("NOT_CONFIGURED", "未配置此数据服务的数据库连接。");
  let pool = writePools.get(role);
  if (!pool) {
    pool = new Pool({ connectionString, max: 3, connectionTimeoutMillis: 4000, idleTimeoutMillis: 15000 });
    pool.on("error", () => console.warn("Data agent lost an idle write connection."));
    writePools.set(role, pool);
  }
  const client = await connectDataAgent(pool);
  let discard: Error | undefined;
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL ROLE ${role}`);
    await client.query("SET LOCAL search_path = pg_catalog; SET LOCAL statement_timeout = '20s'");
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

// Adapted from Greensystem's sandboxSql. A failed rollback discards the connection.
export async function readDataAgent<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
  const connectionString = process.env.DATA_AGENT_DATABASE_URL?.trim();
  if (!connectionString) throw new DataAgentError("NOT_CONFIGURED", "请配置数据库 Agent 的只读连接。");
  if (!globalForDataAgent.dataAgentPool) {
    const pool = new Pool({ connectionString, max: 3, connectionTimeoutMillis: 4000, idleTimeoutMillis: 15000 });
    pool.on("error", () => console.warn("Data agent lost an idle PostgreSQL connection."));
    globalForDataAgent.dataAgentPool = pool;
  }
  const client = await connectDataAgent(globalForDataAgent.dataAgentPool);
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
