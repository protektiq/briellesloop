# Brielle's Loop — Product Requirements Document

**Version:** 3.0
**Date:** May 2, 2026
**Author:** Internal
**Status:** Draft for build

**Changes from v2.0:** Adds §4 writing skill module (the remaining IEP goal), voice input and passage TTS (§5), teacher/IEP-team sharing (§6), a fifth Curriculum Alignment Agent (§12), agent simulation mode (§12), optional cloud sync (§7), and local session reminders (§8). Completes three open v2 items: FR-5 proactive frustration trigger wiring (§4.1), FR-15 cross-item advancement guard (§4.3), and the full accessibility pass (§9).

**TTS engine decision:** All speech synthesis (spelling word reading, passage TTS, reading-aloud mode playback) uses **Kokoro TTS** (`kokoro-js` npm package) running on the Express backend, replacing the browser's `window.speechSynthesis`. Voice input (SpeechRecognition) remains browser-native — Kokoro is output only.

---

## 1. Context: What v2 Solved and What Remains

v2 delivered a complete local learning loop — mood check-in, four-skill practice, spaced repetition, CBT brain breaks, and a four-agent background intelligence layer. As of the v2 pilot, the application is running daily and producing usable data.

Three categories of work remain:

**Unfinished v2 items**
- The writing skill is in Brielle's IEP but is not yet a practice module (v1/v2 deferred it).
- Voice input and passage TTS were explicitly out-of-scope in v2 and are now the highest-value deferred feature based on her IEP's reading-aloud goal.
- The FR-5 proactive frustration trigger — where the Frustration Agent's learned signals drive brain-break offers — is wired in the schema but not evaluated in the practice loop.
- The FR-15 skill-level advancement guard (10+ Tier-3 items across the skill, not just per-item) is missing.

**Growth of the agent system**
- Four agents are running but they are isolated — they cannot share observations between runs. A Calibration Agent that reads a Frustration Agent signal mid-week would be more useful than one that waits for its own data.
- There is no way to evaluate whether an agent's prompt changes are an improvement before deploying them against live sessions. A simulation mode (run agent logic against historical data) is needed before prompt iteration becomes safe.
- The IEP document itself is not a data source for any agent. When Brielle's IEP is updated (annual review), nothing in the app changes automatically.

**Sharing and infrastructure**
- The parent dashboard is PIN-gated and local-only. Brielle's IEP team (teacher, specialist) cannot see progress without the parent being present.
- The app runs on one machine. If the family has two computers or an iPad, practice is inaccessible from them.
- There is no reminder mechanism — daily practice depends on the parent and Brielle remembering.

v3 addresses all of these.

---

## 2. Objectives & KPIs

All v2 KPIs are inherited. v3 adds:

| Objective | KPI | Target |
|---|---|---|
| Writing skill is practiced and improving | Writing module accuracy at the paragraph-conventions rubric | ≥ 70% at 12 weeks |
| Voice input reduces friction for slow typists | % of reading/math sessions using voice input at least once | ≥ 40% by week 4 |
| IEP team can access progress without a meeting | Teacher view accessed ≥ 1× before next IEP meeting | Qualitative: yes/no |
| Agent prompts can be safely iterated | Simulation mode used before any agent prompt update is deployed | 100% |
| Curriculum Alignment Agent catches IEP drift | IEP-relevant flags surfaced before they would otherwise appear in a human review | ≥ 2 meaningful flags in 3-month window |
| Daily reminders increase session consistency | Days practiced per week after enabling reminders vs. before | +0.5 days/week |

---

## 3. Scope

### 3.1 In Scope (v3)

