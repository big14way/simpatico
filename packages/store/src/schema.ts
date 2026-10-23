// Idempotent schema. Runs on every boot; only CREATE ... IF NOT EXISTS.

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS qloo_response (
  id           text PRIMARY KEY,
  cache_key    text NOT NULL,
  method       text NOT NULL,
  path         text NOT NULL,
  params       jsonb NOT NULL,
  http_status  integer NOT NULL,
  body         jsonb,
  fetched_at   timestamptz NOT NULL,
  pinned       boolean NOT NULL DEFAULT false,
  surface      text NOT NULL DEFAULT 'rest'
);
CREATE INDEX IF NOT EXISTS qloo_response_key_idx ON qloo_response (cache_key, fetched_at DESC);

CREATE TABLE IF NOT EXISTS qloo_evidence (
  id           text PRIMARY KEY,
  run_id       text,
  purpose      text NOT NULL,
  subjects     jsonb NOT NULL DEFAULT '[]',
  method       text NOT NULL,
  path         text NOT NULL,
  params       jsonb NOT NULL,
  response_id  text,
  status       text NOT NULL,
  http_status  integer,
  error        jsonb,
  from_cache   boolean NOT NULL,
  surface      text NOT NULL,
  duration_ms  integer NOT NULL,
  fetched_at   timestamptz,
  summary      text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS qloo_evidence_run_idx ON qloo_evidence (run_id, created_at);

CREATE TABLE IF NOT EXISTS runs (
  id           text PRIMARY KEY,
  kind         text NOT NULL DEFAULT 'screen',
  scenario     text,
  status       text NOT NULL,
  stage        text NOT NULL,
  mandate      jsonb NOT NULL,
  state        jsonb NOT NULL DEFAULT '{}',
  summary      jsonb,
  error        text,
  demo_mode    text NOT NULL,
  calls_live   integer NOT NULL DEFAULT 0,
  calls_cached integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS runs_scenario_idx ON runs (scenario, created_at DESC);

CREATE TABLE IF NOT EXISTS run_events (
  seq          bigserial PRIMARY KEY,
  run_id       text NOT NULL,
  at           timestamptz NOT NULL DEFAULT now(),
  kind         text NOT NULL,
  message      text NOT NULL,
  data         jsonb
);
CREATE INDEX IF NOT EXISTS run_events_run_idx ON run_events (run_id, seq);

CREATE TABLE IF NOT EXISTS targets (
  run_id       text NOT NULL,
  target_id    text NOT NULL,
  key          text,
  name         text NOT NULL,
  stage        text NOT NULL,
  screen_rank  integer,
  forward_affinity double precision,
  popularity   double precision,
  image_url    text,
  profile      jsonb,
  metrics      jsonb,
  composite    jsonb,
  flags        jsonb,
  verdict      text,
  why          text,
  score        double precision,
  coverage     double precision,
  owned_by_buyer boolean NOT NULL DEFAULT false,
  pinned       boolean NOT NULL DEFAULT false,
  PRIMARY KEY (run_id, target_id)
);

CREATE TABLE IF NOT EXISTS evidence_rows (
  run_id       text NOT NULL,
  id           text NOT NULL,
  target_id    text NOT NULL,
  kind         text NOT NULL,
  metric       text,
  label        text NOT NULL,
  data         jsonb NOT NULL,
  polarity     jsonb NOT NULL,
  ref          jsonb NOT NULL,
  sources      jsonb NOT NULL,
  PRIMARY KEY (run_id, id)
);

CREATE TABLE IF NOT EXISTS claims (
  id           text PRIMARY KEY,
  run_id       text NOT NULL,
  target_id    text NOT NULL,
  side         text NOT NULL,
  text         text NOT NULL,
  direction    text NOT NULL,
  flag         text,
  cites        jsonb NOT NULL,
  accepted     boolean NOT NULL,
  reason       text,
  model        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS claims_run_idx ON claims (run_id, target_id);

CREATE TABLE IF NOT EXISTS memos (
  id           text PRIMARY KEY,
  run_id       text NOT NULL,
  target_id    text,
  markdown     text NOT NULL,
  checks       jsonb NOT NULL,
  ok           boolean NOT NULL,
  model        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS memos_run_idx ON memos (run_id);

CREATE TABLE IF NOT EXISTS pipeline (
  id           text PRIMARY KEY,
  buyer_key    text NOT NULL,
  buyer_name   text NOT NULL,
  deal_type    text NOT NULL,
  target_id    text NOT NULL,
  target_name  text NOT NULL,
  image_url    text,
  score        double precision,
  verdict      text NOT NULL,
  stage        text NOT NULL,
  owner        text,
  next_step    text,
  last_run_id  text NOT NULL,
  monitored    boolean NOT NULL DEFAULT false,
  last_snapshot jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (buyer_key, deal_type, target_id)
);

CREATE TABLE IF NOT EXISTS outreach (
  id           text PRIMARY KEY,
  run_id       text NOT NULL,
  pipeline_id  text,
  target_id    text NOT NULL,
  target_name  text NOT NULL,
  intended_recipient text NOT NULL,
  subject      text NOT NULL,
  body         text NOT NULL,
  body_sha256  text NOT NULL,
  status       text NOT NULL,
  approval     jsonb,
  delivered_to text,
  provider_id  text,
  error        text,
  model        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS monitor_runs (
  id           text PRIMARY KEY,
  trigger      text NOT NULL,
  as_of        text NOT NULL,
  status       text NOT NULL,
  summary      jsonb,
  error        text,
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz
);

CREATE TABLE IF NOT EXISTS alerts (
  id           text PRIMARY KEY,
  monitor_run_id text NOT NULL,
  pipeline_id  text NOT NULL,
  target_name  text NOT NULL,
  kind         text NOT NULL,
  message      text NOT NULL,
  data         jsonb,
  delivery     jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS alerts_created_idx ON alerts (created_at DESC);

CREATE TABLE IF NOT EXISTS ablations (
  id           text PRIMARY KEY,
  run_id       text NOT NULL,
  result       jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settings (
  key          text PRIMARY KEY,
  value        jsonb NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
`;
