CREATE TABLE IF NOT EXISTS parent_settings (
  student_id UUID PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE,
  parent_pin_hash TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
