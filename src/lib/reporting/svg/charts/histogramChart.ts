import type { HistogramBin } from "../../metrics/histogram.ts";
import { autoNumberFormatter } from "../format.ts";
import { xAxis, yAxis } from "../axis.ts";
import { g, rect, svgRoot } from "../primitives.ts";
import { linearScale, niceTicks } from "../scale.ts";
import { theme } from "../theme.ts";
import type { ChartOutput } from "./lineChart.ts";
import { emptyChart, layoutChartFrame } from "./lineChart.ts";

interface HistogramChartOptions {
  title?: string;
  width?: number;
  height?: number;
  formatX?: (value: number) => string;
  xSuffix?: string;
  color?: string;
}

export function renderHistogramChart(
  bins: ReadonlyArray<HistogramBin>,
  opts: HistogramChartOptions = {},
): ChartOutput {
  const { width, height, x0, x1, y0, y1, titleNode } = layoutChartFrame(opts);

  if (bins.length === 0) return emptyChart(width, height, titleNode);

  const lo = bins[0]?.lo ?? 0;
  const hi = bins.at(-1)?.hi ?? 1;
  const xDomain = { min: lo, max: hi };
  const maxCount = bins.reduce((max, bin) => Math.max(max, bin.count), 0);
  const xScale = linearScale(xDomain, { start: x0, end: x1 });
  const yDomainMax = maxCount === 0 ? 1 : maxCount;
  const yScale = linearScale({ min: 0, max: yDomainMax }, { start: y1, end: y0 });

  const color = opts.color ?? theme.colors.primary;

  const bars = bins.map((bin) => {
    const xa = xScale(bin.lo);
    const xb = xScale(bin.hi);
    const ya = yScale(bin.count);
    const w = Math.max(0, xb - xa - 1);
    const h = Math.max(0, y1 - ya);
    return rect(xa, ya, w, h, { fill: color, opacity: 0.85 });
  });

  const xTicks = niceTicks(xDomain, 6);
  const yTicks = niceTicks({ min: 0, max: yDomainMax }, 4);
  const formatX = opts.formatX ?? autoNumberFormatter(xDomain, opts.xSuffix ?? "");

  const svg = svgRoot(width, height, [
    rect(0, 0, width, height, { fill: theme.colors.background }),
    titleNode,
    yAxis({
      scale: yScale,
      ticks: yTicks,
      x: x0,
      y0,
      y1,
      gridX0: x0,
      gridX1: x1,
      format: (value) => String(Math.round(value)),
    }),
    xAxis({ scale: xScale, ticks: xTicks, y: y1, x0, x1, format: formatX }),
    g({}, bars),
  ]);

  return { svg, width, height };
}
