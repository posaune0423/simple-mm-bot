import { generateCoverageSummary } from "./lib/CoverageSummary.ts";

if (import.meta.main) {
  await generateCoverageSummary();
}
