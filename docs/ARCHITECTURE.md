# ARCHITECTURE

See [STRUCTURE.md](./STRUCTURE.md), [TECH.md](./TECH.md), and [DATABASE.md](./DATABASE.md) for detailed responsibilities.

## High-Level Runtime

```mermaid
flowchart TD
    Config["YAML config + env"] --> DI["DIContainer"]
    DI --> Bot["Bot"]
    Bot --> Feed["IMarketFeed"]
    Bot --> Gateway["IOrderGateway"]
    Bot --> Metrics["MetricsRecorder"]
    Bot --> ExternalStore["ExternalMarketTopOfBookStore"]
    ExternalStore --> FairValue["IFairValueProvider"]
    FairValue --> Bot
    Metrics --> BotRepo["PostgresMetricsRepository"]
    BotRepo --> BotTables[("bot_* tables")]

    Feed --> BulkAPI["Bulk API / WS"]
    Gateway --> BulkAPI
    ExternalCEX["Binance / OKX / Bybit public WS"] --> ExternalStore
```

## Market Data Recorders

```mermaid
flowchart LR
    BulkWS["Bulk public WS/HTTP"] --> Client["BulkMarketDataRecorderClient"]
    Client --> Writer["MarketDataBufferedWriter"]
    Writer --> Repo["PostgresMarketDataRepository"]
    Repo --> TargetMarketTables[("target_market_* tables")]

    CEXWS["Binance / OKX / Bybit public WS"] --> ExternalSubs["External CEX subscriptions"]
    ExternalSubs --> ExternalWriter["ExternalMarketBufferedWriter"]
    ExternalWriter --> ExternalRepo["PostgresExternalMarketRepository"]
    ExternalRepo --> ExternalMarketTables[("external_market_* tables")]
```

Recorders are separate processes from the bot. They write only public market
facts.

## Database Separation

```mermaid
flowchart TD
    TargetFeed["Target venue public feed"] --> TargetMarket["target_market_*"]
    ExternalFeed["External CEX public feed"] --> ExternalMarket["external_market_*"]
    BotRuntime["Bot runtime"] --> BotFacts["bot_*"]
    TargetMarket --> QuoteView["analytics_quote_markouts"]
    TargetMarket --> FillView["analytics_fill_markouts"]
    ExternalMarket --> FairReplay["fair-value replay / diagnostics"]
    BotFacts --> QuoteView
    BotFacts --> FillView
```

`target_market_*` answers what the MM target venue showed.
`external_market_*` answers what external CEX venues showed for fair-value
context. `bot_*` answers what the bot observed, decided, submitted, and filled.

## Venue And Mode Matrix

| venue         | mode       | MarketFeed              | OrderGateway              |
| ------------- | ---------- | ----------------------- | ------------------------- |
| `bulk`        | `live`     | `BulkMarketFeed`        | `BulkOrderGateway`        |
| `bulk`        | `paper`    | `BulkMarketFeed`        | `PaperOrderGateway`       |
| `bulk`        | `backtest` | `HistoricalMarketFeed`  | `PaperOrderGateway`       |
| `hyperliquid` | `live`     | `HyperliquidMarketFeed` | `HyperliquidOrderGateway` |
| `hyperliquid` | `paper`    | `HyperliquidMarketFeed` | `PaperOrderGateway`       |
| `hyperliquid` | `backtest` | `HistoricalMarketFeed`  | `PaperOrderGateway`       |

## Ports And Implementations

```mermaid
flowchart LR
    subgraph DomainPorts["Domain ports"]
        IMF["IMarketFeed"]
        IOG["IOrderGateway"]
        IPOS["IPositionRepository"]
        IMETRICS["IMetricsRepository"]
        IMD["IMarketDataRepository"]
        IMRC["IMarketDataRecorderClient"]
    end

    subgraph Implementations["Adapters / Infrastructure"]
        BMF["BulkMarketFeed"] --> IMF
        BOG["BulkOrderGateway"] --> IOG
        POG["PaperOrderGateway"] --> IOG
        MEM["InMemoryPositionRepository"] --> IPOS
        PM["PostgresMetricsRepository"] --> IMETRICS
        PMD["PostgresMarketDataRepository"] --> IMD
        BRC["BulkMarketDataRecorderClient"] --> IMRC
    end
```

Domain and application depend on ports. Adapters and infrastructure implement them.

## Shutdown

```mermaid
sequenceDiagram
    participant OS
    participant Worker
    participant Recorder
    participant Writer

    OS->>Worker: SIGINT / SIGTERM
    Worker->>Recorder: disconnect()
    Worker->>Writer: shutdown()
    Writer->>Writer: stop timer
    Writer->>Writer: flush remaining buffers
```

The recorder logs final flush results before exiting.
