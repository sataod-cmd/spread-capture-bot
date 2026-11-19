"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, ArrowDownRight, ArrowRight, ArrowUpRight, Bot, ChartCandlestick, ChevronDown,
  CircleDollarSign, Crosshair, Gauge, History, Play, Pause, Power, Radar, RefreshCw,
  Settings2, Shield, Sparkles, Terminal, TrendingUp, Wallet, Zap, Trash2, Info,
  ArrowLeftRight, Timer, Percent, DollarSign, Layers, CheckCircle2, XCircle,
  Server, Globe, Moon, Laptop, Cloud, Database, HeartPulse, Copy, Check, Clock3, RotateCcw, Satellite,
  ShieldCheck, ShieldAlert, Scale, Receipt, PiggyBank, Ban, Flame, Target, Telescope, Waves,
  TrendingDown, Rocket, ActivitySquare, FlaskConical, Crown,
  CalendarClock, Hourglass, ReceiptText, Download, Save, Smartphone, PlugZap,
  LockKeyhole
} from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, LineChart, Line, Cell } from "recharts";

type Quote = { exchange: string; bid: number; ask: number; mid: number; spreadUsd: number; spreadPercent: number; volume24h: number; latencyMs: number; takerFeePercent: number; makerFeePercent: number };
type Market = {
  symbol: string; baseAsset: string; basePrice: number; change24h: number;
  category: string; liquidityScore: number;
  quotes: Quote[]; bestBid: { exchange: string; price: number }; bestAsk: { exchange: string; price: number };
  arbitrage: { buyExchange: string; sellExchange: string; buyAsk: number; sellBid: number; spreadUsd: number; spreadPercent: number; isOpportunity: boolean; tier: string };
  history: { t: string; price: number; spread: number }[];
};
type Config = {
  id: number; isRunning: boolean; autoTrade: boolean; mode: string; spreadThreshold: number; minProfitUsd: number;
  tradeAmountUsd: number; maxTradeAmountUsd: number; feePercent: number; slippagePercent: number; cooldownSeconds: number;
  maxDailyLossUsd: number; symbols: string[]; exchanges: string[]; balanceUsd: number; initialBalanceUsd: number;
  run24x7: boolean; autoResume: boolean; workerIntervalSeconds: number; lastScanAt: string | null; lastHeartbeatAt: string | null;
  minProfitChargeRatio: number; maxLossPerTradeUsd: number; maxConsecutiveLosses: number; maxTradesPerDay: number; maxTradesPerHour: number; maxDrawdownPercent: number; lowFeeRouting: boolean; dynamicSizing: boolean;
  wideHunterEnabled: boolean; wideSpreadThreshold: number; wideOnlyExecution: boolean; includeVolatilePairs: boolean;
  autonomousMode: boolean; strictStopLossEnabled: boolean; stopLossPercent: number; stopLossCooldownMinutes: number; riskPausedUntil: string | null;
  makerOnlyEnabled: boolean; maxMakerFeePercent: number; makerFillTimeoutSeconds: number; tokenFeeDiscount: boolean; taxPercent: number; twoExchangeMode: boolean;
  reEntryEnabled: boolean; reEntryDelaySeconds: number; reEntryMaxAttempts: number; reEntrySizeMultiplier: number; reEntryMinSpreadBoost: number;
  autoScalingEnabled: boolean; baseCapital: number; baseTradeAmount: number; maxCapitalPercentPerTrade: number;
  emergencyStop: boolean; autoTimeWindow: boolean; activeHours: number[];
  autoThresholdTuning: boolean; thresholdBoostLosingHours: number; sizeBoostWinningHours: number; disabledPairs: string[];
};
type LegHealth = { exchange: string; status: string; online: boolean; tradesTotal: number; pnlTotal: number; tradesLastHour: number; pnlLastHour: number; oppsLastHour: number; lastTradeAt: string | null };
type WorkerStatus = {
  ok: boolean; serverTime: string; browserRequired: boolean;
  worker: { id: number; workerId: string; status: string; online: boolean; heartbeatAgeSeconds: number | null; startedAt: string | null; lastHeartbeatAt: string | null; lastScanAt: string | null; lastTradeAt: string | null; lastSource: string; scansCount: number; tradesCount: number; opportunitiesCount: number; errorsCount: number; tickCount: number; hostInfo: string } | null;
  inProcess: { runningInProcess: boolean; workerId?: string; startedAt?: string; uptimeSeconds?: number; lastTickAt?: string | null };
  config: { isRunning: boolean; run24x7: boolean; autoResume: boolean; workerIntervalSeconds: number };
  nextScanInSeconds: number | null;
  legs?: LegHealth[];
  bothBots?: { bothOnline: boolean; anyTrading: boolean; verdict: string };
  availability?: { keepAliveActive: boolean | null; watchdogActive: boolean | null; scansThisProcess: number | null; longestGapSeconds: number | null; lastGapSeconds: number | null; availabilityPercent: number | null; uptimeSeconds?: number } | null;
  serverTrades: { count: number; lastAt: string | null };
  cronTrades: { count: number; lastAt: string | null };
  cronBackup: { urlPath: string; auth: string };
};
type Trade = { id: number; symbol: string; buyExchange: string; sellExchange: string; buyPrice: number; sellPrice: number; spreadPercent: number; quantity: number; amountUsd: number; grossProfit: number; fees: number; netProfit: number; status: string; strategy: string; source?: string; stopLossAmount?: number; stopLossTriggered?: boolean; executedAt: string };
type Opp = { id: number; symbol: string; buyExchange: string; sellExchange: string; buyAsk: number; sellBid: number; spreadPercent: number; spreadUsd: number; estimatedProfit: number; tradeAmountUsd: number; status: string; totalCharges: number; profitChargeRatio: number; breakEvenSpreadPercent: number; riskLevel: string; qualityScore: number; skipReason: string | null; createdAt: string };
type RouteEval = { buy: Quote; sell: Quote; spreadPercent: number; gross: number; buyFee: number; sellFee: number; fees: number; slippage: number; charges: number; net: number; ratio: number; chargesOfGross: number; breakEven: number; requiredSpread: number; pass: boolean; reasons: string[]; score: number; grade: string; suggested: number };
type Log = { id: number; level: string; message: string; createdAt: string };

const ALL_SYMBOLS = ["PEPE/USDT","BONK/USDT","WIF/USDT","SHIB/USDT","INJ/USDT","ARB/USDT"];
const BEST_6_META: Record<string, { rank: number; accent: string; thesis: string }> = {
  "PEPE/USDT": { rank: 1, accent: "#4ade80", thesis: "Widest spreads (2.31%) • #1 earner" },
  "BONK/USDT": { rank: 2, accent: "#fb923c", thesis: "2.16% max spread • #2 earner" },
  "WIF/USDT": { rank: 3, accent: "#f472b6", thesis: "Top fast-move score • β2.2" },
  "SHIB/USDT": { rank: 4, accent: "#facc15", thesis: "100% win rate • patience pair" },
  "INJ/USDT": { rank: 5, accent: "#38bdf8", thesis: "Best non-meme • diversifier" },
  "ARB/USDT": { rank: 6, accent: "#a78bfa", thesis: "L2 beta play • β1.7" },
};
const ALL_EXCHANGES = ["Binance","Coinbase","Kraken","Bybit","KuCoin","OKX","Gate.io","Bitget"];
const CATEGORY_LABEL: Record<string,string> = { major:"MAJOR", alt:"ALT", volatile:"VOLATILE", meme:"MEME" };
// Official account-opening links (verified domains — no referral/affiliate codes)


function fmt(n: number, d = 2) { return n.toLocaleString("en-US",{minimumFractionDigits:d, maximumFractionDigits:d}); }
function fmtMoney(n: number) { const a = Math.abs(n); return a !== 0 && a < 1 ? fmt(n,4) : fmt(n,2); }
function fmtPrice(n: number, sym="") { if (n < 0.0001) return fmt(n,8); if (n < 0.01) return fmt(n,6); return n < 5 ? fmt(n,4) : n < 100 ? fmt(n,3) : fmt(n,2); }
function tierOf(spread: number, wideThreshold: number) { if (spread >= wideThreshold*2.4) return {label:"EXTREME", cls:"bg-rose-500 text-white"}; if (spread >= wideThreshold*1.6) return {label:"MEGA", cls:"bg-orange-500 text-black"}; if (spread >= wideThreshold) return {label:"WIDE", cls:"bg-[#f0b90b] text-black"}; return {label:"NORMAL", cls:"bg-zinc-800 text-zinc-400"}; }
function timeAgo(s: string) { const diff = Math.floor((Date.now()-new Date(s).getTime())/1000); if(diff<5) return "just now"; if(diff<60) return `${diff}s ago`; if(diff<3600) return `${Math.floor(diff/60)}m ago`; return new Date(s).toLocaleTimeString(); }

// ── Frontend mirror of the server Risk Engine (same maths, for live display) ──
function feeRate(q: Quote, lowFee: boolean, fallback: number) { return lowFee ? (q.makerFeePercent ?? fallback) : (q.takerFeePercent ?? fallback); }
function evalRoute(buy: Quote, sell: Quote, cfg: Config | null, amount: number): RouteEval {
  const lowFee = cfg?.lowFeeRouting ?? true;
  const qty = amount / buy.ask;
  const gross = (sell.bid - buy.ask) * qty;
  const spreadPercent = buy.ask ? ((sell.bid - buy.ask) / buy.ask) * 100 : 0;
  const buyFee = amount * (feeRate(buy, lowFee, cfg?.feePercent ?? 0.08) / 100);
  const sellFee = sell.bid * qty * (feeRate(sell, lowFee, cfg?.feePercent ?? 0.08) / 100);
  const fees = buyFee + sellFee;
  const slippage = amount * ((cfg?.slippagePercent ?? 0.03) / 100);
  const charges = fees + slippage;
  const net = gross - charges;
  const ratio = charges > 0 ? net / charges : 0;
  const breakEven = amount > 0 ? (charges / amount) * 100 : 999;
  const requiredSpread = breakEven * (1 + (cfg?.minProfitChargeRatio ?? 1.5));
  const reasons: string[] = [];
  if (spreadPercent < (cfg?.spreadThreshold ?? 0.3)) reasons.push(`Spread ${spreadPercent.toFixed(3)}% < ${(cfg?.spreadThreshold ?? 0.3)}% min`);
  if (charges >= gross && gross > 0) reasons.push("Charges ≥ gross profit");
  else if (net <= 0) reasons.push("Net ≤ $0 after charges");
  else if (ratio < (cfg?.minProfitChargeRatio ?? 1.5)) reasons.push(`Profit only ${ratio.toFixed(2)}× charges (need ${(cfg?.minProfitChargeRatio ?? 1.5)}×)`);
  if (net > 0 && net < (cfg?.minProfitUsd ?? 0.04)) reasons.push(`Net $${net.toFixed(4)} < $${cfg?.minProfitUsd ?? 0.04} min`);
  let score = Math.round(Math.min(100, Math.max(0, (ratio / Math.max(0.1, cfg?.minProfitChargeRatio ?? 1.5)) * 22 + (spreadPercent / Math.max(0.01, requiredSpread)) * 18 + spreadPercent * 22 + 8)));
  if (reasons.length) score = Math.min(score, 54);
  const suggested = !cfg?.dynamicSizing || reasons.length ? amount : score >= 85 ? Math.min(cfg?.maxTradeAmountUsd ?? 50, amount * 1.5) : score >= 70 ? amount : score >= 55 ? amount * 0.75 : amount * 0.5;
  return { buy, sell, spreadPercent, gross, buyFee, sellFee, fees, slippage, charges, net, ratio, chargesOfGross: gross > 0 ? (charges / gross) * 100 : 999, breakEven, requiredSpread, pass: reasons.length === 0, reasons, score, grade: reasons.length ? "SKIP" : score >= 85 ? "A+" : score >= 70 ? "A" : score >= 55 ? "B" : "C", suggested };
}
function bestRoute(m: Market, cfg: Config | null, amount: number): RouteEval | null {
  let all: RouteEval[] = [];
  for (const buy of m.quotes) for (const sell of m.quotes) {
    if (buy.exchange === sell.exchange || sell.bid <= buy.ask) continue;
    all.push(evalRoute(buy, sell, cfg, amount));
  }
  if (!all.length) return null;
  all.sort((a, b) => b.net - a.net);
  return all.find(r => r.pass) || all[0];
}

