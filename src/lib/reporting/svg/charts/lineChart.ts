import { autoNumberFormatter, autoTimeFormatter, niceTimeTicks } from "../format.ts";
import { xAxis, yAxis } from "../axis.ts";
import { formatNumber, g, path, polyline, rect, svgRoot, text } from "../primitives.ts";
import { extent, linearScale, niceTicks } from "../scale.ts";
import { theme } from "../theme.ts";

export interface LineChartPoint {
  x: number;
  y: number;
}

export interface LineChartOptions {
  title?: string;
  yLabel?: string;
  xType?: "linear" | "time";
  formatX?: (value: number) => string;
  formatY?: (value: number) => string;
  width?: number;
  height?: number;
  zeroBaseline?: boolean;
  fillBelowBaseline?: boolean;
  color?: string;
  fillColor?: string;
}

export interface ChartOutput {
  svg: string;
  width: number;
  height: number;
}

export function renderLineChart(
  data: ReadonlyArray<LineChartPoint>,
  opts: LineChartOptions = {},
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

  const xs = data.map((point) => point.x);
  const ys = data.map((point) => point.y);
  const xDomain = extent(xs);
  const baseDomain = extent(ys);
  const yDomain = opts.zeroBaseline
    ? { min: Math.min(0, baseDomain.min), max: Math.max(0, baseDomain.max) }
    : baseDomain;

  const xScale = linearScale(xDomain, { start: x0, end: x1 });
  const yScale = linearScale(yDomain, { start: y1, end: y0 });

  const points = data.map((point) => [xScale(point.x), yScale(point.y)] as const);

  const color = opts.color ?? theme.colors.primary;
  const fillColor = opts.fillColor;

  const pathChildren: string[] = [];
  if (fillColor && opts.fillBelowBaseline) {
    const baseline = yScale(0);
    const first = points[0];
    const last = points.at(-1);
    if (first && last) {
      const d = [
        `M${formatNumber(first[0])} ${formatNumber(baseline)}`,
        ...points.map(([x, y]) => `L${formatNumber(x)} ${formatNumber(y)}`),
        `L${formatNumber(last[0])} ${formatNumber(baseline)}`,
        "Z",
      ].join(" ");
      pathChildren.push(path(d, { fill: fillColor, "fill-opacity": 0.6, stroke: "none" }));
    }
  }
  pathChildren.push(
    polyline(points, {
      fill: "none",
      stroke: color,
      "stroke-width": 1.5,
      "stroke-linejoin": "round",
    }),
  );

  const yTicks = niceTicks(yDomain, 5);
  const xTicks = opts.xType === "time" ? niceTimeTicks(xDomain, 6) : niceTicks(xDomain, 6);
  const formatY = opts.formatY ?? autoNumberFormatter(yDomain);
  const formatX =
    opts.formatX ??
    (opts.xType === "time" ? autoTimeFormatter(xDomain) : autoNumberFormatter(xDomain));

  const yLabelNode = opts.yLabel ? renderRotatedYLabel(opts.yLabel, y0, y1) : "";

  const svg = svgRoot(width, height, [
    rect(0, 0, width, height, { fill: theme.colors.background }),
    titleNode,
    yLabelNode,
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
    g({}, pathChildren),
  ]);

  return { svg, width, height };
}

export function renderTitle(title: string | undefined, x: number, top: number): string {
  if (!title) return "";
  return text(x, top - 16, title, {
    "font-size": theme.font.sizeTitle,
    "font-family": theme.font.family,
    fill: theme.colors.text,
    "font-weight": "600",
  });
}

export function emptyChart(width: number, height: number, titleNode: string): ChartOutput {
  return {
    svg: svgRoot(width, height, [
      rect(0, 0, width, height, { fill: theme.colors.background }),
      titleNode,
      text(width / 2, height / 2, "No data", {
        "text-anchor": "middle",
        "font-size": theme.font.sizeAxis,
        "font-family": theme.font.family,
        fill: theme.colors.axis,
      }),
    ]),
    width,
    height,
  };
}

function renderRotatedYLabel(label: string, y0: number, y1: number): string {
  const cy = (y0 + y1) / 2;
  const cx = 14;
  return text(cx, cy, label, {
    "text-anchor": "middle",
    "font-size": theme.font.sizeAxis,
    "font-family": theme.font.family,
    fill: theme.colors.text,
    transform: `rotate(-90 ${cx} ${cy})`,
  });
}