- Writing skill module (paragraph composition, Claude-graded against a rubric)
- Voice input for math answers and spelling responses (browser Web Speech API — SpeechRecognition)
- Text-to-speech for reading passages (Kokoro TTS via backend, passage follow-along with timing-based sentence highlighting)
- Teacher/IEP-team read-only view (token-gated local URL, no account required)
- Curriculum Alignment Agent (fifth agent, reads IEP PDF directly)
- Agent simulation mode (run agent logic against historical data before deploying prompt changes)
- Agent-to-agent shared notes table (agents leave structured notes; other agents read on next run)
- Optional cloud sync (Supabase cloud project as a secondary target; local remains primary)
- Local session reminders (Web Notifications API)
- Full accessibility pass (keyboard navigation, ARIA audit, screen-reader testing)
- Completing open v2 items: FR-5 frustration signal wiring, FR-15 cross-item advancement guard

### 3.2 Out of Scope (v3)

- Native mobile app (still responsive desktop only; iPad via cloud sync + browser)
- Multi-child support (architecture should not preclude it, but UI and data model are still Brielle-only)
- Live tutoring or video features
- Real authentication (still single-user + PIN gate model)
- Gamification beyond the streak counter
- Agent self-modification (agents may not edit their own prompts or schedules)

---

## 4. Completing Open v2 Items

### FR-5 (Complete): Frustration Agent Signal Evaluation in Practice Loop

The Frustration Agent writes signals to `student_tuning` with names prefixed `frustration_signal:`. These are currently defined in the agent prompt but not read by `PracticePage.jsx`.

**FR-5 (v3 completion).** `PracticePage` must read all `frustration_signal:*` rows from `student_tuning` at session start and evaluate them alongside the static rules. The evaluation is additive: any signal that fires (static OR agent-learned) offers the brain break. The agent-learned signals use the signal types registered in the Frustration Agent prompt (`consecutive_wrong`, `seconds_on_item`, `session_attempts`). Unknown signal types are logged as a warning and skipped; they do not break the session.

**Implementation note:** Add `GET /api/student/tuning` endpoint (or extend the existing session-start response) to return the current `student_tuning` rows for the student. PracticePage reads this once on mount and evaluates against live session state.

### FR-15 (Complete): Cross-Item Skill-Level Advancement Guard

The SRS `calculateNextTier` function currently evaluates mastery at the item level. Skill-level advancement (§4.3) requires a cross-item check: ≥ 80% accuracy AND avg response time < 30s across **10 or more distinct Tier-3 items** within the skill.

**FR-15 (v3 completion).** Add a `checkSkillLevelAdvancement(studentId, skillId, tuning)` function in `srs.js` that queries `item_mastery` for all Tier-3 items in the skill, counts eligible items, and returns `{shouldAdvance, eligibleCount, avgAccuracy, avgResponseTime}`. This function is called from the attempt endpoint after every item submission and only triggers a level advance when `eligibleCount >= 10`. The existing per-item tier logic is unchanged.

---

## 5. Writing Skill Module (FR-30 through FR-33)

The IEP identifies SBAC Level 1 writing (grade-level paragraphs with proper conventions at 80%) as a goal. No existing skill module addresses paragraph composition. The writing module is the fifth and most open-ended skill.

**FR-30 (Writing: Prompts).** Each writing session presents a single short prompt — a topic or sentence starter at Brielle's current level. Prompts are interest-aligned (the same interests array used by other skills). Examples: "Describe your favorite animal using at least three details." / "Write a paragraph about a place you'd like to visit and why." Prompts are stored as items in the items table with `skill_id = writing` and use the template/rendition model from v2.

**FR-31 (Writing: Input).** The student gets an open textarea with a minimum/maximum word count guidance (not enforced; guidance only). A live word count displays below the textarea. Typing module TTS and WPM tracking are not applied here.

**FR-32 (Writing: Grading).** Claude grades against a four-criterion rubric drawn from the IEP writing goal:
1. **Conventions** (capitalization, end punctuation, commas) — 0–25 points
2. **Sentence variety** (at least two distinct sentence structures) — 0–25 points
3. **Main idea** (topic sentence present and supported) — 0–25 points
4. **Detail** (at least two supporting details) — 0–25 points

