import { autoNumberFormatter } from "../format.ts";
import { xAxis, yAxis } from "../axis.ts";
import { circle, g, line, rect, svgRoot } from "../primitives.ts";
import { extent, linearScale, niceTicks } from "../scale.ts";
import { theme } from "../theme.ts";
import type { ChartOutput } from "./lineChart.ts";
import { emptyChart, renderTitle } from "./lineChart.ts";

interface ScatterPoint {
  x: number;
  y: number;
}

interface ScatterChartOptions {
  title?: string;
  width?: number;
  height?: number;
  formatX?: (value: number) => string;
  formatY?: (value: number) => string;
  color?: string;
  showDiagonal?: boolean;
}

export function renderScatterChart(
  data: ReadonlyArray<ScatterPoint>,
  opts: ScatterChartOptions = {},
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

  const xs = data.map((p) => p.x);
  const ys = data.map((p) => p.y);
  const xDomain = extent(xs);
  const yDomain = extent(ys);
  const xScale = linearScale(xDomain, { start: x0, end: x1 });
  const yScale = linearScale(yDomain, { start: y1, end: y0 });

  const color = opts.color ?? theme.colors.scatter;
  const points = data.map((p) =>
    circle(xScale(p.x), yScale(p.y), 2.5, { fill: color, "fill-opacity": 0.55 }),
  );

  const diagonal = opts.showDiagonal ? renderDiagonal(xDomain, yDomain, xScale, yScale) : "";

  const xTicks = niceTicks(xDomain, 6);
  const yTicks = niceTicks(yDomain, 5);
  const formatX = opts.formatX ?? autoNumberFormatter(xDomain);
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
    xAxis({ scale: xScale, ticks: xTicks, y: y1, x0, x1, format: formatX }),
    diagonal,
    g({}, points),
  ]);

  return { svg, width, height };
}

function renderDiagonal(
  xDomain: { min: number; max: number },
  yDomain: { min: number; max: number },
  xScale: (value: number) => number,
  yScale: (value: number) => number,
): string {
  const lo = Math.max(xDomain.min, yDomain.min);
  const hi = Math.min(xDomain.max, yDomain.max);
  if (lo >= hi) return "";
  return line(xScale(lo), yScale(lo), xScale(hi), yScale(hi), {
    stroke: theme.colors.axis,
    "stroke-width": 1,
    "stroke-dasharray": "3 3",
  });
}
