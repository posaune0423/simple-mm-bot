import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

import { createSqliteClient } from "../../src/infrastructure/db/sqlite/client.ts";
import { SqliteMetricsRepository } from "../../src/infrastructure/db/sqlite/repository/SqliteMetricsRepository.ts";

describe("SqliteMetricsRepository", () => {
  const tempDir = join(process.cwd(), "tmp-tests-metrics");
  const dbPath = join(tempDir, "metrics.db");

  beforeEach(async () => {
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { force: true, recursive: true });
  });

  test("stores v5 metrics facts with duplicate-safe upserts", async () => {
    const client = createSqliteClient(dbPath);
    const repository = new SqliteMetricsRepository(client.db);

    await repository.startRun({
      id: "run-1",
      mode: "live",
      venue: "bulk",
      market: "BTC-USD",
      capitalMode: "beta_mock",
      strategyName: "avellaneda-stoikov",
      configJson: { mode: "live", venue: "bulk" },
      gitSha: "abc123",
      gitDirty: true,
      startedAt: 1000,
      status: "running",
    });
    await repository.finishRun("run-1", 8000, "completed", "max_ticks");

    await repository.recordOrderbookSnapshot({
      id: "snapshot-1",
      runId: "run-1",
      venue: "bulk",
      market: "BTC-USD",
      observedAt: 1000,
      bestBid: 99,
      bestAsk: 101,
      midPrice: 100,
      microPrice: 100.25,
      vampPrice: 100.5,
      markPrice: 100,
      spreadBps: 200,
      stalenessMs: 0,
      rawJson: { source: "seed" },
    });
    await repository.recordOrderbookSnapshot({
      id: "snapshot-1-replacement",
      runId: "run-1",
      venue: "bulk",
      market: "BTC-USD",
      observedAt: 1000,
      bestBid: 98,
      bestAsk: 102,
      midPrice: 100,
      microPrice: 100,
      vampPrice: 100.75,
      markPrice: 100,
      spreadBps: 400,
      stalenessMs: 10,
      rawJson: { source: "ws" },
    });

    await repository.recordSubmittedOrder({
      id: "submitted-1",
      runId: "run-1",
      venue: "bulk",
      market: "BTC-USD",
      clientOrderId: "client-1",
      intent: "quote",
      side: "buy",
      orderType: "limit",
      limitPrice: 99,
      quantity: 2,
      timeInForce: "GTC",
      submittedAt: 1000,
      finalStatus: "submitted",
    });
    await repository.recordSubmittedOrder({
      id: "submitted-1",
      runId: "run-1",
      venue: "bulk",
      market: "BTC-USD",
      clientOrderId: "client-1",
      venueOrderId: "venue-order-1",
      intent: "quote",
      side: "buy",
      orderType: "limit",
      limitPrice: 99,
      quantity: 2,
      timeInForce: "GTC",
      submittedAt: 1000,
      acceptedAt: 1100,
      finalStatus: "filled",
      latencyMs: 100,
      rawJson: { status: "resting" },
    });

    await repository.recordTradeFill({
      id: "fill-1",
      runId: "run-1",
      submittedOrderId: "submitted-1",
      venue: "bulk",
      market: "BTC-USD",
      venueFillId: "venue-fill-1",
      venueOrderId: "venue-order-1",
      side: "buy",
      price: 99,
      quantity: 1,
      fee: 0.1,
      tradePnl: 1,
      makerTaker: "maker",
      filledAt: 1000,
      rawJson: { source: "poll" },
    });
    await repository.recordTradeFill({
      id: "fill-duplicate",
      runId: "run-1",
      submittedOrderId: "submitted-1",
      venue: "bulk",
      market: "BTC-USD",
      venueFillId: "venue-fill-1",
      venueOrderId: "venue-order-1",
      side: "buy",
      price: 99,
      quantity: 2,
      fee: 0.2,
      tradePnl: 2,
      makerTaker: "maker",
      filledAt: 1000,
      rawJson: { source: "poll-replacement" },
    });

    await repository.recordAccountStateObservation({
      id: "account-1",
      runId: "run-1",
      venue: "bulk",
      market: "BTC-USD",
      observedAt: 1000,
      equity: 1000,
      positionQty: 2,
      marginRatio: 0.9,
      rawJson: { source: "fullAccount" },
    });

    const tables = client.sqlite
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
      .all()
      .map((row) => row.name);
    expect(tables).toContain("trading_runs");
    expect(tables).toContain("orderbook_snapshots");
    expect(tables).toContain("submitted_orders");
    expect(tables).toContain("trade_fills");
    expect(tables).toContain("account_state_observations");
    expect(tables).not.toContain("reports");
    expect(tables).not.toContain("telemetry_runs");
    expect(tables).not.toContain("telemetry_events");
    expect(tables).not.toContain("markouts");
    expect(tables).not.toContain("quote_decisions");
    expect(tables).not.toContain("runtime_incidents");

    const run = client.sqlite
      .query<{ status: string; stop_reason: string }, []>(
        "SELECT status, stop_reason FROM trading_runs WHERE id = 'run-1'",
      )
      .get();
    expect(run).toEqual({ status: "completed", stop_reason: "max_ticks" });

    const snapshotCount = client.sqlite
      .query<{ count: number }, []>(
        "SELECT count(*) AS count FROM orderbook_snapshots WHERE run_id = 'run-1'",
      )
      .get();
    const fillCount = client.sqlite
      .query<{ count: number }, []>(
        "SELECT count(*) AS count FROM trade_fills WHERE venue = 'bulk' AND venue_fill_id = 'venue-fill-1'",
      )
      .get();
    expect(snapshotCount?.count).toBe(1);
    expect(fillCount?.count).toBe(1);
    const snapshot = client.sqlite
      .query<{ vamp_price: number }, []>(
        "SELECT vamp_price FROM orderbook_snapshots WHERE run_id = 'run-1'",
      )
      .get();
    expect(snapshot?.vamp_price).toBe(100.75);
  });

  test("adds nullable VAMP price when bootstrapping an existing sqlite database", () => {
    const old = new Database(dbPath, { create: true });
    old.exec(`
      CREATE TABLE orderbook_snapshots (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        venue TEXT NOT NULL,
        market TEXT NOT NULL,
        observed_at INTEGER NOT NULL,
        best_bid REAL NOT NULL,
        best_ask REAL NOT NULL,
        mid_price REAL NOT NULL,
        micro_price REAL NOT NULL,
        mark_price REAL NOT NULL,
        spread_bps REAL NOT NULL,
        staleness_ms INTEGER NOT NULL,
        raw_json TEXT,
        UNIQUE (run_id, market, observed_at)
      )
    `);
    old.close();

    const migrated = createSqliteClient(dbPath);
    const columns = migrated.sqlite
      .query<{ name: string }, []>("PRAGMA table_info(orderbook_snapshots)")
      .all()
      .map((column) => column.name);

    expect(columns).toContain("vamp_price");
    migrated.sqlite.close();
  });

  test("computes market quality p95 spread from orderbook snapshots", async () => {
    const client = createSqliteClient(dbPath);
    const repository = new SqliteMetricsRepository(client.db);

    await repository.startRun({
      id: "run-market-quality",
      mode: "live",
      venue: "bulk",
      market: "BTC-USD",
      capitalMode: "beta_mock",
      strategyName: "avellaneda-stoikov",
      configJson: {},
      gitDirty: false,
      startedAt: 0,
      status: "running",
    });

    for (let index = 1; index <= 20; index += 1) {
      await repository.recordOrderbookSnapshot({
        id: `snapshot-p95-${index}`,
        runId: "run-market-quality",
        venue: "bulk",
        market: "BTC-USD",
        observedAt: index * 1000,
        bestBid: 100 - index / 100,
        bestAsk: 100 + index / 100,
        midPrice: 100,
        microPrice: 100,
        markPrice: 100,
        spreadBps: index,
        stalenessMs: index === 20 ? 1500 : 50,
      });
    }

    const marketQuality = client.sqlite
      .query<
        {
          avg_spread_bps: number;
          p95_spread_bps: number;
          stale_rate: number;
          observation_count: number;
        },
        []
      >(
        "SELECT avg_spread_bps, p95_spread_bps, stale_rate, observation_count FROM v_market_quality WHERE run_id = 'run-market-quality'",
      )
      .get();

    expect(marketQuality?.avg_spread_bps).toBeCloseTo(10.5);
    expect(marketQuality?.p95_spread_bps).toBe(19);
    expect(marketQuality?.stale_rate).toBeCloseTo(0.05);
    expect(marketQuality?.observation_count).toBe(20);
  });

  test("recreates analysis views when an existing sqlite database has stale view SQL", () => {
    const client = createSqliteClient(dbPath);
    client.sqlite.exec("DROP VIEW v_fill_markouts");
    client.sqlite.exec("CREATE VIEW v_fill_markouts AS SELECT 1 AS stale_view");
    client.sqlite.close();

    const migrated = createSqliteClient(dbPath);
    const viewSql = migrated.sqlite
      .query<{ sql: string }, []>(
        "SELECT sql FROM sqlite_master WHERE type = 'view' AND name = 'v_fill_markouts'",
      )
      .get();

    expect(viewSql?.sql).toContain("next_s5.observed_at >= f.filled_at + 5000");
    expect(viewSql?.sql).not.toContain("stale_view");
    migrated.sqlite.close();
  });

  test("excludes fills without enough future snapshots from markout coverage denominator", async () => {
    const client = createSqliteClient(dbPath);
    const repository = new SqliteMetricsRepository(client.db);

    await repository.startRun({
      id: "run-markout-coverage",
      mode: "paper",
      venue: "bulk",
      market: "BTC-USD",
      capitalMode: "paper",
      strategyName: "avellaneda-stoikov",
      configJson: {},
      gitDirty: false,
      startedAt: 0,
      status: "running",
    });
    await repository.recordOrderbookSnapshot({
      id: "coverage-snapshot-fill",
      runId: "run-markout-coverage",
      venue: "bulk",
      market: "BTC-USD",
      observedAt: 1000,
      bestBid: 99,
      bestAsk: 101,
      midPrice: 100,
      microPrice: 100,
      markPrice: 100,
      spreadBps: 200,
      stalenessMs: 0,
    });
    await repository.recordOrderbookSnapshot({
      id: "coverage-snapshot-5s",
      runId: "run-markout-coverage",
      venue: "bulk",
      market: "BTC-USD",
      observedAt: 6100,
      bestBid: 100,
      bestAsk: 102,
      midPrice: 101,
      microPrice: 101,
      markPrice: 101,
      spreadBps: 198,
      stalenessMs: 50,
    });
    for (const [id, filledAt] of [
      ["eligible-fill", 1000],
      ["terminal-fill", 6000],
    ] as const) {
      await repository.recordTradeFill({
        id,
        runId: "run-markout-coverage",
        venue: "bulk",
        market: "BTC-USD",
        venueFillId: id,
        side: "buy",
        price: 99,
        quantity: 1,
        fee: 0.1,
        tradePnl: 1,
        makerTaker: "maker",
        filledAt,
      });
    }

    const quality = client.sqlite
      .query<{ avg_markout_5s_bps: number; markout_5s_coverage: number }, []>(
        "SELECT avg_markout_5s_bps, markout_5s_coverage FROM v_markout_quality WHERE run_id = 'run-markout-coverage'",
      )
      .get();

    expect(quality?.avg_markout_5s_bps).toBeCloseTo(202.0202, 4);
    expect(quality?.markout_5s_coverage).toBe(1);
  });

  test("does not use delayed long-horizon snapshots for short-horizon markouts", async () => {
    const client = createSqliteClient(dbPath);
    const repository = new SqliteMetricsRepository(client.db);

    await repository.startRun({
      id: "run-delayed-markout",
      mode: "live",
      venue: "bulk",
      market: "BTC-USD",
      capitalMode: "beta_mock",
      strategyName: "avellaneda-stoikov",
      configJson: {},
      gitDirty: false,
      startedAt: 0,
      status: "running",
    });
    await repository.recordTradeFill({
      id: "fill-delayed",
      runId: "run-delayed-markout",
      venue: "bulk",
      market: "BTC-USD",
      venueFillId: "fill-delayed",
      side: "buy",
      price: 100,
      quantity: 1,
      fee: 0,
      tradePnl: 0,
      makerTaker: "maker",
      filledAt: 1000,
    });
    await repository.recordOrderbookSnapshot({
      id: "snapshot-300s",
      runId: "run-delayed-markout",
      venue: "bulk",
      market: "BTC-USD",
      observedAt: 301000,
      bestBid: 110,
      bestAsk: 112,
      midPrice: 111,
      microPrice: 111,
      markPrice: 111,
      spreadBps: 180,
      stalenessMs: 0,
    });

    const markout = client.sqlite
      .query<
        {
          markout_5s_bps: number | null;
          markout_30s_bps: number | null;
          markout_300s_bps: number | null;
        },
        []
      >(
        "SELECT markout_5s_bps, markout_30s_bps, markout_300s_bps FROM v_fill_markouts WHERE fill_id = 'fill-delayed'",
      )
      .get();

    expect(markout?.markout_5s_bps).toBeNull();
    expect(markout?.markout_30s_bps).toBeNull();
    expect(markout?.markout_300s_bps).toBe(1100);
  });

  test("reads recent side quality from multi-horizon fill markouts", async () => {
    const client = createSqliteClient(dbPath);
    const repository = new SqliteMetricsRepository(client.db);

    await repository.startRun({
      id: "run-side-quality",
      mode: "live",
      venue: "bulk",
      market: "BTC-USD",
      capitalMode: "beta_mock",
      strategyName: "avellaneda-stoikov",
      configJson: {},
      gitDirty: false,
      startedAt: 0,
      status: "running",
    });
    for (const snapshot of [
      { id: "quality-5s", observedAt: 6_000, midPrice: 99 },
      { id: "quality-30s", observedAt: 31_000, midPrice: 98 },
      { id: "quality-300s", observedAt: 301_000, midPrice: 102 },
    ]) {
      await repository.recordOrderbookSnapshot({
        id: snapshot.id,
        runId: "run-side-quality",
        venue: "bulk",
        market: "BTC-USD",
        observedAt: snapshot.observedAt,
        bestBid: snapshot.midPrice - 1,
        bestAsk: snapshot.midPrice + 1,
        midPrice: snapshot.midPrice,
        microPrice: snapshot.midPrice,
        markPrice: snapshot.midPrice,
        spreadBps: 200,
        stalenessMs: 0,
      });
    }
    await repository.recordTradeFill({
      id: "quality-buy",
      runId: "run-side-quality",
      venue: "bulk",
      market: "BTC-USD",
      venueFillId: "quality-buy",
      side: "buy",
      price: 100,
      quantity: 1,
      fee: 0,
      tradePnl: 0,
      makerTaker: "maker",
      filledAt: 1_000,
    });

    const quality = await repository.getRecentSideQuality({
      market: "BTC-USD",
      lookbackFills: 100,
      horizonsSec: [5, 30, 300],
    });

    expect(quality).toEqual([
      {
        side: "buy",
        horizons: [
          { horizonSec: 5, sampleCount: 1, averageMarkoutBps: -100 },
          { horizonSec: 30, sampleCount: 1, averageMarkoutBps: -200 },
          { horizonSec: 300, sampleCount: 1, averageMarkoutBps: 200 },
        ],
      },
    ]);
  });

  test("computes analysis views from fact tables instead of OHLCV", async () => {
    const client = createSqliteClient(dbPath);
    const repository = new SqliteMetricsRepository(client.db);

    await repository.startRun({
      id: "run-views",
      mode: "live",
      venue: "bulk",
      market: "BTC-USD",
      capitalMode: "beta_mock",
      strategyName: "avellaneda-stoikov",
      configJson: {},
      gitDirty: false,
      startedAt: 0,
      status: "running",
    });
    await repository.recordOrderbookSnapshot({
      id: "snapshot-fill",
      runId: "run-views",
      venue: "bulk",
      market: "BTC-USD",
      observedAt: 1000,
      bestBid: 99,
      bestAsk: 101,
      midPrice: 100,
      microPrice: 100,
      markPrice: 100,
      spreadBps: 200,
      stalenessMs: 0,
    });
    await repository.recordOrderbookSnapshot({
      id: "snapshot-5s",
      runId: "run-views",
      venue: "bulk",
      market: "BTC-USD",
      observedAt: 6100,
      bestBid: 100,
      bestAsk: 102,
      midPrice: 101,
      microPrice: 101,
      markPrice: 101,
      spreadBps: 198,
      stalenessMs: 50,
    });
    await repository.recordOrderbookSnapshot({
      id: "snapshot-5s-later",
      runId: "run-views",
      venue: "bulk",
      market: "BTC-USD",
      observedAt: 6200,
      bestBid: 119,
      bestAsk: 121,
      midPrice: 120,
      microPrice: 120,
      markPrice: 120,
      spreadBps: 168,
      stalenessMs: 50,
    });
    await repository.recordSubmittedOrder({
      id: "order-views",
      runId: "run-views",
      venue: "bulk",
      market: "BTC-USD",
      clientOrderId: "client-views",
      venueOrderId: "venue-order-views",
      intent: "quote",
      side: "buy",
      orderType: "limit",
      limitPrice: 99,
      quantity: 1,
      timeInForce: "GTC",
      submittedAt: 900,
      acceptedAt: 950,
      finalStatus: "filled",
      latencyMs: 50,
    });
    await repository.recordTradeFill({
      id: "fill-views",
      runId: "run-views",
      submittedOrderId: "order-views",
      venue: "bulk",
      market: "BTC-USD",
      venueFillId: "venue-fill-views",
      venueOrderId: "venue-order-views",
      side: "buy",
      price: 99,
      quantity: 1,
      fee: 0.1,
      tradePnl: 1,
      makerTaker: "maker",
      filledAt: 1000,
    });
    await repository.recordAccountStateObservation({
      id: "account-views-1",
      runId: "run-views",
      venue: "bulk",
      market: "BTC-USD",
      observedAt: 1000,
      equity: 1000,
      positionQty: 1,
      marginRatio: 0.9,
    });
    await repository.recordAccountStateObservation({
      id: "account-views-2",
      runId: "run-views",
      venue: "bulk",
      market: "BTC-USD",
      observedAt: 2000,
      equity: 990,
      positionQty: -2,
      marginRatio: 0.8,
    });

    const pnl = client.sqlite
      .query<{ net_pnl: number; pnl_per_notional: number }, []>(
        "SELECT net_pnl, pnl_per_notional FROM v_run_pnl WHERE run_id = 'run-views'",
      )
      .get();
    const markout = client.sqlite
      .query<{ markout_5s_bps: number; adverse_5s: number }, []>(
        "SELECT markout_5s_bps, adverse_5s FROM v_fill_markouts WHERE fill_id = 'fill-views'",
      )
      .get();
    const orderQuality = client.sqlite
      .query<{ fill_rate: number; avg_latency_ms: number }, []>(
        "SELECT fill_rate, avg_latency_ms FROM v_order_quality WHERE run_id = 'run-views'",
      )
      .get();
    const inventoryRisk = client.sqlite
      .query<
        {
          max_abs_position: number;
          min_margin_ratio: number;
          equity_drawdown: number;
        },
        []
      >(
        "SELECT max_abs_position, min_margin_ratio, equity_drawdown FROM v_inventory_risk WHERE run_id = 'run-views'",
      )
      .get();
    const performance = client.sqlite
      .query<{ run_id: string; net_pnl: number; avg_markout_5s_bps: number }, []>(
        "SELECT run_id, net_pnl, avg_markout_5s_bps FROM v_run_performance WHERE run_id = 'run-views'",
      )
      .get();
    const viewSql = client.sqlite
      .query<{ sql: string }, []>(
        "SELECT sql FROM sqlite_master WHERE type = 'view' AND name = 'v_fill_markouts'",
      )
      .get();

    expect(pnl?.net_pnl).toBeCloseTo(0.9);
    expect(pnl?.pnl_per_notional).toBeCloseTo(0.9 / 99);
    expect(markout?.markout_5s_bps).toBeCloseTo(202.0202, 4);
    expect(markout?.adverse_5s).toBe(0);
    expect(orderQuality).toEqual({ fill_rate: 1, avg_latency_ms: 50 });
    expect(inventoryRisk).toEqual({
      max_abs_position: 2,
      min_margin_ratio: 0.8,
      equity_drawdown: 10,
    });
    expect(performance?.run_id).toBe("run-views");
    expect(performance?.net_pnl).toBeCloseTo(0.9);
    expect(performance?.avg_markout_5s_bps).toBeCloseTo(202.0202, 4);
    expect(viewSql?.sql.toLowerCase()).toContain("orderbook_snapshots");
    expect(viewSql?.sql.toLowerCase()).not.toContain("ohlcv");
  });

  test("computes order lifecycle and quote competitiveness diagnostics", async () => {
    const client = createSqliteClient(dbPath);
    const repository = new SqliteMetricsRepository(client.db);

    await repository.startRun({
      id: "run-lifecycle",
      mode: "live",
      venue: "bulk",
      market: "BTC-USD",
      capitalMode: "beta_mock",
      strategyName: "avellaneda-stoikov",
      configJson: {},
      gitDirty: false,
      startedAt: 0,
      status: "running",
    });
    await repository.recordOrderbookSnapshot({
      id: "snapshot-lifecycle",
      runId: "run-lifecycle",
      venue: "bulk",
      market: "BTC-USD",
      observedAt: 1000,
      bestBid: 99.95,
      bestAsk: 100.05,
      midPrice: 100,
      microPrice: 100,
      markPrice: 100,
      spreadBps: 10,
      stalenessMs: 0,
    });
    await repository.recordSubmittedOrder({
      id: "order-level-0",
      runId: "run-lifecycle",
      venue: "bulk",
      market: "BTC-USD",
      clientOrderId: "cycle-1:bid:0",
      venueOrderId: "venue-level-0",
      intent: "quote",
      side: "buy",
      orderType: "limit",
      limitPrice: 99.9,
      quantity: 1,
      timeInForce: "GTC",
      submittedAt: 1100,
      acceptedAt: 1150,
      canceledAt: 2100,
      finalStatus: "canceled",
      latencyMs: 50,
    });
    await repository.recordSubmittedOrder({
      id: "order-level-1",
      runId: "run-lifecycle",
      venue: "bulk",
      market: "BTC-USD",
      clientOrderId: "cycle-1:ask:1",
      venueOrderId: "venue-level-1",
      intent: "quote",
      side: "sell",
      orderType: "limit",
      limitPrice: 101.5,
      quantity: 1,
      timeInForce: "GTC",
      submittedAt: 1100,
      acceptedAt: 1160,
      finalStatus: "accepted",
      latencyMs: 60,
    });
    await repository.recordTradeFill({
      id: "fill-level-1",
      runId: "run-lifecycle",
      submittedOrderId: "order-level-1",
      venue: "bulk",
      market: "BTC-USD",
      venueFillId: "fill-level-1",
      venueOrderId: "venue-level-1",
      side: "sell",
      price: 101.5,
      quantity: 1,
      fee: 0.1,
      tradePnl: 1,
      makerTaker: "maker",
      filledAt: 1600,
    });

    const orderQuality = client.sqlite
      .query<
        {
          cancel_rate: number;
          fill_rate: number;
          avg_live_ms: number;
          cancel_before_fill_rate: number;
        },
        []
      >(
        "SELECT cancel_rate, fill_rate, avg_live_ms, cancel_before_fill_rate FROM v_order_quality WHERE run_id = 'run-lifecycle'",
      )
      .get();
    const competitiveness = client.sqlite
      .query<
        {
          quote_level: number;
          distance_to_mid_bps: number;
          distance_to_best_bps: number;
          market_spread_bps: number;
        },
        []
      >(
        "SELECT quote_level, distance_to_mid_bps, distance_to_best_bps, market_spread_bps FROM v_quote_competitiveness WHERE id = 'order-level-0'",
      )
      .get();
    const levelQuality = client.sqlite
      .query<{ quote_level: number; submitted_count: number; fill_rate: number }, []>(
        "SELECT quote_level, submitted_count, fill_rate FROM v_quote_level_quality WHERE run_id = 'run-lifecycle' AND quote_level = 1",
      )
      .get();

    expect(orderQuality?.cancel_rate).toBe(0.5);
    expect(orderQuality?.fill_rate).toBe(0.5);
    expect(orderQuality?.avg_live_ms).toBe(750);
    expect(orderQuality?.cancel_before_fill_rate).toBe(0.5);
    expect(competitiveness?.quote_level).toBe(0);
    expect(competitiveness?.distance_to_mid_bps).toBeCloseTo(10);
    expect(competitiveness?.distance_to_best_bps).toBeCloseTo(5.0025, 4);
    expect(competitiveness?.market_spread_bps).toBe(10);
    expect(levelQuality).toEqual({
      quote_level: 1,
      submitted_count: 1,
      fill_rate: 1,
    });
  });
});