Claude returns a JSON response: `{ total: 0–100, criteria: {...}, feedback: string, encouragement: string }`. The total is stored as `is_correct = (total >= 70)` in attempts. The breakdown is stored in `user_response.grading` for the parent dashboard to display.

**FR-33 (Writing: SRS).** Writing prompts use the same five-tier mastery system. Because writing is generative and no two responses are identical, tier advancement is based on the rubric total across attempts (not string-match or response time). Tier-3 → Tier-4 requires 70+ score on six attempts across three or more sessions.

---

## 6. Voice Features (FR-34 through FR-37)

**TTS (output)** uses Kokoro TTS running on the Express backend. The frontend fetches audio from `GET /api/tts?text=...&voice=...` and plays it via an `<Audio>` element. No browser TTS API is used for output. Kokoro runs via the `kokoro-js` npm package (ONNX runtime, no Python required, Apache 2.0).

**Voice input (listening)** uses the browser's `SpeechRecognition` API. This remains browser-native — there is no easy local open-source equivalent for speech-to-text at this stack's complexity budget.

**FR-34 (Voice Input: Math).** A microphone button appears alongside the answer input on math items. When pressed, the app listens via `SpeechRecognition` and populates the answer field with the recognized text. The student reviews and can edit before submitting. Voice input does not bypass grading — it is equivalent to typing the same text.

**FR-35 (Voice Input: Spelling).** The Kokoro backend endpoint speaks the spelling word (replacing the existing `window.speechSynthesis` call in `useSpellingSpeech`). v3 adds an optional "Say it back" mode: instead of typing, the student can press the mic button and speak the word back. `SpeechRecognition` captures it; exact string comparison grades it. Default is off (typing is the IEP-aligned practice).

**FR-36 (Passage TTS).** The reading practice view gets a "Read to me" button. Pressing it fetches audio from the backend TTS endpoint and plays it at a natural reading rate. Sentence-level highlighting advances using word-count-based timing estimates (words in sentence ÷ 150 WPM = sentence duration) — not `onboundary` events, since Kokoro returns an audio buffer rather than a live synthesis stream. The student may stop playback at any time. Passage TTS state is logged in `attempts.user_response` (`tts_used: true`).

**FR-37 (Reading-Aloud Mode).** An optional alternative to the standard reading view: the student reads the passage aloud while the app listens via `SpeechRecognition`. Claude compares the spoken text to the source passage and reports fluency: `{ words_per_minute, accuracy_pct, missed_words: [] }`. This is not graded for SRS purposes. It is shown on the parent dashboard as a separate fluency trend chart, addressing the IEP reading-aloud goal.

---

## 7. Teacher / IEP-Team View (FR-38 through FR-40)

The IEP team — teacher, reading specialist, behavior coach — needs to see Brielle's progress without logging in or requiring the parent to export a PDF every time.

**FR-38 (Read-Only Share Token).** The settings page has a "Share with IEP team" section. Pressing "Generate link" creates a `share_tokens` record with a 64-character random token, an expiry (default 30 days, configurable), and a read-only scope. The token is shown once as a URL: `http://localhost:PORT/share/TOKEN`. The parent copies and sends this URL.

**FR-39 (Teacher Dashboard).** The `/share/:token` route validates the token (not expired, not revoked) and renders a read-only version of the parent dashboard — stat cards, skill accuracy bars, mood trend, weekly insights, and the fluency chart (FR-37). It does not show: agent actions, pending approvals, settings, or any student PII beyond first name. The PIN gate does not apply to this route.

**FR-40 (Token Management).** The settings page lists all active tokens with their creation date, expiry, last-accessed date, and a "Revoke" button. Revocation is immediate. A token that has never been accessed expires silently. This is the entirety of the "auth" model — there are no teacher accounts.

---

## 8. Optional Cloud Sync (FR-41 through FR-43)

The app runs on one machine. The family may want to use it from a second computer or an iPad (via Safari). Cloud sync makes this possible without changing the local-first architecture.

