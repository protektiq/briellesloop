DROP TABLE IF EXISTS item_mastery CASCADE;
DROP TABLE IF EXISTS items CASCADE;
DROP TABLE IF EXISTS student_skill_levels CASCADE;
DROP TABLE IF EXISTS skills CASCADE;
DROP TABLE IF EXISTS students CASCADE;

-- The student. One row in v1, but structured for future expansion.
CREATE TABLE students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  grade INT NOT NULL,
  date_of_birth DATE,
  interests TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Skills: reading, math, spelling, typing.
CREATE TABLE skills (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  iep_goal_text TEXT,
  iep_target_pct INT DEFAULT 80
);

-- Each student's current level per skill.
CREATE TABLE student_skill_levels (
  student_id UUID REFERENCES students(id),
  skill_id INT REFERENCES skills(id),
  level INT NOT NULL DEFAULT 1,
  current_accuracy DECIMAL(5,2),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (student_id, skill_id)
);

-- The item bank.
CREATE TABLE items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id INT REFERENCES skills(id),
  level INT NOT NULL,
  item_type TEXT NOT NULL,
  prompt JSONB NOT NULL,
  answer JSONB NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  ai_generated BOOLEAN DEFAULT TRUE
);

-- Mastery tracking.
CREATE TABLE item_mastery (
  student_id UUID REFERENCES students(id),
  item_id UUID REFERENCES items(id),
  tier INT NOT NULL DEFAULT 0,
  consecutive_correct INT DEFAULT 0,
  total_attempts INT DEFAULT 0,
  total_correct INT DEFAULT 0,
  avg_response_time_seconds DECIMAL(6,2),
  next_review_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ,
  PRIMARY KEY (student_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_item_mastery_student_next_review
  ON item_mastery(student_id, next_review_at);
