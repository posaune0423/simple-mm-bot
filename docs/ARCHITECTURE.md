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
    Metrics --> BotRepo["PostgresMetricsRepository"]
    BotRepo --> BotTables[("bot_* tables")]

    Feed --> BulkAPI["Bulk API / WS"]
    Gateway --> BulkAPI
```

## Market Data Recorder

```mermaid
flowchart LR
    BulkWS["Bulk public WS/HTTP"] --> Client["BulkMarketDataRecorderClient"]
    Client --> Writer["MarketDataBufferedWriter"]
    Writer --> Repo["PostgresMarketDataRepository"]
    Repo --> MarketTables[("market_data_* tables")]
```

The recorder is a separate process from the bot. It writes only venue market facts.

## Database Separation

```mermaid
flowchart TD
    VenueFeed["Venue public feed"] --> MarketData["market_data_*"]
    BotRuntime["Bot runtime"] --> BotFacts["bot_*"]
    MarketData --> QuoteView["analytics_quote_markouts"]
    MarketData --> FillView["analytics_fill_markouts"]
    BotFacts --> QuoteView
    BotFacts --> FillView
```

`market_data_*` answers what the venue showed. `bot_*` answers what the bot observed, decided, submitted, and filled.

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
