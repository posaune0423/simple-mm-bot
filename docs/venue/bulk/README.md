# Bulk Trade Venue Notes

Bulk Trade の trading algo 実装で参照する venue 固有ルールをまとめる。
ここに書く数字は公式 docs を 2026-05-06 に確認した snapshot であり、実運用では fill / account API から返る実績値を優先する。

## Sources

- [Fees](https://docs.bulk.trade/bulk-exchange/fees)
- [Commission Fees (PFOF)](https://docs.bulk.trade/bulk-exchange/commission-fees)
- [High Frequency Market Making](https://docs.bulk.trade/bulk-exchange/hf-market-making)
- [Self-Trade Prevention](https://docs.bulk.trade/bulk-exchange/Self-Trade-Prevention)
- [Liquidations](https://docs.bulk.trade/bulk-exchange/Liquidations)
- [Margin](https://docs.bulk.trade/bulk-exchange/Margin)

## Algo-Critical Summary

- Fee は fill ごとに USDC でリアルタイム反映される。sub-account の volume は main account に集約され、fee tier は共有される。
- Maker fee が負の値の場合は rebate として受け取る。PnL / spread 判定では `notional * feeBps / 10_000` として扱い、負の maker fee はコストではなく収益側に入れる。
- Taker fee は inventory reduction、IOC close、crossing quote の最低コストとして必ず見積もる。
- Commission fee は standard BULK fee に上乗せされる integrator fee だが、公式 page 上は "coming soon" の状態。bot が直接 integrator fee を設定しない限り、algo 側の default は `0 bps` として扱う。
- Liquidation fee はない。ただし liquidation は全 resting order cancel と市場 sweep を伴うため、bot 側では margin guard と reduce-only close を清算前に走らせる。
- STP は same account 内で aggressive order が自分の resting order に当たりそうな場合、aggressive 側が `cancelledSelfCrossing` になる。これは fill ではなく cancel status として処理する。
- High-frequency 向けの特別 fee / rebate / private feed / VIP queue はない。高速発注では agent wallet を使い、必要なら follower validator を検討する。

## Fees

Do not infer the active phase from local calendar time. The docs define Phase 1
and Phase 2 schedules, but runtime fee modeling should use the exchange/account
state when available, or an explicit config value when it is not.

### Phase 1: Genesis Liquidity

対象は最初の 30 日間。tier は 15-day volume で決まる。

| Tier | 15-Day Volume | Maker      | Taker     |
| ---- | ------------- | ---------- | --------- |
| 1    | `< 1M`        | `0 bps`    | `3.5 bps` |
| 2    | `>= 1M`       | `0 bps`    | `3.3 bps` |
| 3    | `>= 10M`      | `0 bps`    | `3.0 bps` |
| 4    | `>= 50M`      | `0 bps`    | `2.8 bps` |
| 5    | `>= 150M`     | `-1.0 bps` | `2.6 bps` |
| 6    | `>= 500M`     | `-1.5 bps` | `2.4 bps` |
| 7    | `>= 1.5B`     | `-2.0 bps` | `2.3 bps` |
| 8    | `>= 4.0B`     | `-2.5 bps` | `2.2 bps` |

### Phase 2: Public Fee And Rebate Tiers

Phase 1 後の public tier。tier は 14-day rolling volume で継続的に測定され、リアルタイムに適用される。

| Tier | 14-Day Volume | Maker      | Taker     |
| ---- | ------------- | ---------- | --------- |
| 1    | `< 1M`        | `2.0 bps`  | `3.5 bps` |
| 2    | `>= 1M`       | `1.8 bps`  | `3.3 bps` |
| 3    | `>= 10M`      | `1.5 bps`  | `3.0 bps` |
| 4    | `>= 50M`      | `1.0 bps`  | `2.8 bps` |
| 5    | `>= 150M`     | `0.0 bps`  | `2.6 bps` |
| 6    | `>= 500M`     | `-1.0 bps` | `2.4 bps` |
| 7    | `>= 1.5B`     | `-1.5 bps` | `2.3 bps` |
| 8    | `>= 4.0B`     | `-2.0 bps` | `2.2 bps` |

### Fee Model For Strategy

Use this shape in pricing / reporting:

```text
feeUsd = abs(fillPrice * fillQty) * (feeBps + commissionBps) / 10_000
netTradePnl = grossTradePnl - feeUsd
```

For maker fills, `feeBps` can be negative. For taker fills, `feeBps` is positive in the published tiers.

The quote engine should not assume every submitted quote is maker. A `GTC` order that crosses or a reduce-only `IOC` close can pay taker fee. Use actual fill maker/taker fields where available, and use conservative taker fee for pre-trade risk / emergency close estimates.

## Alpha Program

The Alpha Program is a reward program on top of fee rebates. The reward pool is `7.5%` of taker fee revenue per epoch, where one epoch is 30 days.

Quality score:

```text
QS = 0.40 * OI + 0.30 * TightnessDepth + 0.20 * Uptime + 0.10 * Volume
```

Algo implication:

- Tight spread and meaningful depth matter, but uptime and volume also affect rewards.
- The score is per market, then distribution is market-weighted.
- This is a rewards layer, not an execution guarantee. Do not mix Alpha rewards into per-fill break-even unless the report explicitly models epoch rewards separately.

## Commission Fees

Commission fee is intended for frontends, aggregators, or integrators that route orders through their interface.

- Commission is added on top of the user's standard BULK fee tier.
- Commission can be set per order or globally for an integration.
- Commission is declared on-chain as part of the order and credited in real time.
- The docs currently say the feature is coming soon, so the bot should not hardcode a non-zero default.

## High-Frequency Market Making

Bulk docs state that market makers do not receive special programs, special fee schedules, private feeds, or VIP queue priority. Every order goes through the same consensus, deterministic shuffle, and matching engine.

Operational notes:

- Use an agent wallet for high-frequency signing so the primary private key is not exposed.
- Agent wallets can place, modify, and cancel orders on behalf of the main account.
- SDKs for high-frequency market making are described as in active development.
- If default API rate limits are restrictive, the docs recommend running a follower validator for local state reads, higher throughput, full order book state, and account state without API polling.
- The docs say most nodes are currently in Europe. Co-location with the European cluster is the current latency guidance.

Algo implication:

- Keep rate limiting and cancel/replace pacing explicit in config.
- Treat latency as a deployment variable, not as a strategy constant.
- Do not depend on private feeds or privileged maker queue behavior.

## Self-Trade Prevention

STP applies inside the matching engine:

1. An aggressive order starts matching.
2. Before each fill, the engine checks whether incoming owner and resting owner are the same account.
3. If they are the same account, the resting order is skipped and remains on the book.
4. The aggressive order is cancelled with `cancelledSelfCrossing`.

Important details:

- No self-trade fee is charged.
- Self-trades do not appear in the public trade feed.
- STP applies per account. Different sub-accounts under the same main account can trade with each other.

Algo implication:

- Handle `cancelledSelfCrossing` as an expected terminal order status.
- Do not record a fill or fee for `cancelledSelfCrossing`.
- When using sub-accounts for isolation, do not assume STP protects against cross-sub-account self-crossing.

## Margin

Bulk uses portfolio margin rather than independent per-position margin. Margin is driven by total portfolio risk, correlations, leverage, order book impact, and market regime.

Core concepts from the docs:

- Collateral is denominated in USDC.
- Equity is collateral plus unrealized PnL, marked against mark price.
- For each position, signed notional uses position sign, absolute size, and mark price.
- Effective portfolio notional accounts for pairwise correlations between assets.
- Portfolio leverage is computed from effective notional and collateral.
- Each asset has a lambda surface: `lambda = f(leverage, impact, regime)`.
- Impact is estimated from order book depth.
- Regime is one of 9 hidden-Markov-model states: bearish/neutral/bullish crossed with low/medium/high volatility.
- Maintenance margin is a portfolio-level number using the same correlation structure.
- Reducing or closing trades always pass order validation regardless of margin state.

The docs expose formulas, but the rendered math is not enough to safely reimplement the venue risk engine in this bot. Use account margin fields from the venue / SDK for live guard decisions, and treat local calculations as estimates only.

Order validation checks:

- available margin supports the new order notional;
- implied leverage, including open orders, stays within the per-instrument max leverage;
- reducing trades are allowed even in poor margin state.

Sub-account note:

- Bulk uses cross margin by default.
- A sub-account has an independent collateral pool and positions.
- Liquidation in a sub-account does not affect the main account or other sub-accounts.
- Sub-account volume still rolls up to the main account for fee tier calculation.

## Liquidations

The Liquidations page states that liquidation triggers when both conditions hold:

```text
Equity < portfolioMaintenanceMargin
Position PnL < 0
```

All calculations use mark price, not last traded price. The Margin page summarizes the trigger as `Equity < M_p`; when implementing risk guard messaging, prefer the more specific Liquidations page condition and still treat `Equity < M_p` as emergency territory.

Liquidation optimizer flow:

1. Cancel all resting orders across every market.
2. Compute the margin gap against a target that includes a safety buffer.
3. Choose a reduction fraction based on urgency:

| Condition           | Reduction Fraction     |
| ------------------- | ---------------------- |
| `gap > 30% of M_p`  | `25%` of original size |
| `gap > 10% of M_p`  | `10%` of original size |
| `gap <= 10% of M_p` | `5%` of original size  |

4. Recompute margin impact for candidate reductions.
5. Skip positions whose closure would not reduce portfolio margin, preserving hedges.
6. Rank remaining candidates by margin relief per estimated liquidation cost.
7. Iterate up to 100 times; if selective reduction cannot restore margin, fall back to full flattening.

Execution details:

- Planned reductions are executed as market sweeps through the order book.
- Any unfilled remainder can become an ADL candidate.
- Insurance fund covers shortfall first.
- ADL is last resort.
- No liquidation fee is charged to traders.

Algo implication:

- Cancel resting orders before emergency close when margin health is breached.
- Reduce-only close should be independent from ordinary quote placement and should not be blocked by quote risk checks.
- Use mark-price based equity and venue-reported maintenance margin for guard thresholds.
- Preserve hedges only if the bot has enough portfolio context; otherwise, close the bot-owned risk first and fail closed.
