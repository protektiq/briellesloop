DROP TABLE IF EXISTS student_tuning CASCADE;
DROP TABLE IF EXISTS agent_actions CASCADE;
DROP TABLE IF EXISTS agent_runs CASCADE;
DROP TABLE IF EXISTS agents CASCADE;

-- Catalog of agents. Pre-seeded with the four v1 agents.
CREATE TABLE agents (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,                 -- 'calibration','content','frustration','insight'
  description TEXT,
  schedule_cron TEXT,                        -- e.g., '0 2 * * *' for 2am daily
  enabled BOOLEAN DEFAULT TRUE,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ
);

-- Every time an agent runs, a row is written here.
CREATE TABLE agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id INT REFERENCES agents(id),
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  status TEXT,                               -- 'running','completed','failed'
  error_message TEXT,
  observations JSONB,                        -- what the agent saw
  reasoning TEXT,                            -- the agent's chain of thought
  tokens_used INT,
  cost_usd DECIMAL(8,4)
);

-- Every action an agent decides to take. Some apply immediately; some need approval.
CREATE TABLE agent_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_run_id UUID REFERENCES agent_runs(id),
  action_type TEXT NOT NULL,                 -- 'tune_threshold','curate_queue','flag_pattern','suggest_intervention'
  target TEXT,                               -- e.g., 'student_skill_levels:math:level','session_settings:max_items'
  before_value JSONB,
  after_value JSONB,
  rationale TEXT,                            -- agent's explanation for parent
  requires_approval BOOLEAN DEFAULT FALSE,
  approved BOOLEAN,                          -- NULL = pending, TRUE = approved, FALSE = rejected
  approved_at TIMESTAMPTZ,
  applied BOOLEAN DEFAULT FALSE,
  applied_at TIMESTAMPTZ,
  reverted BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Per-student tunable parameters that agents are allowed to adjust.
-- This is the "knobs" surface that the Calibration Agent operates on.
CREATE TABLE student_tuning (
  student_id UUID REFERENCES students(id),
  parameter_name TEXT,                       -- 'tier_advance_accuracy','tier_advance_response_time','session_item_count','frustration_wrong_threshold','frustration_time_threshold'
  current_value DECIMAL(8,2),
  default_value DECIMAL(8,2),
  min_value DECIMAL(8,2),
  max_value DECIMAL(8,2),
  last_changed_at TIMESTAMPTZ,
  changed_by_agent INT REFERENCES agents(id),
  PRIMARY KEY (student_id, parameter_name)
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_agent_started_at_desc
  ON agent_runs(agent_id, started_at DESC);
