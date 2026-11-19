import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
};

function createPool() {
  const p = new Pool({
    connectionString: databaseUrl,
    // ── 24×7 resilience ──────────────────────────────────────────────
    // Never let a dead connection hang a bot tick forever.
    connectionTimeoutMillis: 8000,   // fail fast instead of hanging
    idleTimeoutMillis: 30_000,       // recycle idle connections
    max: 5,                          // small pool, but bounded
    allowExitOnIdle: true,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
  });
  // If the connection dies (host freeze / network blip), drop it so the pool
  // transparently reconnects instead of serving errors forever.
  p.on("error", (err) => {
    console.error("[db] idle client error:", err instanceof Error ? err.message : err);
  });
  return p;
}

export const pool =
  globalForDb.__arenaNextJsPostgresqlPool ?? createPool();

if (process.env.NODE_ENV !== "production") {
  globalForDb.__arenaNextJsPostgresqlPool = pool;
}

/**
 * Recycle the whole pool. Used by the worker watchdog when the database
 * connection has gone stale (common after a host freezes the process).
 */
export function recyclePool() {
  try { void pool.end(); } catch {}
  try { globalForDb.__arenaNextJsPostgresqlPool = createPool(); } catch {}
}

export const db = drizzle(pool);
