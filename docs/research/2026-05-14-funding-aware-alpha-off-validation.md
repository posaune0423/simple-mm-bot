# Funding-Aware MM Alpha-Off Validation

Date: 2026-05-14

Sources:

- https://arxiv.org/abs/2605.06405
- https://arxiv.org/pdf/2605.06405

## Objective

This validation keeps alpha disabled and checks that the funding-aware strategy follows the paper before comparing it with the current simple PMM baseline.

## Paper Alignment

The implementation maps the paper's funding term as a cash carry adjustment:

- Paper sign convention: a long position pays when funding is positive and receives when funding is negative.
- Strategy signal conversion: `expectedFundingBps = fundingRateBps * holdingHorizonSec / rateHorizonSec`.
- Quote model carry term: `fundingCarrySkew = fair * expectedFundingBps / 10000`.
- Reservation price: `fair - inventorySkew - fundingCarrySkew`.

This means positive funding lowers both bid and ask around the adjusted reservation price, while negative funding raises them. Basis is recorded as a diagnostic signal only. With alpha disabled, target inventory stays neutral at zero, matching the paper's symmetric inventory penalty rather than adding a basis/funding-driven target inventory.

Clean Architecture boundaries:

- Domain strategy depends on `AlphaDriftProvider` port for optional alpha drift injection in tests.
- Quote construction exits through existing value-object boundaries: `Price`, `BasisPoints`, and `ModelQuote`.

## Test Evidence

Commands run:

```bash
bun test tests/unit/domain/FundingAwareQuoteModel.test.ts tests/unit/domain/FundingAwarePmmStrategy.test.ts tests/unit/architecture/refactor-boundaries.test.ts
bun test tests/unit/domain/FundingAwareQuoteModel.test.ts tests/unit/domain/FundingAwarePmmStrategy.test.ts tests/unit/application/QuoteModelFactory.test.ts tests/unit/application/StrategyFactory.test.ts tests/unit/config.test.ts tests/integration/application/DIContainer.bulk.test.ts tests/unit/architecture/refactor-boundaries.test.ts
bun run test
bun run check
bun run format:check
```

Results:

- Focused funding/architecture tests: 26 pass, 0 fail.
- Config/factory/DI/funding suite: 51 pass, 0 fail.
- Full suite: unit 366 pass, integration 30 pass.
- `bun run check`: no warnings, lint errors, or type errors.
- `bun run format:check`: all 257 files formatted.

## Backtest/Paper Comparison

Window: 2026-05-08 to 2026-05-13, paper duration 1 minute.

| Strategy                |                                                        Result Path | Backtest Net PnL | Backtest Max DD | Backtest Fill Rate | Paper Net PnL | Paper Max DD | Paper Fill Rate |
| ----------------------- | -----------------------------------------------------------------: | ---------------: | --------------: | -----------------: | ------------: | -----------: | --------------: |
| PMM baseline            | `data/strategy-runs/20260514-005507-pmm-baseline-paper-alpha-off/` |       37597.4165 |        138.3550 |             0.5695 |       15.2431 |       0.6754 |          0.2174 |
| Funding-aware alpha-off |      `data/strategy-runs/20260514-012912-funding-aware-alpha-off/` |       37597.4165 |        134.3376 |             0.5695 |        5.2788 |       1.3511 |          0.1481 |

Both runs completed without runtime errors. In this short alpha-off comparison, funding-aware matches baseline backtest net/trade PnL and slightly improves backtest drawdown, but underperforms the PMM baseline in the 1-minute paper segment on net PnL and fill rate.

## Verdict

```text
verdict:
  pmm: stronger short paper result in this run
  funding-aware: paper-aligned and runnable, but not selected on 1-minute paper performance
selected: pmm for now
reason: funding-aware alpha-off is validated against the paper and runs, but the short paper result has lower net PnL and fill rate than baseline
blocked_by: longer paper canary and live funding/oracle/index coverage before relying on funding-aware edge
next_params: keep alpha disabled; do not increase size; test longer paper window before tuning
next_live_window: not run in this validation
```
