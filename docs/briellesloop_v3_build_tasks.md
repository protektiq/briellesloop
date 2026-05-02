# Brielle's Loop v3 — Build Tasks

This document contains the full sequence of build tasks for v3, formatted as prompts for Claude Code or Cursor Plan Mode.

## How to use this document

For each task:
1. Paste the prompt into your AI coding tool
2. Review the generated plan before building — edit if it goes off-script
3. Verify the exit criteria before moving to the next task
4. Keep `docs/PRD_v3.md` open as reference context

Tasks build on each other. Don't skip ahead. The v2 codebase is assumed complete and running.

---

## Task 1 — Complete Open v2 Items

### Context
Two functional requirements from v2 are unfinished. This task closes them before building anything new.

**Item A (FR-5):** The Frustration Agent writes signals to `student_tuning` with names like `frustration_signal:consecutive_wrong`. The practice page evaluates static rules (2 wrong in a row, >60s) but never reads the agent's learned signals. The agent prompt documents three valid signal types: `consecutive_wrong`, `seconds_on_item`, `session_attempts`.

**Item B (FR-15):** `srs.js` evaluates tier advancement per item. The PRD requires a cross-item check: skill-level advancement requires ≥ 80% accuracy AND avg response time < 30s across 10+ distinct Tier-3 items within the skill. This guard is missing.

```
Read docs/PRD_v3.md section 4 in full. Also read:
- backend/src/services/srs.js (the full file)
- backend/src/routes/sessions.js (specifically the attempt endpoint)
- frontend/src/pages/PracticePage.jsx (the frustration trigger logic, search for "consecutiveWrong" and "frustrationTimeMs")
- backend/src/agents/prompts/frustration.md (the signal_type registry)

Goal: Close two open v2 functional requirements.

### Item A — Frustration Agent Signal Evaluation

1. Add GET /api/student/:studentId/tuning to backend/src/routes/student-profile.js
   - Queries student_tuning WHERE student_id = $1
   - Returns rows as an array of { parameter_name, current_value }
   - Validate studentId is a valid UUID; return 400 if not

2. In PracticePage.jsx, add a useEffect that fetches /api/student/:studentId/tuning on
   mount (after studentId is resolved from the session). Store the result in a ref —
   not state, because re-rendering on tuning load is not needed.

3. Add a evaluateFrustrationSignals(tuningRows, sessionState) function inside
   PracticePage.jsx (not exported):
   - sessionState is { consecutiveWrong, secondsOnCurrentItem, sessionAttemptCount }
   - Reads tuning rows where parameter_name LIKE 'frustration_signal:%'
   - For each row, extract the signal_type suffix and threshold (current_value)
   - Evaluate:
     - 'consecutive_wrong' or 'wrong_streak': fire if consecutiveWrong >= threshold
     - 'seconds_on_item' or 'slow_item_seconds' or 'time_on_item': fire if
       secondsOnCurrentItem >= threshold
     - 'session_attempts': fire if sessionAttemptCount >= threshold
     - Unknown types: console.warn and skip — do NOT throw
   - Returns { shouldOffer: boolean, reason: string | null }

4. In the existing frustration-check useEffect (the one that calls setBreakOfferReason),
   also call evaluateFrustrationSignals. If it returns shouldOffer = true AND no static
   rule has already fired, setBreakOfferReason(reason) to trigger the brain break offer.
   The static rules are unchanged — this is purely additive.

### Item B — Cross-Item Skill-Level Advancement Guard

5. In backend/src/services/srs.js, add:
   checkSkillLevelAdvancement(itemMasteryRows, tuning)
   - itemMasteryRows: array of item_mastery rows for the skill (pre-fetched by the caller)
   - Each row must have: tier, total_correct, total_attempts, avg_response_time_seconds
   - Filters to Tier-3 items only
   - Counts eligible items (tier === 3)
   - Computes avg accuracy = sum(total_correct) / sum(total_attempts) across those items
   - Computes avg response time = average of avg_response_time_seconds across those items
   - Reads thresholds from tuning: tier_advance_accuracy (default 80%), 
     tier_advance_response_time (default 30s), plus a new 'tier_advance_min_items' 
     parameter (default 10)
   - Returns { shouldAdvance: boolean, eligibleCount: number, avgAccuracy: number, 
     avgResponseTime: number }

6. In the attempt endpoint (backend/src/routes/sessions.js or items.js — wherever
   shouldAdvanceSkillLevel is currently called):
   - After updating item_mastery, query all item_mastery rows for this student + skill
   - Call checkSkillLevelAdvancement with those rows and the student's tuning
   - Only update student_skill_levels.level if shouldAdvance is true AND
     eligibleCount >= tier_advance_min_items
   - Log the decision (at debug level) so it's visible in the backend logs

7. Add a migration 20260502130000_tuning_min_items.sql that inserts
   ('tier_advance_min_items', 10, 10, 5, 20) into student_tuning for the existing
   student (use the student_id from the students table, not a hardcoded UUID).

8. Update the existing Vitest tests in srs.test.js to cover checkSkillLevelAdvancement:
   - Returns shouldAdvance = false when eligibleCount < 10
   - Returns shouldAdvance = true when eligibleCount >= 10, accuracy >= threshold, time < threshold
   - Respects tuning overrides

Constraints:
- evaluateFrustrationSignals must never throw — unknown signal types are warn-and-skip
- checkSkillLevelAdvancement must be a pure function (no DB calls, testable)
- The existing shouldAdvanceSkillLevel function in srs.js is either refactored into
  checkSkillLevelAdvancement or kept alongside it — do not break the existing tests

Exit: All srs.js tests pass. A frustration_signal row in student_tuning causes a brain
break offer to appear in the practice page when its threshold is crossed. Skill level
advancement no longer fires with fewer than 10 Tier-3 items.
```

