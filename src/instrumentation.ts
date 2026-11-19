/**
 * Runs once when the Next.js server process starts (not in the browser).
 * This is what makes the bot 24×7: the worker lives in the server, so it
 * keeps scanning/trading after the user closes their tab or turns their
 * computer off. On every restart/deploy it auto-resumes from PostgreSQL.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Don't start the worker during `next build` page-data collection.
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  try {
    const { startBotWorker } = await import("./lib/worker");
    startBotWorker("server-boot");
  } catch (e) {
    console.error("[instrumentation] failed to start bot worker", e);
  }
}
