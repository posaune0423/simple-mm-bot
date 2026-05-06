import { renderLineChart } from "./lineChart.ts";
import type { ChartOutput, LineChartOptions, LineChartPoint } from "./lineChart.ts";
import { theme } from "../theme.ts";

export function renderAreaChart(
  data: ReadonlyArray<LineChartPoint>,
  opts: LineChartOptions = {},
): ChartOutput {
  return renderLineChart(data, {
    ...opts,
    zeroBaseline: opts.zeroBaseline ?? true,
    fillBelowBaseline: true,
    color: opts.color ?? theme.colors.negative,
    fillColor: opts.fillColor ?? theme.colors.drawdown,
  });
}
