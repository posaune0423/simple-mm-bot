import type { Database } from "bun:sqlite";

import type { ReportFill } from "../types.ts";

interface FetchReportFillsInput {
  sqlite: Database;
  venue?: string;
  periodStart: number;
  periodEnd: number;
}

interface ReportFillRow {
  id: string;
  venue: string;
  market: string;
  side: ReportFill["side"];
  price: number;
  qty: number;
  fee: number;
  trade_pnl: number;
  filled_at: number;
  quote_id: string | null;
  mark_price_at_fill: number | null;
  mark_price_5s: number | null;
  mark_price_30s: number | null;
  maker_taker: "maker" | "taker" | "unknown" | null;
}

export async function fetchReportFills({
  sqlite,
  venue,
  periodStart,
  periodEnd,
}: FetchReportFillsInput): Promise<ReportFill[]> {
  const venueCondition = venue === undefined ? "" : "AND f.venue = $venue";
  const rows = sqlite
    .query<ReportFillRow, Record<string, string | number | null>>(
      `
        SELECT
          f.id,
          f.venue,
          f.market,
          f.side,
          f.price,
          f.quantity AS qty,
          f.fee,
          f.trade_pnl,
          f.maker_taker,
          f.filled_at,
          f.venue_order_id AS quote_id,
          (
            SELECT s.mid_price
            FROM orderbook_snapshots s
            WHERE s.run_id = f.run_id
              AND s.market = f.market
              AND s.observed_at <= f.filled_at
            ORDER BY s.observed_at DESC
            LIMIT 1
          ) AS mark_price_at_fill,
          m.mid_5s AS mark_price_5s,
          m.mid_30s AS mark_price_30s
        FROM trade_fills f
        LEFT JOIN v_fill_markouts m ON m.fill_id = f.id
        WHERE f.filled_at BETWEEN $periodStart AND $periodEnd
          ${venueCondition}
        ORDER BY f.filled_at ASC, f.id ASC
      `,
    )
    .all({ $periodStart: periodStart, $periodEnd: periodEnd, $venue: venue ?? null });

  return rows.map((row) => ({
    id: row.id,
    venue: row.venue,
    market: row.market,
    side: row.side,
    price: row.price,
    qty: row.qty,
    fee: row.fee,
    tradePnl: row.trade_pnl,
    filledAt: row.filled_at,
    quoteId: row.quote_id ?? undefined,
    markPriceAtFill: row.mark_price_at_fill ?? undefined,
    markPrice5s: row.mark_price_5s ?? undefined,
    markPrice30s: row.mark_price_30s ?? undefined,
    makerTaker: row.maker_taker ?? undefined,
  }));
}