**FR-41 (Cloud Target Config).** The settings page has a "Cloud sync" section. The parent enters a Supabase cloud project URL and anon key (obtained from their free Supabase account). The backend validates the connection before saving. When configured, cloud sync is enabled.

**FR-42 (Sync Strategy).** The local Postgres remains the primary database. After every session ends (`POST /api/session/:id/end`), the backend syncs the session and its attempts to the cloud project using the Supabase JS client. Agent runs, insights, and tuning changes sync on their own schedule (daily, after agent runs complete). Sync is best-effort: if the cloud is unreachable, the local record is flagged `cloud_synced = false` and retried on the next sync.

**FR-43 (Read-Only Cross-Device).** On a second device, the user opens `http://localhost:PORT` — but that's the local machine. Cross-device access works by pointing a second instance of the backend at the cloud project instead of the local Postgres. A `USE_CLOUD_DB=true` env var switches the DB connection. The second device runs the full app against cloud data. The local machine remains primary; the cloud device is read-and-practice-only (practice sessions from the cloud device sync back to cloud, not to local).

---

## 9. Session Reminders (FR-44 through FR-45)

**FR-44 (Local Notifications).** The settings page has a "Daily reminder" toggle and a time picker. When enabled, the backend schedules a Web Notification (via the Notifications API) at the configured time each day using node-cron. The notification reads: "Time for Brielle's practice! [streak count] days in a row." Clicking the notification focuses the browser and navigates to `/`. Notifications require the browser to be open; they are not OS-level push notifications (no service worker needed in v3).

**FR-45 (Reminder Snooze).** The notification includes a Snooze option (browser notification action buttons, Chrome-only fallback to a re-notification 20 minutes later). Snooze state is stored in-memory only.

---

## 10. Curriculum Alignment Agent (FR-46 through FR-48)

### Overview

The four existing agents adapt the learning experience within the boundaries set by the IEP. None of them reads the IEP itself. When the annual review updates Brielle's goals, nothing in the app changes. The Curriculum Alignment Agent fixes this.

**FR-46 (IEP PDF Ingestion).** The settings page has an "Upload IEP" section. The parent uploads a PDF. The backend stores it locally (`/data/iep.pdf`) and extracts text using `pdf-parse`. The extracted text is stored in a new table `iep_documents` with the upload date. The agent reads from this table, not from the file directly.

**FR-47 (Curriculum Alignment Agent: Purpose and Schedule).** The fifth agent runs weekly on Wednesdays at 6am. It reads the current `iep_documents` row and compares it to the `skills.iep_goal_text` values and the last 4 weeks of performance data. It proposes changes in two categories:
1. **Goal drift:** the IEP text describes a goal the app is no longer targeting well (e.g., a new writing convention goal was added after the last review but `skills.iep_goal_text` still reflects the old language).
2. **Performance misalignment:** performance data suggests Brielle has met a goal or is so far from it that the current items/levels are mismatched.

All proposals are logged as `agent_actions` with `requires_approval = TRUE`. The parent sees them in the Agent Activity Feed with plain-English summaries.

**FR-48 (Curriculum Alignment Agent: Tools).** Read tools: `query_iep_document`, `query_iep_goals`, `query_skill_trends`, `query_week_summary`. Write tools: `propose_iep_goal_update(skill_id, proposed_goal_text, rationale)`, `propose_level_override(student_id, skill_id, new_level, rationale)`. Both writes create `agent_actions` rows requiring approval; neither modifies `skills` or `student_skill_levels` directly.

---

## 11. Agent Simulation Mode (FR-49 through FR-51)

Before v3, prompt changes to any agent required deploying to production and waiting for a live run to evaluate results. This is risky with a real learner.

**FR-49 (Simulation Mode).** Each agent in the Agent Activity page has a "Simulate" button. Pressing it opens a date-range picker. The user selects a historical date range (e.g., "the past 4 weeks"). The backend runs the agent logic in dry-run mode: tools query actual historical data, but write tools are intercepted and return success without writing anything. The agent's full run — observations, reasoning, and what it would have done — is returned to the UI and displayed as a side-by-side comparison with what actually happened in that period.

