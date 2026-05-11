import type { OhlcvBar } from "./leadLagMath.ts";

const BINANCE_ACCOUNT = "https://api.binance.com/api/v3/account";

/**
 * Verifies Binance API key + secret with a signed `GET /api/v3/account` call.
 * The key must allow "Read" (spot account) for this check; klines remain public.
 */
export async function verifyBinanceCredentials(apiKey: string, apiSecret: string): Promise<void> {
  const timestamp = Date.now();
  const query = `timestamp=${timestamp}`;
  const signature = await hmacSha256Hex(apiSecret, query);
  const url = `${BINANCE_ACCOUNT}?${query}&signature=${signature}`;
  const res = await fetch(url, { headers: { "X-MBX-APIKEY": apiKey } });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Binance API credential check failed (HTTP ${res.status}). Ensure the key has read permission and IP allowlist matches: ${text}`,
    );
  }
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return bufferToHex(sig);
}

function bufferToHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let hex = "";
  for (let i = 0; i < bytes.length; i += 1) {
    hex += bytes[i]!.toString(16).padStart(2, "0");
  }
  return hex;
}

interface BinanceKlineFetchParams {
  symbol: string;
  interval: string;
  startTime: number;
  endTime: number;
  apiKey?: string;
}

const BINANCE_KLINES = "https://api.binance.com/api/v3/klines";

/**
 * Fetches spot klines from Binance (public endpoint). Optional `apiKey` sets
 * `X-MBX-APIKEY` for higher rate-limit weight where applicable.
 */
export async function fetchBinanceKlines(params: BinanceKlineFetchParams): Promise<OhlcvBar[]> {
  const { symbol, interval, startTime, endTime, apiKey } = params;
  const all: OhlcvBar[] = [];
  let cursor = startTime;
  const limit = 1000;

  while (cursor < endTime) {
    const url = new URL(BINANCE_KLINES);
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("interval", interval);
    url.searchParams.set("startTime", String(cursor));
    url.searchParams.set("endTime", String(endTime));
    url.searchParams.set("limit", String(limit));

    const headers: Record<string, string> = {};
    if (apiKey !== undefined && apiKey.length > 0) {
      headers["X-MBX-APIKEY"] = apiKey;
    }

    const res = await fetch(url.toString(), { headers });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Binance klines HTTP ${res.status}: ${text}`);
    }
    const raw = await res.json();
    if (!Array.isArray(raw) || raw.length === 0) {
      break;
    }

    for (const row of raw) {
      if (!Array.isArray(row) || row.length < 6) {
        continue;
      }
      const ts = Number(row[0]);
      const open = Number(row[1]);
      const high = Number(row[2]);
      const low = Number(row[3]);
      const close = Number(row[4]);
      const volume = Number(row[5]);
      if (
        !Number.isFinite(ts) ||
        !Number.isFinite(open) ||
        !Number.isFinite(high) ||
        !Number.isFinite(low) ||
        !Number.isFinite(close) ||
        !Number.isFinite(volume)
      ) {
        continue;
      }
      if (ts >= startTime && ts <= endTime) {
        all.push({ ts, open, high, low, close, volume });
      }
    }

    const lastTs = Number((raw[raw.length - 1] as unknown[])[0]);
    if (!Number.isFinite(lastTs)) {
      break;
    }
    cursor = lastTs + 1;
    if (raw.length < limit) {
      break;
    }
  }

  all.sort((a, b) => a.ts - b.ts);
  return dedupeByTs(all);
}

function dedupeByTs(bars: OhlcvBar[]): OhlcvBar[] {
  const seen = new Set<number>();
  const out: OhlcvBar[] = [];
  for (const bar of bars) {
    if (seen.has(bar.ts)) {
      continue;
    }
    seen.add(bar.ts);
    out.push(bar);
  }
  return out;
}
