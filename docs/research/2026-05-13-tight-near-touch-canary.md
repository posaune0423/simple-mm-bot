# 2026-05-13 Bulk BTC-USD Tight Near-Touch Canary

## Objective

Preserve `config/bulk/beta.yml` as the wide-spread profile and test a separate
tight-spread candidate through backtest, preflight, and a small live canary.

## Candidates

Configs:

- `config/bulk/tight-near-touch.yml`
- `config/bulk/tight-near-touch-micro.yml`
- `config/bulk/tight-near-touch-maker.yml`
- `config/bulk/tight-near-touch-inner-maker.yml`

Main differences from `beta.yml`:

- `minSpreadBps: 2.0`
- levels: `1.5 / 3.0 / 5.0` bps
- max position: `0.35 BTC`
- reduce trigger / target: `0.25 / 0.05 BTC`
- max resting: `1800ms`
- smaller notional: `$3000` per level, `askSizeMultiplier: 0.35`

The micro variant keeps the same near-touch hypothesis but reduces the test
surface:

- levels: `1.5 / 3.0` bps
- max position: `0.08 BTC`
- reduce trigger / target: `0.05 / 0.01 BTC`
- max resting: `900ms`
- `$1000` per level, `budgetUsd: 3000`

The maker variant uses the same small quote/risk surface as the micro variant,
but sets `shutdown.closePositionPolicy: emergency_only` so a normal canary stop
does not add shutdown market-close fills to the same telemetry run. If it ends
with inventory, flatten manually after metrics are collected.

All candidates target the historical tight-spread `1-3 bps from best` bucket,
not the `<1 bps` touch bucket.

## Backtest Smoke

Window: `2026-05-12T10:13:41.000Z` to `2026-05-12T12:38:01.000Z`

| config                             | output                                                                      |    net PnL |        notional |  fill rate | max drawdown | max abs position |
| ---------------------------------- | --------------------------------------------------------------------------- | ---------: | --------------: | ---------: | -----------: | ---------------: |
| `config/bulk/beta.yml`             | `data/strategy-runs/20260513-081712-tight-baseline-20260512`                | `$701.997` | `$2,340,323.83` |  `43.682%` |    `$35.927` |   `1.189019 BTC` |
| `tight-touch-canary.yml`           | `data/strategy-runs/20260513-081812-tight-touch-canary-20260512`            |  `$67.007` |   `$162,001.34` | `100.000%` |     `$0.270` |   `0.011184 BTC` |
| `tight-near-touch.yml`             | `data/strategy-runs/20260513-082048-tight-near-touch-canary-20260512`       | `$185.131` | `$1,140,466.80` |  `94.231%` |    `$12.004` |   `0.334464 BTC` |
| `tight-near-touch-micro.yml`       | `data/strategy-runs/20260513-090638-tight-near-touch-micro-source-20260512` |  `$44.657` |   `$286,730.28` | `100.000%` |     `$4.635` |   `0.077650 BTC` |
| `tight-near-touch-maker.yml`       | `data/strategy-runs/20260513-091401-tight-near-touch-maker-20260512`        |  `$43.454` |   `$285,921.93` | `100.000%` |     `$4.635` |   `0.077650 BTC` |
| `tight-near-touch-inner-maker.yml` | `data/strategy-runs/20260513-092820-tight-near-touch-inner-maker-20260512`  |  `$12.556` |   `$115,982.76` | `100.000%` |     `$2.990` |              n/a |

Backtest is only a risk and plumbing smoke here because the historical feed does
not reproduce the live top-of-book tight-spread queue.

## Live Canary 1: Near-Touch

Run ID: `ae271a8f-e5c3-4b46-860f-5e860743195d`

Command shape:

```bash
CONFIG_PATH=config/bulk/tight-near-touch.yml MODE=live DATABASE_URL=file:data/mm.db bun run src/main.ts
```

Preflight after shutdown confirmed `openOrders=0`, `positionSize=null`, and
`cancelAll.ok=true`.

| metric            |                              value |
| ----------------- | ---------------------------------: |
| window            | `2026-05-13 17:25:54-17:28:32 JST` |
| submitted orders  |                              `142` |
| fills             |                                `2` |
| fill rate         |                           `1.408%` |
| notional          |                        `$2,099.69` |
| net PnL           |                         `+$0.8254` |
| net EV            |                      `+3.9310 bps` |
| avg market spread |                       `0.1301 bps` |
| avg 5s markout    |                      `-1.0081 bps` |
| 5s coverage       |                             `100%` |
| max abs position  |                     `0.012952 BTC` |
| maker ratio       |                              `50%` |