**Exit criteria:**
- `npm test` passes all srs.js tests including new ones
- Manually inserting a `frustration_signal:consecutive_wrong` row with threshold 1 into `student_tuning` causes every wrong answer to offer a brain break
- `checkSkillLevelAdvancement` returns `shouldAdvance: false` when queried against a student with only 5 Tier-3 items

---

## Task 2 — Writing Skill Module

### Context
The IEP identifies SBAC Level 1 writing (grade-level paragraphs, proper conventions at 80%) as a goal. No skill module addresses this. Writing is the most open-ended skill: prompts are broad, grading is rubric-based (not answer-matching), and tier advancement is score-based rather than speed-based.

```
Read docs/PRD_v3.md section 5 (FR-30 through FR-33) in full.
Read frontend/src/components/practice/PracticeSkillViews.jsx and understand how other
skill views (Math, Reading, Spelling, Typing) are structured — writing will follow the
same dispatch pattern.
Read backend/src/prompts/math-generator.md and backend/src/prompts/math-grader.md as
style references for the new writing prompts.

Goal: Build the writing skill module end-to-end.

Tasks:

1. Add the writing skill to the database:
   - Migration 20260502140000_writing_skill.sql
   - INSERT into skills: name='writing', iep_goal_text='Grade-level paragraphs with
     proper conventions (capitalization, punctuation, sentence variety) at 80% rubric
     score. SBAC Level 1 → Level 2 target.', iep_target_pct=70
   - INSERT student_skill_levels for the existing student: skill_id=(writing), level=1
   - INSERT default student_tuning rows for writing: session_item_count=1 (writing
     sessions are one prompt at a time — a full paragraph is a session's work)

2. Seed writing prompt templates:
   - Migration 20260502150000_writing_seed.sql
   - Insert ~20 items into the items table with skill_id=(writing):
     - Levels 1–2: single-topic prompts ("Write a paragraph about your favorite animal
       using at least two details.")
     - Levels 3–4: contrast or opinion prompts ("Write a paragraph explaining which
       season you prefer and why. Use at least one transition word.")
     - All prompts should be interest-flexible — the generator fills in Brielle's
       current interest topic at render time
   - item_type = 'writing_prompt'; prompt JSONB = { "topic_template": "...",
     "min_words": 40, "max_words": 120, "rubric_focus": [...] }

3. Build backend/src/prompts/writing-generator.md:
   - System prompt for generating a rendered writing prompt from a template
   - Must include: student level, current interests, IEP writing goal text,
     topic_template from the item, min/max word guidance, rubric criteria
   - Output: { rendered_prompt: string, word_count_guidance: string,
     rubric_criteria: [{ name, description, max_points }] }

4. Build backend/src/prompts/writing-grader.md:
   - System prompt for grading a paragraph response
   - Four criteria from PRD §5: Conventions (25pts), Sentence Variety (25pts),
     Main Idea (25pts), Detail (25pts)
   - Must return JSON: { total: 0–100, criteria: { conventions: N, sentence_variety: N,
     main_idea: N, detail: N }, feedback: string, encouragement: string }
   - Instructions: be encouraging; do not penalize topic choices; grade only what
     the rubric specifies

5. Add writing generation and grading to content-generator.js and grader.js:
   - generateWritingRendition(template, student): calls Claude with writing-generator prompt
   - gradeWritingAttempt(rendition, userResponse, responseTimeSeconds): calls Claude with
     writing-grader prompt
   - Both cache to ai_generations as other skills do
   - gradeWritingAttempt returns the full JSON from the grader, not just { correct }

6. Add the WritingSkillView component to PracticeSkillViews.jsx:
   - Displays the rendered prompt
   - Textarea with live word count (plain JS, no library)
   - Word count guidance shown below the textarea (e.g., "Aim for 40–80 words")
   - Submit button enables when word count > 10 (do not enforce min; guidance only)
   - After submission, show rubric score breakdown: four criteria with filled bars and
     total score out of 100
   - Encouragement text from Claude displayed below the rubric
   - Match the existing card/panel aesthetic from components.css

7. Wire WritingSkillView into PracticePage.jsx dispatch (same safeSkillName switch
   that routes to SpellingSkillView, MathSkillView, etc.)

8. Update the SRS tier advancement for writing in srs.js:
   - Writing uses the same five tiers but correct = (rubric_total >= 70)
   - Tier 3 → 4 requires 6 correct (≥70) across 3+ distinct sessions AND all_under_20s
     is ignored for writing (writing is not time-gated)
   - Add a skillType parameter to calculateNextTier: when skillType = 'writing',
     skip the all_responses_under_20s requirement for Tier 4

9. Update SessionCompletePage.jsx to show the writing rubric breakdown for writing
   sessions (currently only shows accuracy %). Pull from the attempt's user_response
   JSONB if present.

10. Update ParentDashboardPage.jsx to add a Writing accuracy bar alongside the existing
    four skills (it will be empty until the first writing session).

Constraints:
- Writing sessions have session_item_count = 1. The session ends after one writing prompt.
- The textarea must NOT call any AI while the student is typing — only on submit
- Do not add a word count minimum enforcement (guidance only)
- The skill dispatch in PracticePage must not duplicate session management logic —
  only the skill view component changes per skill

Exit: A full writing session runs: prompt renders, student types a paragraph, Claude
grades with a rubric breakdown, session ends. Tier advancement does not fire at 0 Tier-3
items. Parent dashboard shows a writing accuracy bar.
```

**Exit criteria:**
- Writing skill appears in the skill picker on Today page
- Paragraph submission returns a rubric breakdown in the UI
- SessionComplete shows rubric scores for writing sessions
- Attempting to advance writing skill level with 0 Tier-3 items does nothing

---

## Task 3 — Voice Input + Passage TTS

