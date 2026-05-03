-- Agent-to-agent notes (observations, flags, suggestions)
CREATE TABLE agent_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_agent_id INT REFERENCES agents(id),
  to_agent_id INT REFERENCES agents(id),
  note_type TEXT NOT NULL CHECK (note_type IN ('observation', 'flag', 'suggestion')),
  content JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  read_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_agent_notes_created_at_desc ON agent_notes (created_at DESC);

-- Simulation runs: no agent_actions; reads use historical window
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS dry_run BOOLEAN NOT NULL DEFAULT FALSE;
