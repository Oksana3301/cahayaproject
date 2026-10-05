CREATE TABLE IF NOT EXISTS runs (
  id serial PRIMARY KEY,
  agent text,
  skill text,
  prompt_tokens int,
  completion_tokens int,
  status text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS runs_created_at_idx ON runs (created_at);
CREATE INDEX IF NOT EXISTS runs_agent_created_idx ON runs (agent, created_at);