**FR-50 (Simulation Logging).** Simulation runs are logged to `agent_runs` with `status = 'simulation'`. They do not affect `agent_actions` (no rows created). The simulation output is stored in `agent_runs.observations` and visible in the Agent Activity Feed with a "SIMULATION" badge.

**FR-51 (Prompt Editing).** The settings page under each agent has an "Edit prompt" section showing the current agent prompt (read from the filesystem). The parent (or developer) can edit the prompt text and save it. The next scheduled run uses the new prompt. Simulation mode is the intended way to test a prompt change before committing it. There is no version control for prompts in v3 — the parent is responsible for keeping a copy if they want to revert.

---

## 12. Agent-to-Agent Shared Notes (FR-52)

**FR-52.** A new table `agent_notes` allows agents to leave structured notes for other agents. Schema:

```sql
CREATE TABLE agent_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_agent_id INT REFERENCES agents(id),
  to_agent_id INT REFERENCES agents(id),   -- NULL = broadcast to all
  note_type TEXT NOT NULL,                 -- 'observation','flag','suggestion'
  content JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  read_at TIMESTAMPTZ                      -- set when the target agent reads it on its next run
);
```

Each agent's tool suite gains a `read_agent_notes(to_agent_id, unread_only)` read tool and a `write_agent_note(to_agent_id, note_type, content)` write tool. Notes are informational only — they carry no authority to take action. Their purpose is to pass context the database data doesn't capture. Example: the Frustration Agent notices Brielle seems to struggle more on Mondays; it writes a note to the Content Agent to front-load confidence-builder items on Mondays.

---

## 13. Data Model Changes

New tables in v3 (migrations):

```sql
-- Writing skill items use the standard items table; no new table needed.
-- The writing rubric score is stored in attempts.user_response JSONB.

-- Share tokens for teacher view.
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

-- IEP document uploads.
CREATE TABLE iep_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES students(id),
  uploaded_at TIMESTAMPTZ DEFAULT NOW(),
  file_path TEXT NOT NULL,
  extracted_text TEXT,
  active BOOLEAN DEFAULT TRUE              -- only one active doc per student
);

-- Agent-to-agent notes.
CREATE TABLE agent_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_agent_id INT REFERENCES agents(id),
  to_agent_id INT REFERENCES agents(id),
  note_type TEXT NOT NULL,
  content JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  read_at TIMESTAMPTZ
);

-- Cloud sync tracking column on sessions (migration adds column to existing table).
-- ALTER TABLE sessions ADD COLUMN cloud_synced BOOLEAN DEFAULT FALSE;

-- Reading fluency data stored in attempts.user_response JSONB; no new table needed.
-- Passage TTS usage stored in attempts.user_response JSONB; no new table needed.
```

---

## 14. Technical Architecture Changes

| Component | v2 | v3 Change |
|---|---|---|
| Agents | 4 agents | 5 agents (adds Curriculum Alignment) |
| Agent communication | None | `agent_notes` table + read/write tools |
| Agent prompts | Filesystem `.md` files, read-only | Editable in settings UI, persisted to filesystem |
| Simulation | None | Dry-run mode with write-tool interception |
| Database | Local Postgres only | Optional secondary Supabase cloud target |
| Voice output (TTS) | `window.speechSynthesis` for spelling | Kokoro TTS (`kokoro-js`) running on Express backend; frontend plays audio via `<Audio>` element |
| Voice input (STT) | None | Browser `SpeechRecognition` API for math answers, spelling say-back, reading-aloud mode |
| Auth/sharing | PIN gate only | PIN gate + share token for teacher view |
| IEP data | Text copied into `skills.iep_goal_text` | PDF upload + `iep_documents` table |
| Notifications | None | Web Notifications API via node-cron |
| New dependencies | — | `kokoro-js` (TTS engine), `pdf-parse` (IEP ingestion) |

