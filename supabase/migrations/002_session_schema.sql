DROP TABLE IF EXISTS brain_breaks CASCADE;
DROP TABLE IF EXISTS attempts CASCADE;
DROP TABLE IF EXISTS sessions CASCADE;

CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES students(id),
  skill_id INT REFERENCES skills(id),
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  pre_mood_emoji TEXT,
  pre_mood_score INT,
  post_mood_emoji TEXT,
  post_mood_score INT,
  reflection TEXT,
  items_attempted INT DEFAULT 0,
  items_correct INT DEFAULT 0
);

CREATE TABLE attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES sessions(id),
  item_id UUID REFERENCES items(id),
  user_response JSONB,
  is_correct BOOLEAN,
  response_time_seconds DECIMAL(6,2),
  hint_used BOOLEAN DEFAULT FALSE,
  ai_feedback TEXT,
  attempted_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE brain_breaks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES sessions(id),
  triggered_by TEXT,                         -- 'auto_two_wrong','auto_slow','user_button','low_mood','agent_predicted'
  duration_seconds INT,
  taken_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attempts_session_attempted_at
  ON attempts(session_id, attempted_at);
