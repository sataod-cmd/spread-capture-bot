import { pgTable, serial, text, boolean, timestamp, doublePrecision, integer, jsonb } from "drizzle-orm/pg-core";

export const botConfigs = pgTable("bot_configs", {
  id: serial("id").primaryKey(),
  isRunning: boolean("is_running").notNull().default(false),
  autoTrade: boolean("auto_trade").notNull().default(true),
  mode: text("mode").notNull().default("paper"), // paper | live-sim
  spreadThreshold: doublePrecision("spread_threshold").notNull().default(0.6), // % — real spot charges: break-even 0.23%, 1.5x rule needs 0.575% → 0.60% for margin
  minProfitUsd: doublePrecision("min_profit_usd").notNull().default(0.07),
  tradeAmountUsd: doublePrecision("trade_amount_usd").notNull().default(20),
  maxTradeAmountUsd: doublePrecision("max_trade_amount_usd").notNull().default(50),
  feePercent: doublePrecision("fee_percent").notNull().default(0.11), // max spot fee cap per leg % (real Binance/Bybit spot = 0.10%)
  slippagePercent: doublePrecision("slippage_percent").notNull().default(0.03),
  cooldownSeconds: integer("cooldown_seconds").notNull().default(20),
  maxDailyLossUsd: doublePrecision("max_daily_loss_usd").notNull().default(3), // 3% of $100 capital
  // ─── Risk-first / charges guard ───
  minProfitChargeRatio: doublePrecision("min_profit_charge_ratio").notNull().default(1.5), // net profit must be ≥1.5× total charges
  maxLossPerTradeUsd: doublePrecision("max_loss_per_trade_usd").notNull().default(0.15), // hard cap on a single losing trade
  maxConsecutiveLosses: integer("max_consecutive_losses").notNull().default(3), // circuit breaker
  maxTradesPerDay: integer("max_trades_per_day").notNull().default(1000),
  maxTradesPerHour: integer("max_trades_per_hour").notNull().default(200),
  maxDrawdownPercent: doublePrecision("max_drawdown_percent").notNull().default(5), // pause if equity falls this % from capital
  lowFeeRouting: boolean("low_fee_routing").notNull().default(true), // prefer maker fees + cheapest-fee exchanges
  dynamicSizing: boolean("dynamic_sizing").notNull().default(true), // smaller size on marginal edges, bigger only on A-grade
  // ─── Autonomous execution + STRICT stop loss ───
  autonomousMode: boolean("autonomous_mode").notNull().default(true), // bot decides & executes itself, no clicks needed
  // ─── Maker/limit execution (bot handles this — user never trades manually) ───
  makerOnlyEnabled: boolean("maker_only_enabled").notNull().default(true), // limit/maker orders only, never chase with taker
  maxMakerFeePercent: doublePrecision("max_maker_fee_percent").notNull().default(0.11), // reject routes charging more than this per leg (real spot = 0.10%)
  makerFillTimeoutSeconds: integer("maker_fill_timeout_seconds").notNull().default(5), // cancel unfilled maker orders after this
  tokenFeeDiscount: boolean("token_fee_discount").notNull().default(false), // pay fees in BNB (Binance) / MNT (Bybit) → 0.075% instead of 0.10%
  taxPercent: doublePrecision("tax_percent").notNull().default(30), // user's model: 30% tax on earnings (year-end reserve, not a trade blocker)
  twoExchangeMode: boolean("two_exchange_mode").notNull().default(true), // Binance + Bybit only
  // ─── LIVE trading (real money) ───
  liveEnabled: boolean("live_enabled").notNull().default(false), // OFF by default — paper until explicitly enabled
  liveMaxTradeUsd: doublePrecision("live_max_trade_usd").notNull().default(20), // hard cap per live trade
  liveDryRun: boolean("live_dry_run").notNull().default(true), // true = scan real books, never place an order
  liveExecutionMode: text("live_execution_mode").notNull().default("taker"), // taker | maker
  liveEnabledAt: timestamp("live_enabled_at"),
  strictStopLossEnabled: boolean("strict_stop_loss_enabled").notNull().default(true),
  stopLossPercent: doublePrecision("stop_loss_percent").notNull().default(0.5), // exit a losing trade at -0.5% of its size
  stopLossCooldownMinutes: integer("stop_loss_cooldown_minutes").notNull().default(15), // pause after a stop-loss hit
  riskPausedUntil: timestamp("risk_paused_until"),
  // ─── Re-entry system ───
  reEntryEnabled: boolean("re_entry_enabled").notNull().default(true),
  reEntryDelaySeconds: integer("re_entry_delay_seconds").notNull().default(60),
  reEntryMaxAttempts: integer("re_entry_max_attempts").notNull().default(2),
  reEntrySizeMultiplier: doublePrecision("re_entry_size_multiplier").notNull().default(0.5),
  reEntryMinSpreadBoost: doublePrecision("re_entry_min_spread_boost").notNull().default(0),
  // ─── Capital-proportional sizing: double the capital → double the trade ───
  autoScalingEnabled: boolean("auto_scaling_enabled").notNull().default(true),
  baseCapital: doublePrecision("base_capital").notNull().default(100), // reference capital for the $20 default
  baseTradeAmount: doublePrecision("base_trade_amount").notNull().default(20), // trade size at baseCapital
  maxCapitalPercentPerTrade: doublePrecision("max_capital_percent_per_trade").notNull().default(30), // safety ceiling
  // ─── Full autonomy (always-on intelligence, no "modes" needed) ───
  emergencyStop: boolean("emergency_stop").notNull().default(false), // hard kill switch — blocks ALL trading
  autoTimeWindow: boolean("auto_time_window").notNull().default(false), // legacy setting; hourly performance never hard-blocks trading
  activeHours: jsonb("active_hours").notNull().default([0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23]),
  autoThresholdTuning: boolean("auto_threshold_tuning").notNull().default(true), // demand a wider spread in historically losing hours
  thresholdBoostLosingHours: doublePrecision("threshold_boost_losing_hours").notNull().default(0.15), // extra % required in bad hours
  sizeBoostWinningHours: doublePrecision("size_boost_winning_hours").notNull().default(1.25), // size multiplier in good hours
  disabledPairs: jsonb("disabled_pairs").notNull().default([]), // per-pair kill switch
  // ─── Wide Spread Hunter ───
  wideHunterEnabled: boolean("wide_hunter_enabled").notNull().default(true), // prioritise the widest spreads first
  wideSpreadThreshold: doublePrecision("wide_spread_threshold").notNull().default(0.75), // % — at/above this a spread is "WIDE"
  wideOnlyExecution: boolean("wide_only_execution").notNull().default(false), // true = only execute ≥ wide threshold
  includeVolatilePairs: boolean("include_volatile_pairs").notNull().default(true), // meme/small-cap pairs where spreads are naturally widest
  symbols: jsonb("symbols").notNull().default(["PEPE/USDT","BONK/USDT","WIF/USDT","SHIB/USDT","INJ/USDT","ARB/USDT"]), // BEST 6 only
  exchanges: jsonb("exchanges").notNull().default(["Binance","Bybit"]), // two-account mode
  balanceUsd: doublePrecision("balance_usd").notNull().default(100),
  initialBalanceUsd: doublePrecision("initial_balance_usd").notNull().default(100),
  // ─── 24×7 server-side operation ───
  run24x7: boolean("run_24x7").notNull().default(true),
  autoResume: boolean("auto_resume").notNull().default(true), // resume after server restart / deploy
  workerIntervalSeconds: integer("worker_interval_seconds").notNull().default(5), // server scan interval
  lastScanAt: timestamp("last_scan_at"),
  lastHeartbeatAt: timestamp("last_heartbeat_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const serverWorkers = pgTable("server_workers", {
  id: serial("id").primaryKey(),
  workerId: text("worker_id").notNull().default("primary-worker"),
  status: text("status").notNull().default("offline"), // online | paused | offline | error
  startedAt: timestamp("started_at"),
  lastHeartbeatAt: timestamp("last_heartbeat_at"),
  lastScanAt: timestamp("last_scan_at"),
  lastTradeAt: timestamp("last_trade_at"),
  lastSource: text("last_source").notNull().default("server-worker"), // server-worker | cron | manual
  lastError: text("last_error"),
  scansCount: integer("scans_count").notNull().default(0),
  tradesCount: integer("trades_count").notNull().default(0),
  opportunitiesCount: integer("opportunities_count").notNull().default(0),
  errorsCount: integer("errors_count").notNull().default(0),
  tickCount: integer("tick_count").notNull().default(0),
  hostInfo: text("host_info").notNull().default("nextjs-server"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const trades = pgTable("trades", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull(),
  buyExchange: text("buy_exchange").notNull(),
  sellExchange: text("sell_exchange").notNull(),
  buyPrice: doublePrecision("buy_price").notNull(),
  sellPrice: doublePrecision("sell_price").notNull(),
  spreadPercent: doublePrecision("spread_percent").notNull(),
  quantity: doublePrecision("quantity").notNull(),
  amountUsd: doublePrecision("amount_usd").notNull(),
  grossProfit: doublePrecision("gross_profit").notNull(),
  fees: doublePrecision("fees").notNull(),
  netProfit: doublePrecision("net_profit").notNull(),
  status: text("status").notNull().default("completed"), // completed | failed | pending
  strategy: text("strategy").notNull().default("cross-exchange"),
  source: text("source").notNull().default("browser"), // server-worker | cron | browser | manual — proves 24×7 execution
  stopLossAmount: doublePrecision("stop_loss_amount").notNull().default(0), // $ stop distance set at entry
  stopLossTriggered: boolean("stop_loss_triggered").notNull().default(false), // true = strict stop loss exited this trade
  executedAt: timestamp("executed_at").notNull().defaultNow(),
});

export const opportunities = pgTable("opportunities", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull(),
  buyExchange: text("buy_exchange").notNull(),
  sellExchange: text("sell_exchange").notNull(),
  buyAsk: doublePrecision("buy_ask").notNull(),
  sellBid: doublePrecision("sell_bid").notNull(),
  spreadPercent: doublePrecision("spread_percent").notNull(),
  spreadUsd: doublePrecision("spread_usd").notNull(),
  estimatedProfit: doublePrecision("estimated_profit").notNull(),
  tradeAmountUsd: doublePrecision("trade_amount_usd").notNull().default(20),
  status: text("status").notNull().default("detected"), // detected | executed | expired | skipped
  // ─── Risk / charges snapshot at detection time ───
  totalCharges: doublePrecision("total_charges").notNull().default(0), // exchange fees + slippage
  profitChargeRatio: doublePrecision("profit_charge_ratio").notNull().default(0), // net ÷ charges
  breakEvenSpreadPercent: doublePrecision("break_even_spread_percent").notNull().default(0),
  riskLevel: text("risk_level").notNull().default("medium"), // low | medium | high | blocked
  qualityScore: integer("quality_score").notNull().default(0), // 0-100
  skipReason: text("skip_reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const reentryStates = pgTable("reentry_states", {
  id: serial("id").primaryKey(),
  routeKey: text("route_key").notNull().unique(),
  symbol: text("symbol").notNull(),
  buyExchange: text("buy_exchange").notNull(),
  sellExchange: text("sell_exchange").notNull(),
  attempts: integer("attempts").notNull().default(0),
  lastExitAt: timestamp("last_exit_at"),
  lastExitNet: doublePrecision("last_exit_net").notNull().default(0),
  lastExitSpread: doublePrecision("last_exit_spread").notNull().default(0),
  lastExitWasStopLoss: boolean("last_exit_was_stop_loss").notNull().default(false),
  nextEligibleAt: timestamp("next_eligible_at"),
  status: text("status").notNull().default("ready"),
  totalReentries: integer("total_reentries").notNull().default(0),
  totalReentryPnl: doublePrecision("total_reentry_pnl").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const botLogs = pgTable("bot_logs", {
  id: serial("id").primaryKey(),
  level: text("level").notNull().default("info"), // info | success | warn | trade | scan
  message: text("message").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const volatilityAnalyses = pgTable("volatility_analyses", {
  id: serial("id").primaryKey(),
  direction: text("direction").notNull().default("both"), // up | down | both
  magnitudePercent: doublePrecision("magnitude_percent").notNull().default(2),
  bestSymbol: text("best_symbol"),
  bestRoute: text("best_route"),
  bestSpreadPercent: doublePrecision("best_spread_percent").notNull().default(0),
  bestNetProfit: doublePrecision("best_net_profit").notNull().default(0),
  tradeAmountUsd: doublePrecision("trade_amount_usd").notNull().default(20),
  results: jsonb("results").notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const timePeriodStats = pgTable("time_period_stats", {
  id: serial("id").primaryKey(),
  bucketStart: timestamp("bucket_start").notNull(), // hour, truncated (UTC)
  hourUtc: integer("hour_utc").notNull(),
  session: text("session").notNull(),
  scans: integer("scans").notNull().default(0),
  opportunities: integer("opportunities").notNull().default(0),
  wideOpportunities: integer("wide_opportunities").notNull().default(0),
  megaOpportunities: integer("mega_opportunities").notNull().default(0),
  trades: integer("trades").notNull().default(0),
  netProfit: doublePrecision("net_profit").notNull().default(0),
  grossProfit: doublePrecision("gross_profit").notNull().default(0),
  fees: doublePrecision("fees").notNull().default(0),
  spreadSum: doublePrecision("spread_sum").notNull().default(0),
  maxSpread: doublePrecision("max_spread").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const dailyReports = pgTable("daily_reports", {
  id: serial("id").primaryKey(),
  reportDate: text("report_date").notNull().unique(), // YYYY-MM-DD (UTC)
  trades: integer("trades").notNull().default(0),
  wins: integer("wins").notNull().default(0),
  netProfit: doublePrecision("net_profit").notNull().default(0),
  grossProfit: doublePrecision("gross_profit").notNull().default(0),
  fees: doublePrecision("fees").notNull().default(0),
  volume: doublePrecision("volume").notNull().default(0),
  avgSpreadPercent: doublePrecision("avg_spread_percent").notNull().default(0),
  bestHour: text("best_hour"),
  bestHourProfit: doublePrecision("best_hour_profit").notNull().default(0),
  bestSession: text("best_session"),
  bestSessionProfit: doublePrecision("best_session_profit").notNull().default(0),
  worstHour: text("worst_hour"),
  worstHourProfit: doublePrecision("worst_hour_profit").notNull().default(0),
  data: jsonb("data").notNull().default({}), // full hourly/session/day breakdown for the Excel export
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const equitySnapshots = pgTable("equity_snapshots", {
  id: serial("id").primaryKey(),
  balanceUsd: doublePrecision("balance_usd").notNull(),
  realizedPnl: doublePrecision("realized_pnl").notNull(),
  tradeCount: integer("trade_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
