# Test Design

Tests are split by behavioral scope under `tests/`.

## Layout

- `tests/unit/`: pure domain, application use case, adapter mapping, market data normalization, buffered writer, reporting, script, package, and config tests.
- `tests/integration/`: multi-layer tests that exercise PostgreSQL repositories, destructive migration SQL, and DI wiring.

There is no default e2e suite in the current TimescaleDB foundation. Public feed and live recorder verification are done explicitly with Docker Compose when the task requires it.

## Commands

```bash
bun run test:unit
bun run test:integration
bun run test
bun run test:coverage
```

`bun run test` runs unit and integration tests.

## Database Integration

PostgreSQL integration tests use `TEST_DATABASE_URL` or `DATABASE_URL` when available. The TimescaleDB service from `docker-compose.yml` is the expected local target.

```bash
docker compose up -d timescaledb
bun run db:migrate
bun run test:integration
```

## Coverage

`bun run test:coverage` runs Bun native coverage for unit and integration tests, writes LCOV to `docs/coverage/lcov.info`, then generates `docs/coverage/summary.md`.
