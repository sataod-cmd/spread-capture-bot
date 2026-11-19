"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, Download, Monitor, Smartphone, Terminal, Database, Server, Globe,
  CheckCircle2, Circle, Copy, Check, Apple, HardDrive, Rocket, AlertTriangle,
  Clock3, Wifi, Laptop
} from "lucide-react";

const steps = [
  {
    id: "app",
    icon: Download,
    title: "Option A — Install as a desktop app (fastest, 30 seconds)",
    badge: "RECOMMENDED",
    intro: "Your dashboard becomes a real app with its own icon, no browser address bar. Best for checking the bot during the day.",
    items: [
      { os: "Windows / Linux / Chromebook", body: "Open the dashboard link in Chrome or Edge → click the ⋮ menu (or the install icon that appears in the address bar) → choose “Install SpreadHunter” / “Install app” → confirm. A desktop icon and a standalone window are created." },
      { os: "macOS", body: "Open the dashboard link in Safari → File menu → “Add to Dock…”. Your bot appears as a normal Mac app in the Dock." },
      { os: "iPhone / iPad", body: "Open the link in Safari → tap the Share button → “Add to Home Screen”. Tap the new icon to launch it full-screen." },
      { os: "Android", body: "Open the link in Chrome → ⋮ menu → “Install app” (or “Add to Home screen”) → confirm." },
    ],
    note: "This installs the dashboard only. The trading worker still runs on the server, so the bot keeps trading 24×7 even when your computer is off.",
  },
  {
    id: "local",
    icon: Terminal,
    title: "Option B — Run the whole app on your own computer",
    badge: "FULL CONTROL",
    intro: "Run the dashboard AND the trading worker on your own machine. Best if you want to own the whole setup — but read the warning at the end about running 24×7.",
    items: [
      { os: "1. Install Node.js 20+", body: "Download the LTS installer from nodejs.org and run it. Verify by opening a terminal and typing: node -v  (you should see v20 or higher)." },
      { os: "2. Install PostgreSQL 15+", body: "Windows: download the installer from postgresql.org. macOS: brew install postgresql@15. Ubuntu: sudo apt install postgresql. Start the service and create a database + user (commands on the next step)." },
      { os: "3. Get the project & install packages", body: "Download or clone the project folder, open a terminal inside it and run: npm install" },
      { os: "4. Point it at your database", body: "Copy the .env file to .env.local and set DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/spreadhunter  (create the database first with: createdb spreadhunter)" },
      { os: "5. Create the tables", body: "Run: npx drizzle-kit push   — this creates all tables (bot_configs, trades, opportunities, time_period_stats, daily_reports, server_workers…)." },
      { os: "6. Build & start", body: "Run: npm run build  then  npm start   — open http://localhost:3000. The 24×7 worker auto-starts with the server." },
      { os: "7. Keep it running (Windows)", body: "Use nssm or pm2 to run it as a Windows service so it starts with the PC and restarts if it crashes: npx pm2 start npm --name spreadhunter -- start" },
      { os: "8. Keep it running (macOS/Linux)", body: "Use pm2: npm i -g pm2 && pm2 start npm --name spreadhunter -- start && pm2 save && pm2 startup  (follow the printed command to enable boot-time start)." },
    ],
    note: "This is the full setup — you get the worker on your machine too.",
  },
  {
    id: "cloud",
    icon: Globe,
    title: "Option C — Keep the bot running 24×7 on a cloud server (recommended for the bot)",
    badge: "ONLY WAY TO TRADE WHILE PC IS OFF",
    intro: "Your own computer must be ON for a local worker to trade. To trade while it is off, the app must live on an always-on host.",
    items: [
      { os: "Easiest — Vercel", body: "Push the project to GitHub, import it at vercel.com (framework preset: Next.js). Add the environment variable DATABASE_URL pointing to your Postgres (Neon/Supabase offer free Postgres). Add CRON_SECRET. Deploy. The vercel.json already includes a 1-minute cron so the bot keeps scanning even if the server sleeps." },
      { os: "Railway / Render", body: "Create a new service from your GitHub repo, add the DATABASE_URL env var, and attach a managed Postgres. These hosts keep Node processes running continuously — good for the always-on worker." },
      { os: "Cheapest always-on VPS", body: "A small Ubuntu VPS (Hetzner/Contabo/DigitalOcean), then follow Option B steps 3–8 on it. You get a server that never sleeps. Keep the cron backup too, in case the process is ever restarted." },
    ],
    note: "Whichever host you choose, the bot state (ON/OFF, capital, trade size, re-entry counters) lives in PostgreSQL — so it survives restarts and redeploys and resumes trading automatically.",
  },
];