The live run is not a pass: fill count is far below the `20` fill gate, 30s and
300s markout coverage is incomplete, and 5s markout is negative. Net PnL was
positive only on a tiny sample and included the forced close path.

## Live Canary 2: Micro Near-Touch

Run ID: `413d27ed-0317-45db-bdc4-7fefe967367e`

Command shape:

```bash
CONFIG_PATH=config/bulk/tight-near-touch-micro.yml MODE=live DATABASE_URL=file:data/mm.db bun run src/main.ts
```

Preflight after shutdown confirmed `openOrders=0`, `positionSize=null`, and
`cancelAll.ok=true`.

| metric                   |                              value |
| ------------------------ | ---------------------------------: |
| window                   | `2026-05-13 17:45:07-17:50:29 JST` |
| submitted orders         |                              `357` |
| fills                    |                                `3` |
| fill rate                |                           `0.560%` |
| notional                 |                        `$1,999.60` |
| net PnL                  |                         `+$0.2539` |
| trade PnL                |                         `-$0.0060` |
| net EV                   |                      `+1.2698 bps` |
| trade EV                 |                      `-0.0302 bps` |
| avg market spread        |                       `0.0844 bps` |
| avg quote distance best  |                       `2.3869 bps` |
| avg 5s markout           |                      `-0.0253 bps` |
| avg 30s markout          |                      `-0.0450 bps` |
| 5s / 30s / 300s coverage |                  `100% / 33% / 0%` |
| max abs position         |                     `0.012328 BTC` |
| maker ratio              |                              `33%` |
| cancel-before-fill rate  |                          `99.440%` |

Bucket evidence:

| bucket       | fills |  notional |        net EV | avg 5s markout | avg 30s markout |
| ------------ | ----: | --------: | ------------: | -------------: | --------------: |
| `buy:quote`  |   `1` | `$999.80` |  `0.0000 bps` |  `-0.0450 bps` |   `-0.0450 bps` |
| `sell:close` |   `2` | `$999.80` | `+2.5396 bps` |  `-0.0154 bps` |           `n/a` |

The micro run is safer than the first canary and reduced the 5s markout loss to
almost flat, but it is still not a pass. Only one maker quote filled, most
positive net PnL came from rebate on shutdown close fills, 30s/300s coverage is
insufficient, and adverse selection was still high on the tiny sample.

## Live Canary 3: Maker Near-Touch

Run ID: `43abd0e5-6d9f-411f-99d3-ae573578d9b1`

Command shape:

```bash
CONFIG_PATH=config/bulk/tight-near-touch-maker.yml MODE=live DATABASE_URL=file:data/mm.db bun run src/main.ts
```

This run used `shutdown.closePositionPolicy: emergency_only`, so normal shutdown
did not add market-close fills to the telemetry run. After metrics were
collected, the remaining `0.018014 BTC` long was flattened manually with a
separate reduce-only market sell. Post-flatten preflight confirmed
`openOrders=0`, `positionSize=null`, and `cancelAll.ok=true`.

| metric                   |                              value |
| ------------------------ | ---------------------------------: |
| window                   | `2026-05-13 18:17:49-18:23:08 JST` |
| submitted orders         |                              `349` |
| fills                    |                                `9` |
| fill rate                |                           `2.579%` |
| notional                 |                       `$10,535.55` |
| net PnL                  |                         `+$0.0541` |
| trade PnL                |                         `-$0.9434` |
| net EV                   |                      `+0.0514 bps` |
| trade EV                 |                      `-0.8954 bps` |
| avg market spread        |                       `0.0803 bps` |
| avg quote distance best  |                       `2.5096 bps` |
| avg 5s markout           |                      `+0.9023 bps` |
| avg 30s markout          |                      `-0.2454 bps` |
| 5s / 30s / 300s coverage |                  `100% / 78% / 0%` |
| maker ratio              |                              `89%` |
| cancel-before-fill rate  |                          `96.848%` |
| reject rate              |                           `0.573%` |
| projected 15d volume     |                          `$42.70M` |

Bucket evidence:

