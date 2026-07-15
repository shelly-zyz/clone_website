import "server-only";

import { Pool, type QueryResultRow } from "pg";

const globalForDatabase = globalThis as typeof globalThis & {
  postgresPool?: Pool;
};

function createPool() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured.");
  }

  return new Pool({
    connectionString,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    max: 3,
    ssl: process.env.DATABASE_SSL === "true"
      ? { rejectUnauthorized: false }
      : false,
  });
}

export function getDatabasePool() {
  if (!globalForDatabase.postgresPool) {
    globalForDatabase.postgresPool = createPool();
    globalForDatabase.postgresPool.on("error", (error) => {
      console.error("Idle PostgreSQL connection failed.", error);
    });
  }

  return globalForDatabase.postgresPool;
}

export async function queryDatabase<Row extends QueryResultRow>(
  text: string,
  values: readonly unknown[] = [],
) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await getDatabasePool().query<Row>(text, [...values]);
    } catch (error) {
      lastError = error;
      if (attempt === 3 || !isRetryableConnectionError(error)) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }

  throw lastError;
}

function isRetryableConnectionError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return [
    "connection terminated",
    "connection reset",
    "server closed the connection",
    "timeout",
    "econnreset",
    "econnrefused",
  ].some((token) => message.includes(token));
}