### Context
Brielle has a reading-aloud goal in her IEP that no existing module addresses. Typing is also a friction point for math answers on slow days.

**TTS (output):** All speech synthesis uses **Kokoro TTS** (`kokoro-js`) on the Express backend. The existing `window.speechSynthesis` call in `useSpellingSpeech` is replaced with a fetch to `GET /api/tts`. The frontend plays audio via an `<Audio>` element. This gives a noticeably more natural voice than the browser default with no API cost and no Python runtime.

**Voice input (listening):** Browser `SpeechRecognition` API. Remains browser-native.

Voice features are additive — typing remains the default.

```
Read docs/PRD_v3.md section 6 (FR-34 through FR-37) in full.
Read frontend/src/components/practice/PracticeSkillViews.jsx — specifically
useSpellingSpeech (around line 206) which currently calls window.speechSynthesis.
This hook is being replaced with a fetch to the Kokoro backend endpoint.
Read backend/src/prompts/reading-grader.md to understand how reading responses are graded.

Goal: Replace window.speechSynthesis with Kokoro TTS, add voice input for math/spelling,
and add passage TTS with follow-along for reading.

### Part A — Kokoro TTS Backend Service

1. Install kokoro-js in the backend workspace:
   npm install kokoro-js
   (run from the backend/ directory)

2. Build backend/src/services/tts.js:
   - Import KokoroTTS from 'kokoro-js'
   - Initialize the model once at module load time (not per-request):
       const tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-ONNX',
         { dtype: 'q8' })
   - Export async synthesize(text, voice = 'af_sky'):
     - Calls tts.generate(text, { voice })
     - Returns a Buffer of WAV audio data
   - Export AVAILABLE_VOICES array (at minimum: 'af_sky', 'af_bella', 'am_adam')
   - Warm the model at startup with a short test string so the first real request
     is not slow; log "Kokoro TTS ready" when complete

3. Add GET /api/tts in backend/src/routes/ai.js (or a dedicated tts.js route):
   - Query params: text (required, max 2000 chars), voice (optional, default 'af_sky')
   - Validate text is non-empty and voice is in AVAILABLE_VOICES
   - Call synthesize(text, voice), respond Content-Type: audio/wav
   - Set Cache-Control: public, max-age=86400 (output is deterministic for same inputs)

4. Add GET /api/tts/voices returning the AVAILABLE_VOICES array as JSON.

5. Replace useSpellingSpeech in frontend/src/components/practice/PracticeSkillViews.jsx:
   - Remove all window.speechSynthesis / SpeechSynthesisUtterance code
   - Fetch GET /api/tts?text=WORD&voice=SELECTED_VOICE, receive blob, create object URL
   - Play via new Audio(objectURL); store audio ref for cleanup
   - Keep the same hook signature: useSpellingSpeech(wordForSpeech, itemId)
   - Keep the lastSpokenRef guard (plays once per new item)
   - On unmount or new word: audio.pause(), URL.revokeObjectURL(objectURL)

### Part B — Voice Input Hook

6. Build frontend/src/hooks/useSpeechInput.js:
   - Uses window.SpeechRecognition || window.webkitSpeechRecognition
   - Returns { isListening, transcript, startListening, stopListening, isSupported, error }
   - isSupported: false when SpeechRecognition is unavailable — components hide the
     mic button rather than showing a broken one
   - Auto-stops after 10 seconds of silence (continuous = false)
   - Clears transcript on each new startListening call
   - Error cases: 'not-allowed', 'no-speech', 'audio-capture' — set error, do not throw

7. Add a MicButton component in frontend/src/components/MicButton.jsx:
   - Inline SVG microphone icon (no icon library)
   - Props: onTranscript(text), disabled
   - Three states: idle, listening (pulsing CSS animation), error
   - On click: startListening; on recognition end: onTranscript(transcript)
   - Renders nothing if isSupported is false

8. Add MicButton to MathSkillView in PracticeSkillViews.jsx:
   - Below the answer input; transcript populates the input value
   - Student reviews and edits before clicking Check

9. Add "Say it back" toggle to SpellingSkillView:
   - Behind voice_spelling_enabled settings flag
   - When enabled: after Kokoro speaks the word, show MicButton instead of text input
   - Transcript graded with exact string match; default: off

### Part C — Passage TTS + Follow-Along

10. Add a "Read to me" button to ReadingSkillView in PracticeSkillViews.jsx:
    - On click: fetch GET /api/tts?text=PASSAGE&voice=SELECTED_VOICE, play via Audio element
    - Sentence-level highlighting: split passage into sentences on punctuation boundaries.
      Estimate each sentence's playback duration as:
        durationMs = (wordCount / 150) * 60 * 1000
      Use chained setTimeout calls (started when audio.play() resolves) to advance a
      CSS highlight class across sentence <span> elements as the audio progresses.
    - "Stop" button while playing: audio.pause(), cancel pending timeouts, revoke URL
    - audio.onended: clear highlight state
    - tts_used: useRef set to true on first play; included in attempt submission as
      user_response: { ..., passage_tts_used: true }
    - On unmount: audio.pause(), revoke object URL

11. Update POST /api/items/:id/attempt to accept and store passage_tts_used in
    attempts.user_response without overwriting other fields.

### Part D — Reading-Aloud Mode

12. Add a "Read it aloud" button to ReadingSkillView (separate from "Read to me"):
    - Shows MicButton while passage is displayed (before questions begin)
    - Listens to the student reading the passage aloud
    - On transcript received: POST /api/ai/fluency with
      { rendition_id, passage_text, spoken_text, response_time_seconds }
    - Result shown as a fluency card: WPM, accuracy %, missed words
    - Stored in attempts.user_response.fluency — does NOT affect is_correct or SRS

13. Add POST /api/ai/fluency endpoint in backend/src/routes/ai.js:
    - Build backend/src/prompts/reading-fluency.md
    - Input: passage_text, spoken_text, response_time_seconds
    - Output: { words_per_minute: N, accuracy_pct: N, missed_words: [string] }
    - Cache in ai_generations

14. Add a "Reading Fluency" trend chart to ParentDashboardPage.jsx:
    - GET /api/dashboard/fluency: last 7 reading sessions with fluency data in
      attempts.user_response
    - Recharts line chart; hidden if fewer than 2 data points

### Part E — Settings

15. Add voice settings to SettingsPage.jsx:
    - "Voice input for math" toggle (default on if SpeechRecognition available)
    - "Say it back (spelling)" toggle (default off)
    - Voice selector dropdown from GET /api/tts/voices
    - Migration 20260502160000_voice_settings.sql:
      ADD COLUMN voice_math_enabled BOOLEAN DEFAULT TRUE,
      ADD COLUMN voice_spelling_enabled BOOLEAN DEFAULT FALSE,
      ADD COLUMN tts_voice TEXT DEFAULT 'af_sky'
    - Save to parent_settings via existing PUT /api/parent/settings

Constraints:
- Voice features are NEVER required — typing fallback always present
- "Read it aloud" fluency mode does not affect SRS
- audio.pause() + URL.revokeObjectURL() on unmount (no ghost audio)
- MicButton pulsing animation must be CSS-only
- Kokoro model loads once at server startup — NOT per request

Exit: Spelling words are spoken in the Kokoro voice (verify by disabling OS TTS —
spelling still speaks). Math session completable with voice input. Reading passage plays
Kokoro audio with sentence highlighting. Reading-aloud mode produces WPM score.
```

