import { eq } from "drizzle-orm";

import type {
  AccountStateObservationFact,
  IMetricsRepository,
  OrderLifecycleEventFact,
  OrderbookSnapshotFact,
  QuoteDecisionFact,
  SubmittedOrderFact,
  TradeFillFact,
  TradingRunFact,
} from "../../../../domain/ports/IMetricsRepository.ts";
import {
  botFillsTable,
  botMarketObservationsTable,
  botOrdersTable,
  botQuoteDecisionsTable,
  botRunsTable,
} from "../schema.ts";

type PostgresDb = ReturnType<typeof import("../client.ts").createPostgresClient>["db"];
type BotRunRow = typeof botRunsTable.$inferSelect;

export class PostgresMetricsRepository implements IMetricsRepository {
  constructor(private readonly db: PostgresDb) {}

  async startRun(run: TradingRunFact): Promise<void> {
    const row = serializeRun(run);
    await this.db.insert(botRunsTable).values(row).onConflictDoUpdate({
      target: botRunsTable.id,
      set: row,
    });
  }

  async finishRun(
    runId: string,
    endedAt: number,
    status: TradingRunFact["status"],
    stopReason?: string,
  ): Promise<void> {
    await this.db
      .update(botRunsTable)
      .set({ endedAt, status, stopReason })
      .where(eq(botRunsTable.id, runId));
  }

  async recordOrderbookSnapshot(snapshot: OrderbookSnapshotFact): Promise<void> {
    const row = {
      id: snapshot.id,
      runId: snapshot.runId,
      observedAt: snapshot.observedAt,
      venue: snapshot.venue,
      symbol: snapshot.market,
      localMid: snapshot.midPrice,
      localMicro: snapshot.microPrice,
      localVamp: snapshot.vampPrice,
      markPrice: snapshot.markPrice,
      contextJson: stringifyOptional({
        bestBid: snapshot.bestBid,
        bestAsk: snapshot.bestAsk,
        spreadBps: snapshot.spreadBps,
        stalenessMs: snapshot.stalenessMs,
        rawJson: snapshot.rawJson,
      }),
    } satisfies typeof botMarketObservationsTable.$inferInsert;
    await this.db.insert(botMarketObservationsTable).values(row).onConflictDoNothing();
  }

  async recordSubmittedOrder(order: SubmittedOrderFact): Promise<void> {
    const row = {
      id: order.id,
      runId: order.runId,
      createdAt: order.submittedAt,
      submittedAt: order.submittedAt,
      acceptedAt: order.acceptedAt,
      canceledAt: order.canceledAt,
      rejectedAt: order.rejectedAt,
      venue: order.venue,
      symbol: order.market,
      clientOrderId: order.clientOrderId,
      venueOrderId: order.venueOrderId,
      side: order.side,
      orderType: order.orderType,
      price: order.limitPrice,
      quantity: order.quantity,
      timeInForce: order.timeInForce,
      status: order.finalStatus,
      reason: order.rejectReason,
      latencyMs: order.latencyMs,
      rawJson: stringifyOptional({ intent: order.intent, rawJson: order.rawJson }),
    } satisfies typeof botOrdersTable.$inferInsert;
    await this.db
      .insert(botOrdersTable)
      .values(row)
      .onConflictDoUpdate({
        target: [botOrdersTable.id, botOrdersTable.createdAt],
        set: {
          runId: row.runId,
          submittedAt: row.submittedAt,
          acceptedAt: row.acceptedAt,
          canceledAt: row.canceledAt,
          rejectedAt: row.rejectedAt,
          venue: row.venue,
          symbol: row.symbol,
          clientOrderId: row.clientOrderId,
          venueOrderId: row.venueOrderId,
          side: row.side,
          orderType: row.orderType,
          price: row.price,
          quantity: row.quantity,
          timeInForce: row.timeInForce,
          status: row.status,
          reason: row.reason,
          latencyMs: row.latencyMs,
          rawJson: row.rawJson,
        },
      });
  }

  async recordTradeFill(fill: TradeFillFact): Promise<void> {
    const row = {
      id: fill.id,
      runId: fill.runId,
      orderId: fill.submittedOrderId,
      venue: fill.venue,
      symbol: fill.market,
      venueFillId: fill.venueFillId,
      venueOrderId: fill.venueOrderId,
      filledAt: fill.filledAt,
      side: fill.side,
      price: fill.price,
      quantity: fill.quantity,
      fee: fill.fee,
      liquidity: fill.makerTaker,
      rawJson: stringifyOptional({ tradePnl: fill.tradePnl, rawJson: fill.rawJson }),
    } satisfies typeof botFillsTable.$inferInsert;
    await this.db.insert(botFillsTable).values(row).onConflictDoNothing();
  }

