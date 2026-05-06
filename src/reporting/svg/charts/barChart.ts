import { autoNumberFormatter } from "../format.ts";
import { bandAxis, xAxis, yAxis } from "../axis.ts";
import { g, rect, svgRoot, text } from "../primitives.ts";
import { bandScale, linearScale, niceTicks } from "../scale.ts";
import { theme } from "../theme.ts";
import type { ChartOutput } from "./lineChart.ts";
import { emptyChart, renderTitle } from "./lineChart.ts";

interface BarChartDatum {
  category: string;
  value: number;
}

interface BarChartOptions {
  title?: string;
  width?: number;
  height?: number;
  formatY?: (value: number) => string;
  color?: string;
  positiveColor?: string;
  negativeColor?: string;
  every?: number;
  horizontal?: boolean;
}

export function renderBarChart(
  data: ReadonlyArray<BarChartDatum>,
  opts: BarChartOptions = {},
): ChartOutput {
  if (opts.horizontal) return renderHorizontalBarChart(data, opts);
  return renderVerticalBarChart(data, opts);
}

function paddedDomain(values: ReadonlyArray<number>): { min: number; max: number } {
  let min = Math.min(0, ...values);
  let max = Math.max(0, ...values);
  if (min === max) {
    if (min === 0) {
      max = 1;
    } else {
      const pad = Math.abs(min) * 0.1;
      min -= pad;
      max += pad;
    }
  }
  return { min, max };
}

function renderVerticalBarChart(
  data: ReadonlyArray<BarChartDatum>,
  opts: BarChartOptions,
): ChartOutput {
  const width = opts.width ?? theme.layout.width;
  const height = opts.height ?? theme.layout.height;
  const padding = theme.layout.padding;
  const x0 = padding.left;
  const x1 = width - padding.right;
  const y0 = padding.top;
  const y1 = height - padding.bottom;

  const titleNode = renderTitle(opts.title, x0, padding.top);

  if (data.length === 0) return emptyChart(width, height, titleNode);

  const categories = data.map((d) => d.category);
  const values = data.map((d) => d.value);
  const yDomain = paddedDomain(values);
  const xScale = bandScale(categories, { start: x0, end: x1 }, 0.2);
  const yScale = linearScale(yDomain, { start: y1, end: y0 });
  const baseline = yScale(0);

  const bars = data.map((d) => {
    const yPos = yScale(d.value);
    const top = Math.min(baseline, yPos);
    const h = Math.abs(baseline - yPos);
    const fill = pickColor(d.value, opts);
    return rect(xScale(d.category), top, xScale.bandwidth, h, { fill, opacity: 0.9 });
  });

  const yTicks = niceTicks(yDomain, 4);
  const formatY = opts.formatY ?? autoNumberFormatter(yDomain);

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
      format: formatY,
    }),
    bandAxis({ scale: xScale, y: y1, x0, x1, every: opts.every ?? 1 }),
    g({}, bars),
  ]);

  return { svg, width, height };
}

function renderHorizontalBarChart(
  data: ReadonlyArray<BarChartDatum>,
  opts: BarChartOptions,
): ChartOutput {
  const width = opts.width ?? theme.layout.width;
  const height = opts.height ?? theme.layout.height;
  const padding = { ...theme.layout.padding, left: 96 };
  const x0 = padding.left;
  const x1 = width - padding.right;
  const y0 = padding.top;
  const y1 = height - padding.bottom;

  const titleNode = renderTitle(opts.title, x0, padding.top);

  if (data.length === 0) return emptyChart(width, height, titleNode);

  const categories = data.map((d) => d.category);
  const values = data.map((d) => d.value);
  const xDomain = paddedDomain(values);
  const xScale = linearScale(xDomain, { start: x0, end: x1 });
  const yScale = bandScale(categories, { start: y0, end: y1 }, 0.25);
  const baseline = xScale(0);

  const color = opts.color ?? theme.colors.primary;
  const bars = data.map((d) => {
    const xPos = xScale(d.value);
    const left = Math.min(baseline, xPos);
    const w = Math.abs(baseline - xPos);
    return rect(left, yScale(d.category), w, yScale.bandwidth, { fill: color, opacity: 0.9 });
  });

  const labels = data.map((d) =>
    text(x0 - 8, yScale(d.category) + yScale.bandwidth / 2 + 4, d.category, {
      "text-anchor": "end",
      "font-size": theme.font.sizeAxis,
      "font-family": theme.font.family,
      fill: theme.colors.text,
    }),
  );

  const xTicks = niceTicks(xDomain, 5);
  const formatX = opts.formatY ?? autoNumberFormatter(xDomain);

  const svg = svgRoot(width, height, [
    rect(0, 0, width, height, { fill: theme.colors.background }),
    titleNode,
    yAxis({
      scale: linearScale({ min: 0, max: 1 }, { start: y0, end: y0 }),
      ticks: [],
      x: x0,
      y0,
      y1,
    }),
    xAxis({ scale: xScale, ticks: xTicks, y: y1, x0, x1, format: formatX }),
    g({}, bars),
    g({}, labels),
  ]);

  return { svg, width, height };
}

function pickColor(value: number, opts: BarChartOptions): string {
  if (opts.positiveColor && value >= 0) return opts.positiveColor;
  if (opts.negativeColor && value < 0) return opts.negativeColor;
  return opts.color ?? theme.colors.primary;
}