**Exit criteria:**
- Spelling TTS uses Kokoro audio, not browser speechSynthesis
- MicButton appears on math view; transcript populates answer field (Chrome)
- "Read to me" plays Kokoro audio with sentence highlight advancing
- "Read it aloud" returns fluency JSON and stores it in the attempt
- Voice selector in settings changes the Kokoro voice used on next TTS call

---

## Task 4 — Teacher / IEP-Team View

### Context
Brielle's teacher and IEP team need to see progress without requiring the parent to export a PDF each time. The model is a one-time share token — similar to how Google Docs "share with link" works. No teacher account, no real auth, just a token with an expiry.

```
Read docs/PRD_v3.md section 7 (FR-38 through FR-40) in full.
Read frontend/src/pages/ParentDashboardPage.jsx to understand the existing dashboard
data and components — the teacher view reuses most of them.
Read backend/src/routes/parent.js and backend/src/routes/dashboard.js.

Goal: Build the teacher/IEP-team read-only dashboard with share token management.

Tasks:

1. Migration 20260502170000_share_tokens.sql:
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

2. Backend endpoints in backend/src/routes/share.js:
   - POST /api/share/token: generates a 64-character crypto.randomBytes token, inserts
     into share_tokens with expires_at = NOW() + 30 days (configurable via request body
     days param, max 90), returns { token, url, expires_at }
   - GET /api/share/tokens: lists all tokens for the student (active + revoked)
   - DELETE /api/share/token/:id: sets revoked_at = NOW() on that row
   - GET /api/share/validate/:token: validates token (not expired, not revoked),
     updates last_accessed_at, returns { valid: boolean, student_name: string }

3. Frontend route frontend/src/pages/TeacherDashboardPage.jsx:
   - Route: /share/:token
   - On mount: calls GET /api/share/validate/:token
     - If invalid or expired: shows a clear "This link has expired or is not valid" message
     - If valid: shows the read-only dashboard
   - The read-only dashboard shows:
     - Student's first name only (no last name, no DOB)
     - 4 stat cards (same as ParentDashboardPage)
     - Per-skill accuracy bars with 80% IEP target line
     - Mood trend chart
     - Reading fluency chart (if data exists)
     - Latest weekly insight text
   - The read-only dashboard does NOT show:
     - Agent activity
     - Pending approvals
     - Settings
     - Share token management
     - Any admin controls

4. Add /share/:token to frontend/src/App.jsx (or wherever routes are defined).
   This route must NOT be wrapped in the PIN gate or the persistent nav.

5. Share token management UI in SettingsPage.jsx:
   - New "Share with IEP team" section
   - "Generate link" button → calls POST /api/share/token → copies URL to clipboard
     and shows a success toast ("Link copied! Valid for 30 days.")
   - Active tokens listed as a table: Created, Expires, Last accessed, Revoke button
   - Revoke calls DELETE /api/share/token/:id and removes from list
   - Display note: "Anyone with this link can view Brielle's dashboard. It expires
     automatically. Do not share publicly."

6. Register share.js routes in backend/src/server.js.

Constraints:
- /share/:token must NOT require the parent PIN — it is the teacher's entry point
- The teacher view must not expose any endpoint that allows data modification
- Token generation uses crypto.randomBytes(32).toString('hex') — 64 hex chars, not uuid
- Do not add CORS changes — the teacher uses the same machine (same origin) in v3;
  cross-origin teacher access is a v4 concern when cloud sync is available

Exit: Parent generates a token in Settings, opens the URL in an incognito window
(no PIN entered), sees the read-only dashboard with real data. Revoking the token
makes the URL show the expired-link message.
```

**Exit criteria:**
- Token generates and copies to clipboard
- `/share/:token` renders dashboard data without PIN
- Expired/revoked tokens show the error message
- Token table in settings updates on revoke

---

## Task 5 — Session Reminders

### Context
Daily practice depends on Brielle and the parent remembering. A single daily browser notification reduces that friction without being intrusive. This is deliberately minimal — one notification per day, easy to disable.

