import { HttpTransport, InfoClient } from "@nktkas/hyperliquid";

import { detectTestnet } from "./detectTestnet.ts";
import type {
  AssetInfo,
  BookLevel,
  BookSnapshot,
  Candle,
  CandleInterval,
  ClearinghouseState,
  OpenOrder,
  UserFill,
} from "./types.ts";
import { SUPPORTED_INTERVALS } from "./types.ts";

function parseBookLevels(levels: Array<{ px: string; sz: string }>): BookLevel[] {
  return levels.map((l) => ({ price: Number(l.px), size: Number(l.sz) }));
}

function toCandleInterval(timeframe: string): CandleInterval {
  if (SUPPORTED_INTERVALS.includes(timeframe as CandleInterval)) {
    return timeframe as CandleInterval;
  }
  throw new Error(`Unsupported Hyperliquid timeframe: ${timeframe}`);
}

export class HyperliquidInfoApi {
  private readonly client: InfoClient;

  constructor(httpUrl: string) {
    this.client = new InfoClient({
      transport: new HttpTransport({
        apiUrl: httpUrl,
        isTestnet: detectTestnet(httpUrl),
      }),
    });
  }

  async getL2Book(coin: string): Promise<BookSnapshot> {
    const raw = await this.client.l2Book({ coin });
    if (!raw) {
      throw new Error(`No order book data for ${coin}`);
    }
    const [rawBids, rawAsks] = raw.levels;
    return {
      coin,
      time: raw.time,
      bids: parseBookLevels(rawBids),
      asks: parseBookLevels(rawAsks),
    };
  }

  async getAllMids(): Promise<Record<string, number>> {
    const raw = await this.client.allMids();
    const result: Record<string, number> = {};
    for (const [key, value] of Object.entries(raw)) {
      result[key] = Number(value);
    }
    return result;
  }

  async getClearinghouseState(user: string): Promise<ClearinghouseState> {
    const raw = await this.client.clearinghouseState({
      user: user as `0x${string}`,
    });
    return {
      accountValue: Number(raw.marginSummary.accountValue),
      totalMarginUsed: Number(raw.marginSummary.totalMarginUsed),
    };
  }

  async getMeta(): Promise<AssetInfo[]> {
    const raw = await this.client.meta();
    return raw.universe.map((a) => ({ name: a.name }));
  }

  async getOpenOrders(user: string): Promise<OpenOrder[]> {
    const raw = await this.client.openOrders({
      user: user as `0x${string}`,
    });
    return raw.map((o) => ({ coin: o.coin, oid: o.oid }));
  }

  async getUserFills(user: string): Promise<UserFill[]> {
    const raw = await this.client.userFills({
      user: user as `0x${string}`,
    });
    return raw.map((f) => ({
      hash: f.hash,
      coin: f.coin,
      side: f.side,
      price: Number(f.px),
      size: Number(f.sz),
      fee: Number(f.fee),
      closedPnl: Number(f.closedPnl),
      time: f.time,
    }));
  }

  async getCandleSnapshot(params: {
    coin: string;
    interval: string;
    startTime: number;
    endTime: number;
  }): Promise<Candle[]> {
    const raw = await this.client.candleSnapshot({
      coin: params.coin,
      interval: toCandleInterval(params.interval),
      startTime: params.startTime,
      endTime: params.endTime,
    });
    return raw.map((c) => ({
      time: c.t,
      open: Number(c.o),
      high: Number(c.h),
      low: Number(c.l),
      close: Number(c.c),
      volume: Number(c.v),
    }));
  }
}