export default function InstallPage() {
  const [copied, setCopied] = useState<string | null>(null);
  const [swReady, setSwReady] = useState(false);
  const [deferred, setDeferred] = useState<any>(null);
  const [canInstall, setCanInstall] = useState(false);
  const [showInstallHelp, setShowInstallHelp] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").then(() => setSwReady(true)).catch(() => {});
    }
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  useEffect(() => {
    if (deferred) setCanInstall(true);
  }, [deferred]);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const copy = async (text: string, key: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(null), 1800); } catch {}
  };

  const cmds = [
    { label: "Install dependencies", cmd: "npm install" },
    { label: "Create database tables", cmd: "npx drizzle-kit push" },
    { label: "Build for production", cmd: "npm run build" },
    { label: "Start the app + 24×7 worker", cmd: "npm start" },
    { label: "Run as a background service (all OS)", cmd: "npx pm2 start npm --name spreadhunter -- start" },
  ];

  return (
    <div className="min-h-screen bg-[#0b0e11] text-zinc-100">
      <header className="sticky top-0 z-40 border-b border-[#1e242c] bg-[#0b0e11]/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1100px] items-center justify-between gap-4 px-4 py-3">
          <Link href="/" className="flex items-center gap-2 text-xs font-bold text-zinc-400 hover:text-white"><ArrowLeft className="h-4 w-4"/> Back to Dashboard</Link>
          <span className="rounded bg-[#1e242c] px-2 py-1 text-[10px] font-black tracking-widest text-[#f0b90b]">INSTALL GUIDE</span>
        </div>
      </header>

      <main className="mx-auto max-w-[1100px] space-y-6 px-4 py-8">
        <div>
          <h1 className="text-3xl font-black tracking-tight sm:text-4xl">Install the dashboard<br/><span className="text-[#f0b90b]">on your computer</span></h1>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-zinc-400">Three ways to do it — pick one. <b className="text-zinc-100">Option A takes 30 seconds</b> and is what most people want. Option B gives you the whole app on your machine. Option C is the only way the bot keeps trading while your computer is off.</p>
        </div>

        {/* Current link + one-click install */}
        <section className="rounded-2xl border border-emerald-400/30 bg-[#12161a] p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-sm font-black"><Rocket className="h-5 w-5 text-emerald-400"/> Your dashboard link</p>
              <p className="mt-1 text-xs text-zinc-500">Open this on the computer where you want the dashboard. Add <span className="font-mono text-zinc-300">?install=1</span> to open the guided install view.</p>
              <div className="mt-3 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg bg-black/50 px-3 py-2 font-mono text-[11px] text-emerald-300">{origin}/</code>
                <button onClick={() => copy(origin + "/", "url")} className="shrink-0 rounded-lg border border-[#2b3139] p-2 hover:border-zinc-500">{copied === "url" ? <Check className="h-4 w-4 text-emerald-400"/> : <Copy className="h-4 w-4"/>}</button>
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:min-w-[230px]">
              <a
                href="/api/export/source"
                download="spreadhunter-source.zip"
                className="flex items-center justify-center gap-2 rounded-xl bg-emerald-400 px-5 py-3 text-center text-sm font-black text-black hover:bg-emerald-300"
              ><Download className="h-5 w-5"/> Download Project ZIP</a>
              <button
                onClick={async () => {
                  if (deferred && canInstall) {
                    await deferred.prompt();
                    setDeferred(null);
                    setCanInstall(false);
                    return;
                  }
                  // Browsers only offer native PWA installation under their own
                  // rules. If there is no event, show real instructions rather
                  // than leaving a button that appears to do nothing.
                  setShowInstallHelp((value) => !value);
                }}
                className="flex items-center justify-center gap-2 rounded-xl border border-emerald-400/40 px-5 py-2.5 text-sm font-bold text-emerald-300 hover:bg-emerald-400/10"
              ><Smartphone className="h-5 w-5"/> {canInstall ? "Install as App" : "How to Install as App"}</button>
              <span className="text-center text-[10px] text-zinc-500">{swReady ? "✓ App mode ready · ZIP download always works" : "Preparing app mode… · ZIP download works now"}</span>
            </div>
          </div>
        </section>

        {showInstallHelp && (
          <section className="rounded-2xl border border-sky-400/30 bg-sky-400/[0.06] p-5 text-xs leading-relaxed text-sky-100/90">
            <p className="font-black text-sky-200">Install the dashboard as an app (browser dependent)</p>
            <ul className="mt-2 list-disc space-y-1.5 pl-5">
              <li><b>Windows / Mac Chrome or Edge:</b> click the install icon in the address bar, or browser menu → <b>Install SpreadHunter / Install app</b>.</li>
              <li><b>macOS Safari:</b> <b>File → Add to Dock…</b></li>
              <li><b>Android Chrome:</b> menu → <b>Install app</b> or <b>Add to Home screen</b>.</li>
              <li><b>iPhone/iPad Safari:</b> <b>Share → Add to Home Screen</b>. iOS does not show an install prompt.</li>
            </ul>
            <p className="mt-2 text-sky-200/70">These actions install a shortcut to your hosted dashboard, not a second trading bot. Your server continues running independently.</p>
          </section>
        )}

        {/* Options */}
        {steps.map((s, si) => (
          <section key={s.id} className="overflow-hidden rounded-2xl border border-[#1e242c] bg-[#12161a]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1e242c] px-5 py-4">
              <h2 className="flex items-center gap-2.5 font-bold">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#1e242c]"><s.icon className="h-4.5 w-4.5 text-[#f0b90b]"/></span>
                {s.title}
              </h2>
              <span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${s.badge === "RECOMMENDED" ? "bg-emerald-400 text-black" : s.badge === "ONLY WAY TO TRADE WHILE PC IS OFF" ? "bg-rose-500 text-white" : "bg-[#1e242c] text-zinc-300"}`}>{s.badge}</span>
            </div>
            <div className="p-5">
              <p className="text-xs leading-relaxed text-zinc-400">{s.intro}</p>
              <ol className="mt-4 space-y-3">
                {s.items.map((it, i) => (
                  <li key={it.os} className="flex gap-3 rounded-xl border border-[#1e242c] bg-[#0b0e11] p-3.5">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#f0b90b] font-mono text-[11px] font-black text-black">{i + 1}</span>
                    <div className="min-w-0">
                      <p className="text-xs font-bold">{it.os}</p>
                      <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">{it.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <p className="mt-4 flex items-start gap-2 rounded-xl bg-sky-400/[0.06] px-3.5 py-3 text-[11px] leading-relaxed text-sky-100/85"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-sky-400"/><span>{s.note}</span></p>
            </div>
          </section>
        ))}

        {/* Commands */}
        <section className="overflow-hidden rounded-2xl border border-[#1e242c] bg-[#12161a]">
          <div className="border-b border-[#1e242c] px-5 py-4"><h2 className="flex items-center gap-2 font-bold"><Terminal className="h-5 w-5 text-[#f0b90b]"/> Command cheat-sheet (Option B)</h2><p className="mt-1 text-xs text-zinc-500">Run these inside the project folder, one after another.</p></div>
          <div className="space-y-2 p-5">
            {cmds.map(c => (
              <div key={c.cmd} className="flex flex-wrap items-center gap-3 rounded-xl border border-[#1e242c] bg-[#0b0e11] px-3.5 py-3">
                <div className="min-w-[180px] flex-1"><p className="text-[11px] font-bold text-zinc-300">{c.label}</p><code className="mt-0.5 block font-mono text-[12px] text-emerald-300">{c.cmd}</code></div>
                <button onClick={() => copy(c.cmd, c.cmd)} className="shrink-0 rounded-lg border border-[#2b3139] p-2 hover:border-zinc-500">{copied === c.cmd ? <Check className="h-4 w-4 text-emerald-400"/> : <Copy className="h-4 w-4"/>}</button>
              </div>
            ))}
            <div className="mt-3 rounded-xl border border-[#1e242c] bg-[#0b0e11] p-3.5">
              <p className="text-[11px] font-bold text-zinc-200">Database connection string (.env.local)</p>
              <code className="mt-1 block break-all rounded bg-black/40 px-2.5 py-2 font-mono text-[11px] text-amber-300">DATABASE_URL=postgresql://postgres:postgres@localhost:5432/spreadhunter</code>
              <p className="mt-1.5 text-[10px] text-zinc-500">Replace user, password and db name with yours. Add <span className="font-mono">CRON_SECRET=any-long-random-string</span> to protect the cron endpoint.</p>
            </div>
          </div>
        </section>

        {/* Checklist */}
        <section className="overflow-hidden rounded-2xl border border-[#1e242c] bg-[#12161a]">
          <div className="border-b border-[#1e242c] px-5 py-4"><h2 className="flex items-center gap-2 font-bold"><CheckCircle2 className="h-5 w-5 text-emerald-400"/> Final checklist</h2></div>
          <div className="grid gap-2 p-5 sm:grid-cols-2">
            {[
              "Dashboard opens on your computer (Option A, B or C)",
              "PostgreSQL is running and DATABASE_URL is set",
              "npx drizzle-kit push completed — tables exist",
              "npm run build + npm start — server responds on :3000",
              "Bot shows “TRADING 24×7” and both Binance + Bybit legs are green",
              "Worker installed as a service (pm2/nssm) if you want it to survive reboots",
              "If you want trading while PC is OFF → host it in the cloud (Option C)",
              "Exchanges: Binance + Bybit accounts opened, KYC done, 2FA on",
            ].map(t => (
              <p key={t} className="flex items-start gap-2 rounded-lg border border-[#1e242c] bg-[#0b0e11] px-3 py-2.5 text-[11px] leading-snug text-zinc-300"><Circle className="mt-0.5 h-3 w-3 shrink-0 text-zinc-600" />{t}</p>
            ))}
          </div>
        </section>

        {/* Honest warning */}
        <section className="rounded-2xl border border-rose-400/30 bg-rose-400/[0.05] p-5">
          <p className="flex items-center gap-2 text-sm font-black text-rose-200"><Clock3 className="h-5 w-5"/> The one thing nobody tells you</p>
          <p className="mt-2 text-xs leading-relaxed text-zinc-300">A bot can only trade while the machine running it is <b className="text-white">powered on and online</b>. If you install this on your laptop and shut the lid, the bot stops — no profit, no loss, just no trading. That is why the bot was built to run on a <b className="text-white">server</b> (Option C): the server never sleeps, so it keeps working while your computer is off. Install Option A on your computer just for <b className="text-white">viewing and controlling</b> it.</p>
          <p className="mt-2 text-xs leading-relaxed text-zinc-400">Also note: this app currently runs a <b className="text-white">paper-trading simulation</b>. Real money needs API keys (spot only, withdrawals off) plus your own risk limits — see the Exchange Setup panel on the dashboard before depositing.</p>
        </section>

        <div className="flex flex-wrap items-center justify-between gap-3 pb-8 text-[11px] text-zinc-600">
          <p>SpreadHunter · Spread Capture Bot · install guide</p>
          <Link href="/" className="rounded-lg bg-[#f0b90b] px-4 py-2 font-black text-black hover:bg-[#ffd84d]">Open Dashboard →</Link>
        </div>
      </main>
    </div>
  );
}