```
Read docs/PRD_v3.md section 9 (FR-44 through FR-45).
Read backend/src/services/agent-scheduler.js to understand how cron jobs are registered.
Read backend/src/routes/parent.js to see where parent_settings is read/written.

Goal: Add a daily session reminder via the Web Notifications API.

Tasks:

1. Migration 20260502180000_reminder_settings.sql:
   ALTER TABLE parent_settings
     ADD COLUMN IF NOT EXISTS reminder_enabled BOOLEAN DEFAULT FALSE,
     ADD COLUMN IF NOT EXISTS reminder_time TIME DEFAULT '16:00:00';

2. Update GET /api/parent/settings and PUT /api/parent/settings (or equivalent) to
   include reminder_enabled and reminder_time in the response and accept them in the body.

3. Build backend/src/services/reminder-scheduler.js:
   - Reads parent_settings.reminder_enabled and reminder_time on startup and whenever
     the settings are saved (expose a rescheduleReminder() function)
   - Uses node-cron to schedule a daily job at the configured time
   - The cron job sends a push notification payload to a pending SSE connection
     (see step 4) — it does NOT use OS-level push, just browser Notifications API
   - Before firing, checks if a session was already completed today (SELECT 1 FROM
     sessions WHERE ended_at::date = CURRENT_DATE) — if yes, skip the notification

4. Build a minimal SSE endpoint GET /api/notifications/stream in a new
   backend/src/routes/notifications.js:
   - Opens a text/event-stream response that stays open
   - When reminder-scheduler fires, pushes a notification event with
     { type: 'reminder', message: "Time for Brielle's practice!", streak: N }
   - Streak N comes from a streak query (count of consecutive days with ended sessions)

5. In frontend: add a NotificationListener component mounted in App.jsx (root level):
   - On first mount, requests Notification permission if not yet granted
   - Opens EventSource to /api/notifications/stream
   - On 'reminder' event: calls new Notification("Brielle's Loop", { body: message })
   - If Notification permission is denied: shows nothing, logs to console

6. Add reminder settings to SettingsPage.jsx:
   - "Daily reminder" toggle (calls PUT /api/parent/settings)
   - Time picker input (type="time") shown when toggle is on
   - On change: saves immediately via PUT /api/parent/settings, calls rescheduleReminder()
     on the backend via POST /api/notifications/reschedule (a simple trigger endpoint)
   - Shows a test button "Send test notification now" (calls POST /api/notifications/test)

Constraints:
- The notification does not fire if a session was already completed today
- The SSE connection should reconnect automatically on disconnect (EventSource handles this)
- Do NOT install a service worker or use the Push API — browser tab must be open
- The reminder feature does not require any native OS permissions beyond browser Notifications

Exit: With reminder_enabled=true and a time 1 minute from now (for testing), a browser
notification appears. Completing a session before the reminder time prevents it from
firing.
```

**Exit criteria:**
- Toggle and time picker save to `parent_settings`
- Test notification button fires a visible browser notification
- Completing a session suppresses the day's reminder

---

## Task 6 — IEP PDF Upload + Curriculum Alignment Agent

### Context
The four existing agents adapt learning within the current IEP goals. None of them reads the IEP itself. The Curriculum Alignment Agent (the fifth agent) reads the uploaded IEP PDF, compares it to the current skill targets and performance data, and flags drift. All proposals require parent approval.

