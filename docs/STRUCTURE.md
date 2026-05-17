# STRUCTURE

This document defines the current repository layout and ownership boundaries.

## Tree

```text
simple-mm-bot/
├── docker-compose.yml
├── Dockerfile
├── drizzle.config.ts
├── src/
│   ├── main.ts
│   ├── env.ts
│   ├── config.ts
│   ├── application/
│   │   ├── Bot.ts
│   │   ├── di.ts
│   │   ├── factories/
│   │   ├── services/
│   │   │   ├── MarketDataBufferedWriter.ts
│   │   │   ├── MetricsRecorder.ts
│   │   │   ├── OrderIntentBuilder.ts
│   │   │   ├── OrderReconciler.ts
│   │   │   └── QuotingCycleService.ts
│   │   └── usecases/
│   ├── domain/
│   │   ├── market-data/
│   │   ├── ports/
│   │   ├── quote-models/
│   │   ├── services/
│   │   ├── strategies/
│   │   ├── types/
│   │   └── value-objects/
│   ├── adapters/
│   │   ├── bulk/
│   │   ├── hyperliquid/
│   │   └── paper/
│   ├── infrastructure/
│   │   ├── db/
│   │   │   └── postgres/
│   │   │       ├── client.ts
│   │   │       ├── schema.ts
│   │   │       ├── migrations/
│   │   │       └── repository/
│   │   └── GitMetadata.ts
│   ├── lib/
│   │   ├── hyperliquid/
│   │   ├── reporting/
│   │   └── slack/
│   ├── utils/
│   └── workers/
│       ├── marketDataRecorder.ts
│       ├── marketDataRecorderConfig.ts
│       └── marketDataRecorderFactory.ts
├── scripts/
│   ├── analyzeLeadLagCharts.ts
│   ├── checkBulkPrivateApi.ts
│   ├── createDesignIssues.ts
│   ├── generateCoverageSummary.ts
│   ├── generateMetricsReport.ts
│   ├── registerBulkAgentWallet.ts
│   ├── tuneBulkConfig.ts
│   └── lib/
├── tests/
│   ├── unit/
│   └── integration/
├── docs/
│   ├── DATABASE.md
│   ├── DATA_FOUNDATION.md
│   ├── TECH.md
│   ├── TEST.md
│   ├── ARCHITECTURE.md
│   ├── infra/
│   └── venue/
├── infra/
│   └── hetzner/
│       ├── compose.infra.yml
│       ├── compose.workers.yml
│       ├── compose.bots.yml
│       ├── configs/
│       ├── scripts/
│       └── local/
├── config/
│   └── bulk/
├── data/
│   └── timescaledb/
└── package.json
```

## Layer Responsibilities

### `src/domain`

Pure market making and recorder contracts.

- No venue SDK imports.
- No database imports.
- No environment reads.
- Ports live here because inner layers define interfaces.

### `src/application`

Bot and worker orchestration.

- `Bot.ts` owns runtime loop lifecycle.
- `di.ts` is the bot composition root.
- `MarketDataBufferedWriter.ts` batches recorder writes.
- Use cases coordinate domain ports and adapters.

### `src/adapters`

External venue and mode adapters.

- `src/adapters/bulk` owns Bulk HTTP/WS/order/recorder normalization.
- `src/adapters/paper` owns simulated execution and historical feed helpers.
- `src/adapters/hyperliquid` is compatibility-only.

### `src/infrastructure`

External technical details.

- PostgreSQL client and Drizzle schema.
- TimescaleDB migration SQL.
- PostgreSQL repositories implementing domain ports.
- Git metadata and non-domain integrations.

### `src/workers`

Standalone process entry points.

- `marketDataRecorder.ts` reads env, validates PostgreSQL URL, wires recorder dependencies, and handles shutdown.
- `marketDataRecorderConfig.ts` loads recorder YAML when `RECORDER_CONFIG_PATH` is set and preserves env fallback.
- `marketDataRecorderFactory.ts` maps recorder venue to recorder client.

### `infra/hetzner`

Production VPS operations source of truth.

- Compose files split infrastructure, always-on workers, and bot containers.
- Runtime configs under `configs/` are mounted into GHCR image containers.
- Operator scripts target individual services and must not use `docker compose down`.
- `local/` contains read-only SSH tunnel helpers for Beekeeper, agents, and local backtests.
- `/opt/mmbot` is the VPS runtime mirror; `.env`, `data/`, `backups/`, and `logs/` stay VPS-local.

### Docker files

- `Dockerfile` builds the single app image used by local Compose and GHCR production publishing.
- Root `docker-compose.yml` is the local development wrapper. It keeps the same service names and mount paths as Hetzner production while avoiding production-only required secret interpolation.
- Production scripts do not use root `docker-compose.yml`; they run the three `infra/hetzner/compose.*.yml` files from `/opt/mmbot`.

### `scripts`

Operator and development tools outside bot runtime.

- JSON-based metrics report formatting.
- Bulk config tuning from an evaluation JSON.
- design issue planning.
- coverage summary generation.

Scripts must not be required by bot runtime.

## Data Layout

- `data/timescaledb/`: Docker Compose TimescaleDB volume.
- `data/metrics/`: JSON and Markdown artifacts produced by scripts.
- `docs/reports/`: generated report snapshots when intentionally committed.

Runtime database state belongs in TimescaleDB, not local database files.

## Docs

- `docs/DATABASE.md`: TimescaleDB schema source of truth.
- `docs/DATA_FOUNDATION.md`: recorder and replay foundation policy.
- `docs/TECH.md`: technical architecture and runtime policy.
- `docs/ARCHITECTURE.md`: diagrams and high-level flow.
- `docs/TEST.md`: test layout and commands.
- `docs/infra/README.md`: concise Docker and Hetzner operations map.
- `docs/venue/bulk/README.md`: Bulk-specific venue notes.

## DI Matrix

| venue         | mode       | MarketFeed              | OrderGateway              | status        |
| ------------- | ---------- | ----------------------- | ------------------------- | ------------- |
| `bulk`        | `paper`    | `BulkMarketFeed`        | `PaperOrderGateway`       | primary       |
| `bulk`        | `live`     | `BulkMarketFeed`        | `BulkOrderGateway`        | primary       |
| `bulk`        | `backtest` | `HistoricalMarketFeed`  | `PaperOrderGateway`       | temporary     |
| `hyperliquid` | `paper`    | `HyperliquidMarketFeed` | `PaperOrderGateway`       | compatibility |
| `hyperliquid` | `live`     | `HyperliquidMarketFeed` | `HyperliquidOrderGateway` | compatibility |
| `hyperliquid` | `backtest` | `HistoricalMarketFeed`  | `PaperOrderGateway`       | compatibility |

Recorder venues:

| venue          | client                         | status      |
| -------------- | ------------------------------ | ----------- |
| `bulk`         | `BulkMarketDataRecorderClient` | implemented |
| `binance_usdm` | none                           | fail fast   |
| `okx_swap`     | none                           | fail fast   |
| `bybit_linear` | none                           | fail fast   |

## Tests

- `tests/unit`: domain, application, adapter, recorder, reporting, scripts, and package contract tests.
- `tests/integration`: PostgreSQL repository, migration SQL, and DI integration tests.

Run:

```bash
bun run check
bun run test
```
