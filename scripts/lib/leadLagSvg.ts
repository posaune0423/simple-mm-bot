import type { OhlcvBar } from "./leadLagMath.ts";

export interface LineChartOptions {
  title: string;
  width?: number;
  height?: number;
  padding?: { top: number; right: number; bottom: number; left: number };
  stroke?: string;
  xLabel?: string;
  yLabel?: string;
}

export function svgLineChartTimeSeries(
  bars: OhlcvBar[],
  valueSelector: (b: OhlcvBar) => number,
  options: LineChartOptions,
): string {
  const width = options.width ?? 920;
  const height = options.height ?? 360;
  const pad = options.padding ?? { top: 36, right: 24, bottom: 48, left: 64 };
  const stroke = options.stroke ?? "#2563eb";
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  if (bars.length < 2) {
    return emptySvg(width, height, options.title, "Not enough points");
  }

  const values = bars.map(valueSelector);
  const ts = bars.map((b) => b.ts);
  const tMin = ts[0]!;
  const tMax = ts[ts.length - 1]!;
  const vMin = Math.min(...values);
  const vMax = Math.max(...values);
  const vPad = vMax === vMin ? Math.abs(vMin) * 0.001 || 1 : (vMax - vMin) * 0.04;
  const y0 = vMin - vPad;
  const y1 = vMax + vPad;

  const xScale = (t: number) => pad.left + ((t - tMin) / (tMax - tMin || 1)) * innerW;
  const yScale = (v: number) => pad.top + innerH - ((v - y0) / (y1 - y0 || 1)) * innerH;

  const points = bars.map(
    (b, i) => `${xScale(ts[i]!).toFixed(2)},${yScale(values[i]!).toFixed(2)}`,
  );
  const pathD = `M ${points.join(" L ")}`;

  const xTicks = pickTicks(ts.length, 5).map((i) => i);
  const tickLabels = xTicks
    .map((i) => {
      const t = ts[i]!;
      const x = xScale(t);
      const label = new Date(t).toISOString().replace("T", " ").slice(0, 16);
      return `<text x="${x.toFixed(2)}" y="${height - 12}" font-size="11" text-anchor="middle" fill="#64748b">${escapeXml(label)}</text>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#fafafa"/>
  <text x="${width / 2}" y="22" font-size="16" font-weight="600" text-anchor="middle" fill="#0f172a">${escapeXml(options.title)}</text>
  ${options.yLabel ? `<text transform="translate(16 ${pad.top + innerH / 2}) rotate(-90)" font-size="12" fill="#64748b" text-anchor="middle">${escapeXml(options.yLabel)}</text>` : ""}
  <path d="${pathD}" fill="none" stroke="${stroke}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>
  ${tickLabels}
  <text x="${pad.left}" y="${pad.top - 8}" font-size="11" fill="#64748b">min ${vMin.toFixed(4)} / max ${vMax.toFixed(4)}</text>
</svg>`;
}

/** Two normalized close series (first bar = 100) on one chart. */
export function svgOverlayNormalized(
  labelA: string,
  barsA: OhlcvBar[],
  labelB: string,
  barsB: OhlcvBar[],
  title: string,
): string {
  const width = 920;
  const height = 380;
  const pad = { top: 40, right: 28, bottom: 52, left: 64 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  const aligned = alignTwo(barsA, barsB);
  if (aligned.ts.length < 2) {
    return emptySvg(width, height, title, "Could not align series");
  }

  const baseA = aligned.a[0]!.close;
  const baseB = aligned.b[0]!.close;
  const serA = aligned.a.map((b) => (b.close / baseA) * 100);
  const serB = aligned.b.map((b) => (b.close / baseB) * 100);
  const ts = aligned.ts;
  const tMin = ts[0]!;
  const tMax = ts[ts.length - 1]!;
  const allV = [...serA, ...serB];
  const vMin = Math.min(...allV);
  const vMax = Math.max(...allV);
  const vPad = (vMax - vMin) * 0.05 || 0.1;
  const y0 = vMin - vPad;
  const y1 = vMax + vPad;

  const xScale = (t: number) => pad.left + ((t - tMin) / (tMax - tMin || 1)) * innerW;
  const yScale = (v: number) => pad.top + innerH - ((v - y0) / (y1 - y0 || 1)) * innerH;

  const pathA = serA.map((v, i) => `${xScale(ts[i]!).toFixed(2)},${yScale(v).toFixed(2)}`);
  const pathB = serB.map((v, i) => `${xScale(ts[i]!).toFixed(2)},${yScale(v).toFixed(2)}`);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#fafafa"/>
  <text x="${width / 2}" y="24" font-size="16" font-weight="600" text-anchor="middle" fill="#0f172a">${escapeXml(title)}</text>
  <path d="M ${pathA.join(" L ")}" fill="none" stroke="#2563eb" stroke-width="1.6" stroke-linejoin="round"/>
  <path d="M ${pathB.join(" L ")}" fill="none" stroke="#ea580c" stroke-width="1.6" stroke-linejoin="round"/>
  <g font-size="12">
    <rect x="${width - 200}" y="44" width="12" height="12" fill="#2563eb"/><text x="${width - 182}" y="54" fill="#0f172a">${escapeXml(labelA)}</text>
    <rect x="${width - 200}" y="62" width="12" height="12" fill="#ea580c"/><text x="${width - 182}" y="72" fill="#0f172a">${escapeXml(labelB)}</text>
  </g>
  <text x="${pad.left}" y="${height - 14}" font-size="11" fill="#64748b">Normalized close (first candle = 100)</text>
</svg>`;
}

export function svgLagCorrelationBar(
  lags: { lag: number; correlation: number | null }[],
  title: string,
): string {
  const width = 920;
  const height = 400;
  const pad = { top: 44, right: 24, bottom: 56, left: 56 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const finite = lags.filter((l) => l.correlation !== null) as {
    lag: number;
    correlation: number;
  }[];
  if (finite.length === 0) {
    return emptySvg(width, height, title, "No correlation values");
  }
  const barW = innerW / lags.length;
  const maxAbs = Math.max(...finite.map((l) => Math.abs(l.correlation)), 0.05);
  const yMid = pad.top + innerH / 2;
  const yScale = (c: number) => (c / maxAbs) * (innerH / 2 - 8);

  const bars = lags
    .map((entry, i) => {
      if (entry.correlation === null) {
        return "";
      }
      const x = pad.left + i * barW + barW * 0.15;
      const w = barW * 0.7;
      const h = Math.abs(yScale(entry.correlation));
      const y = entry.correlation >= 0 ? yMid - h : yMid;
      const fill = entry.correlation >= 0 ? "#16a34a" : "#dc2626";
      return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" fill="${fill}" opacity="0.85"/>`;
    })
    .join("\n");

  const xLabelEvery = Math.max(1, Math.ceil(lags.length / 12));
  const labels = lags
    .map((entry, i) => {
      if (i % xLabelEvery !== 0 && i !== lags.length - 1) {
        return "";
      }
      const x = pad.left + i * barW + barW / 2;
      return `<text x="${x.toFixed(2)}" y="${height - 28}" font-size="10" text-anchor="middle" fill="#64748b">${entry.lag}</text>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#fafafa"/>
  <text x="${width / 2}" y="26" font-size="16" font-weight="600" text-anchor="middle" fill="#0f172a">${escapeXml(title)}</text>
  <text x="${width / 2}" y="46" font-size="11" text-anchor="middle" fill="#64748b">τ &gt; 0: Binance return at t vs Bulk return at t+τ (Binance leads when peak is right of center)</text>
  <line x1="${pad.left}" y1="${yMid.toFixed(2)}" x2="${(width - pad.right).toFixed(2)}" y2="${yMid.toFixed(2)}" stroke="#cbd5e1" stroke-width="1"/>
  ${bars}
  ${labels}
  <text x="${pad.left}" y="${height - 10}" font-size="11" fill="#64748b">Lag τ (bars)</text>
</svg>`;
}

function alignTwo(a: OhlcvBar[], b: OhlcvBar[]): { ts: number[]; a: OhlcvBar[]; b: OhlcvBar[] } {
  const mapB = new Map(b.map((bar) => [bar.ts, bar] as const));
  const ts: number[] = [];
  const outA: OhlcvBar[] = [];
  const outB: OhlcvBar[] = [];
  for (const bar of a) {
    const mb = mapB.get(bar.ts);
    if (mb !== undefined) {
      ts.push(bar.ts);
      outA.push(bar);
      outB.push(mb);
    }
  }
  return { ts, a: outA, b: outB };
}

function pickTicks(n: number, count: number): number[] {
  if (n <= 1) {
    return [0];
  }
  const out: number[] = [];
  for (let k = 0; k < count; k += 1) {
    out.push(Math.min(n - 1, Math.floor((k * (n - 1)) / (count - 1 || 1))));
  }
  return [...new Set(out)].sort((x, y) => x - y);
}

function emptySvg(width: number, height: number, title: string, message: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#fafafa"/>
  <text x="${width / 2}" y="${height / 2 - 10}" font-size="16" text-anchor="middle" fill="#0f172a">${escapeXml(title)}</text>
  <text x="${width / 2}" y="${height / 2 + 14}" font-size="13" text-anchor="middle" fill="#64748b">${escapeXml(message)}</text>
</svg>`;
}

function escapeXml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