| bucket        | fills |    notional |        net EV | avg 5s markout | avg 30s markout |
| ------------- | ----: | ----------: | ------------: | -------------: | --------------: |
| `buy:quote`   |   `6` | `$5,998.79` |  `0.0000 bps` |  `+1.4601 bps` |   `-0.2846 bps` |
| `sell:reduce` |   `3` | `$4,536.76` | `+0.1193 bps` |  `-0.2132 bps` |   `-0.1475 bps` |
| `level_0`     |   `7` | `$6,348.85` | `-0.0919 bps` |  `+1.2160 bps` |   `+0.0398 bps` |
| `level_1`     |   `1` |   `$350.14` | `+2.1862 bps` |  `-0.3756 bps` |           `n/a` |

The maker-only run is the best tight-spread probe so far on short-horizon
selection: maker ratio improved to `89%`, fill rate improved to `2.58%`, and
5s markout turned positive. It is still not a pass because fill count is below
`20`, 30s coverage is just below the `80%` gate, 300s coverage is unavailable,
30s markout is negative, and the run still loses on pure trade EV before rebate.

The most actionable gap is order age / lifecycle. Quote-age buckets show
`500-1000ms` had the only positive 30s sample, while `1000ms+` buckets carried
negative 30s markout. Runtime telemetry also shows reconcile p95 around `4.4s`,
so tightening `maxRestingMs` alone may not be enough unless the next config
also reduces order churn.

## Live Canary 4: Inner Maker

Run ID: `8e60eabf-6faf-483a-a7d6-13accf7d4269`

Command shape:

```bash
CONFIG_PATH=config/bulk/tight-near-touch-inner-maker.yml MODE=live DATABASE_URL=file:data/mm.db bun run src/main.ts
```

This tested whether removing the outer level and reducing notional/churn would
improve stale-fill quality. Post-shutdown preflight confirmed `openOrders=0`,
`positionSize=null`, and `cancelAll.ok=true`.

| metric                   |                              value |
| ------------------------ | ---------------------------------: |
| window                   | `2026-05-13 18:29:50-18:34:51 JST` |
| fills                    |                                `4` |
| fill rate                |                           `2.410%` |
| notional                 |                        `$1,049.89` |
| net PnL                  |                         `+$0.0634` |
| trade PnL                |                         `+$0.0634` |
| net EV                   |                      `+0.6041 bps` |
| avg market spread        |                       `0.1150 bps` |
| avg quote distance best  |                       `1.5367 bps` |
| avg 5s markout           |                      `-0.4695 bps` |
| avg 30s markout          |                      `-1.3946 bps` |
| 5s / 30s / 300s coverage |                  `100% / 75% / 0%` |
| maker ratio              |                             `100%` |
| reject rate              |                           `2.410%` |
| projected 15d volume     |                           `$4.52M` |

Bucket evidence:

| bucket        | fills |    notional |       net EV | avg 5s markout | avg 30s markout |
| ------------- | ----: | ----------: | -----------: | -------------: | --------------: |
| `sell:quote`  |   `2` |   `$524.98` | `0.0000 bps` |  `-1.3592 bps` |   `-1.8599 bps` |
| `buy:reduce`  |   `2` |   `$524.92` | `1.2082 bps` |  `+0.4201 bps` |   `-0.4639 bps` |
| `1000-3000ms` |   `4` | `$1,049.89` | `0.6041 bps` |  `-0.4695 bps` |   `-1.3946 bps` |

The inner-only hypothesis was negative. It reduced notional too far, did not
improve quote age enough, and the only open quote bucket (`sell:quote`) had
negative 5s and 30s markout. The previous 2-level maker config remains the
better tight-spread probe, but neither is a production candidate.

## Next Decision

Do not promote any tight-spread profile as a winning strategy yet. The 2-level
maker profile is the best short-horizon probe so far, but the evidence does not
prove a tight-spread edge.

Next useful step should be a code-level lifecycle fix or strategy control, not
another size-only YAML tweak. The live canaries repeatedly show `1000ms+` quote
age and reconcile p95 around `4.4s`, so stale order lifecycle is likely masking
or destroying the tight-spread edge. Pass criteria for the next live canary:

- at least `20` fills
- 5s and 30s markout coverage at least `80%`
- positive net EV and positive 5s/30s markout
- adverse selection below `30%`
- max abs position within the selected config cap

If that still fails, the next implementation should be a profile switcher:
keep `beta.yml` behavior for wide spread, use a tight profile only in neutral
tight spread, and disable open quotes in tight-toxic conditions.
