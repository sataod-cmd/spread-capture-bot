import { NextResponse } from "next/server";
import { ensureConfig } from "../../../lib/bot";
import { liveScan } from "../../../lib/live";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = await ensureConfig();
  const result = await liveScan({ execute: false });
  return NextResponse.json({ ...result, liveEnabled: config.liveEnabled, dryRun: config.liveDryRun });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const config = await ensureConfig();

  if (body.action === "scan") {
    const result = await liveScan({ execute: false });
    return NextResponse.json(result);
  }
  if (body.action === "execute") {
    if (!config.liveEnabled) {
      return NextResponse.json({ ok: false, error: "Live trading is disabled. Enable it from the Live Connection panel first." }, { status: 400 });
    }
    if (config.liveDryRun) {
      return NextResponse.json({ ok: false, error: "Dry-run mode is on — it scans real books but will not place orders. Turn dry-run off to trade." }, { status: 400 });
    }
    const result = await liveScan({ execute: true });
    return NextResponse.json(result);
  }
  return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
}