```
Read docs/PRD_v3.md section 10 (FR-46 through FR-48) and section 12 (the fifth agent).
Read backend/src/agents/agent-common.js and backend/src/agents/calibration-agent.js
as reference for how agents are structured.
Read backend/src/agents/tools/db-tools.js and action-tools.js for existing tool patterns.

Goal: Build IEP PDF upload + the Curriculum Alignment Agent.

### Part A — IEP PDF Storage

1. Migration 20260502190000_iep_documents.sql:
   CREATE TABLE iep_documents (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     student_id UUID REFERENCES students(id),
     uploaded_at TIMESTAMPTZ DEFAULT NOW(),
     file_path TEXT NOT NULL,
     extracted_text TEXT,
     active BOOLEAN DEFAULT TRUE
   );

2. Install pdf-parse: npm install pdf-parse (in backend workspace).

3. Add POST /api/iep/upload in backend/src/routes/iep.js:
   - Accepts multipart/form-data with a PDF file field ('iep_pdf')
   - Use multer for file upload (install: npm install multer in backend)
   - Saves file to backend/data/iep/ directory (create if not exists)
   - Calls pdf-parse on the saved file to extract text
   - Deactivates any existing active iep_documents row for this student
     (UPDATE iep_documents SET active=FALSE WHERE student_id=$1)
   - Inserts new iep_documents row with file_path and extracted_text
   - Returns { id, extracted_text_preview: first 300 chars }

4. Add GET /api/iep/document to return the current active iep_documents row
   (id, uploaded_at, extracted_text_preview).

5. Add IEP upload UI to SettingsPage.jsx:
   - "Upload IEP Document" section
   - File input accepting .pdf only
   - On upload: POST to /api/iep/upload, show success with a preview of extracted text
   - Show current document: uploaded date, first 300 chars of extracted text
   - Show a warning if no document has been uploaded ("The Curriculum Agent cannot run
     without an IEP document.")

### Part B — Curriculum Alignment Agent

6. Add new tools to backend/src/agents/tools/db-tools.js:
   - query_iep_document(student_id): returns extracted_text and uploaded_at from
     the active iep_documents row. Returns null if no document exists.

7. Add new action tool to backend/src/agents/tools/action-tools.js:
   - propose_iep_goal_update(skill_id, proposed_goal_text, rationale):
     creates an agent_action with action_type='iep_goal_update',
     before_value={ current: skills.iep_goal_text },
     after_value={ proposed: proposed_goal_text },
     requires_approval=TRUE
   - propose_level_override(student_id, skill_id, new_level, rationale):
     creates an agent_action with action_type='level_override',
     before_value={ current: student_skill_levels.level },
     after_value={ proposed: new_level },
     requires_approval=TRUE
   - When these actions are approved via the existing approval flow, the approve
     handler must handle the new action_types:
     - 'iep_goal_update': UPDATE skills SET iep_goal_text=$1 WHERE id=$2
     - 'level_override': UPDATE student_skill_levels SET level=$1 WHERE student_id=$2 AND skill_id=$3

8. Build backend/src/agents/curriculum-agent.js following the pattern in
   calibration-agent.js:
   - Uses agent-runner.js for the tool-use loop
   - Tools: query_iep_document, query_iep_goals, query_skill_trends, query_week_summary,
     propose_iep_goal_update, propose_level_override
   - Schedule: '0 6 * * 3' (Wednesday 6am)
   - If query_iep_document returns null: logs "No IEP document uploaded; skipping run"
     and exits without calling Claude

9. Build backend/src/agents/prompts/curriculum.md:
   - Purpose: compare IEP document text against current skill targets and performance
   - Tone: conservative — flag uncertainty, prefer observation over proposals
   - Instructions: only propose changes when IEP text clearly describes a goal not
     reflected in current skill targets, OR when performance data shows a goal is met
     or unreachably misaligned
   - Reminder: all proposals require parent approval; state this explicitly in rationale
   - Include example reasoning chain from PRD §10 (FR-47)

10. Add curriculum agent to the scheduler in agent-scheduler.js.

11. Add curriculum agent entry to the agents table seed data or migration:
    INSERT INTO agents (name, description, schedule_cron, enabled)
    VALUES ('curriculum', 'Reads the uploaded IEP PDF and flags drift between IEP goals
    and current skill targets.', '0 6 * * 3', TRUE);

12. Add curriculum agent to the Agent Activity page (it uses the same
    agent_runs / agent_actions display as other agents — no new UI needed, just
    verify its entries appear in the feed).

Constraints:
- All proposals require_approval=TRUE — the curriculum agent never writes to skills
  or student_skill_levels directly
- If pdf-parse fails on a corrupted PDF, return a 400 error with a helpful message
- The extracted text is stored in plain text only — no markdown conversion
- Agent must exit cleanly if no IEP document exists

Exit: Upload a PDF (use a plain text PDF for testing). Manually trigger the curriculum
agent via POST /api/agents/curriculum/run. Verify: agent_runs row appears, agent reads
the IEP text, produces at least one propose_iep_goal_update or propose_level_override
action, action appears in the Activity Feed pending approval.
```

**Exit criteria:**
- PDF upload extracts text and stores in `iep_documents`
- Settings page shows extracted text preview
- Manual trigger of curriculum agent produces `agent_runs` and `agent_actions` rows
- Approving a `propose_level_override` action updates `student_skill_levels`

---

## Task 7 — Agent Simulation Mode + Agent Notes

### Context
Before this task, changing an agent's prompt is dangerous — you find out if it's worse or better by running it on live sessions. Simulation mode runs the agent against historical data with writes intercepted, so you can compare what the agent would have done vs what actually happened. Agent notes allow agents to share observations between runs.

```
Read docs/PRD_v3.md section 11 (FR-49 through FR-51) and section 12 (FR-52).
Read backend/src/services/agent-runner.js in full — simulation mode is a modification
of the same runner.
Read backend/src/agents/tools/db-tools.js and action-tools.js.

Goal: Build simulation mode, agent notes, and the prompt editor.

### Part A — Agent Notes

1. Migration 20260502200000_agent_notes.sql:
   CREATE TABLE agent_notes (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     from_agent_id INT REFERENCES agents(id),
     to_agent_id INT REFERENCES agents(id),
     note_type TEXT NOT NULL CHECK (note_type IN ('observation', 'flag', 'suggestion')),
     content JSONB NOT NULL,
     created_at TIMESTAMPTZ DEFAULT NOW(),
     read_at TIMESTAMPTZ
   );

2. Add to backend/src/agents/tools/db-tools.js:
   - read_agent_notes(to_agent_id, unread_only): SELECT from agent_notes WHERE
     (to_agent_id IS NULL OR to_agent_id=$1) AND (unread_only=false OR read_at IS NULL)
     ORDER BY created_at DESC LIMIT 20. Sets read_at=NOW() on returned rows.

3. Add to backend/src/agents/tools/action-tools.js:
   - write_agent_note(from_agent_id, to_agent_id, note_type, content): INSERT into
     agent_notes. to_agent_id may be null (broadcast). Returns the new row id.

4. Add read_agent_notes and write_agent_note to the tool lists for all five agents.
   No agent is required to use them; they are available.

5. Add an "Agent Notes" section to the Agent Activity page below the runs feed:
   - Shows the last 20 agent_notes rows
   - Each entry: from agent name, to agent name (or "All"), note_type badge, content,
     timestamp, read status
   - Simple table or card list; no approval controls (notes are informational only)

### Part B — Prompt Editor

6. Add GET /api/agents/:name/prompt: reads the agent's .md file from
   backend/src/agents/prompts/:name.md and returns { name, prompt_text }

7. Add PUT /api/agents/:name/prompt: writes prompt_text to the filesystem at
   backend/src/agents/prompts/:name.md
   - Validate that :name is one of the five valid agent names
   - Validate that prompt_text is a non-empty string
   - Back up the current file to :name.md.bak before writing (allows one-level undo)

8. Add a "Prompt" section to each agent card on the Agent Activity page:
   - Expandable panel showing the current prompt text in a <textarea>
   - "Save" button calls PUT /api/agents/:name/prompt
   - "Restore backup" button calls a new PUT /api/agents/:name/prompt/restore endpoint
     that copies :name.md.bak back to :name.md if it exists
   - Show a warning: "Test prompt changes with Simulate before saving."

### Part C — Simulation Mode

9. Add a dry_run parameter to agent-runner.js:
   - Accepts: { agentName, systemPrompt, tools, messages, dryRun: boolean }
   - When dryRun=true: all write tools (propose_tuning_change, curate_queue,
     request_new_items, update_frustration_signals, write_weekly_insight, flag_iep_concern,
     propose_iep_goal_update, propose_level_override, write_agent_note) return a mock
     success response without executing the DB write
   - The mock response looks like a real success: { success: true, id: "dry-run-uuid",
     dry_run: true }
   - Read tools execute normally — they query real historical data
   - The run is logged to agent_runs with status='simulation' and dry_run=true
   - No agent_actions rows are created

10. Add POST /api/agents/:name/simulate endpoint:
    - Body: { date_from: ISO date, date_to: ISO date }
    - Validates the agent name and date range (max 90 days, date_from < date_to)
    - Temporarily sets a date-range filter context that read tools respect
      (each tool that accepts a date parameter passes these bounds instead of "last N days")
    - Runs agent-runner with dryRun=true
    - Returns the full agent_runs row including observations, reasoning, and
      a simulated_actions array (what the write tools would have done)

11. Add "Simulate" button to each agent card on the Agent Activity page:
    - Opens a date-range picker modal (two date inputs, max range 90 days)
    - Calls POST /api/agents/:name/simulate
    - Shows a loading state during the run (simulation may take 30–60 seconds)
    - Results displayed in a modal: agent observations, reasoning, and
      a list of "Would have done:" actions with their rationale
    - A side-panel or expandable section shows what actually happened in that period
      (query agent_actions for the same date range, status != 'simulation')

Constraints:
- Simulation MUST NOT write to agent_actions, student_tuning, next_session_queue,
  weekly_insights, iep_concern_flags, skills, or student_skill_levels
- The prompt editor textarea must not auto-save — only on explicit Save click
- The .bak file approach is one-level only; a second save overwrites the backup
- Simulation date-range queries should use the same tool functions, not a parallel
  set — pass the date range as parameters, don't fork the code

Exit: The Frustration Agent simulation runs against last week's data and returns
what signals it would have written. The prompt editor saves and restores the backup.
An agent note written by one agent appears in the notes feed.
```

