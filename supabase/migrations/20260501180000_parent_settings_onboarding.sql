-- Phase 6: durable first-time onboarding completion flag.
ALTER TABLE parent_settings
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;

COMMENT ON COLUMN parent_settings.onboarding_completed_at IS
  'When set, parent finished first-time onboarding (interests, PIN, session length).';

-- Existing installs that already set a parent PIN are treated as onboarded.
UPDATE parent_settings
SET onboarding_completed_at = NOW()
WHERE onboarding_completed_at IS NULL
  AND parent_pin_hash IS NOT NULL;
