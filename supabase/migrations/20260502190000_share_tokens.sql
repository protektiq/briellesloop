CREATE TABLE share_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES students(id),
  token TEXT UNIQUE NOT NULL,
  scope TEXT NOT NULL DEFAULT 'read_only',
  expires_at TIMESTAMPTZ NOT NULL,
  last_accessed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_share_tokens_student_id ON share_tokens (student_id);