**Exit criteria:**
- Simulation run completes without writing any DB rows (verify in Studio)
- Simulation results modal shows observations and `Would have done:` actions
- Agent note written by a manual trigger appears in the Agent Notes section
- Prompt edit, save, and restore-backup all work without errors

---

## Task 8 — Optional Cloud Sync

### Context
The app runs on one machine. The family may want to practice from a second computer or an iPad. Cloud sync makes this possible by mirroring local session data to a free Supabase cloud project. The local machine remains primary. This task is optional — it adds zero user-visible overhead if not configured.

```
Read docs/PRD_v3.md section 8 (FR-41 through FR-43) in full.
Read backend/src/db.js to understand how the local Postgres connection is configured.

Goal: Add optional cloud sync to a user-configured Supabase cloud project.

Tasks:

1. Migration 20260502210000_cloud_sync_tracking.sql:
   ALTER TABLE sessions ADD COLUMN IF NOT EXISTS cloud_synced BOOLEAN DEFAULT FALSE;
   ALTER TABLE attempts ADD COLUMN IF NOT EXISTS cloud_synced BOOLEAN DEFAULT FALSE;
   ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS cloud_synced BOOLEAN DEFAULT FALSE;
   ALTER TABLE weekly_insights ADD COLUMN IF NOT EXISTS cloud_synced BOOLEAN DEFAULT FALSE;

2. Add cloud sync settings to parent_settings:
   Migration 20260502220000_cloud_sync_settings.sql:
   ALTER TABLE parent_settings
     ADD COLUMN IF NOT EXISTS cloud_sync_enabled BOOLEAN DEFAULT FALSE,
     ADD COLUMN IF NOT EXISTS cloud_supabase_url TEXT,
     ADD COLUMN IF NOT EXISTS cloud_supabase_anon_key TEXT;

3. Build backend/src/services/cloud-sync.js:
   - Install @supabase/supabase-js (npm install @supabase/supabase-js in backend workspace)
   - Reads cloud_supabase_url and cloud_supabase_anon_key from parent_settings on startup
   - Exposes syncSession(sessionId): fetches the session + its attempts from local DB,
     upserts to cloud via supabase.from('sessions').upsert() and supabase.from('attempts').upsert()
     using the same UUIDs (idempotent)
   - Exposes syncAgentRun(runId): same pattern for agent_runs + agent_actions
   - Exposes syncInsight(insightId): same pattern for weekly_insights
   - All sync functions catch errors, log them, and return { synced: boolean, error? }
   - After successful sync, sets cloud_synced=TRUE on the local row

4. Call syncSession(sessionId) from POST /api/session/:id/end after ended_at is set.
   Do this async (don't await it on the request path) — sync failure must not fail
   the session end.

5. Add a background job in agent-scheduler.js that runs daily at 4am:
   - Queries all sessions/attempts/agent_runs/insights where cloud_synced=FALSE
   - Calls the corresponding sync function for each
   - Logs success/failure count

6. Add cloud sync settings to SettingsPage.jsx:
   - "Cloud sync" section with enable toggle, URL input, anon key input
   - "Test connection" button: calls POST /api/cloud-sync/test which creates a
     Supabase client with the provided credentials and runs a SELECT 1 equivalent
   - Connection status indicator: Connected / Not configured / Error
   - Sync stats: "X sessions synced, Y pending" (query cloud_synced counts from local DB)
   - Note: "Your Supabase cloud project must have the same schema as this app.
     Run the same migrations on your cloud project."

7. Add POST /api/cloud-sync/test and GET /api/cloud-sync/status endpoints in a new
   backend/src/routes/cloud-sync.js.

Constraints:
- Cloud sync is entirely optional — if cloud_sync_enabled=FALSE or credentials are
  not set, nothing in the existing flow changes
- Never sync parent_settings (contains credentials) or share_tokens to the cloud
- Sync is one-direction: local → cloud. Never pull from cloud to local.
- The cloud project must have the same schema — there is no migration runner for the
  cloud project in this task; the parent runs migrations manually on cloud Supabase
- Use upsert (not insert) so re-syncing is idempotent

Exit: Configure cloud sync with a real Supabase cloud project (create a free one for
testing). Complete a session. Verify the session row appears in cloud Supabase Studio.
Disable cloud sync. Complete another session. Verify that session does NOT appear in
the cloud.
```

