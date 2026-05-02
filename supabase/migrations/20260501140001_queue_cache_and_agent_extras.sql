-- Next-session queue cache for Content Agent (SRS reads first via queue-builder.js)
CREATE TABLE IF NOT EXISTS next_session_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  skill_id INT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  queue_order INT NOT NULL CHECK (queue_order >= 0 AND queue_order < 100),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_next_session_queue_student_skill
  ON next_session_queue(student_id, skill_id);

-- One insight row per student per calendar week (UTC Monday week_start matches dashboard)
DELETE FROM weekly_insights wi
WHERE wi.id IN (
  SELECT id
  FROM (
    SELECT id,
      ROW_NUMBER() OVER (
        PARTITION BY student_id, week_start
        ORDER BY created_at DESC NULLS LAST, id
      ) AS rn
    FROM weekly_insights
  ) ranked
  WHERE ranked.rn > 1
);

ALTER TABLE weekly_insights
  ADD CONSTRAINT weekly_insights_student_week_unique UNIQUE (student_id, week_start);

-- Insight Agent: flag IEP-related concerns for parent visibility
CREATE TABLE IF NOT EXISTS iep_concern_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  skill_id INT REFERENCES skills(id) ON DELETE SET NULL,
  concern_text TEXT NOT NULL CHECK (char_length(concern_text) <= 4000),
  dismissed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_iep_concern_flags_student_created
  ON iep_concern_flags(student_id, created_at DESC);