No changes to the Express/React/Postgres/Anthropic SDK stack. No new frameworks.

---

## 15. API Usage

### New synchronous calls (v3)

| Call | When | Estimated tokens |
|---|---|---|
| Generate writing prompt (rendition) | At writing session start | ~1,500 in / ~500 out |
| Grade writing response | Per writing item | ~1,800 in / ~400 out |
| Grade reading-aloud fluency | On demand | ~800 in / ~200 out |

### New agent call

| Agent | Frequency | Estimated tokens per run |
|---|---|---|
| Curriculum Alignment Agent | Weekly Wed 6am | ~10,000 in / ~2,000 out (IEP PDF text is large) |

### Updated cost estimate

At current Claude Sonnet pricing, adding writing sessions and the fifth agent:
- Writing sessions (~3/week): +~$1.50/month
- Curriculum Alignment Agent: +~$2/month
- **v3 total: ~$14–20/month typical, ~$30/month upper bound**

Keep the $30/month Anthropic console cap.

---

## 16. User Experience

### New routes

| Route | Screen |
|---|---|
| `/practice/writing` | Writing prompt + textarea |
| `/share/:token` | Teacher/IEP-team read-only dashboard |

### Settings page additions

- Writing skill: enable/disable toggle, minimum/maximum word count guidance settings
- Voice input: enable per-skill toggles, preferred microphone
- Cloud sync: Supabase cloud URL + anon key, sync status
- Share tokens: generate, list, revoke
- IEP document: upload PDF, view extracted text, history
- Daily reminder: time picker, enable/disable
- Per-agent: prompt editor (new), simulate button (links to agent page)

### Agent Activity page additions

- Simulation run trigger and results view
- Agent notes feed (show notes left by agents for other agents)
- Curriculum Alignment Agent entries (alongside the existing four)

---

## 17. Build Plan

Eight tasks. Each builds on the previous. Tasks 1–3 complete unfinished v2 items and add the writing module. Tasks 4–5 add voice. Tasks 6–7 add sharing and reminders. Task 8 adds the agent expansions. Task 9 is the v3 pilot.

### Task 1 — Complete Open v2 Items (1 week)
- Wire FR-5 Frustration Agent signals into `PracticePage`
- Implement FR-15 cross-item advancement guard in `srs.js`
- Add `GET /api/student/tuning` endpoint
- Confirm via manual test: Frustration Agent signal in `student_tuning` fires brain break offer in practice

### Task 2 — Writing Skill Module (1.5 weeks)
- Add `writing` row to `skills` table (migration)
- Seed ~20 writing prompt templates across levels 1–4
- Build `writing-generator.md` and `writing-grader.md` prompts
- Build `WritingSkillView` component in `PracticeSkillViews.jsx`
- Wire writing grade rubric into `SessionCompletePage` per-skill breakdown
- Update parent dashboard to show writing accuracy bar

### Task 3 — Voice Input + Passage TTS (1 week)
- Install `kokoro-js`; build `backend/src/services/tts.js`; expose `GET /api/tts` and `GET /api/tts/voices`
- Replace `useSpellingSpeech` to fetch Kokoro audio instead of calling `window.speechSynthesis`
- Add microphone button to math and spelling practice views (`useSpeechInput` hook, SpeechRecognition)
- Add "Read to me" button to reading view (Kokoro audio + word-count-based sentence highlighting)
- Add reading-aloud mode (SpeechRecognition + fluency scoring via Claude)
- Add fluency trend chart to parent dashboard
- Log `tts_used` and `voice_input_used` in `attempts.user_response`

### Task 4 — Teacher View (0.5 weeks)
- Add `share_tokens` migration
- Add token generation/revocation API: `POST /api/share/token`, `DELETE /api/share/token/:id`
- Build `/share/:token` route (read-only ParentDashboard variant, no PIN required)
- Add share token management to settings page

