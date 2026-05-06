import { autoNumberFormatter } from "../format.ts";
import { bandAxis, yAxis } from "../axis.ts";
import { g, rect, svgRoot, text } from "../primitives.ts";
import { bandScale, linearScale, niceTicks } from "../scale.ts";
import { theme } from "../theme.ts";
import type { ChartOutput } from "./lineChart.ts";
import { emptyChart, renderTitle } from "./lineChart.ts";

interface GroupedBarSeries {
  name: string;
  color: string;
  values: ReadonlyArray<number>;
}

interface GroupedBarChartOptions {
  title?: string;
  width?: number;
  height?: number;
  formatY?: (value: number) => string;
  every?: number;
}

export function renderGroupedBarChart(
  categories: ReadonlyArray<string>,
  series: ReadonlyArray<GroupedBarSeries>,
  opts: GroupedBarChartOptions = {},
): ChartOutput {
  const width = opts.width ?? theme.layout.width;
  const height = opts.height ?? theme.layout.height;
  const padding = theme.layout.padding;
  const x0 = padding.left;
  const x1 = width - padding.right;
  const y0 = padding.top + 16;
  const y1 = height - padding.bottom;

  const titleNode = renderTitle(opts.title, x0, padding.top);

  const allValues = series.flatMap((s) => Array.from(s.values));
  if (categories.length === 0 || allValues.length === 0) {
    return emptyChart(width, height, titleNode);
  }

  let minVal = Math.min(0, ...allValues);
  let maxVal = Math.max(0, ...allValues);
  if (minVal === maxVal) {
    if (minVal === 0) maxVal = 1;
    else {
      const pad = Math.abs(minVal) * 0.1;
      minVal -= pad;
      maxVal += pad;
    }
  }
  const yDomain = { min: minVal, max: maxVal };

  const groupScale = bandScale(categories, { start: x0, end: x1 }, 0.2);
  const subScale = bandScale(
    series.map((s) => s.name),
    { start: 0, end: groupScale.bandwidth },
    0.05,
  );
  const yScale = linearScale(yDomain, { start: y1, end: y0 });
  const baseline = yScale(0);

  const bars: string[] = [];
  for (const s of series) {
    for (let i = 0; i < categories.length; i += 1) {
      const category = categories[i];
      if (category === undefined) continue;
      const value = s.values[i] ?? 0;
      const yPos = yScale(value);
      const top = Math.min(baseline, yPos);
      const h = Math.abs(baseline - yPos);
      const x = groupScale(category) + subScale(s.name);
      bars.push(rect(x, top, subScale.bandwidth, h, { fill: s.color, opacity: 0.9 }));
    }
  }

  const legend = series.map((s, index) =>
    g({ transform: `translate(${x0 + index * 96}, ${padding.top - 4})` }, [
      rect(0, -8, 10, 10, { fill: s.color }),
      text(14, 1, s.name, {
        "font-size": theme.font.sizeAxis,
        "font-family": theme.font.family,
        fill: theme.colors.text,
      }),
    ]),
  );

  const yTicks = niceTicks(yDomain, 4);
  const formatY = opts.formatY ?? autoNumberFormatter(yDomain);

  const svg = svgRoot(width, height, [
    rect(0, 0, width, height, { fill: theme.colors.background }),
    titleNode,
    g({}, legend),
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
    bandAxis({ scale: groupScale, y: y1, x0, x1, every: opts.every ?? 1 }),
    g({}, bars),
  ]);

  return { svg, width, height };
}