export default function Home() {
  const [market, setMarket] = useState<Market[]>([]);
  const [config, setConfig] = useState<Config | null>(null);
  const [stats, setStats] = useState<any>(null);
  const [risk, setRisk] = useState<any>(null);
  const [wide, setWide] = useState<any>(null);
  const [scannerFilter, setScannerFilter] = useState<string>("all");
  const [tab, setTab] = useState<"live" | "risk" | "perf" | "ops">("live");
  const [analysis, setAnalysis] = useState<any>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [moveDirection, setMoveDirection] = useState<string>("both");
  const [moveMagnitude, setMoveMagnitude] = useState<number>(2);
  const [injecting, setInjecting] = useState<string | null>(null);
  const [injectMsg, setInjectMsg] = useState<string | null>(null);
  const [bestPairStats, setBestPairStats] = useState<any[]>([]);
  const [stopLossInfo, setStopLossInfo] = useState<any>(null);
  const [reentry, setReentry] = useState<any>(null);
  const [resettingReentry, setResettingReentry] = useState(false);
  const [sizing, setSizing] = useState<any>(null);
  const [auto, setAuto] = useState<any>(null);
  const [autoBusy, setAutoBusy] = useState(false);
  const [feeAudit, setFeeAudit] = useState<any>(null);
  const [diag, setDiag] = useState<any>(null);
  const [conn, setConn] = useState<any>(null);
  const [connBusy, setConnBusy] = useState(false);
  const [liveRows, setLiveRows] = useState<any[]>([]);
  const [liveMsg, setLiveMsg] = useState<string | null>(null);
  const [profitAudit, setProfitAudit] = useState<any>(null);
  const [executionPlan, setExecutionPlan] = useState<any>(null);
  const [timeData, setTimeData] = useState<any>(null);
  const [excelBusy, setExcelBusy] = useState(false);
  const [savingDaily, setSavingDaily] = useState(false);
  const [exData, setExData] = useState<any>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [opps, setOpps] = useState<Opp[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [equity, setEquity] = useState<any[]>([]);
  const [selected, setSelected] = useState("PEPE/USDT");
  const [expanded, setExpanded] = useState<string | null>("PEPE/USDT");
  const [scanning, setScanning] = useState(false);
  const [lastScan, setLastScan] = useState<Date | null>(null);
  const [executingId, setExecutingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Partial<Config>>({});
  const [capitalInput, setCapitalInput] = useState<string>("100");
  const [applyingCapital, setApplyingCapital] = useState(false);
  const [worker, setWorker] = useState<WorkerStatus | null>(null);
  const [workerBusy, setWorkerBusy] = useState<string | null>(null);
  const [copiedCron, setCopiedCron] = useState(false);
  const [nowTs, setNowTs] = useState(Date.now());
  const logRef = useRef<HTMLDivElement>(null);

  const loadBot = useCallback(async () => {
    try {
      const r = await fetch("/api/bot", { cache: "no-store" });
      const j = await r.json();
      setConfig(j.config); setStats(j.stats); setRisk(j.risk || null); setWide(j.wide || null); setBestPairStats(j.bestPairs || []); setStopLossInfo(j.stopLoss || null); setProfitAudit(j.profitAudit || null); setExecutionPlan(j.executionPlan || null); setReentry(j.reentry || null); setSizing(j.sizing || null); setFeeAudit(j.feeAudit || null); setDiag(j.diagnostics || null); setTrades(j.recentTrades); setOpps(j.recentOpps); setLogs(j.logs); setEquity(j.equitySeries);
      setDraft(j.config);
      // Only sync the capital input on first load, not on every poll (would overwrite typing)
      setCapitalInput(prev => prev === "100" && j.config?.initialBalanceUsd ? String(j.config.initialBalanceUsd) : prev);
    } catch {}
  }, []);

  const loadWorker = useCallback(async () => {
    try {
      const r = await fetch("/api/worker", { cache: "no-store" });
      const j = await r.json();
      setWorker(j);
    } catch {}
  }, []);

  // Read-only market preview — trading is NOT done here anymore.
  // The 24×7 server worker (src/lib/worker.ts) does all scanning/trading.
  const loadMarket = useCallback(async () => {
    try {
      const r = await fetch("/api/market", { cache: "no-store" });
      const j = await r.json();
      setMarket(j.market);
    } catch {}
  }, []);

  useEffect(() => { loadBot(); loadMarket(); loadWorker(); }, [loadBot, loadMarket, loadWorker]);

  // Dashboard refresh loop — READ ONLY. Closing this tab stops nothing.
  useEffect(() => {
    const id = setInterval(async () => {
      await loadMarket();
      loadBot();
      loadWorker();
    }, 3000);
    return () => clearInterval(id);
  }, [loadMarket, loadBot, loadWorker]);

  // 1-second clock for heartbeat / next-scan countdowns
  useEffect(() => {
    const id = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => { if (logRef.current) logRef.current.scrollTop = 0; }, [logs]);

  const selectedMarket = useMemo(() => market.find(m=>m.symbol===selected) || market[0], [market, selected]);
  const liveOpps = useMemo(() => market.filter(m=>m.arbitrage.isOpportunity && m.arbitrage.spreadPercent >= (config?.spreadThreshold||0.12)), [market, config]);
  const bestOpp = liveOpps[0];

  const profitBySymbol = useMemo(() => {
    const map: Record<string, number> = {};
    trades.forEach(t=>{ map[t.symbol]=(map[t.symbol]||0)+t.netProfit; });
    return Object.entries(map).map(([symbol, profit])=>({ symbol: symbol.replace("/USDT",""), profit: parseFloat(profit.toFixed(2)) }));
  }, [trades]);

  async function toggleBot() {
    // Top button now controls the 24×7 server mode, not a browser loop
    await workerAction(config?.isRunning ? "disable-24x7" : "enable-24x7");
  }
  async function workerAction(action: string) {
    setWorkerBusy(action);
    try {
      await fetch("/api/worker", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({action}) });
      await Promise.all([loadBot(), loadWorker()]);
    } finally { setWorkerBusy(null); }
  }
  const loadAnalysis = useCallback(async (direction = "both", magnitude = 2, save = false) => {
    setAnalysisLoading(true);
    try {
      if (save) {
        const r = await fetch("/api/analysis", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ direction, magnitudePercent: magnitude }) });
        const j = await r.json(); setAnalysis(j);
      } else {
        const r = await fetch(`/api/analysis?direction=${direction}&magnitude=${magnitude}`, { cache:"no-store" });
        const j = await r.json(); setAnalysis(j);
      }
    } catch {} finally { setAnalysisLoading(false); }
  }, []);
  async function injectShock(symbol: string, direction: string, magnitude: number) {
    setInjecting(symbol); setInjectMsg(null);
    try {
      const r = await fetch("/api/analysis", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ action:"inject", symbol, direction, magnitudePercent: magnitude }) });
      const j = await r.json();
      setInjectMsg(j.message ? `${j.message} ${j.botRunning24x7 ? "• 24×7 bot is ON — watch Recent Trades below in ~5-15s." : "• Bot is OFF — press START 24×7 first, then inject again."}` : (j.error || "Injected"));
      loadBot();
    } finally { setInjecting(null); }
  }
  const loadTimeAnalysis = useCallback(async () => {
    try { const r = await fetch("/api/time-analysis", { cache: "no-store" }); setTimeData(await r.json()); } catch {}
  }, []);
  // ── Excel export: downloads a server-generated workbook ──
  async function downloadExcel() {
    setExcelBusy(true);
    try {
      const response = await fetch("/api/export/excel", { cache: "no-store" });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || `Export failed (${response.status})`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const stamp = new Date().toISOString().slice(0, 10);
      link.href = url;
      link.download = `spread-capture-bot-profit-report-${stamp}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      alert("Excel export failed: " + (error instanceof Error ? error.message : String(error)));
    } finally {
      setExcelBusy(false);
    }
  }
  async function saveDailyReportNow() {
    setSavingDaily(true);
    try {
      const r = await fetch("/api/time-analysis", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save-daily" }) });
      const j = await r.json();
      if (!j.ok) alert(j.error || "Could not save today's report yet");
      else alert(`Saved ${j.saved.reportDate}: ${j.saved.trades} trades, $${j.saved.netProfit} net, best ${j.saved.bestHour}`);
      loadTimeAnalysis();
    } finally { setSavingDaily(false); }
  }
  const loadExchanges = useCallback(async () => {
    try { const r = await fetch("/api/exchanges?capital=100", { cache: "no-store" }); setExData(await r.json()); } catch {}
  }, []);
  const loadAuto = useCallback(async () => {
    try { const r = await fetch("/api/autopilot", { cache: "no-store" }); setAuto(await r.json()); } catch {}
  }, []);
  const loadConn = useCallback(async () => {
    try { const r = await fetch("/api/connection", { cache: "no-store" }); setConn(await r.json()); } catch {}
  }, []);
  const loadLive = useCallback(async () => {
    try { const r = await fetch("/api/live", { cache: "no-store" }); const j = await r.json(); setLiveRows(j.routes || []); } catch {}
  }, []);
  async function autoPatch(patch: Record<string, unknown>) {
    setAutoBusy(true);
    try {
      await fetch("/api/autopilot", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      await Promise.all([loadAuto(), loadBot()]);
    } finally { setAutoBusy(false); }
  }
  async function autoAction(action: string) {
    setAutoBusy(true);
    try {
      const r = await fetch("/api/autopilot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const j = await r.json();
      if (!j.ok && j.error) alert(j.error);
      await Promise.all([loadAuto(), loadBot()]);
    } finally { setAutoBusy(false); }
  }
  useEffect(() => { loadAnalysis("both", 2, false); loadTimeAnalysis(); loadExchanges(); loadAuto(); loadConn(); loadLive(); }, [loadAnalysis, loadTimeAnalysis, loadExchanges, loadAuto, loadConn, loadLive]);
  // Keep the time tracker fresh (the heavy aggregates only need ~20s cadence)
  useEffect(() => { const id = setInterval(() => { loadTimeAnalysis(); }, 20000); return () => clearInterval(id); }, [loadTimeAnalysis]);
  async function patchWide(patch: Record<string, unknown>) {
    // Instant-apply hunter settings (also saved into the draft for the config form)
    setDraft(d => ({ ...d, ...patch }));
    await fetch("/api/bot", { method:"PATCH", headers:{"Content-Type":"application/json"}, body: JSON.stringify(patch) });
    loadBot();
  }
  async function manualScan(executeAll=false) {
    setScanning(true);
    const r = await fetch("/api/bot/scan", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({manual:true, executeAll}) });
    const j = await r.json(); if(j.market) setMarket(j.market); setLastScan(new Date()); await loadBot(); setScanning(false);
  }
  async function resetBot() {
    const cap = config?.initialBalanceUsd ?? 100;
    if (!confirm(`Reset portfolio to $${fmt(cap)} and clear all trades?`)) return;
    await fetch("/api/bot", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({action:"reset"}) });
    loadBot();
  }
  async function applyCapital(newCap?: number) {
    const cap = Math.round((newCap ?? Number(capitalInput)) * 100) / 100;
    if (!Number.isFinite(cap) || cap < 10) { alert("Capital must be at least $10"); return; }
    if (cap > 1000000) { alert("Capital too large for paper account (max $1,000,000)"); return; }
    if (!confirm(`Start fresh with $${fmt(cap)} capital?\n\nThis clears all trades & history, sets your wallet to $${fmt(cap)}, trade size to $${fmt(Math.min(Math.max(cap*0.2,5), cap*0.5))} (20% of capital), max daily loss to $${fmt(cap*0.03)} (3%) and max loss/trade to $${fmt(Math.max(0.05, cap*0.0015))}.`)) return;
    setApplyingCapital(true);
    const r = await fetch("/api/bot", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({action:"setCapital", capital: cap}) });
    const j = await r.json(); setConfig(j.config); setCapitalInput(String(cap)); setApplyingCapital(false); loadBot();
  }
  async function saveConfig() {
    setSaving(true);
    const payload = { ...draft, spreadThreshold: Number(draft.spreadThreshold), tradeAmountUsd: Number(draft.tradeAmountUsd), maxTradeAmountUsd: Number((draft as any).maxTradeAmountUsd), minProfitUsd: Number(draft.minProfitUsd), feePercent: Number(draft.feePercent), slippagePercent: Number(draft.slippagePercent), cooldownSeconds: Number(draft.cooldownSeconds), maxDailyLossUsd: Number(draft.maxDailyLossUsd), workerIntervalSeconds: Number((draft as any).workerIntervalSeconds || 5), run24x7: !!(draft as any).run24x7, autoResume: !!(draft as any).autoResume, minProfitChargeRatio: Number((draft as any).minProfitChargeRatio ?? 1.5), maxLossPerTradeUsd: Number((draft as any).maxLossPerTradeUsd ?? 0.15), maxConsecutiveLosses: Number((draft as any).maxConsecutiveLosses ?? 3), maxTradesPerDay: Number((draft as any).maxTradesPerDay ?? 1000), maxTradesPerHour: Number((draft as any).maxTradesPerHour ?? 200), maxDrawdownPercent: Number((draft as any).maxDrawdownPercent ?? 5), lowFeeRouting: !!(draft as any).lowFeeRouting, dynamicSizing: !!(draft as any).dynamicSizing, wideHunterEnabled: !!(draft as any).wideHunterEnabled, wideSpreadThreshold: Number((draft as any).wideSpreadThreshold ?? 0.75), wideOnlyExecution: !!(draft as any).wideOnlyExecution, includeVolatilePairs: !!(draft as any).includeVolatilePairs, autonomousMode: !!(draft as any).autonomousMode, strictStopLossEnabled: !!(draft as any).strictStopLossEnabled, stopLossPercent: Number((draft as any).stopLossPercent ?? 0.5), stopLossCooldownMinutes: Number((draft as any).stopLossCooldownMinutes ?? 30), makerOnlyEnabled: !!(draft as any).makerOnlyEnabled, maxMakerFeePercent: Number((draft as any).maxMakerFeePercent ?? 0.11), makerFillTimeoutSeconds: Number((draft as any).makerFillTimeoutSeconds ?? 5), tokenFeeDiscount: !!(draft as any).tokenFeeDiscount, taxPercent: Number((draft as any).taxPercent ?? 30), twoExchangeMode: !!(draft as any).twoExchangeMode, reEntryEnabled: !!(draft as any).reEntryEnabled, reEntryDelaySeconds: Number((draft as any).reEntryDelaySeconds ?? 60), reEntryMaxAttempts: Number((draft as any).reEntryMaxAttempts ?? 2), reEntrySizeMultiplier: Number((draft as any).reEntrySizeMultiplier ?? 0.5), reEntryMinSpreadBoost: Number((draft as any).reEntryMinSpreadBoost ?? 0), autoScalingEnabled: !!(draft as any).autoScalingEnabled, baseCapital: Number((draft as any).baseCapital ?? 100), baseTradeAmount: Number((draft as any).baseTradeAmount ?? 20), maxCapitalPercentPerTrade: Number((draft as any).maxCapitalPercentPerTrade ?? 30), exchanges: ["Binance","Bybit"] };
    const r = await fetch("/api/bot", { method:"PATCH", headers:{"Content-Type":"application/json"}, body: JSON.stringify(payload) });
    const j = await r.json(); setConfig(j.config); setSaving(false); loadBot(); loadWorker();
  }
  async function executeOpp(id: number) {
    setExecutingId(id);
    const r = await fetch("/api/bot/scan", { method:"PUT", headers:{"Content-Type":"application/json"}, body: JSON.stringify({opportunityId:id}) });
    if (!r.ok) { const j = await r.json().catch(()=>({})); alert(j.error || "Blocked by Risk Engine — charges too high vs profit"); }
    setExecutingId(null); loadBot();
  }

  function toggleSymbol(sym: string) {
    const cur = (draft.symbols as string[]) || [];
    const next = cur.includes(sym) ? cur.filter(s=>s!==sym) : [...cur, sym];
    if (next.length===0) return;
    setDraft(d=>({...d, symbols: next}));
  }
  function toggleExchange(ex: string) {
    const cur = (draft.exchanges as string[]) || [];
    const next = cur.includes(ex) ? cur.filter(s=>s!==ex) : [...cur, ex];
    if (next.length<2) return;
    setDraft(d=>({...d, exchanges: next}));
  }

  const balance = config?.balanceUsd ?? 100;
  const initialCapital = config?.initialBalanceUsd ?? 100;
  const pnl = balance - initialCapital;
  const tradeSize = config?.tradeAmountUsd ?? 20;
  // ── 24×7 derived state ──
  const workerOnline = !!worker?.worker?.online;
  const heartbeatAge = worker?.worker?.lastHeartbeatAt ? Math.max(0, Math.round((nowTs - new Date(worker.worker.lastHeartbeatAt).getTime())/1000)) : worker?.worker?.heartbeatAgeSeconds ?? null;
  const workerUptime = worker?.inProcess?.uptimeSeconds ? `${Math.floor(worker.inProcess.uptimeSeconds/3600)}h ${Math.floor((worker.inProcess.uptimeSeconds%3600)/60)}m ${worker.inProcess.uptimeSeconds%60}s` : "—";
  const intervalSec = config?.workerIntervalSeconds ?? worker?.config?.workerIntervalSeconds ?? 5;
  const lastScanTs = worker?.worker?.lastScanAt || config?.lastScanAt || null;
  const nextScanIn = lastScanTs && config?.isRunning && config?.run24x7 ? Math.max(0, intervalSec - Math.floor(((nowTs - new Date(lastScanTs).getTime())/1000) % (intervalSec+0.001))) : null;
  const cronUrl = typeof window !== "undefined" ? `${window.location.origin}/api/cron/tick` : "/api/cron/tick";
  const serverTradeCount = worker?.serverTrades?.count ?? 0;
  // Best live risk-checked route across all symbols (for the Charges Guard panel)
  const liveRoutes = useMemo(() => market.map(m => ({ m, r: bestRoute(m, config, tradeSize) })).filter(x => x.r), [market, config, tradeSize]);
  const bestLiveRoute = useMemo(() => {
    const passing = liveRoutes.filter(x => x.r!.pass).sort((a, b) => b.r!.net - a.r!.net)[0];
    if (passing) return passing;
    return [...liveRoutes].sort((a, b) => b.r!.net - a.r!.net)[0] || null;
  }, [liveRoutes]);
  const wideThreshold = config?.wideSpreadThreshold ?? 0.75;
  const wideLiveRoutes = useMemo(() => [...liveRoutes].sort((a, b) => b.r!.spreadPercent - a.r!.spreadPercent), [liveRoutes]);
  const wideCountLive = wideLiveRoutes.filter(x => x.r!.spreadPercent >= wideThreshold).length;
  const megaCountLive = wideLiveRoutes.filter(x => x.r!.spreadPercent >= wideThreshold * 1.6).length;
  const filteredMarket = useMemo(() => {
    if (scannerFilter === "all") return market;
    if (scannerFilter === "wide") return market.filter(m => { const r = bestRoute(m, config, tradeSize); return r && r.spreadPercent >= wideThreshold; });
    if (scannerFilter === "mega") return market.filter(m => { const r = bestRoute(m, config, tradeSize); return r && r.spreadPercent >= wideThreshold * 1.6; });
    if (scannerFilter === "pass") return market.filter(m => { const r = bestRoute(m, config, tradeSize); return r?.pass; });
    return market.filter(m => m.category === scannerFilter);
  }, [market, scannerFilter, config, tradeSize, wideThreshold]);

  return (
    <div className="min-h-screen bg-[#0b0e11] text-zinc-100">
      {/* Top Bar */}
      <header className="sticky top-0 z-40 border-b border-[#1e242c] bg-[#0b0e11]/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4 px-4 py-3 lg:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#f0b90b] text-black"><Crosshair className="h-5 w-5" strokeWidth={2.5}/></div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold tracking-tight leading-none">Spread Capture Bot</h1>
                <span className="rounded bg-[#1e242c] px-1.5 py-0.5 text-[10px] font-bold tracking-widest text-[#f0b90b]">ARB BOT v2.1</span>
                <span className="rounded bg-teal-400 px-1.5 py-0.5 text-[10px] font-black text-black">ACCOUNTS IN USE: 2 — BINANCE + BYBIT</span>
              </div>
              <p className="text-[11px] text-zinc-500 mt-0.5">Bid-Ask Arbitrage • Cross-Exchange • Paper Trading</p>
              <p className="mt-1 inline-flex rounded bg-emerald-400/10 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">Capital: ${fmt(initialCapital)} • Size: ${fmt(tradeSize)} • BEST 6 ONLY • Strict SL −{config?.stopLossPercent ?? 0.5}%</p>
              <p className={`mt-1 ml-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold ${workerOnline && config?.run24x7 ? "bg-emerald-400 text-black" : "bg-zinc-800 text-zinc-400"}`}><Server className="h-3 w-3"/> {workerOnline ? (config?.isRunning && config?.run24x7 ? "24×7 SERVER: ON" : "SERVER WORKER: ONLINE") : "SERVER WORKER: STARTING…"}</p>
            </div>
          </div>

          <div className="hidden md:flex items-center gap-6 text-xs">
            <div><p className="text-zinc-500">Starting Capital</p><p className="font-mono font-bold text-sm text-[#f0b90b]">${fmt(initialCapital)}</p></div>
            <div><p className="text-zinc-500">Wallet Balance</p><p className="font-mono font-bold text-sm text-white">${fmt(balance)}</p></div>
            <div><p className="text-zinc-500">Realized P&L</p><p className={`font-mono font-bold text-sm ${pnl>=0?"text-emerald-400":"text-rose-400"}`}>{pnl>=0?"+":""}${fmtMoney(pnl)} <span className="text-[10px]">({stats?.roi ?? 0}%)</span></p></div>
            <div><p className="text-zinc-500">Server Scanner (24×7)</p><p className="flex items-center gap-1.5 font-semibold"><span className={`h-2 w-2 rounded-full ${workerOnline && config?.isRunning && config?.run24x7 ?"bg-emerald-400 live-dot":"bg-zinc-600"}`}/>{config?.isRunning && config?.run24x7 ? "TRADING ON SERVER" : workerOnline ? "WORKER ONLINE • IDLE" : "STARTING…"}</p></div>
            <div className="hidden lg:block"><p className="text-zinc-500">Heartbeat</p><p className="font-mono font-bold text-sm text-white">{heartbeatAge !== null ? `${heartbeatAge}s ago` : "—"}</p></div>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={()=>manualScan(false)} disabled={scanning} className="hidden sm:flex items-center gap-1.5 rounded-lg border border-[#2b3139] bg-[#161a1e] px-3 py-2 text-xs font-semibold hover:border-zinc-600 disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${scanning?"animate-spin":""}`}/> Scan Now</button>
            <a href="/install" className="flex items-center gap-1.5 rounded-lg border border-[#2b3139] bg-[#161a1e] px-3 py-2 text-xs font-semibold hover:border-zinc-600"><Download className="h-3.5 w-3.5"/> Install</a>
            <button onClick={toggleBot} disabled={workerBusy!==null} className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold tracking-wide disabled:opacity-60 ${config?.isRunning?"bg-rose-500 hover:bg-rose-600 text-white":"bg-emerald-500 hover:bg-emerald-400 text-black"}`}>
              {workerBusy ? "Working…" : config?.isRunning ? <><Pause className="h-4 w-4"/> PAUSE BOT</> : <><Play className="h-4 w-4"/> START AUTONOMOUS</>}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] px-4 py-5 lg:px-6 space-y-5">
        {/* Mobile view notice — visible only on small screens */}
        <div className="rounded-2xl border border-sky-400/30 bg-sky-400/[0.06] px-4 py-3 md:hidden">
          <p className="flex items-start gap-2 text-xs leading-relaxed text-sky-100/90">
            <Smartphone className="mt-0.5 h-4 w-4 shrink-0 text-sky-400"/>
            <span><b>Mobile view:</b> your bot runs 24×7 on the server — this page is only a window into it. You can close it, lock your phone, or turn it off; trading continues. <b>Tip:</b> in your browser menu choose <b>Add to Home Screen</b> for an app-like icon.</span>
          </p>
        </div>
        {/* ── TAB BAR ── */}
        <nav className="sticky top-[58px] z-30 overflow-hidden rounded-2xl border border-[#2a3440] bg-[#12161a]/95 shadow-[0_8px_28px_rgba(0,0,0,0.5)] backdrop-blur">
          <div className="flex overflow-x-auto">
            {([
              { k:"live", icon:"⚡", label:"Live Trading", desc:"Scanner • trades", badge: worker?.bothBots?.anyTrading ? "TRADING" : config?.isRunning ? "SCANNING" : "OFF", live: !!worker?.bothBots?.anyTrading },
              { k:"risk", icon:"🛡️", label:"Risk & Charges", desc:"Fees • stop-loss", badge: `${config?.spreadThreshold ?? 0.575}%`, live: false },
              { k:"perf", icon:"📈", label:"Performance", desc:"Timings • Excel", badge: `+$${fmtMoney(pnl)}`, live: false },
              { k:"ops", icon:"🖥️", label:"24×7 Operations", desc:"Server • re-entry", badge: worker?.worker?.online ? "ONLINE" : "OFFLINE", live: false },
            ] as const).map(x=>{
              const active = tab === x.k;
              return (
                <button
                  key={x.k}
                  onClick={()=>setTab(x.k)}
                  aria-current={active ? "page" : undefined}
                  className={`group relative flex min-w-[168px] flex-1 items-center gap-2.5 border-r border-[#1e242c] px-4 py-3 text-left transition last:border-r-0 ${active ? "bg-gradient-to-b from-[#f0b90b]/25 to-transparent" : "hover:bg-white/[0.03]"}`}
                >
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-base ${active ? "bg-[#f0b90b] shadow-[0_0_14px_rgba(240,185,11,0.5)]" : "bg-[#1e242c] opacity-70 group-hover:opacity-100"}`}>{x.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-[13px] font-black leading-tight ${active ? "text-white" : "text-zinc-300"}`}>{x.label}</span>
                    <span className="mt-0.5 block truncate text-[10px] leading-tight text-zinc-600">{x.desc}</span>
                  </span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-[9px] font-black ${active ? "bg-[#f0b90b] text-black" : x.live ? "bg-emerald-400/15 text-emerald-300" : "bg-[#1e242c] text-zinc-500"}`}>{x.badge}</span>
                  {active && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-[#f0b90b] shadow-[0_0_10px_#f0b90b]"/>}
                </button>
              );
            })}
          </div>
        </nav>


        {/* ─────────────── LIVE CONNECTION (REAL MONEY) ─────────────── */}
        {/* ── PROFIT: WITH OR WITHOUT CHARGES? ── */}
        <section className="rounded-2xl border border-emerald-400/25 bg-[#101418] px-5 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <p className="flex items-center gap-2 text-sm font-black"><ReceiptText className="h-5 w-5 text-emerald-400"/> Is your profit including trading charges?</p>
            <span className="rounded-full bg-emerald-400 px-3 py-1 text-[11px] font-black text-black">YES — SHOWN PROFIT IS AFTER CHARGES (NET)</span>
            <span className="text-[11px] text-zinc-500">Tax (30% on earnings) shown separately on the right — it never blocks a trade</span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 font-mono text-xs">
            <span className="rounded-xl border border-white/10 bg-black/30 px-3 py-2">Gross spread captured<br/><b className="text-sm text-zinc-100">${fmtMoney(profitAudit?.grossBeforeCharges ?? stats?.totalGross ?? 0)}</b> <span className="text-zinc-600">(before charges)</span></span>
            <span className="font-black text-zinc-600">−</span>
            <span className="rounded-xl border border-rose-400/20 bg-rose-400/[0.05] px-3 py-2">Exchange fees (both legs)<br/><b className="text-sm text-rose-300">${fmtMoney(profitAudit?.exchangeFees ?? stats?.totalFees ?? 0)}</b></span>
            <span className="font-black text-zinc-600">−</span>
            <span className="rounded-xl border border-amber-400/20 bg-amber-400/[0.05] px-3 py-2">Slippage<br/><b className="text-sm text-amber-300">${fmtMoney(profitAudit?.slippageCost ?? risk?.estimatedSlippage ?? 0)}</b></span>
            <span className="font-black text-zinc-600">=</span>
            <span className="rounded-xl border border-emerald-400/40 bg-emerald-400/[0.08] px-3 py-2">NET PROFIT (what you see)<br/><b className={`text-sm ${(profitAudit?.netAfterCharges ?? pnl)>=0?"text-emerald-400":"text-rose-400"}`}>${fmtMoney(profitAudit?.netAfterCharges ?? pnl)}</b> <span className="text-zinc-500">• you keep {profitAudit?.youKeepPercentOfGross ?? 0}% of gross</span></span>
            <span className="font-black text-zinc-600">−</span>
            <span className="rounded-xl border border-amber-400/30 bg-amber-400/[0.06] px-3 py-2">Your 30% tax on earnings<br/><b className="text-sm text-amber-300">${fmtMoney(profitAudit?.estimatedTaxReserve ?? 0)}</b> <span className="text-zinc-500">reserve</span></span>
            <span className="font-black text-zinc-600">=</span>
            <span className="rounded-xl border border-white/20 bg-white/[0.05] px-3 py-2">AFTER-TAX ESTIMATE<br/><b className="text-sm text-white">${fmtMoney(profitAudit?.afterTaxProfit ?? pnl)}</b></span>
            <span className="ml-auto max-w-sm font-sans text-[10px] leading-snug text-zinc-500">Headline profit is after trading charges but before your 30% tax on earnings, exactly as you asked to treat it. Formula: Net = Gross − maker fees − slippage, then tax reserve on earnings.</span>
          </div>
        </section>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          {[
            { label:"Net Profit (After Charges)", value:`${pnl>=0?"+":"-"}$${fmtMoney(Math.abs(pnl))}`, sub:`on $${fmt(initialCapital)} capital • ROI ${stats?.roi??0}% • after fees+slippage`, icon:CircleDollarSign, color: pnl>=0?"text-emerald-400":"text-rose-400", bg: pnl>=0?"bg-emerald-400/10":"bg-rose-400/10" },
            { label:"Total Trades", value: stats?.totalTrades ?? 0, sub:`$${fmt(stats?.totalVolume||0)} volume • guard skipped ${risk?.skippedByRisk ?? 0}`, icon:History, color:"text-white", bg:"bg-zinc-400/10" },
            { label:"Win Rate", value:`${stats?.winRate ?? 0}%`, sub:`${trades.filter(t=>t.netProfit>0).length}W / ${trades.filter(t=>t.netProfit<=0).length}L (recent)`, icon:Gauge, color:"text-[#f0b90b]", bg:"bg-[#f0b90b]/10" },
            { label:"Tradeable (Risk-Pass)", value: liveRoutes.filter(x=>x.r!.pass).length, sub: bestLiveRoute?.r?.pass ? `Best ${bestLiveRoute.m.symbol} ${bestLiveRoute.r.spreadPercent.toFixed(3)}% • ${bestLiveRoute.r.ratio.toFixed(2)}× charges` : `${liveOpps.length} raw gaps • 0 pass charges guard`, icon:Radar, color:"text-emerald-400", bg:"bg-emerald-400/10" },
            { label:"Avg Spread Captured", value:`${(stats?.avgSpread||0).toFixed(3)}%`, sub:`Min now ${config?.spreadThreshold}% (raised for safety)`, icon:Percent, color:"text-white", bg:"bg-zinc-400/10" },
            { label:"Charges Paid", value:`$${fmtMoney(risk?.totalChargesEst ?? stats?.totalFees ?? 0)}`, sub:`${risk?.feesOfGrossPercent ?? 0}% of gross • must stay < profit`, icon:Wallet, color:"text-rose-300", bg:"bg-rose-400/10" },
          ].map(c=>(
            <div key={c.label} className="rounded-2xl border border-[#1e242c] bg-[#12161a] p-4">
              <div className="flex items-center justify-between"><p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">{c.label}</p><span className={`rounded-lg p-1.5 ${c.bg} ${c.color}`}><c.icon className="h-4 w-4"/></span></div>
              <p className={`mt-2 font-mono text-xl font-bold ${c.color}`}>{c.value}</p><p className="text-[11px] text-zinc-500 mt-0.5 truncate">{c.sub}</p>
            </div>
          ))}
        </div>

        {tab === "live" && (
        <section className="overflow-hidden rounded-2xl border border-emerald-400/40 bg-[#12161a]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1e242c] bg-emerald-400/[0.06] px-5 py-4">
            <div>
              <h2 className="flex items-center gap-2 font-bold"><PlugZap className="h-5 w-5 text-emerald-400"/> Connect Your Binance + Bybit Accounts (live trading)</h2>
              <p className="mt-0.5 max-w-3xl text-xs leading-relaxed text-zinc-400">Keys stay on the server only. The bot reads <b className="text-zinc-100">real order books</b> and your <b className="text-zinc-100">real fee rates</b>, and places <b className="text-zinc-100">real limit orders</b> on both legs — only when profit still beats every charge.</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={()=>{ setConnBusy(true); loadConn().finally(()=>setConnBusy(false)); }} disabled={connBusy} className="rounded-lg border border-[#2b3139] px-3 py-2 text-xs font-bold hover:border-zinc-500 disabled:opacity-50">{connBusy?"Testing…":"Test Connection"}</button>
              <button onClick={()=>{ setConnBusy(true); loadLive().finally(()=>setConnBusy(false)); }} disabled={connBusy} className="rounded-lg border border-[#2b3139] px-3 py-2 text-xs font-bold hover:border-zinc-500 disabled:opacity-50">Scan Real Books</button>
            </div>
          </div>

          {/* Setup checklist */}
          <div className="grid gap-0 lg:grid-cols-5">
            <div className="border-b border-[#1e242c] p-5 lg:col-span-3 lg:border-b-0 lg:border-r">
              <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Step 1 — create the API keys (then add them to the server env)</p>
              <div className="mt-3 space-y-2">
                {(conn?.apiKeyInstructions || []).map((s:string, i:number)=>(
                  <p key={i} className="flex items-start gap-2 rounded-xl border border-white/10 bg-[#0b0e11] px-3 py-2.5 text-[11px] leading-relaxed text-zinc-300">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-400 font-mono text-[10px] font-black text-black">{i+1}</span>{s}
                  </p>
                ))}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(conn?.envSetup || []).map((e:any)=>(
                  <div key={e.name} className={`rounded-lg border px-2.5 py-2 ${e.configured ? "border-emerald-400/40 bg-emerald-400/[0.07]" : "border-white/10 bg-[#0b0e11]"}`}>
                    <p className="truncate font-mono text-[10px] text-zinc-300">{e.name}</p>
                    <p className={`text-[10px] font-black ${e.configured ? "text-emerald-400" : "text-zinc-600"}`}>{e.configured ? "✓ SET" : "✕ MISSING"}</p>
                  </div>
                ))}
              </div>
              <div className="mt-2 rounded-lg border border-white/10 bg-[#0b0e11] px-3 py-2">
                <p className="font-mono text-[10px] text-zinc-500">Server egress IP right now: <b className="text-zinc-300">{conn?.serverPublicIp || "—"}</b></p>
                <p className="mt-1 text-[10px] leading-relaxed text-zinc-500">
                  Hosting IPs change on their own — that is normal. <b className="text-zinc-300">Leave the exchange IP allowlist empty.</b> A region block shows as <b className="text-rose-300">403/451</b> and an allowlist problem as <b className="text-amber-300">401 / -2015</b>; they are different failures. Open <span className="font-mono">/api/preflight</span> to see which one you have.
                </p>
              </div>

              {conn?.binanceBan?.active && (
                <div className="mt-4 rounded-xl border border-amber-400/50 bg-amber-400/[0.08] px-3.5 py-3">
                  <p className="text-xs font-black text-amber-200">⏳ Binance IP banned for rate-limit abuse — {conn.binanceBan.minutesLeft} min left (until {conn.binanceBan.until})</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-amber-100/80">Do <b>NOT</b> click “Test Connection” until the countdown ends — every call during a ban extends it. This is not a key, region or allowlist problem; your keys are fine. The updated build suppresses Binance calls automatically while banned.</p>
                </div>
              )}
              <p className="mt-5 text-[11px] font-bold uppercase tracking-wider text-zinc-500">Step 2 — verification</p>
              <div className="mt-2 space-y-1.5">
                {(conn?.checks || []).map((c:any)=>(
                  <p key={c.label} className={`flex items-start gap-2 rounded-lg px-2.5 py-2 text-[11px] ${c.ok ? "bg-emerald-400/[0.06] text-emerald-200" : "bg-rose-400/[0.07] text-rose-200"}`}>
                    {c.ok ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0"/> : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0"/>}
                    <span><b>{c.label}</b> — {c.detail}</span>
                  </p>
                ))}
                {!conn && <p className="text-[11px] text-zinc-500">Press “Test Connection” to verify your keys.</p>}
              </div>
            </div>

            {/* Venue cards + live switch */}
            <div className="p-5 lg:col-span-2">
              <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Your accounts</p>
              <div className="mt-3 space-y-2">
                {(conn?.venues || []).map((v:any)=>(
                  <div key={v.venue} className="rounded-xl border border-white/10 bg-[#0b0e11] p-3.5">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-black">{v.name}</p>
                      <span className={`rounded-full px-2 py-0.5 text-[9px] font-black ${v.state === "ready" ? "bg-emerald-400 text-black" : v.state === "connected_unfunded" ? "bg-sky-400 text-black" : v.state === "rate_limited" ? "bg-amber-400 text-black" : "bg-zinc-800 text-zinc-400"}`}>{v.state === "ready" ? "✓ READY" : v.state === "connected_unfunded" ? "✓ AUTH · UNFUNDED" : v.state === "rate_limited" ? "⏳ RATE LIMITED" : v.authenticated ? "✓ CONNECTED" : "✕ NOT CONNECTED"}</span>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-center">
                      <div className="rounded-lg bg-black/30 px-2 py-1.5"><p className="text-[9px] text-zinc-500">USDT</p><p className="font-mono text-xs font-bold">${v.totalUsdValue.toFixed(2)}</p></div>
                      <div className="rounded-lg bg-black/30 px-2 py-1.5"><p className="text-[9px] text-zinc-500">Fees m/t</p><p className="font-mono text-xs font-bold">{v.makerFeePercent.toFixed(3)}/{v.takerFeePercent.toFixed(3)}%</p></div>
                    </div>
                    <p className="mt-1.5 text-[9px] text-zinc-600">{v.feeSource}</p>
                    {(v.errors||[]).map((e:string,i:number)=><p key={i} className="mt-1 text-[10px] text-rose-300">• {e}</p>)}
                    {(v.notes||[]).map((n:string,i:number)=><p key={i} className="mt-1 text-[10px] text-amber-300/80">• {n}</p>)}
                  </div>
                ))}
                {!conn && <p className="text-[11px] text-zinc-500">Press “Test Connection”.</p>}
              </div>

              {conn?.sharedIpGuidance?.suspected && (
                <div className="mt-3 rounded-xl border border-amber-400/35 bg-amber-400/[0.06] p-3.5">
                  <p className="text-[11px] font-black text-amber-200">Binance shared-IP rate limit — infrastructure action required</p>
                  <p className="mt-1 text-[10px] leading-relaxed text-amber-100/80">{conn.sharedIpGuidance.assessment}</p>
                  <p className="mt-1.5 text-[10px] leading-relaxed text-zinc-300">{conn.sharedIpGuidance.requiredAction}</p>
                  <a href={conn.sharedIpGuidance.officialGuide} target="_blank" rel="noreferrer" className="mt-2 inline-block rounded-lg bg-amber-400 px-2.5 py-1.5 text-[10px] font-black text-black">Open Render dedicated-IP guide ↗</a>
                </div>
              )}

              <div className={`mt-3 rounded-xl border p-3.5 ${conn?.liveMode?.liveEnabled ? "border-rose-400/50 bg-rose-400/[0.07]" : "border-white/10 bg-[#0b0e11]"}`}>
                <p className="flex items-center justify-between text-xs font-black">
                  <span>Live trading</span>
                  <span className={`rounded-full px-2 py-0.5 text-[9px] font-black ${conn?.liveMode?.liveEnabled ? "bg-rose-500 text-white" : "bg-zinc-800 text-zinc-400"}`}>{conn?.liveMode?.liveEnabled ? "🔴 LIVE — REAL MONEY" : "PAPER"}</span>
                </p>
                <p className="mt-1.5 text-[10px] leading-relaxed text-zinc-400">Max per trade <b className="text-zinc-200">${fmt(conn?.liveMode?.liveMaxTradeUsd ?? 20,0)}</b> • stop-loss ${fmtMoney(config?.maxLossPerTradeUsd ?? 0.15)} • daily cap ${fmtMoney(config?.maxDailyLossUsd ?? 3)} • only trades when profit ≥ {config?.minProfitChargeRatio ?? 1.5}× charges.</p>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  <button
                    onClick={async()=>{
                      if(!confirm("Enable LIVE trading with REAL money?\n\n1) Both accounts must be funded (the bot trades your actual funds).\n2) It places real limit orders on Binance and Bybit.\n3) Start small — the cap below limits each trade.\n4) You can disable it any time with one click.")) return;
                      setConnBusy(true);
                      const r = await fetch("/api/connection",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"enable-live",maxTradeUsd: conn?.liveMode?.liveMaxTradeUsd ?? 20})});
                      const j = await r.json();
                      setLiveMsg(j.ok ? "🔴 LIVE ENABLED — the 24×7 bot will now place real orders." : `Could not enable: ${j.error}`);
                      setConnBusy(false); loadConn(); loadBot();
                    }}
                    disabled={connBusy || !conn?.readyForLive}
                    className="rounded-lg bg-rose-500 px-3 py-2 text-[11px] font-black text-white hover:bg-rose-600 disabled:opacity-40"
                  >🔴 ENABLE LIVE ($ {fmt(conn?.liveMode?.liveMaxTradeUsd ?? 20,0)}/trade)</button>
                  <button
                    onClick={async()=>{ setConnBusy(true); const r = await fetch("/api/connection",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"disable-live"})}); const j = await r.json(); setLiveMsg(j.ok?"⚪ Back to paper mode.":j.error); setConnBusy(false); loadConn(); }}
                    disabled={connBusy || !conn?.liveMode?.liveEnabled}
                    className="rounded-lg border border-white/15 px-3 py-2 text-[11px] font-bold hover:border-white/40 disabled:opacity-40">⚪ Back to Paper</button>
                  <button
                    onClick={async()=>{ setConnBusy(true); const r = await fetch("/api/live",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"execute"})}); const j = await r.json(); setLiveMsg(j.executed?.length ? `✅ Executed ${j.executed[0].symbol} ${j.executed[0].route} net $${fmtMoney(j.executed[0].net)}` : (j.error||"No trade executed")); setConnBusy(false); loadBot(); }}
                    disabled={connBusy || !conn?.liveMode?.liveEnabled || conn?.liveMode?.liveDryRun}
                    className="rounded-lg border border-emerald-400/40 px-3 py-2 text-[11px] font-bold text-emerald-300 hover:bg-emerald-400/10 disabled:opacity-40">⚡ Execute Now</button>
                </div>
                {liveMsg && <p className="mt-2 rounded-lg bg-white/[0.04] px-2.5 py-2 text-[11px] text-zinc-200">{liveMsg}</p>}
              </div>
            </div>
          </div>

          {/* Live route table */}
          {liveRows.length > 0 && (
            <div className="border-t border-[#1e242c] p-5">
              <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Real cross-exchange routes right now (live books, your real fees)</p>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[720px] text-[11px]">
                  <thead><tr className="text-left text-zinc-500"><th className="py-1.5 pr-2 font-medium">Pair</th><th className="px-2 py-1.5 font-medium">Route</th><th className="px-2 py-1.5 font-medium text-right">Spread</th><th className="px-2 py-1.5 font-medium text-right">Gross</th><th className="px-2 py-1.5 font-medium text-right">Charges</th><th className="px-2 py-1.5 font-medium text-right">Net</th><th className="px-2 py-1.5 font-medium text-right">× charges</th><th className="px-2 py-1.5 font-medium">Verdict</th></tr></thead>
                  <tbody>
                    {liveRows.slice(0, 10).map((r:any, i:number)=>(
                      <tr key={`${r.symbol}-${r.buyVenue}-${r.sellVenue}`} className="border-t border-[#1e242c]/60">
                        <td className="py-1.5 pr-2 font-bold">{r.symbol}</td>
                        <td className="px-2 py-1.5">{r.buyVenue} → {r.sellVenue}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{r.spreadPercent.toFixed(3)}%</td>
                        <td className="px-2 py-1.5 text-right font-mono text-emerald-300">${fmtMoney(r.grossProfit)}</td>
                        <td className="px-2 py-1.5 text-right font-mono text-rose-300">−${fmtMoney(r.fees)}</td>
                        <td className={`px-2 py-1.5 text-right font-mono font-bold ${r.netProfit>0?"text-emerald-400":"text-rose-400"}`}>${fmtMoney(r.netProfit)}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{r.profitChargeRatio.toFixed(2)}×</td>
                        <td className="px-2 py-1.5">{r.passes ? <span className="rounded bg-emerald-400 px-1.5 py-0.5 text-[9px] font-black text-black">TRADE</span> : <span className="text-[10px] text-zinc-500">{r.reason || "skip"}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
        )}

        {tab === "risk" && (
<>
        {/* ─────────────── REAL FEE AUDIT ─────────────── */}
        <section className="overflow-hidden rounded-2xl border border-amber-400/30 bg-[#12161a]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1e242c] bg-amber-400/[0.05] px-5 py-4">
            <div>
              <h2 className="flex items-center gap-2 font-bold"><ReceiptText className="h-5 w-5 text-amber-400"/> Real Trading Charges — Binance + Bybit (published spot fees)</h2>
              <p className="mt-0.5 max-w-3xl text-xs leading-relaxed text-zinc-400">Verified against the exchanges' published fee schedules. A round trip = <b className="text-zinc-100">two fills</b>, so commission is charged twice. This panel re-prices every trade you have ever run at the true cost.</p>
            </div>
            <button onClick={()=>patchWide({ tokenFeeDiscount: !(config?.tokenFeeDiscount ?? false) })} className={`rounded-full px-4 py-2 text-xs font-black ${config?.tokenFeeDiscount ? "bg-emerald-400 text-black" : "border border-[#2b3139] text-zinc-300 hover:border-zinc-500"}`}>{config?.tokenFeeDiscount ? "✅ BNB/MNT DISCOUNT ON (0.075%)" : "🔻 ENABLE BNB/MNT (−25% FEES)"}</button>
          </div>
          <div className="grid gap-0 lg:grid-cols-5">
            <div className="border-b border-[#1e242c] p-5 lg:col-span-3 lg:border-b-0 lg:border-r">
              <div className="grid gap-2 sm:grid-cols-2">
                {(feeAudit?.venues || []).map((v: any) => (
                  <div key={v.exchange} className="rounded-xl border border-white/10 bg-[#0b0e11] p-3.5">
                    <p className="text-xs font-black">{v.exchange} <span className="ml-1 font-normal text-zinc-500">spot VIP 0</span></p>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-center">
                      <div className="rounded-lg bg-black/30 px-2 py-1.5"><p className="text-[9px] text-zinc-500">MAKER</p><p className="font-mono text-sm font-bold text-emerald-300">{v.makerFeePercent.toFixed(3)}%</p></div>
                      <div className="rounded-lg bg-black/30 px-2 py-1.5"><p className="text-[9px] text-zinc-500">TAKER</p><p className="font-mono text-sm font-bold text-rose-300">{v.takerFeePercent.toFixed(3)}%</p></div>
                    </div>
                    <p className="mt-2 text-[10px] leading-snug text-zinc-500">{v.note}</p>
                  </div>
                ))}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  { l:"Per leg", v:`${feeAudit?.perLegFeePercent ?? "—"}%`, s:"one fill" },
                  { l:"Round trip", v:`${feeAudit?.roundTripFeePercent ?? "—"}%`, s:"buy + sell" },
                  { l:"+ Slippage", v:`${feeAudit?.totalChargesPercent ?? "—"}%`, s:"total charges" },
                  { l:"Spread needed", v:`${feeAudit?.requiredSpreadPercent ?? "—"}%`, s:"to clear 1.5× rule" },
                ].map(x=>(
                  <div key={x.l} className="rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-center"><p className="text-[9px] uppercase tracking-wider text-zinc-500">{x.l}</p><p className="font-mono text-sm font-black text-amber-300">{x.v}</p><p className="text-[9px] text-zinc-600">{x.s}</p></div>
                ))}
              </div>
              <p className="mt-3 rounded-lg bg-amber-400/[0.07] px-3 py-2 text-[10px] leading-relaxed text-amber-100/85">⚠ <b>Correction applied:</b> the bot previously priced a spot strategy with <b>futures</b> maker fees (0.02%/leg). Real spot at VIP 0 is <b>0.10%/leg</b> on both Binance and Bybit, so a round trip costs 0.20%, not 0.04%. The spread threshold is now <b>0.60%</b> and min profit <b>$0.07</b>, so the charges guard is honest.</p>
              <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-black/25 px-3 py-2.5">
                <p className="flex-1 text-[11px] text-zinc-400">Re-price the whole ledger at real fees so your balance &amp; P&amp;L match reality:</p>
                <span className="rounded bg-black/40 px-2 py-1 font-mono text-[10px] text-zinc-400">{feeAudit?.tradesAboveRequiredSpread ?? 0}/{feeAudit?.tradesAudited ?? 0} trades clear the {feeAudit?.requiredSpreadPercent ?? "—"}% bar</span>
                <button onClick={async()=>{
                  if(!confirm("Re-price every trade at the real published spot fees? Your balance and profit will change to the truthful numbers.")) return;
                  const r = await fetch("/api/bot",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"reprice-real-fees"})});
                  const j = await r.json();
                  if(j.ok){ alert(`✅ ${j.tradesRepriced} trades re-priced\nTrue net: $${j.trueNet}\nNew balance: $${j.newBalance}`); loadBot(); }
                }} className="rounded-lg bg-amber-400 px-3 py-1.5 text-[11px] font-black text-black hover:bg-amber-300">💱 Re-price Ledger Now</button>
              </div>
            </div>
            <div className="p-5 lg:col-span-2">
              <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Profitability re-priced at real fees</p>
              <div className="mt-3 space-y-2">
                <div className="rounded-xl border border-white/10 bg-[#0b0e11] p-3.5">
                  <p className="text-[10px] uppercase tracking-wider text-zinc-500">Every trade you have run, re-priced</p>
                  <div className="mt-2 space-y-1 font-mono text-[11px]">
                    <p className="flex justify-between"><span className="font-sans text-zinc-500">Trades audited</span><b>{feeAudit?.tradesAudited ?? 0}</b></p>
                    <p className="flex justify-between"><span className="font-sans text-zinc-500">Modelled net (old model)</span><b className="text-zinc-300">${fmtMoney(feeAudit?.modelledNetProfit ?? 0)}</b></p>
                    <p className="flex justify-between"><span className="font-sans text-zinc-500">TRUE net (real fees)</span><b className="text-emerald-400">${fmtMoney(feeAudit?.trueNetProfit ?? 0)}</b></p>
                    <p className="flex justify-between"><span className="font-sans text-zinc-500">Overstatement</span><b className="text-rose-300">${fmtMoney(feeAudit?.overstatementBy ?? 0)}</b></p>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-center">
                    <div className="rounded-lg bg-emerald-400/10 px-2 py-1.5"><p className="font-mono text-sm font-black text-emerald-400">{feeAudit?.profitableAtRealFees ?? 0}</p><p className="text-[9px] text-zinc-500">still profitable</p></div>
                    <div className="rounded-lg bg-rose-400/10 px-2 py-1.5"><p className="font-mono text-sm font-black text-rose-400">{feeAudit?.lossMakingAtRealFees ?? 0}</p><p className="text-[9px] text-zinc-500">net negative</p></div>
                  </div>
                  <p className="mt-2 text-[9px] text-zinc-600">Charges consumed {feeAudit?.chargesOfGrossPercent ?? 0}% of gross profit at true fees.</p>
                </div>
                <p className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.05] p-3 text-[11px] leading-relaxed text-emerald-100/85">{feeAudit?.verdict}</p>
                <p className="rounded-xl border border-white/10 bg-[#0b0e11] p-3 text-[10px] leading-relaxed text-zinc-400">{feeAudit?.tokenDiscountNote}</p>
                <div className="rounded-xl border border-white/10 bg-[#0b0e11] p-3 text-[10px] leading-relaxed text-zinc-400">
                  <p className="font-bold text-zinc-200">How to cut charges further</p>
                  <ul className="mt-1.5 list-disc space-y-1 pl-4">
                    <li>Turn on <b>“pay fees in BNB”</b> (Binance) / <b>“pay in MNT”</b> (Bybit) → 0.075% per leg</li>
                    <li>Stay maker-only — on spot, maker = taker at VIP 0, so a limit order saves nothing unless you get the token discount</li>
                    <li>Raise the spread threshold so only fat gaps are taken (the bot now needs ≥{feeAudit?.requiredSpreadPercent ?? "0.345"}%)</li>
                    <li>Trade bigger less often — fees are % of size, so more trades = more charges</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </section>

        </>
        )}

        {tab === "ops" && (
<div className={tab === "ops" ? "" : "hidden"}>
        {/* ─────────────── BOT ACTIVITY DIAGNOSTICS ─────────────── */}
        <section className="overflow-hidden rounded-2xl border border-sky-400/30 bg-[#12161a]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1e242c] bg-sky-400/[0.05] px-5 py-4">
            <div>
              <h2 className="flex items-center gap-2 font-bold"><ActivitySquare className="h-5 w-5 text-sky-400"/> Is The Bot Actually Running? (works even while you're offline)</h2>
              <p className="mt-0.5 max-w-3xl text-xs leading-relaxed text-zinc-400">This panel answers the one question that matters: <b className="text-zinc-100">is the bot alive, and if it isn't trading, exactly why?</b> All of it is read from the server's own database — no browser needed.</p>
            </div>
            <span className={`flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-black ${diag?.botAlive ? "bg-emerald-400 text-black" : "bg-rose-500 text-white"}`}>
              <span className={`h-2 w-2 rounded-full ${diag?.botAlive ? "bg-black live-dot" : "bg-white"}`}/>
              {diag?.botAlive ? "● SERVER BOT ALIVE" : "✕ SERVER BOT NOT RESPONDING"}
            </span>
          </div>
          <div className="grid gap-0 lg:grid-cols-5">
            <div className="border-b border-[#1e242c] p-5 lg:col-span-3 lg:border-b-0 lg:border-r">
              <div className="grid gap-2 sm:grid-cols-4">
                {[
                  { l:"Trades (15 min)", v: diag?.tradesLast15min ?? 0, s:`${diag?.tradesLast15minPnl >= 0 ? "+" : ""}$${fmtMoney(diag?.tradesLast15minPnl ?? 0)} net`, c:(diag?.tradesLast15minPnl ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400" },
                  { l:"Qualifying (15m)", v: diag?.opportunitiesPassedLast15min ?? 0, s:`${diag?.opportunitiesSkippedLast15min ?? 0} rejected by guard`, c:"text-sky-300" },
                  { l:"Heartbeat", v: diag?.heartbeatAgeSeconds !== null && diag?.heartbeatAgeSeconds !== undefined ? `${diag.heartbeatAgeSeconds}s ago` : "—", s:"server proof-of-life", c:(diag?.heartbeatAgeSeconds ?? 0) < 90 ? "text-emerald-400" : "text-rose-400" },
                  { l:"Last scan", v: diag?.lastScanAt ? timeAgo(diag.lastScanAt) : "—", s:"server-side", c:"text-zinc-200" },
                  { l:"Uptime %", v: worker?.availability?.availabilityPercent !== undefined && worker?.availability?.availabilityPercent !== null ? `${worker.availability.availabilityPercent}%` : "—", s:`keep-alive ${worker?.availability?.keepAliveActive ? "ON" : "?"} • watchdog ${worker?.availability?.watchdogActive ? "ON" : "?"}`, c:"text-emerald-400" },
                ].map(x=>(
                  <div key={x.l} className="rounded-xl border border-white/10 bg-[#0b0e11] p-3 text-center"><p className="text-[9px] uppercase tracking-wider text-zinc-500">{x.l}</p><p className={`font-mono text-base font-black ${x.c}`}>{x.v}</p><p className="text-[9px] text-zinc-500">{x.s}</p></div>
                ))}
              </div>
              <p className={`mt-3 rounded-xl px-3.5 py-2.5 text-xs font-bold ${diag?.paused ? "bg-rose-400/10 text-rose-200" : diag?.botAlive ? "bg-emerald-400/[0.07] text-emerald-200" : "bg-rose-400/10 text-rose-200"}`}>
                {diag?.paused ? `⏸ PAUSED — ${diag.pauseReason} Resumes in ~${diag.pausedMinutesLeft} min.` : diag?.status}
              </p>
              {(diag?.whyNoTrades || []).length > 0 && (
                <>
                  <p className="mt-4 text-[11px] font-bold uppercase tracking-wider text-zinc-500">Why it didn&apos;t take those (last 15 min)</p>
                  <div className="mt-2 space-y-1.5">
                    {(diag?.whyNoTrades || []).map((w: any) => (
                      <div key={w.reason} className="flex items-center gap-3 rounded-lg border border-white/10 bg-[#0b0e11] px-3 py-2">
                        <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-300">{w.reason}</span>
                        <div className="h-1.5 w-24 overflow-hidden rounded-full bg-zinc-800"><div className="h-full rounded-full bg-amber-400" style={{width:`${Math.min(100, w.count / Math.max(1, diag.whyNoTrades[0].count) * 100)}%`}}/></div>
                        <span className="w-7 text-right font-mono text-[11px] font-bold text-amber-300">{w.count}</span>
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-[10px] leading-relaxed text-zinc-500">These skips are the <b className="text-zinc-300">charges guard working</b>: at real spot fees (0.10%/leg) the bot needs a ≥{feeAudit?.requiredSpreadPercent ?? "0.575"}% spread so fees can never exceed profit. A quiet period is the bot protecting your $100, not a fault.</p>
                </>
              )}
            </div>
            <div className="p-5 lg:col-span-2">
              <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Offline behaviour — the facts</p>
              <div className="mt-3 space-y-2">
                {[
                  { t:"Trading engine location", d:"Inside the SERVER process + PostgreSQL. Your browser only displays it.", ok:true },
                  { t:"Does it need your computer?", d:"No. Closing the tab, locking the phone or powering off the PC changes nothing.", ok:true },
                  { t:"Does it need your browser open?", d:"No — the dashboard is read-only. Trades are tagged 'server-worker'.", ok:true },
                  { t:"Trades while you are away", d:`Yes — ${diag?.tradesLast15min ?? 0} trades in the last 15 minutes with no browser involved.`, ok:true },
                  { t:"Host may freeze when idle", d:"Fixed with a stale-lock watchdog + self-recovery. The external cron ping is the belt-and-braces guarantee.", ok:true },
                ].map(x=>(
                  <p key={x.t} className="flex items-start gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.04] px-3 py-2.5 text-[11px] leading-relaxed">
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400"/>
                    <span><b className="text-zinc-100">{x.t}</b><br/><span className="text-zinc-400">{x.d}</span></span>
                  </p>
                ))}
              </div>
              <p className="mt-3 rounded-xl border border-[#f0b90b]/25 bg-[#f0b90b]/[0.05] px-3 py-2.5 text-[10px] leading-relaxed text-amber-100/85">
                <b>One-time setup for a hard guarantee:</b> point a free scheduler (cron-job.org / UptimeRobot / GitHub Actions) at <span className="font-mono">{typeof window !== "undefined" ? window.location.origin : ""}/api/cron/tick</span> every 1 minute. Each ping forces a scan, so the bot trades even on hosts that freeze between requests.
              </p>
            </div>
          </div>
        </section>
        </div>
        )}


        {tab === "risk" && (
<div className={tab === "risk" ? "" : "hidden"}>
        {/* ─────────────── FULLY AUTOMATIC (AUTO-PILOT) ─────────────── */}
        <section className="overflow-hidden rounded-2xl border border-emerald-400/30 bg-[#12161a]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1e242c] bg-emerald-400/[0.05] px-5 py-4">
            <div>
              <h2 className="flex items-center gap-2 font-bold"><Bot className="h-5 w-5 text-emerald-400"/> Fully Automatic — You Do Nothing</h2>
              <p className="mt-0.5 max-w-3xl text-xs leading-relaxed text-zinc-400">The bot decides <b className="text-zinc-100">which pair, when, how big and whether to trade at all</b>. It monitors all 24 hours, demands a wider spread in losing hours, and never needs a click from you.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={()=>autoAction("go-full-auto")} disabled={autoBusy} className="flex items-center gap-2 rounded-xl bg-emerald-400 px-4 py-2.5 text-xs font-black text-black hover:bg-emerald-300 disabled:opacity-50"><Bot className="h-4 w-4"/>{autoBusy ? "Enabling…" : "🤖 GO FULLY AUTOMATIC"}</button>
              <button onClick={()=>autoAction("emergency-stop")} disabled={autoBusy} className={`rounded-xl px-4 py-2.5 text-xs font-black disabled:opacity-50 ${auto?.settings?.emergencyStop ? "bg-rose-500 text-white" : "border border-rose-400/50 text-rose-300 hover:bg-rose-400/10"}`}>{auto?.settings?.emergencyStop ? "🛑 RELEASE KILL SWITCH" : "🛑 EMERGENCY STOP"}</button>
            </div>
          </div>
          {auto?.settings?.emergencyStop && <div className="border-b border-rose-400/30 bg-rose-500/15 px-5 py-3 text-sm font-black text-rose-100">🛑 EMERGENCY STOP ENGAGED — every trade is blocked. The bot still scans and tracks, but nothing executes until you release the switch.</div>}
          {auto?.decision?.blocked && !auto?.settings?.emergencyStop && <div className="border-b border-amber-400/30 bg-amber-400/10 px-5 py-3 text-xs font-bold text-amber-100">⏸ {auto.decision.blockReason}</div>}

          <div className="grid gap-0 lg:grid-cols-5">
            <div className="border-b border-[#1e242c] p-5 lg:col-span-3 lg:border-b-0 lg:border-r">
              <div className="grid gap-2 sm:grid-cols-2">
                {[
                  { t:"Decides pair + size", d:"Scans all 8 exchanges, ranks every buy→sell route by net-after-charges, takes only the best one." },
                  { t:"Decides timing", d:"Evaluates eligible trades around the clock; never blocks an unobserved hour." },
                  { t:"Decides strictness", d:"Demands a wider spread in historically losing hours; fee and risk checks still apply." },
                  { t:"Decides how it executes", d:"Maker limit orders, cancels unfilled ones, never chases with an expensive taker order." },
                  { t:"Decides risk", d:"Strict stop-loss on every trade, daily-loss breaker, max one trade per scan, sizing scales with your capital." },
                  { t:"Decides what it keeps", d:"Skips pairs that stop working, and writes a daily Excel report of your profitable timings." },
                ].map(x=>(
                  <div key={x.t} className="rounded-xl border border-white/10 bg-[#0b0e11] p-3.5">
                    <p className="flex items-center gap-1.5 text-[11px] font-black text-emerald-200"><CheckCircle2 className="h-3.5 w-3.5"/>{x.t}</p>
                    <p className="mt-1 text-[10px] leading-relaxed text-zinc-400">{x.d}</p>
                  </div>
                ))}
              </div>

              <div className="mt-4 rounded-2xl border border-white/10 bg-black/25 p-4">
                <p className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-zinc-300"><Clock3 className="h-4 w-4 text-sky-400"/> Hourly results (UTC) · trading eligible 24/7</p>
                <p className="mt-1.5 text-[11px] text-zinc-500">Past hourly profits are observations, not a schedule. Unobserved hours remain eligible; every trade must still pass the fee, spread, and risk checks.</p>
                <div className="mt-3 grid grid-cols-12 gap-1">
                  {Array.from({ length: 24 }, (_, h) => {
                    const stat = (auto?.hourStats || []).find((x: {hour:number}) => x.hour === h);
                    return <span key={h} title={`${String(h).padStart(2,"0")}:00 UTC · ${stat?.trades ?? 0} trades · $${stat?.netProfit ?? 0} net`} className={`rounded py-1.5 text-center font-mono text-[9px] font-black ${stat?.profitable ? "bg-emerald-400/20 text-emerald-300" : stat?.trades ? "bg-rose-400/20 text-rose-300" : "bg-zinc-800 text-zinc-400"}`}>{String(h).padStart(2,"0")}</span>;
                  })}
                </div>
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
                  <div className="flex items-center justify-between"><p className="text-xs font-black uppercase tracking-wider text-zinc-300">Auto-threshold tuning</p><button onClick={()=>autoPatch({ autoThresholdTuning: !(auto?.settings?.autoThresholdTuning ?? true) })} className={`h-6 w-11 rounded-full p-0.5 ${auto?.settings?.autoThresholdTuning ? "bg-emerald-400" : "bg-zinc-700"}`}><span className={`block h-5 w-5 rounded-full bg-white transition-transform ${auto?.settings?.autoThresholdTuning ? "translate-x-5" : ""}`}/></button></div>
                  <p className="mt-1.5 text-[11px] text-zinc-500">Winning hour → spread bar −10%. Losing hour → +{(auto?.settings?.thresholdBoostLosingHours ?? 0.15).toFixed(2)}% (so bad hours simply produce no trades).</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
                  <p className="text-xs font-black uppercase tracking-wider text-zinc-300">Size boost in good hours</p>
                  <p className="mt-1.5 text-[11px] text-zinc-500">Current hour {auto?.decision?.hourLabel}: {auto?.decision?.isWinningHour ? <b className="text-emerald-400">profitable (+${auto?.decision?.hourNetProfit?.toFixed?.(4)})</b> : <b className="text-rose-400">not profitable</b>} · spread bar now <b className="font-mono text-white">{auto?.decision?.effectiveSpreadThreshold}%</b> · size ×{auto?.decision?.sizeMultiplier}</p>
                </div>
              </div>

              <div className="mt-3 rounded-2xl border border-white/10 bg-black/25 p-4">
                <p className="text-xs font-black uppercase tracking-wider text-zinc-300">Skip a pair (bot handles the rest)</p>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {ALL_SYMBOLS.map((sym) => {
                    const off = (auto?.settings?.disabledPairs || []).includes(sym);
                    const stat = bestPairStats.find((x: any) => x.symbol === sym);
                    return (
                      <button key={sym} onClick={() => {
                        const cur = auto?.settings?.disabledPairs || [];
                        autoPatch({ disabledPairs: off ? cur.filter((x: string) => x !== sym) : [...cur, sym] });
                      }} className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-bold ${off ? "border-rose-400/50 bg-rose-400/10 text-rose-300 line-through" : "border-white/15 text-zinc-300 hover:border-zinc-500"}`}>
                        {sym.replace("/USDT","")} <span className="font-mono text-[9px] opacity-70">${fmtMoney(stat?.netProfit ?? 0)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="p-5 lg:col-span-2">
              <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Your bot right now</p>
              <div className="mt-3 space-y-2">
                {[
                  { l:"Capital", v:`$${fmt(auto?.capital ?? balance)}`, s:`trade size $${fmt(auto?.tradeAmount ?? tradeSize)}` },
                  { l:"Status", v: auto?.fullyAutomatic ? "FULLY AUTOMATIC" : (config?.isRunning ? "RUNNING" : "STOPPED"), s:"no input needed" },
                  { l:"Trading hours", v:"24 / 24 eligible", s:`spread bar ${auto?.decision?.effectiveSpreadThreshold ?? "—"}%` },
                  { l:"Next window", v: auto?.bestHours?.[0]?.label ?? "—", s: auto?.bestHours?.[0] ? `best hour · +$${auto.bestHours[0].netProfit}` : "building history" },
                ].map(x=>(
                  <div key={x.l} className="rounded-xl border border-white/10 bg-[#0b0e11] p-3"><p className="text-[10px] uppercase tracking-wider text-zinc-500">{x.l}</p><p className="font-mono text-sm font-black text-emerald-300">{x.v}</p><p className="text-[10px] text-zinc-500">{x.s}</p></div>
                ))}
              </div>
              <div className="mt-3 rounded-xl border border-white/10 bg-[#0b0e11] p-3.5 text-[11px] leading-relaxed">
                <p className="font-bold text-zinc-200">What it does on its own</p>
                <ul className="mt-1.5 list-disc space-y-1 pl-4 text-zinc-400">
                  {(auto?.whatItDoesOnItsOwn || []).map((w: string, i: number) => <li key={i}>{w}</li>)}
                </ul>
              </div>
              <div className="mt-3 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.04] p-3.5 text-[11px] leading-relaxed text-emerald-100/85">
                <p className="font-bold">Safety rails are always on</p>
                <p className="mt-1 text-zinc-400">Charges can never exceed profit (needs {feeAudit?.requiredSpreadPercent ?? "0.575"}% spread at real fees), strict stop-loss on every trade, daily-loss breaker, maker-only execution, one trade per scan. Fully automatic never means reckless.</p>
              </div>
            </div>
          </div>
        </section>
        </div>
        )}


        {tab === "perf" && (
<div className={tab === "perf" ? "" : "hidden"}>
        {/* ─────────────── CAPITAL-PROPORTIONAL SIZING ─────────────── */}
        <section className="overflow-hidden rounded-2xl border border-amber-400/30 bg-[#12161a]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1e242c] bg-amber-400/[0.05] px-5 py-4">
            <div>
              <h2 className="flex items-center gap-2 font-bold"><Layers className="h-5 w-5 text-amber-400"/> Capital Doubles → Trade Amount Doubles</h2>
              <p className="mt-0.5 max-w-3xl text-xs leading-relaxed text-zinc-400">Trade size scales <b className="text-zinc-200">linearly with your wallet</b>, anchored at <b className="text-zinc-100">${fmt(config?.baseTradeAmount ?? 20)} per ${fmt(config?.baseCapital ?? 100)} capital</b>. The bot recalculates it on every scan from the live balance — no manual adjustment needed. Safety cap: never more than <b className="text-zinc-100">{config?.maxCapitalPercentPerTrade ?? 30}% of capital</b> in a single spread.</p>
            </div>
            <button onClick={()=>patchWide({ autoScalingEnabled: !(config?.autoScalingEnabled ?? true) })} className={`rounded-full px-3 py-1.5 text-xs font-black ${(config?.autoScalingEnabled ?? true) ? "bg-amber-400 text-black" : "bg-zinc-800 text-zinc-300"}`}>{(config?.autoScalingEnabled ?? true) ? "📈 AUTO-SCALING ON" : "AUTO-SCALING OFF"}</button>
          </div>

          <div className="grid gap-0 lg:grid-cols-5">
            <div className="border-b border-[#1e242c] p-5 lg:col-span-3 lg:border-b-0 lg:border-r">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Scaling ladder — what the bot will trade at each capital level</p>
                <span className="rounded bg-black/40 px-2 py-0.5 font-mono text-[10px] text-zinc-400">highlighted = your level or below</span>
              </div>
              <div className="mt-3 space-y-2">
                {(sizing?.table || []).map((row:any)=>{
                  const isCurrent = config && row.capital <= balance;
                  return (
                    <div key={row.capital} className={`flex flex-wrap items-center gap-3 rounded-xl border px-3.5 py-3 ${isCurrent ? "border-amber-400/40 bg-amber-400/[0.06]" : "border-[#1e242c] bg-[#0b0e11]"}`}>
                      <div className="min-w-[92px]">
                        <p className="font-mono text-sm font-black">${fmt(row.capital,0)}</p>
                        <p className="text-[10px] text-zinc-500">{row.capitalMultiple.toFixed(2)}× base capital</p>
                      </div>
                      <ArrowRight className="h-4 w-4 shrink-0 text-zinc-600"/>
                      <div className="min-w-[110px]">
                        <p className={`font-mono text-sm font-black text-amber-300`}>${fmt(row.tradeAmount)} <span className="text-[10px] font-normal text-zinc-500">per trade</span></p>
                        <p className="text-[10px] text-zinc-500">{row.cappedAtPercent}% of capital</p>
                      </div>
                      <div className="min-w-[100px]">
                        <p className="text-[10px] text-zinc-500">Stop-loss at</p>
                        <p className="font-mono text-[11px] font-bold text-rose-300">−${fmtMoney(row.stopLossAt)}</p>
                      </div>
                      <div className="ml-auto flex items-center gap-2">
                        {row.clamped && <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] font-bold text-zinc-400">capped at {row.maxPercentPerTrade}%</span>}
                        {isCurrent && <span className="rounded bg-amber-400 px-2 py-0.5 text-[9px] font-black text-black">{balance >= row.capital ? "✓ YOUR LEVEL" : "UPCOMING"}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="mt-3 flex items-start gap-1.5 text-[10px] leading-relaxed text-zinc-500"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0"/> Quality grading still applies on top: A+ trades may use up to 1.5× the scaled amount, while B/C-grade edges are sized down. So capital sets the baseline, and trade quality sets the multiplier.</p>
            </div>

            <div className="p-5 lg:col-span-2">
              <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Right now, with your live balance</p>
              <div className="mt-3 rounded-xl border border-amber-400/30 bg-amber-400/[0.05] p-4">
                <p className="text-[10px] uppercase tracking-wider text-zinc-500">Wallet balance</p>
                <p className="font-mono text-2xl font-black text-white">${fmt(balance)}</p>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-black/30 px-1 py-2"><p className="text-[9px] text-zinc-500">× capital</p><p className="font-mono text-sm font-bold text-amber-300">{sizing?.current?.capitalMultiple ?? "—"}×</p></div>
                  <div className="rounded-lg bg-black/30 px-1 py-2"><p className="text-[9px] text-zinc-500">Trade size</p><p className="font-mono text-sm font-black text-emerald-400">${fmt(sizing?.current?.tradeAmountNow ?? tradeSize)}</p></div>
                  <div className="rounded-lg bg-black/30 px-1 py-2"><p className="text-[9px] text-zinc-500">% of capital</p><p className="font-mono text-sm font-bold text-zinc-200">{sizing?.current?.cappedAtPercent ?? "—"}%</p></div>
                </div>
                {sizing?.current?.clamped && <p className="mt-2 rounded bg-rose-400/10 px-2 py-1.5 text-[10px] text-rose-200">Raw rule wanted ${fmtMoney(sizing.current.requestedByRule)} but the {config?.maxCapitalPercentPerTrade ?? 30}% capital cap limited it to ${fmt(sizing.current.tradeAmountNow)}.</p>}
                <p className="mt-2 text-[10px] leading-relaxed text-zinc-500">Anchored at ${fmt(config?.baseTradeAmount ?? 20)} per ${fmt(config?.baseCapital ?? 100)}. Next milestone: at <b className="text-zinc-300">${fmt(((config?.baseCapital ?? 100) * 2))}</b> capital the bot trades <b className="text-amber-300">${fmt((config?.baseTradeAmount ?? 20) * 2)}</b>.</p>
              </div>

              <div className="mt-3 space-y-3 rounded-xl border border-[#1e242c] bg-[#0b0e11] p-4">
                <div>
                  <div className="flex justify-between text-xs"><span className="font-medium text-zinc-300">Base trade (at ${fmt(config?.baseCapital ?? 100)} capital)</span><span className="font-mono font-bold text-amber-300">${fmt(config?.baseTradeAmount ?? 20)}</span></div>
                  <input type="range" min={5} max={100} step={5} value={config?.baseTradeAmount ?? 20} onChange={e=>patchWide({ baseTradeAmount: Number(e.target.value) })} className="mt-1.5 w-full accent-amber-400"/>
                  <div className="flex justify-between text-[10px] text-zinc-600"><span>Raises/lowers the whole ladder</span><span>$5 — $100</span></div>
                </div>
                <div>
                  <div className="flex justify-between text-xs"><span className="font-medium text-zinc-300">Max % of capital per trade</span><span className="font-mono font-bold text-rose-300">{config?.maxCapitalPercentPerTrade ?? 30}%</span></div>
                  <input type="range" min={5} max={50} step={1} value={config?.maxCapitalPercentPerTrade ?? 30} onChange={e=>patchWide({ maxCapitalPercentPerTrade: Number(e.target.value) })} className="mt-1.5 w-full accent-rose-400"/>
                  <div className="flex justify-between text-[10px] text-zinc-600"><span>Safety ceiling — lower = safer</span><span>5% — 50%</span></div>
                </div>
                <p className="text-[10px] leading-relaxed text-zinc-500">Example: base $20 + cap 30% → at $500 capital the rule says $100, but the cap allows max $150, so it trades $100. At $5,000 the rule says $1,000, the cap allows $1,500, so it trades $1,000.</p>
              </div>
            </div>
          </div>
        </section>
        </div>
        )}


        <section className="rounded-2xl border border-sky-400/30 bg-sky-400/[0.05] px-5 py-4">
          <div className="flex flex-wrap items-center gap-4">
            <div>
              <p className="flex items-center gap-2 text-sm font-black"><Wallet className="h-5 w-5 text-sky-400"/> Spread Capture Bot Is Trading With <span className="rounded bg-teal-400 px-2 py-0.5 text-[11px] font-black text-black">2 EXCHANGE ACCOUNTS — NOT 8</span></p>
              <p className="mt-1 max-w-3xl text-xs leading-relaxed text-zinc-400">The bot uses <b className="text-zinc-100">Binance + Bybit only</b>. Your browser tabs are a different thing: Tab A and Tab B both just <i>view</i> this same bot. One $100 paper wallet is split across the two exchange accounts ($55 Binance / $45 Bybit at the start) — it is not $100 in each, and the lists of 8 exchanges elsewhere on this page are research comparisons, not accounts in use.</p>
            </div>
            <div className="ml-auto grid grid-cols-2 gap-2 text-center font-mono sm:grid-cols-4">
              <div className="rounded-xl border border-[#f0b90b]/40 bg-black/30 px-3 py-2.5"><p className="font-sans text-[9px] uppercase tracking-wider text-[#f0b90b]">Exchange Account 1</p><p className="mt-1 text-sm font-black text-white">Binance</p><p className="text-[9px] text-zinc-500">$55 of the $100 start</p></div>
              <div className="rounded-xl border border-sky-400/40 bg-black/30 px-3 py-2.5"><p className="font-sans text-[9px] uppercase tracking-wider text-sky-300">Exchange Account 2</p><p className="mt-1 text-sm font-black text-white">Bybit</p><p className="text-[9px] text-zinc-500">$45 of the $100 start</p></div>
              <div className="rounded-xl border border-white/10 bg-black/30 px-3 py-2.5"><p className="font-sans text-[9px] uppercase tracking-wider text-zinc-500">Total Capital (once)</p><p className="mt-1 text-sm font-black text-emerald-400">${fmt(balance)}</p><p className="text-[9px] text-zinc-500">started ${fmt(initialCapital)} • shared wallet</p></div>
              <div className="rounded-xl border border-white/10 bg-black/30 px-3 py-2.5"><p className="font-sans text-[9px] uppercase tracking-wider text-zinc-500">Browser Tabs A / B</p><p className="mt-1 text-sm font-black text-white">Just views</p><p className="text-[9px] text-zinc-500">no extra accounts or money</p></div>
            </div>
          </div>
        </section>

        {tab === "live" && (
<div className={tab === "live" ? "" : "hidden"}>
        {/* ─────────────── AUTONOMOUS BEST-6 DECK (HERO) ─────────────── */}
        <section className="overflow-hidden rounded-3xl border border-emerald-400/30 bg-[#101418] shadow-[0_20px_60px_rgba(0,0,0,0.45)]">
          <div className="grid lg:grid-cols-5">
            <div className="relative overflow-hidden p-6 lg:col-span-2">
              <div className="pointer-events-none absolute -right-10 -top-10 h-44 w-44 rounded-full bg-emerald-400/10 blur-2xl"/>
              <p className="relative flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-emerald-400"><Bot className="h-4 w-4"/> Autonomous Trading Deck</p>
              <h2 className="relative mt-3 text-3xl font-black leading-[1.05] tracking-tight">The bot trades<br/>on its own.<br/><span className="text-emerald-400">Best 6 pairs only.</span></h2>
              <p className="relative mt-3 max-w-md text-sm leading-relaxed text-zinc-400">No pair-picking, no clicking Execute. The server scans Binance + Bybit, takes the single best fee-checked trade on these six researched pairs, and cuts any loser at a <b className="text-white">strict −{config?.stopLossPercent ?? 0.5}% stop-loss</b>.</p>
              <div className="relative mt-5 flex flex-wrap items-center gap-2">
                <button onClick={toggleBot} disabled={workerBusy!==null} className={`flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-black disabled:opacity-60 ${config?.isRunning ? "bg-rose-500 text-white hover:bg-rose-600" : "bg-emerald-400 text-black hover:bg-emerald-300"}`}>{config?.isRunning ? <><Pause className="h-4 w-4"/> Pause Autonomous Bot</> : <><Play className="h-4 w-4"/> Start Autonomous Bot</>}</button>
                <span className={`flex items-center gap-2 rounded-xl border px-3 py-3 text-xs font-bold ${stopLossInfo?.isPausedNow ? "border-rose-400/50 text-rose-300" : "border-emerald-400/30 text-emerald-300"}`}><ShieldCheck className="h-4 w-4"/>{stopLossInfo?.isPausedNow ? `STOP-LOSS COOLDOWN until ${new Date(stopLossInfo.pausedUntil).toLocaleTimeString()}` : `Strict SL armed: −$${fmtMoney(stopLossInfo?.amountForBaseTrade ?? ((config?.stopLossPercent ?? 0.5)/100*tradeSize))} per $${fmt(tradeSize,0)} trade`}</span>
              </div>
              <div className="relative mt-5 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-2xl border border-white/10 bg-black/30 px-2 py-3"><p className="text-[9px] uppercase tracking-wider text-zinc-500">Balance</p><p className="mt-1 font-mono text-base font-black text-white">${fmt(balance)}</p><p className={`font-mono text-[10px] font-bold ${pnl>=0?"text-emerald-400":"text-rose-400"}`}>{pnl>=0?"+":""}${fmtMoney(pnl)} ({stats?.roi ?? 0}%)</p></div>
                <div className="rounded-2xl border border-white/10 bg-black/30 px-2 py-3"><p className="text-[9px] uppercase tracking-wider text-zinc-500">Bot Status</p><p className={`mt-1 flex items-center justify-center gap-1.5 font-mono text-sm font-black ${config?.isRunning?"text-emerald-400":"text-zinc-400"}`}><span className={`h-2 w-2 rounded-full ${config?.isRunning?"bg-emerald-400 live-dot":"bg-zinc-600"}`}/>{config?.isRunning?"AUTO ON":"OFF"}</p><p className="text-[10px] text-zinc-500">24×7 server • {worker?.worker?.scansCount ?? 0} scans</p></div>
                <div className="rounded-2xl border border-white/10 bg-black/30 px-2 py-3"><p className="text-[9px] uppercase tracking-wider text-zinc-500">Stop-Loss Hits</p><p className="mt-1 font-mono text-base font-black text-rose-300">{stopLossInfo?.totalHits ?? 0}</p><p className="text-[10px] text-zinc-500">worst trade ${fmtMoney(stopLossInfo?.worstTradeEver ?? 0)}</p></div>
              </div>
              <p className="relative mt-4 flex items-center gap-1.5 text-[11px] text-zinc-500"><Moon className="h-3.5 w-3.5 text-emerald-400"/> Close this page and switch off your computer — autonomous execution continues on the server.</p>
            </div>

            <div className="border-t border-white/5 bg-black/20 p-5 lg:col-span-3 lg:border-l lg:border-t-0">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-black uppercase tracking-[0.18em] text-zinc-400">🏆 The Best 6 — the only pairs traded</p>
                <span className="rounded-full bg-emerald-400 px-2.5 py-1 text-[10px] font-black text-black">LOCKED • NO OTHER CHOICES</span>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {ALL_SYMBOLS.map(sym=>{
                  const meta = BEST_6_META[sym];
                  const stat = bestPairStats.find((x:any)=>x.symbol===sym);
                  const live = market.find(m=>m.symbol===sym);
                  const route = live ? bestRoute(live, config, tradeSize) : null;
                  const isSel = selected===sym;
                  return (
                    <button key={sym} onClick={()=>{ setSelected(sym); setExpanded(sym); }} className={`group relative overflow-hidden rounded-2xl border p-4 text-left transition hover:-translate-y-0.5 ${isSel ? "border-white/40 bg-white/[0.06]" : "border-white/10 bg-[#12161a] hover:border-white/25"}`}>
                      <span className="absolute inset-x-0 top-0 h-1" style={{background: meta.accent}}/>
                      <div className="flex items-start justify-between">
                        <span className="flex h-10 w-10 items-center justify-center rounded-xl font-mono text-xs font-black text-black" style={{background: meta.accent}}>{sym.split("/")[0].slice(0,4)}</span>
                        <span className="rounded-full bg-black/40 px-2 py-1 font-mono text-[10px] font-black text-zinc-300">#{meta.rank}</span>
                      </div>
                      <p className="mt-3 font-black tracking-tight">{sym}</p>
                      <p className="mt-0.5 min-h-8 text-[11px] leading-snug text-zinc-500">{meta.thesis}</p>
                      <div className="mt-3 grid grid-cols-3 gap-1 text-center font-mono">
                        <div className="rounded-lg bg-black/30 px-1 py-1.5"><p className="text-[8px] text-zinc-600">SPREAD</p><p className={`text-[11px] font-bold ${route && route.spreadPercent>=wideThreshold ? "text-[#f0b90b]" : "text-zinc-200"}`}>{route ? `${route.spreadPercent.toFixed(2)}%` : "—"}</p></div>
                        <div className="rounded-lg bg-black/30 px-1 py-1.5"><p className="text-[8px] text-zinc-600">NET P&L</p><p className={`text-[11px] font-bold ${(stat?.netProfit||0)>=0?"text-emerald-400":"text-rose-400"}`}>${fmtMoney(stat?.netProfit||0)}</p></div>
                        <div className="rounded-lg bg-black/30 px-1 py-1.5"><p className="text-[8px] text-zinc-600">WIN</p><p className="text-[11px] font-bold text-zinc-200">{stat?.winRate ?? 0}%</p></div>
                      </div>
                      <div className="mt-2.5 flex items-center justify-between text-[10px]">
                        <span className="text-zinc-600">{stat?.trades ?? 0} trades • max {stat?.maxSpreadPercent ? `${stat.maxSpreadPercent.toFixed(2)}%` : "—"}</span>
                        <span className={`rounded px-1.5 py-0.5 font-black ${route?.pass ? "bg-emerald-400 text-black" : "bg-zinc-800 text-zinc-400"}`}>{route?.pass ? `● LIVE ${route.grade}` : "○ waiting"}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl border border-rose-400/20 bg-rose-400/[0.04] px-4 py-3 text-[11px] text-zinc-400">
                <span className="flex items-center gap-1.5 font-bold text-rose-300"><ShieldAlert className="h-4 w-4"/> Strict Stop-Loss</span>
                <span>Every trade exits at <b className="text-white">−{config?.stopLossPercent ?? 0.5}%</b> (−${fmtMoney(stopLossInfo?.amountForBaseTrade ?? 0.1)} on ${fmt(tradeSize,0)}, −${fmtMoney(stopLossInfo?.amountForMaxTrade ?? 0.15)} max size)</span>
                <span>Absolute cap <b className="text-white">${fmtMoney(config?.maxLossPerTradeUsd ?? 0.15)}</b></span>
                <span>After a hit: <b className="text-white">{config?.stopLossCooldownMinutes ?? 30} min full pause</b></span>
                <span>Daily stop <b className="text-white">${fmtMoney(config?.maxDailyLossUsd ?? 3)}</b></span>
                <span className="ml-auto font-mono text-[10px] text-zinc-500">No trade can ever lose more than its stop. Ever.</span>
              </div>
            </div>
          </div>
        </section>
        </div>
        )}


        {tab === "risk" && (
<div className={tab === "risk" ? "" : "hidden"}>
        {/* ─────────────── YOUR 4 ACTIVITIES — HANDLED ─────────────── */}
        <section className="overflow-hidden rounded-3xl border border-white/10 bg-[#101418] shadow-[0_16px_50px_rgba(0,0,0,0.35)]">
          <div className="border-b border-white/5 px-6 py-4">
            <h2 className="text-base font-black tracking-tight">Your 4 Activities — Handled By The Bot</h2>
            <p className="mt-0.5 text-xs text-zinc-500">You do not trade yourself. You only keep the bot switched on — it places orders, manages fees, reserves tax and protects capital on its own.</p>
          </div>
          <div className="grid md:grid-cols-2 xl:grid-cols-4">
            {/* A1 Maker */}
            <div className="border-b border-white/5 p-5 md:border-r xl:border-b-0">
              <p className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-emerald-400"><span>Activity 1 • Maker Pricing</span><span className={`rounded px-2 py-0.5 text-[9px] ${config?.makerOnlyEnabled ? "bg-emerald-400 text-black" : "bg-zinc-800 text-zinc-400"}`}>{config?.makerOnlyEnabled ? "ON — BOT HANDLES IT" : "OFF"}</span></p>
              <p className="mt-3 text-2xl font-black">Limit orders only.<br/><span className="text-emerald-400">Never taker.</span></p>
              <ol className="mt-3 list-decimal space-y-1.5 pl-4 text-[11px] leading-relaxed text-zinc-400">
                <li>Bot finds a Best-6 spread that passes the charges guard</li>
                <li>Places <b className="text-zinc-100">limit (maker) orders on both legs</b> — Binance/Bybit maker is modelled at 0.02%/leg vs 0.05–0.12% taker</li>
                <li>Waits up to {config?.makerFillTimeoutSeconds ?? 5}s for a fill</li>
                <li>Not filled? It <b className="text-zinc-100">cancels and re-scans</b> — it never chases with a market order</li>
                <li>Any route charging over {config?.maxMakerFeePercent ?? 0.04}% maker per leg is rejected before ordering</li>
              </ol>
              <p className="mt-3 rounded-xl bg-emerald-400/[0.06] px-3 py-2 text-[10px] leading-relaxed text-emerald-100/80">You need no knowledge of maker/taker. If you ever see “MAKER UNFILLED” in the terminal, that is the bot deliberately saving fees, not an error.</p>
            </div>
            {/* A2 Tax */}
            <div className="border-b border-white/5 p-5 xl:border-b-0 xl:border-r">
              <p className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-amber-300"><span>Activity 2 • Tax</span><span className="rounded bg-amber-400 px-2 py-0.5 text-[9px] font-black text-black">30% RESERVE</span></p>
              <p className="mt-3 text-2xl font-black">Tax is on earnings.<br/><span className="text-amber-300">Not a trade blocker.</span></p>
              <div className="mt-3 space-y-1.5 font-mono text-[11px]">
                <p className="flex justify-between"><span className="font-sans text-zinc-500">Pre-tax net (after charges)</span><b>${fmtMoney(profitAudit?.netAfterCharges ?? pnl)}</b></p>
                <p className="flex justify-between"><span className="font-sans text-zinc-500">Your tax reserve ({profitAudit?.taxPercent ?? config?.taxPercent ?? 30}%)</span><b className="text-amber-300">−${fmtMoney(profitAudit?.estimatedTaxReserve ?? 0)}</b></p>
                <p className="flex justify-between border-t border-white/10 pt-1.5"><span className="font-sans font-bold text-zinc-300">After-tax estimate</span><b className="text-emerald-400">${fmtMoney(profitAudit?.afterTaxProfit ?? pnl)}</b></p>
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">As you said: tax applies to capital gains/earnings, so the bot does <b className="text-zinc-300">not</b> use tax to reject trades. It simply parks a 30% reserve on positive earnings so the headline never surprises you at filing time.</p>
            </div>
            {/* A3 Two accounts */}
            <div className="border-b border-white/5 p-5 md:border-r">
              <p className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-sky-300"><span>Activity 3 • Two Accounts</span><span className="rounded bg-sky-400 px-2 py-0.5 text-[9px] font-black text-black">YES — IT WORKS</span></p>
              <p className="mt-3 text-2xl font-black">Binance + Bybit<br/><span className="text-sky-300">is enough.</span></p>
              <p className="mt-3 text-[11px] leading-relaxed text-zinc-400">This bot is now locked to <b className="text-zinc-100">Two-Exchange Mode</b>: every trade is Binance→Bybit or Bybit→Binance on the Best 6. No other exchange account is needed.</p>
              <ul className="mt-2.5 space-y-1.5 text-[11px] leading-relaxed text-zinc-500">
                <li className="flex gap-1.5"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400"/>Both KYC-verified, spot enabled</li>
                <li className="flex gap-1.5"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400"/>Both funded first: $55 Binance / $45 Bybit on $100 (65% USDT, 35% coin inventory)</li>
                <li className="flex gap-1.5"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400"/>Best 6 USDT pairs confirmed on both</li>
                <li className="flex gap-1.5"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400"/>Expect fewer, cleaner trades — both venues are fast, so gaps are smaller. That is normal.</li>
              </ul>
            </div>
            {/* A4 Legal India */}
            <div className="p-5">
              <p className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-teal-300"><span>Activity 4 • India Legal</span><span className="rounded bg-teal-400 px-2 py-0.5 text-[9px] font-black text-black">CONFIRMED ✓</span></p>
              <div className="mt-3 space-y-2.5">
                {(exData?.indiaLegal || [
                  { exchange:"Binance", status:"FIU-IND registered reporting entity", detail:"Binance announced FIU-IND registration on 15 Aug 2024; website/app fully accessible to Indian users. Spot available after KYC under PMLA/AML reporting.", source:{label:"Binance official announcement", url:"https://www.binance.com/en-IN/square/post/2024-08-15-binance-achieves-major-regulatory-milestone-with-registration-in-india-12191256221994"} },
                  { exchange:"Bybit", status:"FIU-IND registered reporting entity (VDA SP)", detail:"Bybit's official release (8 Sep 2025) confirms FIU-IND registration and full access restored for Indian users, explicitly including Spot, with KYC.", source:{label:"Bybit official press release", url:"https://www.bybit.com/en/press/post/bybit-resumes-full-access-for-indian-users-reinforces-commitment-to-compliance-and-crypto-inclusion-blt7042bbc940598172"} },
                ]).map((x:any)=>(
                  <div key={x.exchange} className="rounded-xl border border-white/10 bg-black/25 p-3">
                    <p className="flex items-center justify-between text-xs font-black">{x.exchange}<span className="rounded bg-teal-400/15 px-1.5 py-0.5 text-[8px] font-black text-teal-300">SPOT PERMITTED ✓</span></p>
                    <p className="mt-1 text-[10px] font-bold text-teal-200">{x.status}</p>
                    <p className="mt-1 text-[10px] leading-relaxed text-zinc-500">{x.detail}</p>
                    <a href={x.source.url} target="_blank" rel="noreferrer" className="mt-1.5 inline-block text-[10px] font-semibold text-sky-300 hover:text-sky-200">{x.source.label} ↗</a>
                  </div>
                ))}
              </div>
              <p className="mt-2.5 text-[10px] leading-relaxed text-zinc-600">FIU-IND registration = AML/KYC reporting under PMLA. It is not SEBI/RBI investment regulation and does not guarantee your funds like a bank deposit. Crypto gains remain taxable in India; keep KYC and trade records. Verify the current status in the official app/website before depositing, as rules can change.</p>
            </div>
          </div>
        </section>
        </div>
        )}


        {tab === "ops" && (
<div className={tab === "ops" ? "" : "hidden"}>
        {/* ─────────────── 24×7 SERVER PANEL ─────────────── */}
        <section className="overflow-hidden rounded-2xl border border-emerald-400/30 bg-[#12161a]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1e242c] bg-emerald-400/[0.05] px-5 py-4">
            <div>
              <h2 className="flex items-center gap-2 font-bold"><Globe className="h-5 w-5 text-emerald-400"/> 24×7 Server Mode — Runs Whether Your Computer Is On Or Off</h2>
              <p className="mt-0.5 text-xs text-zinc-400">The bot no longer lives in this browser tab. It runs as a <b className="text-zinc-200">worker inside the server</b> (started automatically when the server boots) and reads its ON/OFF state from PostgreSQL on every tick.</p>
            </div>
            <span className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-black ${workerOnline ? "bg-emerald-400 text-black" : "bg-zinc-800 text-zinc-300"}`}>
              <span className={`h-2 w-2 rounded-full ${workerOnline ? "bg-black live-dot" : "bg-zinc-500"}`}/>
              {workerOnline ? (config?.isRunning && config?.run24x7 ? "● TRADING 24×7 ON SERVER" : "SERVER ONLINE — BOT PAUSED") : "SERVER WORKER STARTING…"}
            </span>
          </div>

          <div className="grid gap-0 lg:grid-cols-5">
            {/* Flow diagram */}
            <div className="border-b border-[#1e242c] p-5 lg:col-span-2 lg:border-b-0 lg:border-r">
              <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Why it works with your PC off</p>
              <div className="mt-3 space-y-2 text-xs">
                {[
                  { icon: Laptop, title: "Your computer / phone", desc: "Only opens this dashboard. Can be OFF, asleep, or closed — it is NOT the bot.", off: true },
                  { icon: Cloud, title: "Cloud server (this app, always-on host)", desc: "Next.js server process hosts the worker. Started by instrumentation.ts on boot.", off: false },
                  { icon: Server, title: "Bot Worker — ticks every 2s, scans every " + intervalSec + "s", desc: "performScan() → finds Ask<Bid gaps → executes $"+fmt(tradeSize,0)+" trades → writes to DB.", off: false },
                  { icon: Database, title: "PostgreSQL (always-on)", desc: "Stores isRunning, run24x7, balance ($"+fmt(balance)+"), trades & heartbeats. Survives restarts → auto-resume.", off: false },
                ].map((r,i,arr)=>(
                  <div key={r.title}>
                    <div className={`flex gap-3 rounded-xl border p-3 ${r.off ? "border-zinc-800 bg-black/20 opacity-70" : "border-emerald-400/20 bg-emerald-400/[0.04]"}`}>
                      <r.icon className={`mt-0.5 h-5 w-5 shrink-0 ${r.off ? "text-zinc-500" : "text-emerald-400"}`}/>
                      <div><p className="font-bold text-zinc-100">{r.title} {r.off && <span className="ml-1 rounded bg-zinc-800 px-1 text-[9px] text-zinc-400">NOT REQUIRED</span>}</p><p className="mt-0.5 leading-relaxed text-zinc-400">{r.desc}</p></div>
                    </div>
                    {i<arr.length-1 && <div className="ml-5 h-3 w-px bg-zinc-700"/>}
                  </div>
                ))}
              </div>
            </div>

            {/* Live worker telemetry */}
            <div className="p-5 lg:col-span-3">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {[
                  { label:"Worker Status", value: workerOnline ? (config?.isRunning && config?.run24x7 ? "TRADING" : "ONLINE • IDLE") : "STARTING", sub: worker?.worker?.workerId || "primary-worker", icon: Server, color:"text-emerald-400" },
                  { label:"Heartbeat", value: heartbeatAge!==null ? `${heartbeatAge}s ago` : "—", sub:"Proof server is alive • every 2s", icon: HeartPulse, color: heartbeatAge!==null && heartbeatAge<15 ? "text-emerald-400" : "text-rose-400" },
                  { label:"Last Server Scan", value: lastScanTs ? timeAgo(lastScanTs) : "—", sub: nextScanIn!==null ? `Next scan in ${nextScanIn}s` : (config?.isRunning ? "Scanning…" : "Bot paused"), icon: Clock3, color:"text-white" },
                  { label:"Worker Uptime", value: workerUptime, sub: worker?.worker?.startedAt ? `Since ${new Date(worker.worker.startedAt).toLocaleTimeString()}` : "This server process", icon: Activity, color:"text-white" },
                  { label:"Server Scans", value: worker?.worker?.scansCount ?? 0, sub:`${worker?.worker?.tickCount ?? 0} worker ticks total`, icon: Radar, color:"text-[#f0b90b]" },
                  { label:"Trades By Server", value: serverTradeCount, sub: worker?.serverTrades?.lastAt ? `Last: ${timeAgo(worker.serverTrades.lastAt)}` : "Tagged source=server-worker", icon: Zap, color:"text-emerald-400" },
                  { label:"Opps Found By Server", value: worker?.worker?.opportunitiesCount ?? 0, sub:`Errors: ${worker?.worker?.errorsCount ?? 0}`, icon: Sparkles, color:"text-white" },
                  { label:"Auto-Resume", value: config?.autoResume ? "ON" : "OFF", sub:"Restarts trading after deploy/reboot", icon: RotateCcw, color: config?.autoResume ? "text-emerald-400" : "text-zinc-400" },
                ].map(c=>(
                  <div key={c.label} className="rounded-xl border border-[#1e242c] bg-[#0b0e11] p-3">
                    <div className="flex items-center justify-between"><p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">{c.label}</p><c.icon className={`h-4 w-4 ${c.color}`}/></div>
                    <p className={`mt-1.5 font-mono text-sm font-bold ${c.color}`}>{c.value}</p><p className="mt-0.5 truncate text-[10px] text-zinc-500">{c.sub}</p>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {config?.isRunning && config?.run24x7 ? (
                  <button onClick={()=>workerAction("disable-24x7")} disabled={workerBusy!==null} className="flex items-center gap-2 rounded-lg bg-rose-500 px-4 py-2 text-xs font-bold text-white hover:bg-rose-600 disabled:opacity-50"><Pause className="h-4 w-4"/> Stop 24×7 Trading</button>
                ) : (
                  <button onClick={()=>workerAction("enable-24x7")} disabled={workerBusy!==null} className="flex items-center gap-2 rounded-lg bg-emerald-400 px-4 py-2 text-xs font-black text-black hover:bg-emerald-300 disabled:opacity-50"><Play className="h-4 w-4"/> {workerBusy==="enable-24x7" ? "Enabling…" : "Enable 24×7 Trading"}</button>
                )}
                <button onClick={()=>workerAction("force-tick")} disabled={workerBusy!==null} className="flex items-center gap-2 rounded-lg border border-[#2b3139] bg-[#161a1e] px-3 py-2 text-xs font-semibold hover:border-zinc-500 disabled:opacity-50"><Zap className="h-3.5 w-3.5 text-[#f0b90b]"/> Force Server Tick</button>
                <button onClick={()=>workerAction("restart-worker")} disabled={workerBusy!==null} className="flex items-center gap-2 rounded-lg border border-[#2b3139] bg-[#161a1e] px-3 py-2 text-xs font-semibold hover:border-zinc-500 disabled:opacity-50"><RotateCcw className="h-3.5 w-3.5"/> Restart Worker</button>
                <span className="ml-auto hidden items-center gap-1.5 text-[11px] text-zinc-500 md:flex"><Moon className="h-3.5 w-3.5 text-emerald-400"/> Close this tab now — trading continues on the server</span>
              </div>

              {/* Prove-it test + cron backup */}
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-[#2b3139] bg-[#0b0e11] p-3.5 text-[11px] leading-relaxed">
                  <p className="text-xs font-bold text-white">✅ Prove it yourself (2 minutes)</p>
                  <ol className="mt-1.5 list-decimal space-y-1 pl-4 text-zinc-400">
                    <li>Make sure the badge above says <b className="text-emerald-300">TRADING 24×7</b></li>
                    <li><b className="text-zinc-200">Close this tab</b> (or turn your computer off) for 1–2 minutes</li>
                    <li>Come back — <b className="text-zinc-200">Server Scans</b> & <b className="text-zinc-200">Trades By Server</b> will have increased, with new trades tagged <span className="rounded bg-emerald-400/10 px-1 font-mono text-[9px] font-bold text-emerald-300">24×7 SERVER</span></li>
                  </ol>
                </div>
                <div className="rounded-xl border border-[#2b3139] bg-[#0b0e11] p-3.5 text-[11px] leading-relaxed">
                  <p className="flex items-center gap-1.5 text-xs font-bold text-white"><Satellite className="h-3.5 w-3.5 text-[#f0b90b]"/> Backup wake-up (if host sleeps)</p>
                  <p className="mt-1 text-zinc-400">If your host ever sleeps the process, point an external cron (cron-job.org / Vercel Cron — <span className="font-mono">vercel.json</span> included) at:</p>
                  <div className="mt-2 flex items-center gap-2">
                    <code className="flex-1 truncate rounded bg-black/50 px-2 py-1.5 font-mono text-[10px] text-emerald-300">{cronUrl}</code>
                    <button onClick={async()=>{ try{ await navigator.clipboard.writeText(cronUrl); setCopiedCron(true); setTimeout(()=>setCopiedCron(false),1500);}catch{} }} className="shrink-0 rounded border border-[#2b3139] p-1.5 hover:border-zinc-500">{copiedCron ? <Check className="h-3.5 w-3.5 text-emerald-400"/> : <Copy className="h-3.5 w-3.5"/>}</button>
                  </div>
                  <p className="mt-1.5 text-zinc-500">Every ping runs one scan itself — so even a sleeping host still trades at least once per minute. Set <span className="font-mono text-zinc-300">CRON_SECRET</span> env to protect it.</p>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-zinc-500">
                <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-emerald-400"/> Server process: <b className="text-zinc-300">{workerOnline ? "Online" : "Starting"}</b></span>
                <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-emerald-400"/> Database state persists ON/OFF</span>
                <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-emerald-400"/> Auto-resume after restart: <b className="text-zinc-300">{config?.autoResume ? "ON" : "OFF"}</b></span>
                <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-emerald-400"/> Browser required: <b className="text-emerald-300">NO</b></span>
                <span>Host requirement: an always-on server (this deployment / VPS / Railway / Render / Vercel+cron). Your laptop is never the host.</span>
              </div>
            </div>
          </div>
        </section>
        </div>
        )}


        {tab === "ops" && (
<div className={tab === "ops" ? "" : "hidden"}>
        {/* ─────────────── BOTH BOTS 24×7 CHECK ─────────────── */}
        <section className="overflow-hidden rounded-2xl border border-teal-400/30 bg-[#12161a]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1e242c] bg-teal-400/[0.05] px-5 py-4">
            <div>
              <h2 className="flex items-center gap-2 font-bold"><ActivitySquare className="h-5 w-5 text-teal-400"/> Both Bots 24×7 Check — Binance Leg + Bybit Leg</h2>
              <p className="mt-0.5 text-xs text-zinc-400">One server worker trades <b className="text-zinc-200">both</b> legs. ONLINE = seen in scans in the last hour; TRADING = filled a trade in the last hour.</p>
            </div>
            <span className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-black ${worker?.bothBots?.bothOnline ? "bg-emerald-400 text-black" : "bg-zinc-800 text-zinc-300"}`}>
              <span className={`h-2 w-2 rounded-full ${worker?.bothBots?.bothOnline ? "bg-black live-dot" : "bg-zinc-500"}`}/>
              {worker?.bothBots?.verdict || "CHECKING…"}
            </span>
          </div>
          <div className="grid gap-3 p-5 md:grid-cols-2">
            {(worker?.legs || []).map((leg) => (
              <div key={leg.exchange} className={`rounded-xl border p-4 ${leg.online ? "border-emerald-400/30 bg-emerald-400/[0.04]" : "border-[#1e242c] bg-[#0b0e11]"}`}>
                <div className="flex items-center justify-between">
                  <p className="flex items-center gap-2 font-bold">{leg.exchange === "Binance" ? "🟡" : "🟠"} {leg.exchange} Bot</p>
                  <span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${leg.status === "trading" ? "bg-emerald-400 text-black" : leg.status === "scanning" ? "bg-sky-400 text-black" : leg.status === "paused" ? "bg-zinc-700 text-zinc-200" : "bg-zinc-800 text-zinc-400"}`}>
                    {leg.status === "trading" ? "● TRADING 24×7" : leg.status === "scanning" ? "● SCANNING 24×7" : leg.status === "paused" ? "❚❚ PAUSED" : "○ IDLE"}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-black/30 px-1 py-2"><p className="text-[9px] uppercase tracking-wider text-zinc-500">Trades (1h)</p><p className="font-mono text-sm font-bold">{leg.tradesLastHour}</p><p className={`font-mono text-[10px] ${leg.pnlLastHour >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{leg.pnlLastHour >= 0 ? "+" : ""}${fmtMoney(leg.pnlLastHour)}</p></div>
                  <div className="rounded-lg bg-black/30 px-1 py-2"><p className="text-[9px] uppercase tracking-wider text-zinc-500">Scans (1h)</p><p className="font-mono text-sm font-bold">{leg.oppsLastHour}</p><p className="text-[10px] text-zinc-500">opps incl. leg</p></div>
                  <div className="rounded-lg bg-black/30 px-1 py-2"><p className="text-[9px] uppercase tracking-wider text-zinc-500">Last Trade</p><p className="font-mono text-[11px] font-bold">{leg.lastTradeAt ? timeAgo(leg.lastTradeAt) : "—"}</p><p className="text-[10px] text-zinc-500">{leg.tradesTotal} total</p></div>
                </div>
                <p className="mt-2 text-[10px] text-zinc-500">Lifetime: <b className="text-zinc-300">{leg.tradesTotal} trades</b> • P&L <b className={leg.pnlTotal >= 0 ? "text-emerald-400" : "text-rose-400"}>{leg.pnlTotal >= 0 ? "+" : ""}${fmtMoney(leg.pnlTotal)}</b> <span className="text-zinc-600">(every trade touches both legs)</span></p>
              </div>
            ))}
            {(!worker?.legs || worker.legs.length === 0) && <p className="text-xs text-zinc-500">Loading leg health…</p>}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-[#1e242c] px-5 py-3 text-[10px] text-zinc-500">
            <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-emerald-400"/> Single worker drives both legs</span>
            <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-emerald-400"/> Tab A and Tab B show identical numbers</span>
            <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-emerald-400"/> Heartbeat {heartbeatAge !== null ? `${heartbeatAge}s ago` : "—"} • errors {worker?.worker?.errorsCount ?? 0}</span>
          </div>
        </section>
        </div>
        )}


        <div className="rounded-2xl border border-[#1e242c] bg-[#12161a] p-4">
          <div className="flex flex-col lg:flex-row lg:items-center gap-4">
            <div className="flex items-start gap-3 lg:max-w-xs">
              <div className="rounded-lg bg-[#f0b90b]/10 p-2 text-[#f0b90b]"><Info className="h-4 w-4"/></div>
              <div><h2 className="text-sm font-bold">How the bot makes money</h2><p className="text-xs text-zinc-400 leading-relaxed mt-0.5">It buys where the <b className="text-zinc-200">Ask is cheapest</b> and instantly sells where the <b className="text-zinc-200">Bid is highest</b>. The gap — minus fees — is locked profit.</p></div>
            </div>
            <div className="flex flex-1 items-center gap-2 overflow-x-auto pb-1 lg:pb-0">
              {[
                {n:"1", t:`Server scans ${(config?.exchanges||[]).length || 8} exchanges`, d:`Every ${intervalSec}s on server • 24×7 • widest first`},
                {n:"2", t:"Find Ask < Bid gap", d:"Best Ask vs Best Bid across venues"},
                {n:"3", t:"Check profit > fees", d:"Fees + slippage + min profit filter"},
                {n:"4", t:"Buy low, Sell high", d:"Simultaneous legs • Cooldown guard"},
                {n:"5", t:"Bank the spread", d:"P&L added to wallet instantly"},
              ].map((s,i,arr)=>(
                <div key={s.n} className="flex items-center gap-2 shrink-0">
                  <div className="rounded-xl border border-[#2b3139] bg-[#0b0e11] px-3 py-2 min-w-[150px]"><div className="flex items-center gap-2"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#f0b90b] text-[10px] font-black text-black">{s.n}</span><span className="text-xs font-bold">{s.t}</span></div><p className="text-[10px] text-zinc-500 mt-1">{s.d}</p></div>
                  {i<arr.length-1 && <ArrowRight className="h-4 w-4 text-zinc-600 shrink-0"/>}
                </div>
              ))}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-zinc-500 border-t border-[#1e242c] pt-3">
            <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400"/> <b className="text-zinc-300">Bid</b> = highest price buyers will pay</span>
            <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-rose-400"/> <b className="text-zinc-300">Ask</b> = lowest price sellers will accept</span>
            <span><b className="text-zinc-300">Arbitrage spread</b> = Best Bid (Exchange B) − Best Ask (Exchange A)</span>
            <span className="ml-auto font-mono">{lastScanTs ? `Last server scan ${timeAgo(lastScanTs)}${nextScanIn!==null ? ` • next in ${nextScanIn}s` : ""}` : lastScan ? `Last scan ${lastScan.toLocaleTimeString()}` : "Waiting for server scan…"}</span>
          </div>
        </div>

        {tab === "ops" && (
<div className={tab === "ops" ? "" : "hidden"}>
        {/* ─────────────── RE-ENTRY MANAGER ─────────────── */}
        <section className="overflow-hidden rounded-2xl border border-violet-400/30 bg-[#12161a]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1e242c] bg-violet-400/[0.05] px-5 py-4">
            <div>
              <h2 className="flex items-center gap-2 font-bold"><RotateCcw className="h-5 w-5 text-violet-400"/> Re-Entry Manager — Get Back In When The Edge Returns</h2>
              <p className="mt-0.5 max-w-3xl text-xs leading-relaxed text-zinc-400">After each exit the bot arms a per-route re-entry: waits <b className="text-zinc-100">{config?.reEntryDelaySeconds ?? 60}s</b>, then re-enters at <b className="text-zinc-100">{Math.round((config?.reEntrySizeMultiplier ?? 0.5) * 100)}% size</b> (max <b className="text-zinc-100">{config?.reEntryMaxAttempts ?? 2}</b>/cycle) — only if the spread still qualifies. Stop-loss locks the route for the full <b className="text-rose-300">{config?.stopLossCooldownMinutes ?? 30} min</b>. Stored in PostgreSQL, survives restarts.</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={()=>patchWide({ reEntryEnabled: !(config?.reEntryEnabled ?? true) })} className={`rounded-full px-3 py-1.5 text-xs font-black ${config?.reEntryEnabled ?? true ? "bg-violet-400 text-black" : "bg-zinc-800 text-zinc-300"}`}>{(config?.reEntryEnabled ?? true) ? "🔁 RE-ENTRY ON" : "RE-ENTRY OFF"}</button>
              <button onClick={async()=>{ if(!confirm("Reset all re-entry cycles and clear the stop-loss pause?")) return; setResettingReentry(true); try { await fetch("/api/bot",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"reset-reentry"})}); await Promise.all([loadBot(),loadWorker()]); } finally { setResettingReentry(false);} }} disabled={resettingReentry} className="rounded-full border border-[#2b3139] px-3 py-1.5 text-xs font-bold hover:border-zinc-500 disabled:opacity-50">{resettingReentry?"Resetting…":"Reset Cycles"}</button>
            </div>
          </div>
          <div className="grid gap-0 lg:grid-cols-5">
            <div className="border-b border-[#1e242c] p-5 lg:col-span-3 lg:border-b-0 lg:border-r">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Live route states</p>
                <span className="rounded bg-black/40 px-2 py-0.5 font-mono text-[10px] text-zinc-400">{reentry?.totals?.routesTracked ?? 0} tracked • {reentry?.totals?.coolingDown ?? 0} cooling down</span>
                <span className="rounded bg-black/40 px-2 py-0.5 font-mono text-[10px] text-zinc-400">{reentry?.totals?.totalReentries ?? 0} re-entries • <b className={(reentry?.totals?.totalReentryPnl ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}>{(reentry?.totals?.totalReentryPnl ?? 0) >= 0 ? "+" : ""}${fmtMoney(reentry?.totals?.totalReentryPnl ?? 0)}</b></span>
              </div>
              <div className="mt-3 max-h-[300px] space-y-2 overflow-y-auto pr-1">
                {(reentry?.routes || []).map((r:any)=>(
                  <div key={r.routeKey} className="flex flex-wrap items-center gap-2 rounded-xl border border-[#1e242c] bg-[#0b0e11] px-3 py-2.5">
                    <div className="min-w-[150px] flex-1">
                      <p className="text-xs font-bold">{r.symbol} <span className="font-normal text-zinc-500">{r.buyExchange}→{r.sellExchange}</span></p>
                      <p className="mt-0.5 text-[10px] text-zinc-500">Last exit {r.lastExitAt ? timeAgo(r.lastExitAt) : "—"} • {r.lastExitNet >= 0 ? "+" : ""}${fmtMoney(r.lastExitNet)} @ {Number(r.lastExitSpread).toFixed(3)}% {r.lastExitWasStopLoss && <span className="font-bold text-rose-400">🛑 SL</span>}</p>
                    </div>
                    <span className="font-mono text-[10px] text-zinc-400">{r.attempts}/{r.maxAttempts} used</span>
                    {r.waitSeconds <= 0 ? (
                      <span className="rounded-full bg-emerald-400 px-2.5 py-1 text-[10px] font-black text-black">{r.status === "exhausted" ? "○ CYCLE RESTING" : "✓ READY"}</span>
                    ) : r.status === "stop-paused" ? (
                      <span className="rounded-full bg-rose-500 px-2.5 py-1 font-mono text-[10px] font-black text-white">🛑 SL LOCK {Math.floor(r.waitSeconds/60)}m {r.waitSeconds%60}s</span>
                    ) : (
                      <span className="rounded-full bg-amber-400 px-2.5 py-1 font-mono text-[10px] font-black text-black">⏳ {r.waitSeconds}s</span>
                    )}
                  </div>
                ))}
                {(!reentry?.routes || reentry.routes.length===0) && <p className="rounded-xl border border-dashed border-[#2b3139] px-4 py-6 text-center text-xs text-zinc-500">No exits tracked yet — states appear after the first trade on each route.</p>}
              </div>
            </div>
            <div className="p-5 lg:col-span-2">
              <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Re-entry rules (tap to tune — applies instantly)</p>
              <div className="mt-3 space-y-3">
                <div>
                  <div className="flex justify-between text-xs"><span className="font-medium text-zinc-300">Wait after exit</span><span className="font-mono font-bold text-violet-300">{config?.reEntryDelaySeconds ?? 60}s</span></div>
                  <input type="range" min={15} max={300} step={5} value={config?.reEntryDelaySeconds ?? 60} onChange={e=>patchWide({ reEntryDelaySeconds: Number(e.target.value) })} className="mt-1.5 w-full accent-violet-400"/>
                </div>
                <div>
                  <div className="flex justify-between text-xs"><span className="font-medium text-zinc-300">Max re-entries per cycle</span><span className="font-mono font-bold text-violet-300">{config?.reEntryMaxAttempts ?? 2}</span></div>
                  <input type="range" min={1} max={5} step={1} value={config?.reEntryMaxAttempts ?? 2} onChange={e=>patchWide({ reEntryMaxAttempts: Number(e.target.value) })} className="mt-1.5 w-full accent-violet-400"/>
                </div>
                <div>
                  <div className="flex justify-between text-xs"><span className="font-medium text-zinc-300">Re-entry size</span><span className="font-mono font-bold text-violet-300">{Math.round((config?.reEntrySizeMultiplier ?? 0.5) * 100)}%</span></div>
                  <input type="range" min={0.25} max={1} step={0.05} value={config?.reEntrySizeMultiplier ?? 0.5} onChange={e=>patchWide({ reEntrySizeMultiplier: Number(e.target.value) })} className="mt-1.5 w-full accent-violet-400"/>
                </div>
                <div>
                  <div className="flex justify-between text-xs"><span className="font-medium text-zinc-300">Spread must beat last exit by</span><span className="font-mono font-bold text-violet-300">+{(config?.reEntryMinSpreadBoost ?? 0).toFixed(2)}%</span></div>
                  <input type="range" min={0} max={0.3} step={0.01} value={config?.reEntryMinSpreadBoost ?? 0} onChange={e=>patchWide({ reEntryMinSpreadBoost: Number(e.target.value) })} className="mt-1.5 w-full accent-violet-400"/>
                </div>
              </div>
              <div className="mt-4 rounded-xl border border-[#2b3139] bg-[#0b0e11] p-3.5 text-[11px] leading-relaxed text-zinc-400">
                <p className="font-bold text-zinc-200">How a re-entry works</p>
                <ol className="mt-1.5 list-decimal space-y-1 pl-4">
                  <li>Route exits (profit or stop-loss) → tracker arms with a countdown.</li>
                  <li>Normal exit → wait {config?.reEntryDelaySeconds ?? 60}s. Stop-loss → full {config?.stopLossCooldownMinutes ?? 30} min lock.</li>
                  <li>Spread reappears and passes risk checks → bot re-enters at {Math.round((config?.reEntrySizeMultiplier ?? 0.5) * 100)}% size, logged <span className="font-mono text-violet-300">🔁RE-ENTRY #n</span>.</li>
                  <li>After {config?.reEntryMaxAttempts ?? 2} re-entries the route rests; 30-min quiet resets it.</li>
                </ol>
              </div>
            </div>
          </div>
        </section>
        </div>
        )}


        {tab === "risk" && (
<div className={tab === "risk" ? "" : "hidden"}>
        {/* ─────────────── RISK & CHARGES GUARD ─────────────── */}
        <section className="overflow-hidden rounded-2xl border border-rose-400/25 bg-[#12161a]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1e242c] bg-rose-400/[0.04] px-5 py-4">
            <div>
              <h2 className="flex items-center gap-2 font-bold"><ShieldCheck className="h-5 w-5 text-emerald-400"/> Risk-First & Charges Guard — Minimum Risk, Higher Reward</h2>
              <p className="mt-0.5 text-xs text-zinc-400">Hard rule: <b className="text-white">a trade is never executed unless expected net profit ≥ {config?.minProfitChargeRatio ?? 1.5}× ALL trading charges</b> (buy fee + sell fee + slippage). Charges can therefore never be more than the profit.</p>
            </div>
            {risk?.circuitBreakerActive ? (
              <span className="flex items-center gap-2 rounded-full bg-rose-500 px-3 py-1.5 text-xs font-black text-white"><ShieldAlert className="h-4 w-4"/> CIRCUIT BREAKER ACTIVE</span>
            ) : (
              <span className="flex items-center gap-2 rounded-full bg-emerald-400 px-3 py-1.5 text-xs font-black text-black"><ShieldCheck className="h-4 w-4"/> {bestLiveRoute?.r?.pass ? `READY • ${bestLiveRoute.m.symbol} GRADE ${bestLiveRoute.r.grade}` : "GUARD ACTIVE • WAITING FOR HIGH-QUALITY EDGE"}</span>
            )}
          </div>
          {risk?.circuitBreakerActive && <div className="border-b border-rose-400/20 bg-rose-500/10 px-5 py-2.5 text-xs font-semibold text-rose-200">🛑 {risk.circuitBreaker} — the worker keeps scanning but will NOT open new trades until the condition clears.</div>}

          <div className="grid gap-0 lg:grid-cols-5">
            {/* Live trade maths for the best route right now */}
            <div className="border-b border-[#1e242c] p-5 lg:col-span-3 lg:border-b-0 lg:border-r">
              <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Best live route — full charges maths (fee-aware, not just best price)</p>
              {bestLiveRoute?.r ? (() => { const r = bestLiveRoute.r; const grossPos = Math.max(r.gross, 0.0001); return (
                <div className="mt-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold">{bestLiveRoute.m.symbol}</span>
                    <span className="text-xs text-zinc-400">Buy <b className="text-zinc-100">{r.buy.exchange}</b> ${fmtPrice(r.buy.ask)} → Sell <b className="text-zinc-100">{r.sell.exchange}</b> ${fmtPrice(r.sell.bid)}</span>
                    <span className={`rounded px-2 py-0.5 font-mono text-[11px] font-black ${r.pass ? "bg-emerald-400 text-black" : "bg-rose-500/15 text-rose-300"}`}>{r.pass ? `✓ TRADE • GRADE ${r.grade} • ${r.score}/100` : "✕ SKIP"}</span>
                    <span className="font-mono text-[11px] text-zinc-500">size ${fmt(r.suggested,0)}{config?.dynamicSizing ? " (dynamic)" : ""} • spread {r.spreadPercent.toFixed(3)}%</span>
                  </div>
                  {/* Charges waterfall */}
                  <div className="mt-4 space-y-2 font-mono text-xs">
                    {[
                      { label:"Gross profit (spread captured)", val:r.gross, color:"bg-emerald-400", text:"text-emerald-300" },
                      { label:`Buy fee — ${r.buy.exchange} (${feeRate(r.buy, config?.lowFeeRouting ?? true, config?.feePercent ?? 0.08).toFixed(3)}% ${config?.lowFeeRouting ? "maker" : "taker"})`, val:-r.buyFee, color:"bg-rose-400", text:"text-rose-300" },
                      { label:`Sell fee — ${r.sell.exchange} (${feeRate(r.sell, config?.lowFeeRouting ?? true, config?.feePercent ?? 0.08).toFixed(3)}% ${config?.lowFeeRouting ? "maker" : "taker"})`, val:-r.sellFee, color:"bg-rose-400", text:"text-rose-300" },
                      { label:`Slippage allowance (${config?.slippagePercent ?? 0.03}%)`, val:-r.slippage, color:"bg-amber-400", text:"text-amber-300" },
                    ].map(row=>(
                      <div key={row.label} className="flex items-center gap-3">
                        <span className="w-64 shrink-0 truncate font-sans text-[11px] text-zinc-400">{row.label}</span>
                        <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-zinc-800"><div className={`h-full rounded-full ${row.color}`} style={{width:`${Math.min(100, Math.abs(row.val)/grossPos*100)}%`}}/></div>
                        <span className={`w-20 shrink-0 text-right font-bold ${row.text}`}>{row.val>=0?"+":"−"}${fmtMoney(Math.abs(row.val))}</span>
                      </div>
                    ))}
                    <div className="flex items-center justify-between border-t border-white/10 pt-2.5">
                      <span className="font-sans text-[11px] text-zinc-400">Total charges <span className="text-zinc-600">({r.chargesOfGross.toFixed(1)}% of gross)</span></span><span className="font-bold text-rose-300">−${fmtMoney(r.charges)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="font-sans text-xs font-bold text-white">NET PROFIT if executed</span><span className={`text-sm font-black ${r.net>0?"text-emerald-400":"text-rose-400"}`}>{r.net>=0?"+":"−"}${fmtMoney(Math.abs(r.net))}</span>
                    </div>
                  </div>
                  {/* Rule checklist */}
                  <div className="mt-4 grid gap-1.5 text-[11px] sm:grid-cols-2">
                    {[
                      { ok:r.spreadPercent >= (config?.spreadThreshold ?? 0.3), t:`Spread ${r.spreadPercent.toFixed(3)}% ≥ ${(config?.spreadThreshold ?? 0.3)}% minimum (needs ${r.requiredSpread.toFixed(3)}% to satisfy ratio)` },
                      { ok:r.ratio >= (config?.minProfitChargeRatio ?? 1.5), t:`Profit ${r.ratio.toFixed(2)}× charges ≥ ${(config?.minProfitChargeRatio ?? 1.5)}× required` },
                      { ok:r.charges < r.net, t:`Charges $${fmtMoney(r.charges)} ${r.charges < r.net ? "<" : "≥"} profit $${fmtMoney(r.net)} ${r.charges < r.net ? "— charges do NOT exceed profit" : "— BLOCKED"}` },
                      { ok:r.net >= (config?.minProfitUsd ?? 0.04), t:`Net $${fmtMoney(r.net)} ≥ $${config?.minProfitUsd ?? 0.04} minimum` },
                      { ok:r.chargesOfGross < 50, t:`Charges are ${r.chargesOfGross.toFixed(1)}% of gross (must be < 50%)` },
                      { ok:!(risk?.circuitBreakerActive), t:risk?.circuitBreakerActive ? "Circuit breaker: ACTIVE" : "Circuit breakers: clear (daily loss / losing streak / drawdown)" },
                    ].map((c,i)=>(
                      <p key={i} className={`flex items-start gap-1.5 rounded-lg px-2 py-1.5 ${c.ok ? "bg-emerald-400/[0.06] text-emerald-200/90" : "bg-rose-400/[0.06] text-rose-200/90"}`}>{c.ok ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0"/> : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0"/>}{c.t}</p>
                    ))}
                  </div>
                  {!r.pass && <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-amber-400/[0.06] px-3 py-2 text-[11px] text-amber-200/90"><Ban className="mt-0.5 h-3.5 w-3.5 shrink-0"/> Bot will SKIP this — {r.reasons[0]}. Skipping is the profit strategy here: 100 skipped bad trades protect the $100 more than 1 marginal trade earns.</p>}
                </div> ); })() : <p className="mt-3 text-xs text-zinc-500">Waiting for market data…</p>}
            </div>

            {/* Portfolio risk meters */}
            <div className="p-5 lg:col-span-2">
              <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Your realised risk so far</p>
              <div className="mt-3 space-y-3">
                <div className="rounded-xl border border-[#1e242c] bg-[#0b0e11] p-3.5">
                  <div className="flex items-center justify-between text-xs"><span className="flex items-center gap-1.5 font-bold"><Receipt className="h-4 w-4 text-rose-300"/> Charges vs Profit (all time)</span><span className={`font-mono font-black ${risk && risk.totalChargesEst < Math.max(risk.totalNetProfit,0) ? "text-emerald-400":"text-amber-300"}`}>{risk?.netToChargesRatio ?? 0}×</span></div>
                  <div className="mt-2 space-y-1 font-mono text-[11px] text-zinc-400">
                    <p className="flex justify-between"><span>Gross profit captured</span><b className="text-emerald-300">+${fmtMoney(risk?.totalGrossProfit || 0)}</b></p>
                    <p className="flex justify-between"><span>Exchange fees paid</span><b className="text-rose-300">−${fmtMoney(risk?.totalExchangeFees || 0)}</b></p>
                    <p className="flex justify-between"><span>Slippage cost (exact, implied)</span><b className="text-amber-300">−${fmtMoney(risk?.estimatedSlippage || 0)}</b></p>
                    <p className="flex justify-between border-t border-white/5 pt-1"><span>Net kept</span><b className={(risk?.totalNetProfit||0)>=0?"text-emerald-400":"text-rose-400"}>${fmtMoney(risk?.totalNetProfit || 0)}</b></p>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-800"><div className="h-full bg-rose-400" style={{width:`${Math.min(100, risk?.feesOfGrossPercent || 0)}%`}}/></div>
                  <p className="mt-1.5 text-[10px] leading-relaxed text-zinc-500">Charges have consumed <b className="text-zinc-300">{risk?.feesOfGrossPercent ?? 0}% of gross</b> (bar above). New trades must keep this below 40% — profit ≥1.5× charges. {risk?.chargesVerdict}</p>
                </div>

                <div className="grid grid-cols-2 gap-2 text-center">
                  {[
                    { label:"Reward : Risk", val:`${risk?.rewardRiskRatio ?? 0} : 1`, sub:`Avg win $${fmtMoney(risk?.avgWin||0)} vs avg loss $${fmtMoney(risk?.avgLoss||0)}`, icon:Scale },
                    { label:"Profit Factor", val:risk?.profitFactor ?? 0, sub:"Gross wins ÷ gross losses (>1.5 good)", icon:Target },
                    { label:"Max Loss / Trade", val:`$${fmtMoney(config?.maxLossPerTradeUsd ?? 0.15)}`, sub:`Hard cap • largest loss $${fmtMoney(Math.abs(risk?.largestLoss||0))}`, icon:ShieldAlert },
                    { label:"Skipped By Guard", val:risk?.skippedByRisk ?? 0, sub:"Bad trades refused (fees/risk)", icon:Ban },
                  ].map(c=>(
                    <div key={c.label} className="rounded-xl border border-[#1e242c] bg-[#0b0e11] p-3"><c.icon className="mx-auto h-4 w-4 text-[#f0b90b]"/><p className="mt-1 text-[10px] uppercase tracking-wider text-zinc-500">{c.label}</p><p className="font-mono text-sm font-bold">{c.val}</p><p className="text-[9px] leading-tight text-zinc-600">{c.sub}</p></div>
                  ))}
                </div>

                <div className="space-y-2.5 rounded-xl border border-[#1e242c] bg-[#0b0e11] p-3.5 text-[11px]">
                  <p className="flex items-center gap-1.5 text-xs font-bold"><Flame className="h-4 w-4 text-orange-400"/> Circuit breakers today</p>
                  {[
                    { label:`Daily loss used ${risk?.todayPnl < 0 ? `($${fmtMoney(risk.todayPnl)})` : "(in profit)"}`, pct:risk?.dailyLossUsedPercent ?? 0, val:`$${fmtMoney(Math.abs(Math.min(0, risk?.todayPnl||0)))} / $${config?.maxDailyLossUsd ?? 3}`, danger:(risk?.dailyLossUsedPercent??0)>70 },
                    { label:`Trades today`, pct:Math.min(100, ((risk?.todayTrades||0)/Math.max(1,config?.maxTradesPerDay ?? 1000))*100), val:`${risk?.todayTrades ?? 0} / ${config?.maxTradesPerDay ?? 1000}`, danger:false },
                    { label:`Consecutive losses`, pct:Math.min(100, ((risk?.consecutiveLosses||0)/Math.max(1,config?.maxConsecutiveLosses ?? 3))*100), val:`${risk?.consecutiveLosses ?? 0} / ${config?.maxConsecutiveLosses ?? 3}`, danger:(risk?.consecutiveLosses||0)>0 },
                    { label:`Drawdown from $100`, pct:Math.min(100, risk?.drawdownPercent ?? 0), val:`${risk?.drawdownPercent ?? 0}% / ${config?.maxDrawdownPercent ?? 5}%`, danger:(risk?.drawdownPercent??0)>2 },
                  ].map(m=>(
                    <div key={m.label}><div className="flex justify-between"><span className="text-zinc-400">{m.label}</span><span className="font-mono font-bold text-zinc-200">{m.val}</span></div><div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-800"><div className={`h-full rounded-full ${m.danger ? "bg-rose-400" : "bg-emerald-400"}`} style={{width:`${m.pct}%`}}/></div></div>
                  ))}
                  <p className="flex items-start gap-1.5 pt-1 text-[10px] leading-relaxed text-zinc-500"><PiggyBank className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400"/> On $100: risking max <b className="text-zinc-300">${fmtMoney(config?.maxLossPerTradeUsd ?? 0.15)} per trade</b> and <b className="text-zinc-300">${config?.maxDailyLossUsd ?? 3}/day (3%)</b>. Even a terrible day cannot wipe the account — and only A/B-grade, fee-beating edges get traded, in smaller size when marginal.</p>
                </div>
              </div>
            </div>
          </div>
        </section>
        </div>
        )}


        {tab === "perf" && (
<div className={tab === "perf" ? "" : "hidden"}>
        {/* ─────────────── PAIR ANALYSIS & FAST-MOVE SIMULATOR ─────────────── */}
        <section className="overflow-hidden rounded-2xl border border-sky-400/25 bg-[#12161a]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1e242c] bg-sky-400/[0.04] px-5 py-4">
            <div>
              <h2 className="flex items-center gap-2 font-bold"><FlaskConical className="h-5 w-5 text-sky-400"/> Pair Analysis First — Then: What Happens When Price Moves FAST (Up or Down)?</h2>
              <p className="mt-0.5 max-w-3xl text-xs leading-relaxed text-zinc-400"><b className="text-zinc-200">Step 1:</b> every pair is analysed on realised volatility, spread behaviour & liquidity. <b className="text-zinc-200">Step 2:</b> we simulate an instant pump/crash — fast exchanges reprice first, slow ones lag — and measure which pair pays <b className="text-zinc-100">immediately</b>, after all charges.</p>
            </div>
            <span className="rounded-full bg-sky-400 px-3 py-1.5 text-xs font-black text-black">{analysis?.summary?.overallBestSymbol ? `🏆 BEST IN VOLATILITY: ${analysis.summary.overallBestSymbol}` : "ANALYSING…"}</span>
          </div>

          {/* Simulator controls */}
          <div className="flex flex-wrap items-center gap-3 border-b border-[#1e242c] px-5 py-3.5">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-bold text-zinc-400">Fast move:</span>
              {[{k:"up", label:"▲ Pump (Up)", icon:Rocket},{k:"down", label:"▼ Crash (Down)", icon:TrendingDown},{k:"both", label:"Both", icon:ArrowLeftRight}].map((b:any)=>(
                <button key={b.k} onClick={()=>setMoveDirection(b.k)} className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-bold ${moveDirection===b.k ? (b.k==="down" ? "bg-rose-500 text-white" : "bg-emerald-400 text-black") : "border border-[#2b3139] text-zinc-300 hover:border-zinc-500"}`}>{b.label}</button>
              ))}
            </div>
            <div className="flex min-w-[220px] flex-1 items-center gap-2">
              <span className="whitespace-nowrap text-[11px] font-bold text-zinc-400">Size {moveMagnitude}%</span>
              <input type="range" min={0.5} max={5} step={0.5} value={moveMagnitude} onChange={e=>setMoveMagnitude(Number(e.target.value))} className="w-full accent-sky-400"/>
              <span className="font-mono text-xs font-bold text-sky-300">{moveMagnitude}%</span>
            </div>
            <button onClick={()=>loadAnalysis(moveDirection, moveMagnitude, true)} disabled={analysisLoading} className="flex items-center gap-2 rounded-lg bg-sky-400 px-4 py-2 text-xs font-black text-black hover:bg-sky-300 disabled:opacity-50"><FlaskConical className="h-4 w-4"/>{analysisLoading ? "Analysing…" : "Run Analysis (Save)"}</button>
            <button onClick={()=>loadAnalysis(moveDirection, moveMagnitude, false)} disabled={analysisLoading} className="rounded-lg border border-[#2b3139] px-3 py-2 text-xs font-semibold hover:border-zinc-500 disabled:opacity-50">Refresh</button>
            {injectMsg && <p className="w-full rounded-lg bg-amber-400/[0.07] px-3 py-2 text-[11px] leading-relaxed text-amber-200">{injectMsg}</p>}
          </div>

          {/* Verdict summary cards */}
          <div className="grid gap-3 border-b border-[#1e242c] p-5 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label:"Most Volatile Pair", value: analysis?.summary?.mostVolatile || "—", sub:"Highest realised volatility in live feed", icon:ActivitySquare, color:"text-sky-300" },
              { label:`Best If Price Pumps +${moveMagnitude}%`, value: analysis?.summary?.bestImmediateProfitUp ? `${analysis.summary.bestImmediateProfitUp.symbol}  +$${fmtMoney(analysis.summary.bestImmediateProfitUp.netProfit)}` : "—", sub: analysis?.summary?.bestImmediateProfitUp ? `${analysis.summary.bestImmediateProfitUp.route} • ${analysis.summary.bestImmediateProfitUp.spreadPercent}% spread • ~${analysis.summary.bestImmediateProfitUp.windowSeconds}s window • ${analysis.summary.bestImmediateProfitUp.passesRiskGuard ? "✓ passes charges guard" : "✗ fails charges guard"}` : "", icon:Rocket, color:"text-emerald-400" },
              { label:`Best If Price Crashes −${moveMagnitude}%`, value: analysis?.summary?.bestImmediateProfitDown ? `${analysis.summary.bestImmediateProfitDown.symbol}  +$${fmtMoney(analysis.summary.bestImmediateProfitDown.netProfit)}` : "—", sub: analysis?.summary?.bestImmediateProfitDown ? `${analysis.summary.bestImmediateProfitDown.route} • ${analysis.summary.bestImmediateProfitDown.spreadPercent}% spread • ~${analysis.summary.bestImmediateProfitDown.windowSeconds}s window • ${analysis.summary.bestImmediateProfitDown.passesRiskGuard ? "✓ passes charges guard" : "✗ fails charges guard"}` : "", icon:TrendingDown, color:"text-rose-400" },
              { label:"Direction Matters?", value:"NO — Route Flips", sub:"Pump: buy lagging / sell leading. Crash: buy leading / sell lagging. Same pairs win both ways.", icon:ArrowLeftRight, color:"text-[#f0b90b]" },
            ].map(c=>(
              <div key={c.label} className="rounded-xl border border-[#1e242c] bg-[#0b0e11] p-3.5"><div className="flex items-center justify-between"><p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">{c.label}</p><c.icon className={`h-4 w-4 ${c.color}`}/></div><p className={`mt-1.5 font-mono text-sm font-bold ${c.color}`}>{c.value}</p><p className="mt-0.5 text-[10px] leading-snug text-zinc-500">{c.sub}</p></div>
            ))}
          </div>

          <div className="grid gap-0 xl:grid-cols-5">
            {/* Step 1+2 table */}
            <div className="overflow-x-auto p-5 xl:col-span-3">
              <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">All pairs ranked — Volatility-Profit Score (Step 1 analysis → Step 2 fast-move result)</p>
              <table className="mt-3 w-full min-w-[640px] text-sm">
                <thead><tr className="border-b border-[#1e242c] text-left text-[10px] uppercase tracking-wider text-zinc-500"><th className="py-2 pr-2 font-medium">Pair</th><th className="px-2 py-2 font-medium text-right">Volatility<br/>(realised)</th><th className="px-2 py-2 font-medium text-right">Spread Now / Max</th><th className="px-2 py-2 font-medium text-right">Shock Spread<br/>@ {moveMagnitude}%</th><th className="px-2 py-2 font-medium text-right">Immediate Net<br/>on ${fmt(analysis?.tradeAmountUsd ?? tradeSize,0)}</th><th className="px-2 py-2 font-medium">Route in a Fast Move</th><th className="px-2 py-2 font-medium text-right">Score</th><th className="px-2 py-2"></th></tr></thead>
                <tbody>
                  {(analysis?.pairs || []).map((p:any, idx:number)=>{
                    const dirForRow = moveDirection === "down" ? (analysis.down?.find((x:any)=>x.symbol===p.symbol) || p) : p;
                    const sc = dirForRow.scenario;
                    return (
                      <tr key={p.symbol} className={`border-b border-[#1e242c]/60 hover:bg-white/[0.02] ${idx===0 ? "bg-sky-400/[0.04]" : ""}`}>
                        <td className="py-2.5 pr-2"><p className="flex items-center gap-1.5 font-bold text-[12px]">{idx===0 && <Crown className="h-3.5 w-3.5 text-[#f0b90b]"/>}{p.symbol}</p><p className="text-[9px] text-zinc-600">{p.category} • liq {p.liquidityScore} • β{sc.beta?.toFixed(1)} (moves {sc.effectiveMovePercent}% here) • {p.samples} samples</p></td>
                        <td className="px-2 py-2.5 text-right font-mono text-[11px]">{p.realisedVolPercent.toFixed(3)}%<p className={`text-[9px] ${p.velocityPercent>0?"text-emerald-400":p.velocityPercent<0?"text-rose-400":"text-zinc-600"}`}>{p.velocityPercent>=0?"+":""}{p.velocityPercent.toFixed(3)}% vel.</p></td>
                        <td className="px-2 py-2.5 text-right font-mono text-[11px]">{p.currentSpreadPercent.toFixed(3)}%<p className="text-[9px] text-zinc-600">max {p.maxSpreadPercent.toFixed(3)}% • wide {p.wideFrequencyPercent}%</p></td>
                        <td className="px-2 py-2.5 text-right"><span className={`rounded px-1.5 py-0.5 font-mono text-[11px] font-bold ${sc.spreadPercent >= wideThreshold ? "bg-[#f0b90b] text-black" : "bg-zinc-800 text-zinc-300"}`}>{sc.spreadPercent.toFixed(3)}%</span><p className="mt-0.5 text-[9px] text-zinc-600">~{sc.profitWindowSeconds}s window</p></td>
                        <td className="px-2 py-2.5 text-right"><span className={`font-mono text-[12px] font-bold ${sc.netProfit>0?"text-emerald-400":"text-rose-400"}`}>+${fmtMoney(sc.netProfit)}</span><p className="text-[9px] text-zinc-600">{sc.profitChargeRatio.toFixed(2)}× charges {sc.passesRiskGuard ? "• ✓ guard" : "• ✗ guard"}</p></td>
                        <td className="px-2 py-2.5 text-[10px] leading-snug text-zinc-400"><b className="text-zinc-200">{sc.buyExchange} → {sc.sellExchange}</b><br/><span className="text-zinc-600">lead {sc.leadingExchange} • lag {sc.laggingExchange}</span></td>
                        <td className="px-2 py-2.5 text-right"><div className="ml-auto h-2 w-16 overflow-hidden rounded-full bg-zinc-800"><div className={`h-full rounded-full ${p.volatilityProfitScore>=78?"bg-emerald-400":p.volatilityProfitScore>=62?"bg-sky-400":p.volatilityProfitScore>=45?"bg-amber-400":"bg-zinc-600"}`} style={{width:`${p.volatilityProfitScore}%`}}/></div><p className="mt-1 font-mono text-[11px] font-bold">{p.volatilityProfitScore}/100</p></td>
                        <td className="py-2.5 pl-1"><button onClick={()=>injectShock(p.symbol, moveDirection==="down"?"down":"up", moveMagnitude)} disabled={injecting!==null} title="Inject this fast move into the paper market — the 24×7 bot should capture it" className="whitespace-nowrap rounded-lg bg-amber-400 px-2 py-1.5 text-[9px] font-black text-black hover:bg-amber-300 disabled:opacity-50">{injecting===p.symbol ? "Injecting…" : `⚡ Live ${moveDirection==="down"?"Crash":"Pump"} Test`}</button></td>
                      </tr>
                    );
                  })}
                  {!analysis && <tr><td colSpan={8} className="py-8 text-center text-xs text-zinc-500">Running pair analysis…</td></tr>}
                </tbody>
              </table>
              <p className="mt-2 text-[10px] leading-relaxed text-zinc-600">How to read it: a high score needs (a) high realised volatility, (b) spreads that already widen often, and (c) a big fee-adjusted profit in the shock simulation. BTC/ETH score low despite being famous — their books are too deep and every exchange reprices in lockstep.</p>
            </div>

            {/* Chart + explanation + saved runs */}
            <div className="border-t border-[#1e242c] p-5 xl:col-span-2 xl:border-l xl:border-t-0">
              <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Immediate net profit by pair — {moveDirection==="down" ? `crash −${moveMagnitude}%` : `pump +${moveMagnitude}%`}</p>
              <div className="mt-2 h-[210px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={[...(analysis?.pairs || [])].sort((a:any,b:any)=>b.scenario.netProfit-a.scenario.netProfit).slice(0,8).map((p:any)=>({ symbol:p.symbol.replace("/USDT",""), net:p.scenario.netProfit }))} layout="vertical" margin={{left:8, right:12}}>
                    <CartesianGrid stroke="#1e242c" strokeDasharray="3 3"/><XAxis type="number" tick={{fill:"#71717a", fontSize:10}} axisLine={false} tickFormatter={(v)=>`$${v}`}/><YAxis type="category" dataKey="symbol" tick={{fill:"#a1a1aa", fontSize:10}} axisLine={false} width={52}/>
                    <Tooltip contentStyle={{background:"#161a1e", border:"1px solid #2b3139", borderRadius:10, fontSize:12}} formatter={(v:any)=>[`$${fmtMoney(Number(v))} net after charges`,"Immediate profit"]}/>
                    <Bar dataKey="net" radius={[0,4,4,0]}>{[...(analysis?.pairs || [])].sort((a:any,b:any)=>b.scenario.netProfit-a.scenario.netProfit).slice(0,8).map((p:any,i:number)=><Cell key={i} fill={i===0?"#0ecb81":"#38bdf8"}/>)}</Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="mt-3 grid gap-2 text-[11px] leading-relaxed sm:grid-cols-2">
                <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.04] p-3"><p className="flex items-center gap-1.5 font-bold text-emerald-300"><Rocket className="h-3.5 w-3.5"/> Price pumps UP fast</p><ol className="mt-1.5 list-decimal space-y-1 pl-4 text-zinc-400"><li>Binance/Bybit reprice in &lt;1s to the new high</li><li>Gate.io/Kraken still quote the <b className="text-zinc-200">old cheap Ask</b></li><li>Bot <b className="text-zinc-200">buys the lagging exchange</b>, sells the fast one</li><li>Gap closes in ~5–15s as laggards catch up</li></ol></div>
                <div className="rounded-xl border border-rose-400/20 bg-rose-400/[0.04] p-3"><p className="flex items-center gap-1.5 font-bold text-rose-300"><TrendingDown className="h-3.5 w-3.5"/> Price crashes DOWN fast</p><ol className="mt-1.5 list-decimal space-y-1 pl-4 text-zinc-400"><li>Fast exchanges drop instantly to the new low</li><li>Slow exchanges still show the <b className="text-zinc-200">old high Bid</b></li><li>Bot <b className="text-zinc-200">buys the fast (cheap) exchange</b>, sells into the lagging high Bid</li><li>Same pairs win — only the route direction flips</li></ol></div>
              </div>

              <div className="mt-3 rounded-xl border border-[#2b3139] bg-[#0b0e11] p-3.5 text-[11px] leading-relaxed">
                <p className="text-xs font-bold">🏆 The answer for your market</p>
                <p className="mt-1 text-zinc-400">{analysis?.pairs?.[0] ? <><b className="text-white">{analysis.pairs[0].symbol}</b> ({analysis.pairs[0].category}, liquidity {analysis.pairs[0].liquidityScore}) gives the most immediate profit in a fast move: <b className="text-emerald-300">+${fmtMoney(analysis.pairs[0].scenario.netProfit)}</b> on ${fmt(analysis?.tradeAmountUsd ?? tradeSize,0)} from a {analysis.pairs[0].scenario.spreadPercent.toFixed(3)}% shock-spread ({analysis.pairs[0].scenario.buyExchange}→{analysis.pairs[0].scenario.sellExchange}), score {analysis.pairs[0].volatilityProfitScore}/100. Memes/volatile pairs beat BTC/ETH because their books are thin and Gate.io/Bitget reprice slowly — the lag IS the profit.</> : "Loading…"}</p>
                <p className="mt-1.5 text-zinc-500">{analysis?.summary?.lesson}</p>
              </div>

              {analysis?.savedRuns?.length > 0 && (
                <div className="mt-3 rounded-xl border border-[#1e242c] bg-[#0b0e11] p-3.5">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Saved analysis runs (PostgreSQL)</p>
                  <div className="mt-2 space-y-1.5">{analysis.savedRuns.slice(0,4).map((run:any)=>(
                    <p key={run.id} className="flex items-center justify-between font-mono text-[10px]"><span className="font-sans font-bold text-zinc-300">{run.bestSymbol} <span className="font-normal text-zinc-500">{run.direction} {run.magnitudePercent}%</span></span><span className="text-zinc-500">{run.bestRoute}</span><span className="font-bold text-sky-300">{run.bestSpreadPercent.toFixed(3)}%</span><span className="font-bold text-emerald-400">+${fmtMoney(run.bestNetProfit)}</span><span className="text-zinc-600">{timeAgo(run.createdAt)}</span></p>
                  ))}</div>
                </div>
              )}
            </div>
          </div>
        </section>
        </div>
        )}


        {tab === "perf" && (
<div className={tab === "perf" ? "" : "hidden"}>
        {/* ─────────────── ACTIVITY 1: MOST PROFITABLE TIME PERIOD ─────────────── */}
        <section className="overflow-hidden rounded-2xl border border-violet-400/25 bg-[#12161a]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1e242c] bg-violet-400/[0.04] px-5 py-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-violet-300">Activity 1</p>
              <h2 className="mt-0.5 flex items-center gap-2 font-bold"><CalendarClock className="h-5 w-5 text-violet-400"/> Which Time Period Is Most Profitable — And Why?</h2>
              <p className="mt-0.5 max-w-3xl text-xs leading-relaxed text-zinc-400">The server records <b className="text-zinc-200">every scan</b> into hourly buckets (UTC) — trades, spreads, wide opportunities, fees and P&L — whether or not you're watching. This tracker never sleeps, so it learns your best window while you don't.</p>
            </div>
            <div className="text-right">
              <div className="flex flex-wrap justify-end gap-2">
                <button onClick={downloadExcel} disabled={excelBusy} className="flex items-center gap-1.5 rounded-lg bg-emerald-400 px-4 py-2 text-xs font-black text-black hover:bg-emerald-300 disabled:opacity-50"><Download className="h-4 w-4"/>{excelBusy ? "Building…" : "Download Excel (.xlsx)"}</button>
                <button onClick={saveDailyReportNow} disabled={savingDaily} className="flex items-center gap-1.5 rounded-lg border border-violet-400/50 px-3 py-2 text-xs font-bold text-violet-300 hover:bg-violet-400/10 disabled:opacity-50"><Save className="h-4 w-4"/>{savingDaily ? "Saving…" : "Save Today's Report"}</button>
              </div>
              <span className={`mt-2 inline-block rounded-full px-3 py-1.5 text-xs font-black ${timeData?.current?.isBestSessionNow ? "bg-emerald-400 text-black" : "bg-zinc-800 text-zinc-300"}`}>{timeData?.current?.isBestSessionNow ? "⭐ YOU ARE IN YOUR BEST SESSION NOW" : `Now: ${timeData?.current?.sessionDef?.label || "—"} (${String(timeData?.current?.hourUtc ?? 0).padStart(2,"0")}:00 UTC)`}</span>
              <p className="mt-1.5 font-mono text-[10px] text-zinc-500">{timeData?.tracking ? `Tracking since ${new Date(timeData.tracking.since).toLocaleDateString()} • ${timeData.tracking.trackedScans} tracked scans • updated ${timeAgo(timeData.tracking.lastUpdated)}` : "Starting tracker…"}</p>
              <p className="mt-0.5 text-[10px] text-zinc-600">Excel has 7 sheets: Daily Summary • Hourly Profit • Sessions • Days of Week • Best 6 Pairs • Recent Hours • Summary. Yesterday's report also auto-saves every day at UTC midnight.</p>
            </div>
          </div>

          <div className="grid gap-3 border-b border-[#1e242c] p-5 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label:"🏆 Most Profitable Hour", value: timeData?.bestHour ? `${timeData.bestHour.label}  •  $${fmtMoney(timeData.bestHour.netProfit)}` : "Collecting…", sub: timeData?.bestHour ? `${timeData.bestHour.trades} trades • win ${timeData.bestHour.winRate}% • avg spread ${timeData.bestHour.avgSpreadPercent.toFixed(3)}%${timeData?.current?.nextBestInHours!==null && timeData?.current?.nextBestInHours!==undefined ? ` • next in ~${timeData.current.nextBestInHours}h` : ""}` : "Needs trades in more hours", color:"text-violet-300" },
              { label:"🏆 Most Profitable Session", value: timeData?.bestSession ? `${timeData.bestSession.label}  •  $${fmtMoney(timeData.bestSession.netProfit)}` : "Collecting…", sub: timeData?.bestSession ? `${timeData.bestSession.range || ""} • ${timeData.bestSession.trades} trades • $${fmtMoney(timeData.bestSession.avgNetPerTrade)}/trade` : "", color:"text-emerald-400" },
              { label:"Best 4-Hour Block", value: timeData?.bestBlock ? `${timeData.bestBlock.label}  •  $${fmtMoney(timeData.bestBlock.netProfit)}` : "—", sub: timeData?.bestBlock ? `${timeData.bestBlock.trades} trades • fees only ${timeData.bestBlock.feesOfGrossPercent}% of gross` : "", color:"text-sky-300" },
              { label:"Weakest Period (avoid size)", value: timeData?.worstSession ? `${timeData.worstSession.label}  •  $${fmtMoney(timeData.worstSession.netProfit)}` : "—", sub: timeData ? `Confidence: ${timeData.confidence}` : "", color:"text-rose-300" },
            ].map(c=>(
              <div key={c.label} className="rounded-xl border border-[#1e242c] bg-[#0b0e11] p-3.5"><p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">{c.label}</p><p className={`mt-1.5 font-mono text-[13px] font-bold leading-snug ${c.color}`}>{c.value}</p><p className="mt-0.5 text-[10px] leading-snug text-zinc-500">{c.sub}</p></div>
            ))}
          </div>

          <div className="grid gap-0 xl:grid-cols-5">
            <div className="p-5 xl:col-span-3">
              <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">24-hour profit heatmap (UTC) — green earns, red loses, grey = no data yet</p>
              <div className="mt-3 grid grid-cols-6 gap-1.5 sm:grid-cols-8 lg:grid-cols-12">
                {(timeData?.byHour || Array.from({length:24},(_,h)=>({key:String(h), label:`${String(h).padStart(2,"0")}:00`, trades:0, netProfit:0, avgSpreadPercent:0}))).map((h:any)=>{
                  const maxAbs = Math.max(0.01, ...(timeData?.byHour||[]).map((x:any)=>Math.abs(x.netProfit)));
                  const intensity = Math.min(0.85, Math.abs(h.netProfit)/maxAbs * 0.85 + (h.trades?0.15:0));
                  const isNow = timeData?.current?.hourUtc === Number(h.key);
                  const isBest = timeData?.bestHour?.key === h.key && h.trades>0;
                  return (
                    <div key={h.key} title={`${h.label} UTC • ${h.trades} trades • Net $${fmtMoney(h.netProfit)} • Avg spread ${(h.avgSpreadPercent||0).toFixed(3)}% • Win ${h.winRate||0}%`} className={`rounded-lg border px-1 py-2 text-center ${isNow ? "border-sky-400" : isBest ? "border-violet-400" : "border-[#1e242c]"}`} style={{ background: h.trades===0 ? "#12161a" : h.netProfit>=0 ? `rgba(14,203,129,${intensity})` : `rgba(246,70,93,${intensity})` }}>
                      <p className="font-mono text-[10px] font-bold">{String(h.key).padStart(2,"0")}:00{isBest && " 🏆"}{isNow && " •"}</p>
                      <p className="mt-0.5 font-mono text-[9px] font-bold">{h.trades ? `$${fmtMoney(h.netProfit)}` : "no data"}</p>
                      <p className="text-[8px] text-zinc-400">{h.trades ? `${h.trades} trades` : "—"}</p>
                    </div>
                  );
                })}
              </div>
              <div className="mt-4 h-[180px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={(timeData?.byHour||[]).map((h:any)=>({ hour:`${String(h.key).padStart(2,"0")}`, net:h.netProfit, spread:h.avgSpreadPercent }))}>
                    <CartesianGrid stroke="#1e242c" strokeDasharray="3 3"/><XAxis dataKey="hour" tick={{fill:"#71717a", fontSize:9}} axisLine={false} interval={1}/><YAxis tick={{fill:"#71717a", fontSize:10}} axisLine={false} tickFormatter={(v)=>`$${v}`}/>
                    <Tooltip contentStyle={{background:"#161a1e", border:"1px solid #2b3139", borderRadius:10, fontSize:12}} formatter={(v:any,name:any)=>[name==="net"?`$${fmtMoney(Number(v))}`:`${Number(v).toFixed(3)}%`, name==="net"?"Net profit":"Avg spread"]}/>
                    <Bar dataKey="net" radius={[3,3,0,0]}>{(timeData?.byHour||[]).map((h:any,i:number)=><Cell key={i} fill={h.netProfit>=0 ? (timeData?.bestHour?.key===h.key ? "#a78bfa" : "#0ecb81") : "#f6465d"}/>)}</Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <p className="mt-2 text-[11px] font-bold uppercase tracking-wider text-zinc-500">Session breakdown</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {(timeData?.bySession || []).map((s:any)=>(
                  <div key={s.key} className={`rounded-xl border p-3 ${timeData?.bestSession?.key===s.key ? "border-violet-400/50 bg-violet-400/[0.05]" : "border-[#1e242c] bg-[#0b0e11]"}`}>
                    <div className="flex items-center justify-between"><p className="text-xs font-bold">{s.label} {timeData?.bestSession?.key===s.key && "🏆"}</p><span className={`font-mono text-xs font-bold ${s.netProfit>=0?"text-emerald-400":"text-rose-400"}`}>${fmtMoney(s.netProfit)}</span></div>
                    <p className="mt-0.5 text-[10px] text-zinc-500">{s.range} • {s.trades} trades • win {s.winRate}% • avg spread {s.avgSpreadPercent.toFixed(3)}% • fees {s.feesOfGrossPercent}% of gross • wide opps {s.wideFrequencyPercent}%</p>
                    <p className="mt-1 text-[10px] leading-snug text-zinc-600">{s.description}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="border-t border-[#1e242c] p-5 xl:col-span-2 xl:border-l xl:border-t-0">
              <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Why is that period most profitable?</p>
              <div className="mt-3 space-y-2">
                {(timeData?.why || ["Collecting data…"]).map((w:string, i:number)=>(
                  <p key={i} className="flex items-start gap-2 rounded-xl border border-[#1e242c] bg-[#0b0e11] px-3 py-2.5 text-[11px] leading-relaxed text-zinc-300"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-400 font-mono text-[10px] font-black text-black">{i+1}</span>{w}</p>
                ))}
              </div>
              <div className="mt-3 rounded-xl border border-violet-400/20 bg-violet-400/[0.04] p-3.5 text-[11px] leading-relaxed">
                <p className="flex items-center gap-1.5 text-xs font-bold text-violet-200"><Hourglass className="h-4 w-4"/> What to do with this</p>
                <ul className="mt-1.5 list-disc space-y-1 pl-4 text-zinc-400">{(timeData?.recommendations || []).map((r:string, i:number)=><li key={i}>{r}</li>)}</ul>
              </div>
              <p className="mt-3 text-[11px] font-bold uppercase tracking-wider text-zinc-500">Recent tracked hours (live from the worker)</p>
              <div className="mt-2 max-h-[220px] overflow-y-auto rounded-xl border border-[#1e242c]">
                <table className="w-full text-[11px]">
                  <thead className="sticky top-0 bg-[#12161a]"><tr className="text-left text-zinc-500"><th className="px-3 py-2 font-medium">Hour (UTC)</th><th className="px-2 py-2 font-medium text-right">Scans</th><th className="px-2 py-2 font-medium text-right">Opps / Wide</th><th className="px-2 py-2 font-medium text-right">Trades</th><th className="px-3 py-2 font-medium text-right">Net</th></tr></thead>
                  <tbody>{(timeData?.recentPeriods || []).slice(0,10).map((r:any)=>(
                    <tr key={r.bucketStart} className="border-t border-[#1e242c]/60"><td className="px-3 py-2 font-mono">{new Date(r.bucketStart).toISOString().slice(5,16).replace("T"," ")} <span className="text-zinc-600">{r.session}</span></td><td className="px-2 py-2 text-right font-mono">{r.scans}</td><td className="px-2 py-2 text-right font-mono">{r.opportunities} / {r.wideOpportunities}</td><td className="px-2 py-2 text-right font-mono">{r.trades}</td><td className={`px-3 py-2 text-right font-mono font-bold ${r.netProfit>=0?"text-emerald-400":"text-rose-400"}`}>${fmtMoney(r.netProfit)}</td></tr>
                  ))}{(timeData?.recentPeriods||[]).length===0 && <tr><td colSpan={5} className="px-3 py-4 text-center text-zinc-600">Tracker starts filling from the next server scan (every {intervalSec}s while the worker is on).</td></tr>}</tbody>
                </table>
              </div>
              <p className="mt-2 text-[10px] text-zinc-600">{timeData?.timezoneNote}</p>

              <div className="mt-4 rounded-xl border border-[#1e242c] bg-[#0b0e11] p-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Daily profit history — saved automatically every day</p>
                  <span className="rounded bg-black/40 px-2 py-0.5 font-mono text-[10px] text-zinc-400">{timeData?.savedReports?.length ?? 0} saved • {(timeData?.daily?.length ?? 0)} days with trades</span>
                </div>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full min-w-[640px] text-[11px]">
                    <thead><tr className="text-left text-zinc-500"><th className="py-1.5 pr-2 font-medium">Date (UTC)</th><th className="px-2 py-1.5 font-medium text-right">Trades</th><th className="px-2 py-1.5 font-medium text-right">Win %</th><th className="px-2 py-1.5 font-medium text-right">Net Profit</th><th className="px-2 py-1.5 font-medium">Best Hour</th><th className="px-2 py-1.5 font-medium">Best Session</th><th className="px-2 py-1.5 font-medium text-right">Avg Spread</th></tr></thead>
                    <tbody>
                      {(timeData?.daily || []).slice().reverse().slice(0, 10).map((x: any) => (
                        <tr key={x.reportDate} className="border-t border-[#1e242c]/60">
                          <td className="py-1.5 pr-2 font-mono font-bold">{x.reportDate} <span className="font-sans font-normal text-zinc-600">{x.dayName}</span></td>
                          <td className="px-2 py-1.5 text-right font-mono">{x.trades}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{x.winRate}%</td>
                          <td className={`px-2 py-1.5 text-right font-mono font-bold ${x.netProfit >= 0 ? "text-emerald-400" : "text-rose-400"}`}>${fmtMoney(x.netProfit)}</td>
                          <td className="px-2 py-1.5 font-mono text-[10px]">{x.bestHour || "—"} <span className="text-emerald-400">(${x.bestHourProfit >= 0 ? "+" : ""}${fmtMoney(x.bestHourProfit)})</span></td>
                          <td className="px-2 py-1.5 text-[10px]">{x.bestSession || "—"}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{x.avgSpreadPercent.toFixed(3)}%</td>
                        </tr>
                      ))}
                      {(!timeData?.daily || timeData.daily.length === 0) && <tr><td colSpan={7} className="py-4 text-center text-zinc-600">No daily data yet — it builds automatically as the bot trades.</td></tr>}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-[10px] text-zinc-600">Tip: use <b className="text-zinc-400">Download Excel</b> above to get this whole history (plus hourly/session/pair sheets) as a file you can keep or share.</p>
              </div>
            </div>
          </div>
        </section>
        </div>
        )}


        {tab === "perf" && (
<div className={tab === "perf" ? "" : "hidden"}>
        {/* ─────────────── WIDE SPREAD HUNTER ─────────────── */}
        <section className="overflow-hidden rounded-2xl border border-[#f0b90b]/30 bg-[#12161a]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1e242c] bg-[#f0b90b]/[0.05] px-5 py-4">
            <div>
              <h2 className="flex items-center gap-2 font-bold"><Telescope className="h-5 w-5 text-[#f0b90b]"/> Wide Spread Hunter — Finding Bigger Dislocations</h2>
              <p className="mt-0.5 max-w-3xl text-xs leading-relaxed text-zinc-400">Wider spreads live where books are thin: <b className="text-zinc-200">the Best 6 volatile & meme pairs</b> (PEPE, BONK, WIF, SHIB, INJ, ARB). In Two-Exchange Mode the gap is the Binance↔Bybit repricing/bias difference on those thin pairs. Now scanning <b className="text-zinc-100">{(config?.symbols||[]).length} pairs × {(config?.exchanges||[]).length} exchanges = {(config?.symbols||[]).length * ((config?.exchanges||[]).length * ((config?.exchanges||[]).length - 1))} buy→sell routes</b> every {intervalSec}s, ranked widest-first, still fee-checked.</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={()=>patchWide({ wideHunterEnabled: !(config?.wideHunterEnabled) })} className={`rounded-full px-3 py-1.5 text-xs font-black ${config?.wideHunterEnabled ? "bg-[#f0b90b] text-black" : "bg-zinc-800 text-zinc-300"}`}>{config?.wideHunterEnabled ? "🎯 HUNTER ON — WIDEST FIRST" : "HUNTER OFF"}</button>
              <button onClick={()=>patchWide({ wideOnlyExecution: !(config?.wideOnlyExecution) })} title="Only execute spreads at or above the wide threshold" className={`rounded-full px-3 py-1.5 text-xs font-black ${config?.wideOnlyExecution ? "bg-rose-500 text-white" : "bg-zinc-800 text-zinc-300"}`}>{config?.wideOnlyExecution ? "WIDE-ONLY: ON" : "WIDE-ONLY: OFF"}</button>
            </div>
          </div>

          <div className="grid gap-0 lg:grid-cols-5">
            <div className="border-b border-[#1e242c] p-5 lg:col-span-3 lg:border-b-0 lg:border-r">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Widest spreads right now</p>
                <div className="flex items-center gap-1.5 text-[10px]">
                  <span className="text-zinc-500">Wide = ≥</span>
                  {[0.5, 0.75, 1, 1.5].map(v=>(
                    <button key={v} onClick={()=>patchWide({ wideSpreadThreshold: v })} className={`rounded px-2 py-1 font-mono font-bold ${wideThreshold===v ? "bg-[#f0b90b] text-black" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"}`}>{v}%</button>
                  ))}
                </div>
              </div>
              <div className="mt-3 space-y-2">
                {wideLiveRoutes.slice(0,6).map(({m, r}, i)=>{
                  if (!r) return null;
                  const tier = tierOf(r.spreadPercent, wideThreshold);
                  const barW = Math.min(100, (r.spreadPercent / Math.max(wideThreshold*2.4, r.spreadPercent)) * 100);
                  return (
                    <button key={m.symbol} onClick={()=>{ setSelected(m.symbol); setExpanded(m.symbol); }} className="block w-full rounded-xl border border-[#1e242c] bg-[#0b0e11] p-3 text-left hover:border-[#f0b90b]/50">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs font-black text-zinc-500">#{i+1}</span>
                        <span className="font-bold text-[13px]">{m.symbol}</span>
                        <span className={`rounded px-1.5 py-0.5 text-[9px] font-black ${m.category==="meme" ? "bg-pink-500/15 text-pink-300" : m.category==="volatile" ? "bg-orange-500/15 text-orange-300" : m.category==="alt" ? "bg-sky-500/15 text-sky-300" : "bg-zinc-700/50 text-zinc-300"}`}>{CATEGORY_LABEL[m.category] || m.category?.toUpperCase()} • liq {m.liquidityScore}</span>
                        <span className={`rounded px-2 py-0.5 font-mono text-[11px] font-black ${tier.cls}`}>{tier.label} {r.spreadPercent.toFixed(3)}%</span>
                        <span className="ml-auto font-mono text-xs"><span className={r.net>0?"text-emerald-400":"text-rose-400"}>{r.net>=0?"+":"−"}${fmtMoney(Math.abs(r.net))} net</span> <span className="text-zinc-600">• {r.ratio.toFixed(2)}× charges • ${fmt(r.suggested,0)}</span></span>
                      </div>
                      <div className="mt-2 flex items-center gap-3">
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-800"><div className={`h-full rounded-full ${r.spreadPercent>=wideThreshold*1.6 ? "bg-orange-500" : r.spreadPercent>=wideThreshold ? "bg-[#f0b90b]" : "bg-zinc-600"}`} style={{width:`${barW}%`}}/></div>
                        <span className="shrink-0 text-[10px] text-zinc-500">{r.buy.exchange} ${fmtPrice(r.buy.ask)} → {r.sell.exchange} ${fmtPrice(r.sell.bid)}</span>
                        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-black ${r.pass ? "bg-emerald-400 text-black" : "bg-zinc-800 text-zinc-400"}`}>{r.pass ? `TRADE ${r.grade}` : "SKIP"}</span>
                      </div>
                    </button>
                  );
                })}
                {wideLiveRoutes.length===0 && <p className="text-xs text-zinc-500">Waiting for market data…</p>}
              </div>
              <p className="mt-3 flex items-start gap-1.5 text-[10px] leading-relaxed text-zinc-500"><Waves className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#f0b90b]"/> Why volatile pairs are wider: thin order books + slow price updates on smaller exchanges create 1–3% dislocations, vs 0.05–0.4% on BTC. The trade-off is slippage — the Risk Guard (profit ≥{config?.minProfitChargeRatio ?? 1.5}× charges, $ {fmtMoney(config?.maxLossPerTradeUsd ?? 0.15)} max loss) still applies, and size stays small on meme pairs.</p>
            </div>

            <div className="p-5 lg:col-span-2">
              <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Hunter scoreboard (all time, from DB)</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {[
                  { label:"Widest Ever Found", value:`${(wide?.widestEverPercent ?? 0).toFixed(3)}%`, sub: wide?.widestOpportunities?.[0] ? `${wide.widestOpportunities[0].symbol} • ${wide.widestOpportunities[0].buyExchange}→${wide.widestOpportunities[0].sellExchange}` : "—", color:"text-[#f0b90b]" },
                  { label:"Live Wide / Mega", value:`${wideCountLive} / ${megaCountLive}`, sub:`≥${wideThreshold}% / ≥${(wideThreshold*1.6).toFixed(2)}% right now`, color:"text-orange-300" },
                  { label:"Wide Found (DB)", value: wide?.wideFound ?? 0, sub:`Mega ${wide?.megaFound ?? 0} • Extreme ${wide?.extremeFound ?? 0}`, color:"text-white" },
                  { label:"Wide Trades Won", value:`$${fmtMoney(wide?.wideTradesPnl ?? 0)}`, sub:`${wide?.wideTradesCount ?? 0} trades ≥${wideThreshold}% • widest ${(wide?.widestTradePercent ?? 0).toFixed(3)}%`, color:"text-emerald-400" },
                ].map(c=>(
                  <div key={c.label} className="rounded-xl border border-[#1e242c] bg-[#0b0e11] p-3"><p className="text-[10px] uppercase tracking-wider text-zinc-500">{c.label}</p><p className={`mt-1 font-mono text-base font-bold ${c.color}`}>{c.value}</p><p className="mt-0.5 truncate text-[10px] text-zinc-500">{c.sub}</p></div>
                ))}
              </div>
              <div className="mt-3 space-y-2 rounded-xl border border-[#1e242c] bg-[#0b0e11] p-3.5 text-[11px] leading-relaxed">
                <p className="text-xs font-bold text-white">Hunter settings</p>
                <label className="flex items-center justify-between gap-2"><span className="text-zinc-400">Include volatile & meme pairs</span><button onClick={()=>patchWide({ includeVolatilePairs: !(config?.includeVolatilePairs) })} className={`h-6 w-11 shrink-0 rounded-full p-0.5 ${config?.includeVolatilePairs?"bg-[#f0b90b]":"bg-zinc-700"}`}><span className={`block h-5 w-5 rounded-full bg-white transition-transform ${config?.includeVolatilePairs?"translate-x-5":""}`}/></button></label>
                <label className="flex items-center justify-between gap-2"><span className="text-zinc-400">Execute wide spreads first</span><button onClick={()=>patchWide({ wideHunterEnabled: !(config?.wideHunterEnabled) })} className={`h-6 w-11 shrink-0 rounded-full p-0.5 ${config?.wideHunterEnabled?"bg-[#f0b90b]":"bg-zinc-700"}`}><span className={`block h-5 w-5 rounded-full bg-white transition-transform ${config?.wideHunterEnabled?"translate-x-5":""}`}/></button></label>
                <label className="flex items-center justify-between gap-2"><span className="text-zinc-400">Wide-only execution <span className="text-zinc-600">(ignore smaller spreads)</span></span><button onClick={()=>patchWide({ wideOnlyExecution: !(config?.wideOnlyExecution) })} className={`h-6 w-11 shrink-0 rounded-full p-0.5 ${config?.wideOnlyExecution?"bg-rose-500":"bg-zinc-700"}`}><span className={`block h-5 w-5 rounded-full bg-white transition-transform ${config?.wideOnlyExecution?"translate-x-5":""}`}/></button></label>
                <div>
                  <div className="flex justify-between"><span className="text-zinc-400">Wide threshold</span><span className="font-mono font-bold text-[#f0b90b]">{wideThreshold}%</span></div>
                  <input type="range" min={0.3} max={2} step={0.05} value={wideThreshold} onChange={e=>patchWide({ wideSpreadThreshold: Number(e.target.value) })} className="mt-1 w-full accent-[#f0b90b]"/>
                  <div className="flex justify-between text-[10px] text-zinc-600"><span>Lower = more “wide” alerts</span><span>0.3% — 2%</span></div>
                </div>
                <p className="text-[10px] text-zinc-500">Tip: Set Wide-Only ON + threshold 1% if you want the bot to sit patiently and only strike rare, fat dislocations. Keep it OFF to also take normal A-grade edges.</p>
              </div>
              {wide?.widestOpportunities?.length > 0 && (
                <div className="mt-3 rounded-xl border border-[#1e242c] bg-[#0b0e11] p-3.5">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Widest ever recorded</p>
                  <div className="mt-2 space-y-1.5">{wide.widestOpportunities.slice(0,4).map((o:any)=>(
                    <p key={o.id} className="flex items-center justify-between font-mono text-[11px]"><span className="font-sans font-bold text-zinc-300">{o.symbol}</span><span className="text-zinc-500">{o.buyExchange}→{o.sellExchange}</span><span className="font-bold text-[#f0b90b]">{o.spreadPercent.toFixed(3)}%</span><span className={o.status==="executed"?"text-emerald-400":"text-zinc-500"}>{o.status}</span></p>
                  ))}</div>
                </div>
              )}
            </div>
          </div>
        </section>
        </div>
        )}


        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
          {/* Left column - market + chart */}
          <div className="xl:col-span-2 space-y-5">
            {tab === "live" && (
<>
            {/* Live Scanner */}
            </>
            )}
            <section className="rounded-2xl border border-[#1e242c] bg-[#12161a] overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-[#1e242c]">
                <div><h2 className="flex items-center gap-2 font-bold"><Radar className="h-4 w-4 text-emerald-400"/> Live Bid-Ask Scanner — Net After Charges</h2><p className="text-xs text-zinc-500 mt-0.5">Route shown is the <b className="text-zinc-300">best profit after buy/sell fees + slippage</b> (fee-aware), not just best price. Green only if it passes the charges guard.</p></div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full border border-[#2b3139] px-2 py-1 text-[10px] font-mono text-zinc-400">{filteredMarket.length}/{market.length} pairs • {(config?.exchanges||[]).length} exchanges • {wideCountLive} wide</span>
                  <button onClick={()=>manualScan(true)} className="rounded-lg bg-[#f0b90b] px-3 py-1.5 text-xs font-bold text-black hover:bg-[#ffd84d]">Scan + Execute Best</button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 border-b border-[#1e242c] px-5 py-3">
                {[
                  {k:"all", label:"Best 6 — All"}, {k:"wide", label:`🎯 Wide ≥${wideThreshold}%`}, {k:"mega", label:`🔥 Mega ≥${(wideThreshold*1.6).toFixed(2)}%`}, {k:"pass", label:"✓ Risk-Pass Only"},
                ].map(f=>(
                  <button key={f.k} onClick={()=>setScannerFilter(f.k)} className={`rounded-lg px-2.5 py-1.5 text-[11px] font-bold ${scannerFilter===f.k ? "bg-[#f0b90b] text-black" : "border border-[#2b3139] text-zinc-400 hover:border-zinc-500"}`}>{f.label}</button>
                ))}
                <span className="ml-auto hidden text-[10px] text-zinc-600 md:block">Sorted widest-first • Click a row for the full order-book across {(config?.exchanges||[]).length} exchanges</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-[#1e242c] text-left text-[11px] uppercase tracking-wider text-zinc-500">
                    <th className="px-5 py-3 font-medium">Pair / Price</th><th className="px-3 py-3 font-medium">Buy (Fee-Aware Route) ↓</th><th className="px-3 py-3 font-medium">Sell (Fee-Aware Route) ↑</th><th className="px-3 py-3 font-medium text-right">Spread / Break-Even</th><th className="px-3 py-3 font-medium text-right">Net After Charges</th><th className="px-3 py-3 font-medium text-right">Risk Decision</th><th className="px-2 py-3"></th>
                  </tr></thead>
                  <tbody>
                    {filteredMarket.map(m=>{
                      const route = bestRoute(m, config, tradeSize);
                      const isOpp = !!route?.pass;
                      const isSelected = selected===m.symbol;
                      if (!route) return null;
                      return (
                        <tbody key={m.symbol} className="contents">
                        <tr onClick={()=>{setSelected(m.symbol); setExpanded(expanded===m.symbol?null:m.symbol);}} className={`cursor-pointer border-b border-[#1e242c]/70 hover:bg-white/[0.02] ${isSelected?"bg-white/[0.03]":""} ${isOpp?"bg-emerald-400/[0.04]":""}`}>
                          <td className="px-5 py-3.5"><div className="flex items-center gap-3"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#1e242c] text-[10px] font-black">{m.baseAsset.slice(0,3)}</span><div><p className="font-bold text-[13px]">{m.symbol} <span className={`ml-1 rounded px-1 py-0.5 align-middle text-[8px] font-black ${tierOf(route.spreadPercent, wideThreshold).cls}`}>{tierOf(route.spreadPercent, wideThreshold).label}</span></p><p className="font-mono text-[11px] text-zinc-500">${fmtPrice(m.basePrice)} <span className={m.change24h>=0?"text-emerald-400":"text-rose-400"}>{m.change24h>=0?"+":""}{m.change24h}%</span> <span className="text-zinc-600">• {CATEGORY_LABEL[m.category]||m.category} liq {m.liquidityScore}</span></p></div></div></td>
                          <td className="px-3 py-3.5"><p className="font-mono text-[13px] text-rose-300">${fmtPrice(route.buy.ask)}</p><p className="text-[11px] text-zinc-500">{route.buy.exchange} • ASK • fee {feeRate(route.buy, config?.lowFeeRouting ?? true, config?.feePercent ?? 0.08).toFixed(3)}%</p></td>
                          <td className="px-3 py-3.5"><p className="font-mono text-[13px] text-emerald-300">${fmtPrice(route.sell.bid)}</p><p className="text-[11px] text-zinc-500">{route.sell.exchange} • BID • fee {feeRate(route.sell, config?.lowFeeRouting ?? true, config?.feePercent ?? 0.08).toFixed(3)}%</p></td>
                          <td className="px-3 py-3.5 text-right"><span className={`inline-flex rounded-md px-2 py-1 font-mono text-xs font-bold ${isOpp?"bg-emerald-400 text-black": route.spreadPercent>0?"bg-amber-400/10 text-amber-300":"bg-rose-400/10 text-rose-300"}`}>{route.spreadPercent>0?"+":""}{route.spreadPercent.toFixed(3)}%</span><p className="font-mono text-[9px] text-zinc-500 mt-1">break-even {route.breakEven.toFixed(3)}% • need {route.requiredSpread.toFixed(3)}%</p></td>
                          <td className="px-3 py-3.5 text-right"><span className={`font-mono text-[13px] font-bold ${route.net>0 && isOpp?"text-emerald-400": route.net>0?"text-amber-300":"text-rose-400"}`}>{route.net>=0?"+":"−"}${fmtMoney(Math.abs(route.net))}</span><p className="text-[9px] text-zinc-600 font-mono">gross ${fmtMoney(route.gross)} − charges ${fmtMoney(route.charges)}<br/>{route.ratio.toFixed(2)}× charges • on ${fmt(route.suggested,0)}</p></td>
                          <td className="px-3 py-3.5 text-right">{isOpp ? <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-400 px-2.5 py-1.5 text-[11px] font-black text-black"><Zap className="h-3 w-3"/> TRADE {route.grade}</span> : <span title={route.reasons[0]} className="inline-flex max-w-[150px] items-center gap-1 rounded-lg bg-zinc-800 px-2 py-1.5 text-left text-[9px] font-bold leading-tight text-zinc-400"><Ban className="h-3 w-3 shrink-0 text-rose-400"/> SKIP: {route.reasons[0] || "No edge"}</span>}</td>
                          <td className="px-2 py-3.5"><ChevronDown className={`h-4 w-4 text-zinc-500 transition-transform ${expanded===m.symbol?"rotate-180":""}`}/></td>
                        </tr>
                        {expanded===m.symbol && (
                          <tr className="border-b border-[#1e242c] bg-[#0b0e11]">
                            <td colSpan={7} className="px-5 py-4">
                              <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 mb-3">Order book snapshot — {m.symbol} across exchanges <span className="normal-case font-normal">(click any opportunity below to trade it)</span></p>
                              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                                {m.quotes.map(q=>(
                                  <div key={q.exchange} className={`rounded-xl border p-3 ${q.exchange===m.bestAsk.exchange?"border-rose-400/40 bg-rose-400/5": q.exchange===m.bestBid.exchange?"border-emerald-400/40 bg-emerald-400/5":"border-[#1e242c] bg-[#12161a]"}`}>
                                    <div className="flex items-center justify-between"><p className="text-xs font-bold">{q.exchange}</p><span className="text-[9px] font-mono text-zinc-500">{q.latencyMs}ms</span></div>
                                    <div className="mt-2 space-y-1 font-mono text-[11px]">
                                      <p className="flex justify-between"><span className="text-zinc-500">BID</span><span className="text-emerald-300 font-bold">${fmtPrice(q.bid)}</span></p>
                                      <p className="flex justify-between"><span className="text-zinc-500">ASK</span><span className="text-rose-300 font-bold">${fmtPrice(q.ask)}</span></p>
                                      <p className="flex justify-between border-t border-white/5 pt-1"><span className="text-zinc-500">Spread</span><span>{q.spreadPercent.toFixed(3)}%</span></p>
                                      <p className="flex justify-between"><span className="text-zinc-500">Fee maker/taker</span><span className="text-amber-200">{(q.makerFeePercent ?? 0.04).toFixed(3)}% / {(q.takerFeePercent ?? 0.08).toFixed(3)}%</span></p>
                                    </div>
                                    {route && q.exchange===route.buy.exchange && <p className="mt-2 rounded bg-rose-400/10 px-1.5 py-0.5 text-center text-[9px] font-bold text-rose-300">▼ BEST NET BUY (after fees)</p>}
                                    {route && q.exchange===route.sell.exchange && <p className="mt-2 rounded bg-emerald-400/10 px-1.5 py-0.5 text-center text-[9px] font-bold text-emerald-300">▲ BEST NET SELL (after fees)</p>}
                                  </div>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                        </tbody>
                      );
                    })}
                    {market.length===0 && <tr><td colSpan={7} className="px-5 py-10 text-center text-zinc-500 text-sm">Connecting to exchanges…</td></tr>}
                    {market.length>0 && filteredMarket.length===0 && <tr><td colSpan={7} className="px-5 py-10 text-center text-zinc-500 text-sm">No pairs match this filter right now — spreads move every {intervalSec}s, keep the hunter on and they will appear.</td></tr>}
                  </tbody>
                </table>
              </div>
            </section>

            {tab === "perf" && (
<>
            {/* Charts row */}
            </>
            )}
            <div className="grid md:grid-cols-5 gap-5">
              <section className="md:col-span-3 rounded-2xl border border-[#1e242c] bg-[#12161a] p-5">
                <div className="flex items-center justify-between"><h3 className="font-bold text-sm flex items-center gap-2"><TrendingUp className="h-4 w-4 text-emerald-400"/> Equity Curve</h3><span className="font-mono text-xs text-zinc-400">Balance ${fmt(balance)}</span></div>
                <div className="h-[220px] mt-3">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={equity}>
                      <CartesianGrid stroke="#1e242c" strokeDasharray="3 3"/><XAxis dataKey="time" tick={{fill:"#71717a", fontSize:10}} axisLine={false} tickLine={false}/><YAxis domain={[(dataMin: number)=>Math.floor(dataMin - Math.max(1, Math.abs(dataMin)*0.02)), (dataMax: number)=>Math.ceil(dataMax + Math.max(1, Math.abs(dataMax)*0.02))]} tick={{fill:"#71717a", fontSize:10}} axisLine={false} tickLine={false} tickFormatter={(v)=>`$${Number(v).toLocaleString()}`}/>
                      <Tooltip contentStyle={{background:"#161a1e", border:"1px solid #2b3139", borderRadius:10, fontSize:12}} formatter={(v:any)=>[`$${fmt(Number(v))} (started $${fmt(initialCapital)})`,"Balance"]}/>
                      <Area type="monotone" dataKey="balance" stroke="#0ecb81" strokeWidth={2.5} fill="#0ecb81" fillOpacity={0.16}/>
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </section>
              <section className="md:col-span-2 rounded-2xl border border-[#1e242c] bg-[#12161a] p-5">
                <h3 className="font-bold text-sm flex items-center gap-2"><ChartCandlestick className="h-4 w-4 text-[#f0b90b]"/> Spread — {selected}</h3>
                <p className="text-[11px] text-zinc-500">Cross-exchange spread % over time. Above yellow line = bot trades.</p>
                <div className="h-[180px] mt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={selectedMarket?.history || []}>
                      <CartesianGrid stroke="#1e242c" strokeDasharray="3 3"/><XAxis dataKey="t" tick={{fill:"#71717a", fontSize:9}} axisLine={false}/><YAxis tick={{fill:"#71717a", fontSize:10}} axisLine={false} tickFormatter={(v)=>`${v}%`}/>
                      <Tooltip contentStyle={{background:"#161a1e", border:"1px solid #2b3139", borderRadius:10, fontSize:12}} formatter={(v:any)=>[`${Number(v).toFixed(3)}%`,"Spread"]}/>
                      <Line type="monotone" dataKey="spread" stroke="#f0b90b" strokeWidth={2} dot={false}/>
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                {profitBySymbol.length>0 && <>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 mt-2 mb-2">Profit by pair</p>
                  <div className="h-[110px]"><ResponsiveContainer width="100%" height="100%"><BarChart data={profitBySymbol}><XAxis dataKey="symbol" tick={{fill:"#a1a1aa", fontSize:10}} axisLine={false}/><YAxis tick={{fill:"#71717a", fontSize:10}} axisLine={false}/><Tooltip contentStyle={{background:"#161a1e", border:"1px solid #2b3139", borderRadius:10, fontSize:12}} formatter={(v:any)=>[`$${v}`,"Profit"]}/><Bar dataKey="profit" radius={[4,4,0,0]}>{profitBySymbol.map((e,i)=><Cell key={i} fill={e.profit>=0?"#0ecb81":"#f6465d"}/>)}</Bar></BarChart></ResponsiveContainer></div>
                </>}
              </section>
            </div>

            {tab === "live" && (
<>
            {/* Trades */}
            </>
            )}
            <section className="rounded-2xl border border-[#1e242c] bg-[#12161a] overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-[#1e242c]"><h3 className="font-bold flex items-center gap-2"><History className="h-4 w-4 text-zinc-400"/> Recent Trades</h3><span className="text-xs text-zinc-500">{trades.length} shown • All trades saved to PostgreSQL</span></div>
              <div className="overflow-x-auto max-h-[380px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-[#12161a]"><tr className="border-b border-[#1e242c] text-left text-[11px] uppercase text-zinc-500"><th className="px-5 py-3 font-medium">Pair & Route</th><th className="px-3 py-3 font-medium">Buy → Sell</th><th className="px-3 py-3 font-medium text-right">Spread</th><th className="px-3 py-3 font-medium text-right">Size / Qty</th><th className="px-3 py-3 font-medium text-right">Net P&L</th><th className="px-3 py-3 font-medium text-right">Time</th></tr></thead>
                  <tbody>
                    {trades.map(t=>(
                      <tr key={t.id} className="border-b border-[#1e242c]/60 hover:bg-white/[0.02]">
                        <td className="px-5 py-3"><p className="font-bold text-[13px]">{t.symbol}</p><p className="text-[11px] text-zinc-500 flex items-center gap-1">{t.buyExchange} <ArrowLeftRight className="h-3 w-3"/> {t.sellExchange} {t.strategy==="manual" && <span className="rounded bg-[#f0b90b]/10 text-[#f0b90b] px-1 text-[9px] font-bold">MANUAL</span>} {(t.source==="server-worker" || t.strategy==="server-24x7") && <span className="rounded bg-emerald-400 px-1 text-[9px] font-black text-black">AUTO • 24×7</span>} {t.source==="cron" && <span className="rounded bg-sky-400/20 text-sky-300 px-1 text-[9px] font-bold">CRON</span>} {t.stopLossTriggered && <span className="rounded bg-rose-500 px-1 text-[9px] font-black text-white">🛑 STOP-LOSS</span>}</p></td>
                        <td className="px-3 py-3 font-mono text-[11px]"><span className="text-rose-300">${fmtPrice(t.buyPrice)}</span> → <span className="text-emerald-300">${fmtPrice(t.sellPrice)}</span></td>
                        <td className="px-3 py-3 text-right font-mono text-xs text-[#f0b90b]">{t.spreadPercent.toFixed(3)}%</td>
                        <td className="px-3 py-3 text-right font-mono text-[11px] text-zinc-400">${fmt(t.amountUsd,0)}<br/><span className="text-zinc-600">{t.quantity}</span></td>
                        <td className="px-3 py-3 text-right"><span className={`font-mono font-bold text-[13px] ${t.netProfit>=0?"text-emerald-400":"text-rose-400"}`}>{t.netProfit>=0?"+":""}${fmtMoney(t.netProfit)}</span><p className="text-[10px] text-zinc-600 font-mono">fee ${fmtMoney(t.fees)}{t.stopLossAmount ? ` • SL −$${fmtMoney(t.stopLossAmount)}` : ""}</p></td>
                        <td className="px-3 py-3 text-right text-[11px] text-zinc-500">{timeAgo(t.executedAt)}</td>
                      </tr>
                    ))}
                    {trades.length===0 && <tr><td colSpan={6} className="px-5 py-10 text-center"><Bot className="h-8 w-8 mx-auto text-zinc-700"/><p className="text-sm text-zinc-500 mt-2 font-medium">No trades yet</p><p className="text-xs text-zinc-600">Press <b className="text-emerald-400">START BOT</b> — it will auto-trade when a spread beats your threshold, or click Execute on an opportunity →</p></td></tr>}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          {/* Right column */}
          <div className="space-y-5">
            {tab === "live" && (
<>
            {/* Opportunities feed */}
            </>
            )}
            <section className="rounded-2xl border border-emerald-400/20 bg-[#12161a] overflow-hidden">
              <div className="px-5 py-4 border-b border-[#1e242c] bg-emerald-400/[0.04] flex items-center justify-between"><h3 className="font-bold flex items-center gap-2 text-sm"><Sparkles className="h-4 w-4 text-emerald-400"/> Opportunity Feed</h3><span className="rounded-full bg-emerald-400 px-2 py-0.5 text-[10px] font-black text-black">{opps.filter(o=>o.status==="detected").length} NEW</span></div>
              <div className="max-h-[420px] overflow-y-auto divide-y divide-[#1e242c]/70">
                {opps.slice(0,15).map(o=>(
                  <div key={o.id} className="px-4 py-3 hover:bg-white/[0.02]">
                    <div className="flex items-start justify-between gap-2">
                      <div><p className="font-bold text-[13px]">{o.symbol} <span className={`ml-1 font-mono text-xs ${o.spreadPercent>= (config?.spreadThreshold||0)?"text-emerald-400":"text-zinc-400"}`}>+{o.spreadPercent.toFixed(3)}%</span> {o.spreadPercent >= wideThreshold && <span className={`ml-1 rounded px-1 py-0.5 align-middle text-[8px] font-black ${tierOf(o.spreadPercent, wideThreshold).cls}`}>{tierOf(o.spreadPercent, wideThreshold).label}</span>}</p><p className="text-[11px] text-zinc-400 mt-0.5">Buy <b className="text-zinc-200">{o.buyExchange}</b> ${fmtPrice(o.buyAsk)} → Sell <b className="text-zinc-200">{o.sellExchange}</b> ${fmtPrice(o.sellBid)}</p></div>
                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-black uppercase ${o.status==="executed"?"bg-emerald-400/10 text-emerald-300": o.status==="skipped"?"bg-zinc-700/40 text-zinc-400":"bg-[#f0b90b] text-black"}`}>{o.status}</span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      <span className={`rounded px-1.5 py-0.5 font-mono text-[9px] font-bold ${o.riskLevel==="low" ? "bg-emerald-400/10 text-emerald-300" : o.riskLevel==="blocked" || o.status==="skipped" ? "bg-rose-400/10 text-rose-300" : "bg-amber-400/10 text-amber-300"}`}>{o.status==="skipped" ? "BLOCKED" : `${o.riskLevel?.toUpperCase()} RISK`} • {o.qualityScore}/100</span>
                      <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[9px] text-zinc-300">profit {(o.profitChargeRatio||0).toFixed(2)}× charges</span>
                      <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[9px] text-zinc-300">charges ${fmtMoney(o.totalCharges||0)}</span>
                    </div>
                    {o.status==="skipped" && o.skipReason && <p className="mt-1.5 flex items-start gap-1 text-[10px] leading-tight text-rose-200/80"><Ban className="mt-0.5 h-3 w-3 shrink-0"/>{o.skipReason}</p>}
                    <div className="flex items-center justify-between mt-2">
                      <span className="font-mono text-[11px] text-zinc-500">Net est. <b className={o.estimatedProfit>0?"text-emerald-400":"text-rose-400"}>${fmtMoney(o.estimatedProfit)}</b> on ${fmt(o.tradeAmountUsd,0)} • {timeAgo(o.createdAt)}</span>
                      {o.status==="detected" && <button onClick={()=>executeOpp(o.id)} disabled={executingId===o.id} className="rounded-lg bg-emerald-400 px-3 py-1.5 text-[11px] font-black text-black hover:bg-emerald-300 disabled:opacity-50">{executingId===o.id?"Executing…":"Execute →"}</button>}
                      {o.status==="skipped" && <span className="rounded-lg bg-zinc-800 px-2.5 py-1.5 text-[10px] font-bold text-zinc-500">Guard Blocked</span>}
                      {o.status==="executed" && <CheckCircle2 className="h-4 w-4 text-emerald-400"/>}
                    </div>
                  </div>
                ))}
                {opps.length===0 && <div className="px-5 py-8 text-center text-xs text-zinc-500">No opportunities recorded yet.<br/>Start the bot or run a manual scan.</div>}
              </div>
            </section>

            {tab === "risk" && (
<>
            {/* Config */}
            </>
            )}
            <section className="rounded-2xl border border-[#1e242c] bg-[#12161a] p-5">
              <div className="flex items-center justify-between"><h3 className="font-bold flex items-center gap-2 text-sm"><Settings2 className="h-4 w-4 text-[#f0b90b]"/> Bot Configuration</h3><button onClick={resetBot} className="flex items-center gap-1 text-[11px] text-zinc-500 hover:text-rose-300"><Trash2 className="h-3 w-3"/> Reset</button></div>

              <div className="mt-4 space-y-4">
                {/* Starting Capital — $100 default */}
                <div className="rounded-xl border border-[#f0b90b]/30 bg-[#f0b90b]/[0.06] p-3.5">
                  <div className="flex items-center justify-between">
                    <p className="flex items-center gap-1.5 text-xs font-black text-[#f0b90b]"><Wallet className="h-4 w-4"/> STARTING CAPITAL</p>
                    <span className="rounded bg-[#f0b90b] px-1.5 py-0.5 font-mono text-[10px] font-black text-black">${fmt(initialCapital)}</span>
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">You start with <b className="text-white">${fmt(initialCapital)} paper USDT</b>. Bot trades <b className="text-white">${fmt(tradeSize)} per arbitrage</b> ({initialCapital ? Math.round(tradeSize/initialCapital*100) : 20}% of capital) so it never risks the whole wallet on one gap.</p>
                  <div className="mt-3 flex gap-1.5">
                    {[100,250,500,1000,5000].map(v=>(
                      <button key={v} onClick={()=>{ setCapitalInput(String(v)); }} className={`flex-1 rounded-lg border px-1 py-1.5 text-[11px] font-bold ${Number(capitalInput)===v ? "border-[#f0b90b] bg-[#f0b90b] text-black" : "border-[#2b3139] text-zinc-300 hover:border-zinc-500"}`}>${v>=1000 ? `${v/1000}k` : v}</button>
                    ))}
                  </div>
                  <div className="mt-2 flex gap-2">
                    <div className="relative flex-1">
                      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-bold text-zinc-500">$</span>
                      <input type="number" min={10} step={10} value={capitalInput} onChange={e=>setCapitalInput(e.target.value)} className="w-full rounded-lg border border-[#2b3139] bg-[#0b0e11] py-2 pl-6 pr-2 font-mono text-sm font-bold text-white outline-none focus:border-[#f0b90b]"/>
                    </div>
                    <button onClick={()=>applyCapital()} disabled={applyingCapital} className="shrink-0 rounded-lg bg-[#f0b90b] px-3 py-2 text-xs font-black text-black hover:bg-[#ffd84d] disabled:opacity-50">{applyingCapital ? "Applying…" : "Apply & Reset"}</button>
                  </div>
                  <p className="mt-1.5 text-[10px] text-zinc-500">Applying clears trade history and re-scales trade size (20%), max trade (50%), max daily loss (3%) & max loss/trade (0.15%) to the new capital.</p>
                  <div className="mt-2 grid grid-cols-3 gap-1.5 text-center font-mono text-[10px]">
                    <div className="rounded bg-black/30 px-1 py-1.5"><p className="text-zinc-500">WALLET</p><p className="font-bold text-white">${fmt(balance)}</p></div>
                    <div className="rounded bg-black/30 px-1 py-1.5"><p className="text-zinc-500">PER TRADE</p><p className="font-bold text-emerald-300">${fmt(tradeSize)}</p></div>
                    <div className="rounded bg-black/30 px-1 py-1.5"><p className="text-zinc-500">MAX LOSS/DAY</p><p className="font-bold text-rose-300">${fmt(config?.maxDailyLossUsd ?? initialCapital*0.1)}</p></div>
                  </div>
                </div>

                <div className="flex items-center justify-between rounded-xl border border-[#2b3139] bg-[#0b0e11] px-3 py-2.5">
                  <div><p className="text-xs font-bold">Auto-Trade</p><p className="text-[10px] text-zinc-500">Execute without asking</p></div>
                  <button onClick={()=>setDraft(d=>({...d, autoTrade: !d.autoTrade}))} className={`h-6 w-11 rounded-full p-0.5 transition-colors ${draft.autoTrade?"bg-emerald-400":"bg-zinc-700"}`}><span className={`block h-5 w-5 rounded-full bg-white transition-transform ${draft.autoTrade?"translate-x-5":""}`}/></button>
                </div>

                {/* 24×7 settings */}
                <div className="space-y-2.5 rounded-xl border border-emerald-400/25 bg-emerald-400/[0.04] p-3">
                  <p className="flex items-center gap-1.5 text-xs font-black text-emerald-300"><Server className="h-4 w-4"/> 24×7 SERVER SETTINGS</p>
                  <div className="flex items-center justify-between">
                    <div><p className="text-xs font-bold">Run 24×7 on Server</p><p className="text-[10px] text-zinc-500">Worker trades even with your PC off</p></div>
                    <button onClick={()=>setDraft(d=>({...d, run24x7: !(d as any).run24x7}))} className={`h-6 w-11 shrink-0 rounded-full p-0.5 transition-colors ${(draft as any).run24x7?"bg-emerald-400":"bg-zinc-700"}`}><span className={`block h-5 w-5 rounded-full bg-white transition-transform ${(draft as any).run24x7?"translate-x-5":""}`}/></button>
                  </div>
                  <div className="flex items-center justify-between">
                    <div><p className="text-xs font-bold">Auto-Resume After Restart</p><p className="text-[10px] text-zinc-500">Server reboot / deploy → keep trading</p></div>
                    <button onClick={()=>setDraft(d=>({...d, autoResume: !(d as any).autoResume}))} className={`h-6 w-11 shrink-0 rounded-full p-0.5 transition-colors ${(draft as any).autoResume?"bg-emerald-400":"bg-zinc-700"}`}><span className={`block h-5 w-5 rounded-full bg-white transition-transform ${(draft as any).autoResume?"translate-x-5":""}`}/></button>
                  </div>
                  <div>
                    <div className="flex justify-between text-xs"><label className="font-medium text-zinc-300">Server Scan Interval</label><span className="font-mono font-bold text-emerald-300">{(draft as any).workerIntervalSeconds ?? 5}s</span></div>
                    <input type="range" min={3} max={30} step={1} value={(draft as any).workerIntervalSeconds ?? 5} onChange={e=>setDraft(d=>({...d, workerIntervalSeconds: Number(e.target.value)}))} className="mt-1.5 w-full accent-emerald-400"/>
                    <div className="flex justify-between text-[10px] text-zinc-600"><span>How often the server (not browser) scans</span><span>3s — 30s</span></div>
                  </div>
                  <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-zinc-500"><Info className="mt-0.5 h-3 w-3 shrink-0"/> These are stored in PostgreSQL. The server worker reads them every tick, so changes apply without keeping this page open. “Save Configuration” below saves them.</p>
                </div>

                {/* Risk & charges settings */}
                <div className="space-y-2.5 rounded-xl border border-rose-400/25 bg-rose-400/[0.04] p-3">
                  <p className="flex items-center gap-1.5 text-xs font-black text-rose-300"><ShieldCheck className="h-4 w-4"/> RISK & CHARGES — MINIMUM RISK</p>
                  <div className="flex items-center justify-between">
                    <div><p className="text-xs font-bold">Low-Fee Routing (Maker)</p><p className="text-[10px] text-zinc-500">Binance/Bybit 0.02% vs Coinbase 0.06% maker — cuts charges ~3×</p></div>
                    <button onClick={()=>setDraft(d=>({...d, lowFeeRouting: !(d as any).lowFeeRouting}))} className={`h-6 w-11 shrink-0 rounded-full p-0.5 transition-colors ${(draft as any).lowFeeRouting?"bg-emerald-400":"bg-zinc-700"}`}><span className={`block h-5 w-5 rounded-full bg-white transition-transform ${(draft as any).lowFeeRouting?"translate-x-5":""}`}/></button>
                  </div>
                  <div className="flex items-center justify-between">
                    <div><p className="text-xs font-bold">Dynamic Position Sizing</p><p className="text-[10px] text-zinc-500">Half size on marginal edges, full only on A-grade</p></div>
                    <button onClick={()=>setDraft(d=>({...d, dynamicSizing: !(d as any).dynamicSizing}))} className={`h-6 w-11 shrink-0 rounded-full p-0.5 transition-colors ${(draft as any).dynamicSizing?"bg-emerald-400":"bg-zinc-700"}`}><span className={`block h-5 w-5 rounded-full bg-white transition-transform ${(draft as any).dynamicSizing?"translate-x-5":""}`}/></button>
                  </div>
                  <div className="flex items-center justify-between border-t border-white/5 pt-2.5">
                    <div><p className="text-xs font-bold text-emerald-300">Maker / Limit Orders ONLY (bot handles it)</p><p className="text-[10px] text-zinc-500">Limit orders at 0.02% maker — cancels if unfilled in {(draft as any).makerFillTimeoutSeconds ?? 5}s, never pays taker. You never place an order yourself.</p></div>
                    <button onClick={()=>setDraft(d=>({...d, makerOnlyEnabled: !(d as any).makerOnlyEnabled, lowFeeRouting: true}))} className={`h-6 w-11 shrink-0 rounded-full p-0.5 transition-colors ${(draft as any).makerOnlyEnabled?"bg-emerald-400":"bg-zinc-700"}`}><span className={`block h-5 w-5 rounded-full bg-white transition-transform ${(draft as any).makerOnlyEnabled?"translate-x-5":""}`}/></button>
                  </div>
                  <p className="text-[10px] leading-relaxed text-zinc-500">With Low-Fee OFF (taker), most routes will be correctly SKIPPED — that is the guard working, not a bug. Charges must never exceed profit.</p>
                </div>

                {/* STRICT STOP LOSS */}
                <div className="space-y-2.5 rounded-xl border border-rose-500/40 bg-rose-500/[0.06] p-3">
                  <p className="flex items-center gap-1.5 text-xs font-black text-rose-300"><ShieldAlert className="h-4 w-4"/> STRICT STOP LOSS — NON-NEGOTIABLE</p>
                  <div className="flex items-center justify-between">
                    <div><p className="text-xs font-bold">Strict Stop-Loss</p><p className="text-[10px] text-zinc-500">Cut every loser at exactly the stop distance</p></div>
                    <button onClick={()=>setDraft(d=>({...d, strictStopLossEnabled: !(d as any).strictStopLossEnabled}))} className={`h-6 w-11 shrink-0 rounded-full p-0.5 transition-colors ${(draft as any).strictStopLossEnabled?"bg-rose-500":"bg-zinc-700"}`}><span className={`block h-5 w-5 rounded-full bg-white transition-transform ${(draft as any).strictStopLossEnabled?"translate-x-5":""}`}/></button>
                  </div>
                  <div className="flex items-center justify-between">
                    <div><p className="text-xs font-bold">Autonomous Execution</p><p className="text-[10px] text-zinc-500">Bot decides & executes itself — no clicks</p></div>
                    <button onClick={()=>setDraft(d=>({...d, autonomousMode: !(d as any).autonomousMode, autoTrade: true}))} className={`h-6 w-11 shrink-0 rounded-full p-0.5 transition-colors ${(draft as any).autonomousMode?"bg-emerald-400":"bg-zinc-700"}`}><span className={`block h-5 w-5 rounded-full bg-white transition-transform ${(draft as any).autonomousMode?"translate-x-5":""}`}/></button>
                  </div>
                  <div>
                    <div className="flex justify-between text-xs"><label className="font-medium text-zinc-300">Stop-Loss Distance</label><span className="font-mono font-bold text-rose-300">−{((draft as any).stopLossPercent ?? 0.5)}% = −${fmtMoney((Number((draft as any).stopLossPercent ?? 0.5)/100) * Number((draft as any).tradeAmountUsd || tradeSize))} on ${fmt(Number((draft as any).tradeAmountUsd || tradeSize),0)}</span></div>
                    <input type="range" min={0.2} max={1.5} step={0.05} value={(draft as any).stopLossPercent ?? 0.5} onChange={e=>setDraft(d=>({...d, stopLossPercent: Number(e.target.value)}))} className="mt-1.5 w-full accent-rose-500"/>
                    <div className="flex justify-between text-[10px] text-zinc-600"><span>Tighter = smaller losses, more stop-outs</span><span>0.2% — 1.5%</span></div>
                  </div>
                  <div>
                    <div className="flex justify-between text-xs"><label className="font-medium text-zinc-300">Pause After A Stop-Out</label><span className="font-mono font-bold text-rose-300">{(draft as any).stopLossCooldownMinutes ?? 30} min</span></div>
                    <input type="range" min={5} max={120} step={5} value={(draft as any).stopLossCooldownMinutes ?? 30} onChange={e=>setDraft(d=>({...d, stopLossCooldownMinutes: Number(e.target.value)}))} className="mt-1.5 w-full accent-rose-500"/>
                    <div className="flex justify-between text-[10px] text-zinc-600"><span>All trading halts — no revenge trades</span><span>5 — 120 min</span></div>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5 text-center font-mono text-[10px]">
                    <div className="rounded bg-black/30 px-1 py-1.5"><p className="text-zinc-500">SL HITS</p><p className="font-bold text-rose-300">{stopLossInfo?.totalHits ?? 0}</p></div>
                    <div className="rounded bg-black/30 px-1 py-1.5"><p className="text-zinc-500">STOPPED LOSS</p><p className="font-bold text-white">${fmtMoney(stopLossInfo?.totalStoppedLoss ?? 0)}</p></div>
                    <div className="rounded bg-black/30 px-1 py-1.5"><p className="text-zinc-500">WORST TRADE</p><p className="font-bold text-white">${fmtMoney(stopLossInfo?.worstTradeEver ?? 0)}</p></div>
                  </div>
                  {stopLossInfo?.isPausedNow && <p className="rounded-lg bg-rose-500 px-3 py-2 text-center text-[11px] font-black text-white">🛑 STOP-LOSS COOLDOWN ACTIVE until {new Date(stopLossInfo.pausedUntil).toLocaleTimeString()} — bot is sitting out</p>}
                </div>

                {/* Wide hunter settings (also instant in the Hunter panel above) */}
                <div className="space-y-2.5 rounded-xl border border-[#f0b90b]/30 bg-[#f0b90b]/[0.05] p-3">
                  <p className="flex items-center gap-1.5 text-xs font-black text-[#f0b90b]"><Telescope className="h-4 w-4"/> WIDE SPREAD HUNTER</p>
                  <div className="flex items-center justify-between"><div><p className="text-xs font-bold">Hunt Wide Spreads First</p><p className="text-[10px] text-zinc-500">Execution priority = widest spread, then quality</p></div><button onClick={()=>setDraft(d=>({...d, wideHunterEnabled: !(d as any).wideHunterEnabled}))} className={`h-6 w-11 shrink-0 rounded-full p-0.5 ${(draft as any).wideHunterEnabled?"bg-[#f0b90b]":"bg-zinc-700"}`}><span className={`block h-5 w-5 rounded-full bg-white transition-transform ${(draft as any).wideHunterEnabled?"translate-x-5":""}`}/></button></div>
                  <div className="flex items-center justify-between"><div><p className="text-xs font-bold">Include Volatile & Meme Pairs</p><p className="text-[10px] text-zinc-500">SUI, NEAR, ARB, INJ, WIF, PEPE, BONK, SHIB — widest spreads</p></div><button onClick={()=>setDraft(d=>({...d, includeVolatilePairs: !(d as any).includeVolatilePairs}))} className={`h-6 w-11 shrink-0 rounded-full p-0.5 ${(draft as any).includeVolatilePairs?"bg-[#f0b90b]":"bg-zinc-700"}`}><span className={`block h-5 w-5 rounded-full bg-white transition-transform ${(draft as any).includeVolatilePairs?"translate-x-5":""}`}/></button></div>
                  <div className="flex items-center justify-between"><div><p className="text-xs font-bold">Wide-Only Execution</p><p className="text-[10px] text-zinc-500">Ignore anything below the wide threshold</p></div><button onClick={()=>setDraft(d=>({...d, wideOnlyExecution: !(d as any).wideOnlyExecution}))} className={`h-6 w-11 shrink-0 rounded-full p-0.5 ${(draft as any).wideOnlyExecution?"bg-rose-500":"bg-zinc-700"}`}><span className={`block h-5 w-5 rounded-full bg-white transition-transform ${(draft as any).wideOnlyExecution?"translate-x-5":""}`}/></button></div>
                  <div><div className="flex justify-between text-xs"><label className="font-medium text-zinc-300">Wide Spread Threshold</label><span className="font-mono font-bold text-[#f0b90b]">{(draft as any).wideSpreadThreshold ?? 0.75}%</span></div><input type="range" min={0.3} max={2} step={0.05} value={(draft as any).wideSpreadThreshold ?? 0.75} onChange={e=>setDraft(d=>({...d, wideSpreadThreshold: Number(e.target.value)}))} className="mt-1.5 w-full accent-[#f0b90b]"/><div className="flex justify-between text-[10px] text-zinc-600"><span>WIDE ≥ this • MEGA ≥ ×1.6 • EXTREME ≥ ×2.4</span><span>0.3% — 2%</span></div></div>
                </div>

                {[
                  {key:"minProfitChargeRatio", label:"Min Profit × Charges (KEY RULE)", suffix:"×", step:0.1, min:0.5, max:3, hint:"Net profit must be at least this × (fees+slippage) • 1.5 = charges ≤40% of gross"},
                  {key:"spreadThreshold", label:"Min Spread Threshold", suffix:"%", step:0.01, min:0.1, max:1, hint:"Raised to 0.30% so spread comfortably covers charges"},
                  {key:"tradeAmountUsd", label:"Trade Size (per arbitrage)", suffix:"$", step:5, min:5, max:Math.max(50, initialCapital*0.5), hint:`USDT per round-trip • ${initialCapital ? Math.round((Number(draft.tradeAmountUsd||tradeSize)/initialCapital)*100) : 20}% of $${fmt(initialCapital)} capital`},
                  {key:"maxTradeAmountUsd", label:"Max Trade Size (cap)", suffix:"$", step:5, min:10, max:Math.max(100, initialCapital), hint:"Hard ceiling — only A+ trades reach this"},
                  {key:"minProfitUsd", label:"Min Net Profit", suffix:"$", step:0.01, min:0.01, max:Math.max(2, initialCapital*0.02), hint:"After ALL charges • $0.04 on a $20 trade = 0.20% net edge"},
                  {key:"maxLossPerTradeUsd", label:"Max Loss Per Trade (hard cap)", suffix:"$", step:0.05, min:0.05, max:Math.max(1, initialCapital*0.01), hint:"A losing trade can NEVER lose more than this"},
                  {key:"maxDailyLossUsd", label:"Max Daily Loss (circuit breaker)", suffix:"$", step:0.5, min:0.5, max:Math.max(50, initialCapital*0.2), hint:"Trading pauses for the day if hit • 3% of $100"},
                  {key:"maxConsecutiveLosses", label:"Pause After Consecutive Losses", suffix:"", step:1, min:1, max:10, hint:"Circuit breaker streak limit"},
                  {key:"maxTradesPerDay", label:"Max Trades Per Day (runaway cap)", suffix:"", step:50, min:50, max:2000, hint:"Runaway safety only — real pacing is 1 best trade/scan, 15s apart, 20s route cooldown"},
                  {key:"maxTradesPerHour", label:"Max Trades Per Hour (runaway cap)", suffix:"", step:10, min:20, max:500, hint:"Runaway safety only — stops a runaway loop, not normal trading"},
                  {key:"maxDrawdownPercent", label:"Max Drawdown From Capital", suffix:"%", step:0.5, min:1, max:20, hint:"Pause if wallet falls this % below start"},
                  {key:"feePercent", label:"Max Fee Cap (per leg)", suffix:"%", step:0.01, min:0.02, max:0.5, hint:"Routes charging more than this are rejected"},
                  {key:"slippagePercent", label:"Slippage Allowance", suffix:"%", step:0.01, min:0, max:0.3, hint:"Counted as a charge in every decision"},
                  {key:"cooldownSeconds", label:"Cooldown (same pair/route)", suffix:"s", step:1, min:2, max:60, hint:"Prevents over-trading one gap"},
                ].map((f:any)=>(
                  <div key={f.key}>
                    <div className="flex justify-between text-xs"><label className="font-medium text-zinc-300">{f.label}</label><span className="font-mono font-bold text-[#f0b90b]">{f.suffix==="$" ? `$${fmtMoney(Number((draft as any)[f.key]||0))}` : `${(draft as any)[f.key]}${f.suffix}`}</span></div>
                    <input type="range" min={f.min} max={f.max} step={f.step} value={(draft as any)[f.key] ?? 0} onChange={e=>setDraft(d=>({...d,[f.key]: Number(e.target.value)}))} className="w-full accent-[#f0b90b] mt-1.5"/>
                    <div className="flex justify-between text-[10px] text-zinc-600"><span>{f.hint}</span><span>{f.suffix==="$" ? `$${f.min} — $${fmt(f.max)}` : `${f.min} — ${f.max}${f.suffix}`}</span></div>
                  </div>
                ))}

                <div>
                  <p className="text-xs font-medium text-zinc-300 mb-2">Trading Pairs — Locked To The Best 6</p>
                  <div className="space-y-1.5">{ALL_SYMBOLS.map(s=>{ const meta=BEST_6_META[s]; const stat=bestPairStats.find((x:any)=>x.symbol===s); return (
                    <div key={s} className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-[#0b0e11] px-3 py-2">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{background: meta.accent}}/>
                      <span className="font-mono text-[10px] font-black text-zinc-500">#{meta.rank}</span>
                      <span className="text-xs font-bold">{s}</span>
                      <span className="hidden truncate text-[10px] text-zinc-600 sm:block">{meta.thesis}</span>
                      <span className="ml-auto font-mono text-[10px] font-bold text-emerald-400">${fmtMoney(stat?.netProfit||0)}</span>
                      <span className="rounded bg-emerald-400 px-1.5 py-0.5 text-[8px] font-black text-black">LOCKED</span>
                    </div>)})}
                  </div>
                  <p className="mt-1.5 text-[10px] leading-relaxed text-zinc-600">All other pairs were removed on purpose — they earned less, had thinner spreads after fees, and only added noise. The bot trades these six and nothing else.</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-zinc-300 mb-2">Exchanges — Locked To Your Two Accounts</p>
                  <div className="grid grid-cols-2 gap-2">
                    {["Binance","Bybit"].map(s=>(
                      <div key={s} className="rounded-xl border border-teal-400/30 bg-teal-400/[0.04] px-3 py-2.5 text-center"><p className="text-xs font-black">{s}</p><p className="mt-0.5 text-[9px] text-teal-200/70">FIU-IND registered • Spot ✓ • Maker 0.02%</p><span className="mt-1.5 inline-block rounded bg-teal-400 px-1.5 py-0.5 text-[8px] font-black text-black">LOCKED</span></div>
                    ))}
                  </div>
                  <p className="mt-1.5 text-[10px] text-zinc-600">Two-Exchange Mode is ON. The bot only routes Binance↔Bybit — exactly the two accounts you plan to open.</p>
                </div>

                <div className="rounded-xl bg-[#0b0e11] border border-[#2b3139] p-3 text-[11px] leading-relaxed text-zinc-400">
                  <p className="flex items-center gap-1.5 font-bold text-zinc-200 text-xs"><Shield className="h-3.5 w-3.5 text-emerald-400"/> Risk Guardrails Active</p>
                  <ul className="mt-1.5 space-y-1 list-disc pl-4"><li>Starting capital: <b className="text-zinc-200">${fmt(initialCapital)}</b> • Trade size ${fmt(tradeSize)} ({initialCapital ? Math.round(tradeSize/initialCapital*100) : 20}% per trade)</li><li><b className="text-emerald-300">Profit must be ≥{(draft as any).minProfitChargeRatio ?? 1.5}× all charges</b> — charges can never exceed profit</li><li>Max loss/trade: <b className="text-zinc-200">${fmtMoney(Number((draft as any).maxLossPerTradeUsd||0))}</b> • Max daily loss: <b className="text-zinc-200">${fmtMoney(Number(draft.maxDailyLossUsd||0))}</b> — circuit breakers pause trading</li><li>Low-fee routing and dynamic sizing keep risk minimum</li><li>Paper mode: no real funds at risk</li></ul>
                </div>

                <button onClick={saveConfig} disabled={saving} className="w-full rounded-xl bg-[#f0b90b] py-2.5 text-sm font-black text-black hover:bg-[#ffd84d] disabled:opacity-50">{saving?"Saving…":"Save Configuration"}</button>
                <p className="text-center text-[10px] text-zinc-600">Changes apply on next server scan ({intervalSec}s) — no need to keep this page open</p>
              </div>
            </section>

            {tab === "live" && (
<>
            {/* Logs */}
            </>
            )}
            <section className="rounded-2xl border border-[#1e242c] bg-[#0d1114] overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-[#1e242c]"><h3 className="font-bold text-xs flex items-center gap-2 uppercase tracking-wider"><Terminal className="h-4 w-4 text-emerald-400"/> Bot Terminal</h3><span className={`flex items-center gap-1.5 text-[10px] font-bold ${config?.isRunning?"text-emerald-400":"text-zinc-500"}`}><span className={`h-1.5 w-1.5 rounded-full ${config?.isRunning?"bg-emerald-400 live-dot":"bg-zinc-600"}`}/>{config?.isRunning?"RUNNING":"IDLE"}</span></div>
              <div ref={logRef} className="h-[260px] overflow-y-auto px-4 py-3 font-mono text-[11px] leading-relaxed space-y-1.5">
                {logs.map(l=>(
                  <div key={l.id} className="flex gap-2"><span className="text-zinc-600 shrink-0">{new Date(l.createdAt).toLocaleTimeString("en-US",{hour12:false})}</span><span className={l.level==="trade"?"text-emerald-300": l.level==="success"?"text-emerald-400": l.level==="warn"?"text-[#f0b90b]": l.level==="scan"?"text-zinc-400":"text-zinc-300"}>{l.message}</span></div>
                ))}
                {logs.length===0 && <p className="text-zinc-600">Waiting for bot activity…</p>}
              </div>
            </section>

          </div>
        </div>

        <footer className="flex flex-col sm:flex-row items-center justify-between gap-2 pb-4 pt-2 text-[11px] text-zinc-600">
          <p>SpreadHunter • Built for education & paper trading • Not financial advice</p>
          <p className="font-mono">Exchanges: Binance · Coinbase · Kraken · Bybit · KuCoin — simulated feeds</p>
        </footer>
      </main>
    </div>
  );
}