### Task 5 — Session Reminders (0.5 weeks)
- Add `parent_settings` columns: `reminder_enabled`, `reminder_time`
- Schedule notification cron in `server.js` reading these settings
- Request `Notification` permission on first use from settings page
- Test Chrome and Firefox

### Task 6 — IEP PDF Upload + Curriculum Alignment Agent (1.5 weeks)
- Add `iep_documents` migration
- Add `POST /api/iep/upload` endpoint using `pdf-parse` to extract text
- Build IEP upload UI in settings
- Build `curriculum-agent.js` with tools: `query_iep_document`, `query_iep_goals`, `query_skill_trends`, `propose_iep_goal_update`, `propose_level_override`
- Write `curriculum.md` agent prompt
- Wire agent into scheduler at `0 6 * * 3` (Wednesday 6am)
- Add agent to Activity Feed

### Task 7 — Agent Simulation Mode + Agent Notes (1 week)
- Add `agent_notes` migration
- Add `read_agent_notes` and `write_agent_note` tools to all five agents
- Build dry-run mode in `agent-runner.js` (intercept write tools, return mock success)
- Add `POST /api/agents/:name/simulate` endpoint with date-range body
- Build simulation results UI in Agent Activity page
- Add prompt editor to settings (reads/writes agent `.md` files)

### Task 8 — Optional Cloud Sync (1 week)
- Add `cloud_synced` column to `sessions` (migration)
- Build `cloud-sync.js` service using Supabase JS client
- Add sync call to `POST /api/session/:id/end`
- Add sync UI + status indicator to settings
- Test: session created on local machine appears in Supabase Studio cloud

### Task 9 — Accessibility Pass + v3 Pilot (1 week)
- Full keyboard-navigation audit (every action reachable without mouse)
- ARIA labels on all icon buttons, modals, and charts
- Screen-reader pass (VoiceOver or NVDA)
- Font size selector verified against all new components
- One full week of Brielle using v3, daily debugging
- Tune writing and curriculum agent prompts based on observed output

---

## 18. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| SpeechRecognition is inconsistent for a 5th-grader's voice | Fallback to typing is always available; voice is additive, never required |
| Kokoro model takes time to load on first startup | Load and warm the model at server startup, not on first request; log a warning if load takes > 10s |
| Kokoro audio latency is perceptible on slow hardware | Pre-generate spelling word audio at session start; passage TTS can buffer while the student reads the title |
| Writing grading by Claude is too harsh or too lenient | Rubric calibration against 5–10 sample responses before enabling live grading; parent can override any grade in the session view |
| IEP PDF text extraction is incomplete (tables, images) | Show extracted text in settings so parent can verify; agent prompt instructs to flag uncertainty rather than hallucinate |
| Cloud sync causes data drift between devices | Local is always primary; cloud is a copy. Never allow simultaneous sessions from two devices in v3 |
| Curriculum Agent proposes aggressive goal changes | All proposals require approval; agent is instructed to prefer observation over action |
| Agent prompt editing introduces regressions | Simulation mode is the required pre-test; original prompts checked into git as fallback |
| Notification fatigue | Single daily notification, easy to disable, 20-minute snooze; not delivered if a session was already completed that day |

---

## 19. Future Enhancements (v4+)

- Multi-child support (siblings, second student profile)
- Native iPad app via React Native or Expo + existing backend
- IEP team login (proper multi-user auth, not tokens)
- Writing-to-speech: Brielle dictates a paragraph, app transcribes + grades
- Agent self-improvement: agents can propose edits to their own prompts (with simulation + parent approval gate)
- Cross-session mood correlation analysis (Insight Agent extended)
- Vocabulary module (sight words, definitions, context sentences) — relevant to her reading goal
- Integration with school's SIS for automatic IEP document updates
- Offline content cache — pre-generate two weeks of items, work offline for everything except new item generation

---

*— End of PRD v3 —*
