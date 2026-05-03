-- IEP PDF uploads (one active document per student).
CREATE TABLE iep_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES students(id),
  uploaded_at TIMESTAMPTZ DEFAULT NOW(),
  file_path TEXT NOT NULL,
  extracted_text TEXT,
  active BOOLEAN DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_iep_documents_student_active
  ON iep_documents (student_id)
  WHERE active = TRUE;

INSERT INTO agents (name, description, schedule_cron, enabled)
VALUES (
  'curriculum',
  'Reads the uploaded IEP PDF and flags drift between IEP goals and current skill targets.',
  '0 6 * * 3',
  TRUE
)
ON CONFLICT (name) DO UPDATE SET
  description = EXCLUDED.description,
  schedule_cron = EXCLUDED.schedule_cron,
  enabled = EXCLUDED.enabled;