  async recordAccountStateObservation(observation: AccountStateObservationFact): Promise<void> {
    const row = {
      id: observation.id,
      runId: observation.runId,
      observedAt: observation.observedAt,
      venue: observation.venue,
      symbol: observation.market,
      positionQty: observation.positionQty,
      contextJson: stringifyOptional({
        balance: observation.balance,
        equity: observation.equity,
        realizedPnl: observation.realizedPnl,
        unrealizedPnl: observation.unrealizedPnl,
        marginRatio: observation.marginRatio,
        rawJson: observation.rawJson,
      }),
    } satisfies typeof botMarketObservationsTable.$inferInsert;
    await this.db.insert(botMarketObservationsTable).values(row).onConflictDoNothing();
  }

  async recordQuoteDecision(decision: QuoteDecisionFact): Promise<void> {
    const row = {
      id: decision.id,
      runId: decision.runId,
      decidedAt: decision.createdAt,
      quoteCycleId: decision.quoteCycleId,
      venue: decision.venue,
      symbol: decision.market,
      fairPrice: decision.fairPrice,
      referencePrice: decision.markPrice,
      sigma: decision.sigma,
      inventoryQty: decision.positionQty,
      bidPrice: decision.side === "buy" ? decision.price : undefined,
      bidSize: decision.side === "buy" ? decision.quantity : undefined,
      askPrice: decision.side === "sell" ? decision.price : undefined,
      askSize: decision.side === "sell" ? decision.quantity : undefined,
      bidEnabled: decision.side === "buy",
      askEnabled: decision.side === "sell",
      spreadBps: decision.spreadBps,
      reason: decision.intent,
      decisionJson: stringifyOptional({
        side: decision.side,
        level: decision.level,
        policy: decision.policy,
        microPrice: decision.microPrice,
        stalenessMs: decision.stalenessMs,
        controlReasons: decision.controlReasons,
        rawJson: decision.rawJson,
      }),
    } satisfies typeof botQuoteDecisionsTable.$inferInsert;
    await this.db.insert(botQuoteDecisionsTable).values(row).onConflictDoNothing();
  }

  async recordOrderLifecycleEvent(event: OrderLifecycleEventFact): Promise<void> {
    const row = {
      id: event.id,
      runId: event.runId,
      createdAt: event.observedAt,
      venue: event.venue,
      symbol: event.market,
      clientOrderId: event.clientOrderId,
      venueOrderId: event.venueOrderId,
      side: event.side ?? "buy",
      orderType: event.orderType ?? "limit",
      price: event.price,
      quantity: event.quantity ?? 0,
      timeInForce: event.timeInForce,
      status: event.status ?? event.action,
      latencyMs: event.latencyMs,
      rawJson: stringifyOptional({ intent: event.intent, rawJson: event.rawJson }),
    } satisfies typeof botOrdersTable.$inferInsert;
    await this.db.insert(botOrdersTable).values(row).onConflictDoNothing();
  }

  async findRun(runId: string): Promise<TradingRunFact | null> {
    const rows = await this.db
      .select()
      .from(botRunsTable)
      .where(eq(botRunsTable.id, runId))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : deserializeRun(row);
  }
}

function serializeRun(run: TradingRunFact): typeof botRunsTable.$inferInsert {
  const configJson = JSON.stringify(run.configJson);
  return {
    id: run.id,
    mode: run.mode,
    venue: run.venue,
    symbol: run.market,
    strategyName: run.strategyName,
    configHash: String(Bun.hash(configJson)),
    configJson,
    gitSha: run.gitSha,
    gitDirty: run.gitDirty,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    status: run.status,
    stopReason: run.stopReason,
    metadataJson: stringifyOptional({ capitalMode: run.capitalMode }),
  };
}

function deserializeRun(row: BotRunRow): TradingRunFact {
  const metadata = parseMetadata(row.metadataJson);
  return {
    id: row.id,
    mode: row.mode as TradingRunFact["mode"],
    venue: row.venue,
    market: row.symbol,
    capitalMode: metadata.capitalMode,
    strategyName: row.strategyName,
    configJson: JSON.parse(row.configJson),
    gitSha: row.gitSha ?? undefined,
    gitDirty: row.gitDirty,
    startedAt: row.startedAt,
    endedAt: row.endedAt ?? undefined,
    status: row.status as TradingRunFact["status"],
    stopReason: row.stopReason ?? undefined,
  };
}

function parseMetadata(value: string | null): { capitalMode: TradingRunFact["capitalMode"] } {
  if (value === null) {
    return { capitalMode: "real" };
  }
  const parsed = JSON.parse(value) as Partial<{ capitalMode: TradingRunFact["capitalMode"] }>;
  return { capitalMode: parsed.capitalMode ?? "real" };
}

function stringifyOptional(value: unknown): string | undefined {
  return value === undefined ? undefined : JSON.stringify(value);
}
