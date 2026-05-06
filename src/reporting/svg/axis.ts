import { g, line, text } from "./primitives.ts";
import type { BandScale, LinearScale } from "./scale.ts";
import { theme } from "./theme.ts";

interface XAxisOptions {
  scale: LinearScale;
  ticks: ReadonlyArray<number>;
  y: number;
  x0: number;
  x1: number;
  format?: (value: number) => string;
}

interface YAxisOptions {
  scale: LinearScale;
  ticks: ReadonlyArray<number>;
  x: number;
  y0: number;
  y1: number;
  format?: (value: number) => string;
  gridX0?: number;
  gridX1?: number;
}

interface BandAxisOptions {
  scale: BandScale;
  y: number;
  x0: number;
  x1: number;
  every?: number;
}

export function xAxis(opts: XAxisOptions): string {
  const { scale, ticks, y, x0, x1, format = String } = opts;
  const baseline = line(x0, y, x1, y, { stroke: theme.colors.axis, "stroke-width": 1 });
  const labels = ticks.map((tick) =>
    g({}, [
      line(scale(tick), y, scale(tick), y + 4, { stroke: theme.colors.axis, "stroke-width": 1 }),
      text(scale(tick), y + 16, format(tick), {
        "text-anchor": "middle",
        "font-size": theme.font.sizeAxis,
        "font-family": theme.font.family,
        fill: theme.colors.text,
      }),
    ]),
  );
  return g({}, [baseline, ...labels]);
}

export function yAxis(opts: YAxisOptions): string {
  const { scale, ticks, x, y0, y1, format = String, gridX0, gridX1 } = opts;
  const baseline = line(x, y0, x, y1, { stroke: theme.colors.axis, "stroke-width": 1 });
  const items = ticks.map((tick) => {
    const yPos = scale(tick);
    const grid =
      gridX0 !== undefined && gridX1 !== undefined
        ? line(gridX0, yPos, gridX1, yPos, {
            stroke: theme.colors.grid,
            "stroke-width": 1,
            "stroke-dasharray": "2 2",
          })
        : "";
    return g({}, [
      grid,
      line(x - 4, yPos, x, yPos, { stroke: theme.colors.axis, "stroke-width": 1 }),
      text(x - 8, yPos + 4, format(tick), {
        "text-anchor": "end",
        "font-size": theme.font.sizeAxis,
        "font-family": theme.font.family,
        fill: theme.colors.text,
      }),
    ]);
  });
  return g({}, [baseline, ...items]);
}

export function bandAxis(opts: BandAxisOptions): string {
  const { scale, y, x0, x1, every = 1 } = opts;
  const baseline = line(x0, y, x1, y, { stroke: theme.colors.axis, "stroke-width": 1 });
  const labels = scale.domain
    .map((key, index) => {
      if (index % every !== 0) return "";
      const x = scale(key) + scale.bandwidth / 2;
      return text(x, y + 16, key, {
        "text-anchor": "middle",
        "font-size": theme.font.sizeAxis,
        "font-family": theme.font.family,
        fill: theme.colors.text,
      });
    })
    .filter((value) => value.length > 0);
  return g({}, [baseline, ...labels]);
}