**Exit criteria:**
- Test connection button returns success for valid credentials, error for invalid
- Session sync after `session/end` creates row in cloud Supabase (verify in cloud Studio)
- Pending sync job re-syncs missed rows
- Everything works unchanged when cloud sync is disabled

---

## Task 9 — Accessibility Pass + v3 Pilot

### Context
The app has had no formal accessibility testing. Brielle may also be used by other students with accessibility needs in future versions. This task does the full pass before the v3 pilot week.

```
Read docs/PRD_v3.md section 3.1 (accessibility in scope), section 17 (Task 9 in build plan).
Read frontend/src/pages/PracticePage.jsx, TodayPage.jsx, ParentDashboardPage.jsx,
BrainBreakPage.jsx, and SettingsPage.jsx — these are the five core pages.

Goal: Full accessibility pass + v3 pilot QA.

Tasks:

1. Keyboard navigation audit — every interactive element in every page must be:
   - Reachable via Tab key
   - Activatable via Enter or Space where appropriate
   - No keyboard traps (focus can always leave any element)
   - Specific fixes to make:
     a. All icon-only buttons must have aria-label
     b. Modal overlays (brain break offer, simulation results) must trap focus while open
        and restore focus to the trigger element when closed
     c. Mood emoji buttons must have aria-label (e.g., "Very sad, score 1")
     d. The skill tiles on TodayPage must be keyboard-selectable
     e. The breathing animation on BrainBreakPage must have aria-live="polite" on
        the countdown timer

2. ARIA audit — run through every page and add:
   - role="status" or aria-live="polite" on all dynamic feedback regions
     (grading result, error messages, score display)
   - aria-expanded on all toggle/expand controls
   - aria-busy="true" during loading states
   - aria-required on required form fields
   - aria-invalid when a form field has an error

3. Screen-reader smoke test — manually test with VoiceOver (macOS) or NVDA (Windows):
   - Navigate through a full math session using keyboard + screen reader
   - Verify grading feedback is announced
   - Verify brain break offer dialog is announced and controllable

4. Font size selector — verify it works across all new v3 components:
   - WritingSkillView textarea scales with font size
   - Fluency chart labels scale
   - All new settings sections scale
   - Fix any overflow or layout breaks caused by larger font sizes

5. Color contrast audit — check all text against WCAG AA (4.5:1 minimum):
   - Use the browser DevTools accessibility inspector
   - Fix any failing text/background combinations
   - Specifically check: the breathing animation text, the rubric score bars,
     the agent activity feed "SIMULATION" badge

6. Full v3 QA checklist (run before declaring pilot ready):
   - One full math session with voice input
   - One full math session with keyboard only
   - One full reading session with "Read to me" TTS
   - One full reading session with "Read it aloud" fluency mode
   - One full spelling session with say-it-back mode
   - One full typing session
   - One full writing session
   - Brain break: auto-trigger via 2 wrong in a row
   - Brain break: auto-trigger via agent frustration signal
   - Post-session reflection + mood capture
   - Parent dashboard with all charts
   - Export IEP PDF — verify writing section appears
   - Generate share token — verify teacher view in incognito
   - Upload an IEP PDF — verify text extraction
   - Manually trigger Curriculum Alignment Agent
   - Run simulation on Insight Agent against last 7 days
   - Edit agent prompt, save, restore backup
   - Enable and test daily reminder
   - Configure cloud sync and verify a session appears in cloud Studio
   - Approve a Calibration Agent tuning proposal
   - Revert a Content Agent queue action

Constraints:
- Do NOT add new features in this task
- Accessibility fixes should be minimal and targeted — fix the audit findings only
- If a chart is not screen-reader-accessible, add a visually-hidden data table alternative
  rather than reworking the chart itself

Exit: Brielle can use the app for one full week using only the keyboard (with mouse
available as fallback). Every QA checklist item passes without requiring code fixes.
```

**Exit criteria:**
- All QA checklist items pass
- No keyboard traps anywhere in the app
- VoiceOver or NVDA can complete a full math session
- Font size at 150% does not cause layout overflow on any page

---

## Operating Notes

**On order:** Tasks 1–3 should be done before showing v3 to Brielle. Tasks 4–8 can be done in any order once Task 3 is complete. Task 9 is always last.

**On cloud sync (Task 8):** If the family doesn't have a need for cross-device access, skip Task 8. It has no dependencies and can be added post-pilot.

**On simulation mode (Task 7):** Use simulation mode before modifying any agent prompt. The temptation will be to edit prompts directly after seeing a bad agent run — simulate first.

**On the writing module (Task 2):** Claude's rubric grading will need calibration. After the first week of writing sessions, read the raw grading JSON in Studio and adjust the grader prompt if scores seem systematically too high or too low.

**On PRD sync:** If any task produces a result that differs from PRD_v3.md, update the PRD to match the actual implementation. Future agents and tasks read the PRD as context — keeping it accurate matters.
