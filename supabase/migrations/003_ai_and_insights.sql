DROP TABLE IF EXISTS weekly_insights CASCADE;
DROP TABLE IF EXISTS ai_generations CASCADE;

CREATE TABLE ai_generations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose TEXT NOT NULL,
  input_prompt TEXT,
  input_hash TEXT,
  model TEXT,
  output JSONB,
  tokens_in INT,
  tokens_out INT,
  cost_usd DECIMAL(8,4),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE weekly_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES students(id),
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  insight_text TEXT,
  suggested_adjustment TEXT,
  applied BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
