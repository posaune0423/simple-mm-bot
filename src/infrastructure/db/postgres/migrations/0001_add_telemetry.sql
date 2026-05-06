CREATE TABLE IF NOT EXISTS telemetry_runs (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  venue TEXT NOT NULL,
  capital_mode TEXT NOT NULL,
  market TEXT NOT NULL,
  config_json TEXT NOT NULL,
  git_sha TEXT,
  git_dirty BOOLEAN NOT NULL,
  started_at BIGINT NOT NULL,
  ended_at BIGINT,
  status TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS telemetry_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  venue TEXT NOT NULL,
  type TEXT NOT NULL,
  ts BIGINT NOT NULL,
  market TEXT,
  payload_json TEXT NOT NULL
);
