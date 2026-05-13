# Test Design

Tests are split by behavioral scope under `tests/`.

## Layout

- `tests/unit/`: pure domain, application use case, adapter mapping, reporting, script, package, and config tests. External I/O is mocked or in-memory.
- `tests/integration/`: multi-layer tests that exercise real persistence, DI wiring, or runtime telemetry against fixtures.
- `tests/e2e/`: smoke tests that may touch public network feeds or run end-to-end paper/backtest paths.

## Commands

```bash
bun run test:unit
bun run test:integration
bun run test
bun run test:e2e:paper
bun run test:coverage
```

`bun run test` intentionally excludes e2e smoke tests. Run `bun run test:e2e:paper` when public-feed behavior is in scope.

## Latency Integration

`tests/integration/latency/quote-cycle-latency.test.ts` uses fixture market, position, and order adapters with the real quoting cycle path and a real SQLite metrics repository. It records `quote_cycle_freshness` runtime health rows, measures 5 warmup plus 30 sampled quote cycles, and fails when the sample is incomplete or the quoting cycle soft gate is exceeded.

The test prints one compact `quote_cycle_latency` JSON line during `bun run test:integration`.

## Coverage

`bun run test:coverage` runs Bun native coverage for unit and integration tests, writes LCOV to `docs/coverage/lcov.info`, then generates `docs/coverage/summary.md`.
