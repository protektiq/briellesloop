# Brielle's Loop — Cursor Plan Mode Build Tasks

This document contains the full sequence of build tasks for Brielle's Loop, formatted as prompts to feed into Cursor's Plan Mode (`Shift+Tab` from chat input).

## How to use this document

For each task below:

1. Open Cursor, hit `Shift+Tab` to enter Plan Mode
2. Paste the prompt for that task
3. Answer Cursor's clarifying questions (if any)
4. **Review the plan it generates before clicking build** — edit it if it goes off-script
5. Build it
6. Verify the "Exit criteria" listed
7. Only then move to the next task

Don't skip ahead. Each task assumes the previous one is working.

---

## Task 0 — Workspace Setup & Reference Files

**Run this in regular Agent mode, not Plan Mode.** It's just file scaffolding.

```
Create a new folder called brielles-loop in my home directory. Inside it, create a docs/ subfolder
and place these three files there exactly as I'll provide them:

- docs/PRD.md (I will paste the contents)
- docs/desktop-mockup.html (I will paste the contents)
- docs/IEP-summary.md (I will paste the contents)

Then create an empty README.md at the root that just says "# Brielle's Loop" for now.

Do not create any other files. Do not run npm init. Do not install anything.
```

After Cursor creates the folder, **paste the PRD v2 markdown into `docs/PRD.md`** and **paste the desktop mockup HTML into `docs/desktop-mockup.html`**. For `docs/IEP-summary.md`, paste this:

```markdown
# Brielle's IEP Summary (Reference)

- 5th grader, DOB 12/21/2014, ADHD
- Reading: 1st percentile; goal 80% accuracy on grade-level texts (main idea, supporting details, inferences)
- Math: 16th–27th percentile; accurate but slow; goal multi-step word problems
- Spelling: phonics intact; weak on multisyllabic (24/24 missed), r-controlled, variant vowels
- Writing: SBAC Level 1; goal grade-level paragraphs with proper conventions at 80%
- Behavior: identify when "upset," use 3-minute brain break or pre-planned cool-down tool
```

These three files are the **context every future Plan Mode task will reference.** Cursor reads them, so the agent always has the full picture.

---

## Task 1 — Project Scaffold & Tooling

**Plan Mode prompt:**

```
Read docs/PRD.md and docs/desktop-mockup.html for full context.

Goal: Initialize the monorepo project structure for Brielle's Loop as specified in section 6.4 of the PRD.

Set up the following:
- Root package.json with npm workspaces for "frontend" and "backend"
- frontend/ workspace using Vite + React 18 + plain CSS (no Tailwind, no CSS-in-JS)
- backend/ workspace using Node.js + Express
- Root .env.example file documenting ANTHROPIC_API_KEY and DATABASE_URL
- Root .gitignore that excludes node_modules, .env, and Supabase volumes
- Root README.md with prerequisites (Node 20+, Docker, Supabase CLI) and a "Getting Started" section

Constraints:
- Use npm, not yarn or pnpm
- Use ES modules (type: "module") in both workspaces
- Do NOT install React component libraries, UI kits, or CSS frameworks. Plain CSS only.
- Do NOT create any source files in src/ yet — just the empty folder structures

After scaffolding, both `npm install` at the root and `npm run dev` in each workspace should
succeed (frontend serves a default Vite page, backend serves "Hello World" on port 3001).

Show me the file tree before building.
```

**Exit criteria:**
- `npm install` runs cleanly at the root
- `cd frontend && npm run dev` opens the Vite welcome page
- `cd backend && npm run dev` (or equivalent) returns "Hello World" on `localhost:3001`

---

## Task 2 — Supabase Local Connection

You already have the Supabase images in Docker, so this is just configuration.

**Plan Mode prompt:**

```
Read docs/PRD.md, focusing on sections 6.2, 7.1, and 7.2.

Goal: Connect this project to a local Supabase stack. I already have the Supabase Docker images
pulled (Postgres 17.6, Studio, Auth, Realtime, Storage, GoTrue, Edge Runtime, Kong, Vector,
Logflare, Mailpit). I have the Supabase CLI to install if needed.

Tasks:
1. Verify Supabase CLI is installed; if not, output the install command for Ubuntu
2. Run `supabase init` in the project root to create the supabase/ folder
3. Run `supabase start` and confirm all services come up cleanly
4. Update the root .env file with the actual local DATABASE_URL, SUPABASE_URL, and SUPABASE_ANON_KEY
   that `supabase start` outputs
5. Add a backend/src/db.js that uses the `pg` library to connect to the local Postgres
6. Add a /api/health endpoint to backend that runs `SELECT 1` against the database and returns
   { db: "ok" } or { db: "error", message } accordingly

Constraints:
- Use the `pg` library directly. Do NOT install Prisma, Drizzle, Knex, or any ORM.
- Do NOT run any migrations yet — that's the next task.
- Do NOT modify the Supabase config defaults.

Exit: `curl localhost:3001/api/health` returns { db: "ok" }, and Supabase Studio at
localhost:54323 is reachable.
```

**Exit criteria:**
- `supabase status` shows all services running
- Studio loads at `localhost:54323`
- `curl localhost:3001/api/health` returns `{"db":"ok"}`

---

## Task 3 — Database Schema (All 14 Tables)

**Plan Mode prompt:**

```
Read docs/PRD.md section 7 carefully. Pay close attention to 7.1 (core schema) and 7.2 (agent schema).

Goal: Create and run database migrations for all 14 tables defined in the PRD.

Tasks:
1. Create migration files in supabase/migrations/ — one file per logical group:
   - 001_core_schema.sql: students, skills, student_skill_levels, items, item_mastery
   - 002_session_schema.sql: sessions, attempts, brain_breaks
   - 003_ai_and_insights.sql: ai_generations, weekly_insights
   - 004_agent_schema.sql: agents, agent_runs, agent_actions, student_tuning
2. Each migration must include the exact CREATE TABLE statements from the PRD — do not modify
   column types, defaults, or constraints
3. Add appropriate indexes:
   - item_mastery(student_id, next_review_at) for SRS queue queries
   - attempts(session_id, attempted_at) for session reconstruction
   - agent_runs(agent_id, started_at DESC) for activity feed
4. Add a 005_seed.sql that:
   - Inserts 4 rows into skills (reading, math, spelling, typing) with iep_goal_text from
     docs/IEP-summary.md
   - Inserts 1 row into students for Brielle (with her DOB and grade from the IEP summary)
   - Inserts 4 rows into agents (calibration, content, frustration, insight) with the cron
     schedules from PRD section 11.2
   - Inserts default rows into student_tuning for all 5 parameters listed in the PRD
5. Run all migrations with `supabase db reset` and verify in Studio that all 14 tables exist
   and seed data is present

Constraints:
- All UUIDs use gen_random_uuid()
- All timestamps use TIMESTAMPTZ
- Use IF NOT EXISTS only on indexes, not on CREATE TABLE
- Do NOT add Row Level Security policies in v1 (single local user)

Exit: Studio's Schema Visualizer shows all 14 tables connected by foreign keys, and the
skills, students, agents, and student_tuning tables have seed data.
```

**Exit criteria:**
- All 14 tables visible in Studio
- Schema Visualizer (Database → Schema Visualizer) shows the foreign key graph
- Skills table has 4 rows; agents table has 4 rows

---

## Task 4 — Backend API Skeleton

**Plan Mode prompt:**

```
Read docs/PRD.md sections 6.3 and 6.4.

Goal: Build the Express backend route structure with stub endpoints for every API surface listed
in the system diagram. Real logic comes in later tasks; this task is about shape.

Tasks:
1. Reorganize backend/src/ to match the folder structure in PRD section 6.4 (under src/):
   - src/routes/ (one file per route group)
   - src/services/
   - src/agents/
   - src/prompts/
2. Create route files with stub handlers (returning mock JSON) for:
   - routes/sessions.js: POST /api/session/start, POST /api/session/:id/end
   - routes/items.js: GET /api/items/queue/:skill_id, POST /api/items/:id/attempt
   - routes/ai.js: POST /api/ai/generate, POST /api/ai/grade, POST /api/ai/hint
   - routes/dashboard.js: GET /api/dashboard/week, GET /api/dashboard/skills
   - routes/agents.js: GET /api/agents, GET /api/agents/runs, GET /api/agents/actions/pending,
     POST /api/agents/actions/:id/approve, POST /api/agents/actions/:id/revert
   - routes/export.js: GET /api/export/iep-pdf (stub returns mock JSON; real PDF in Task 11)
3. Wire all routes into server.js with a clean prefix structure
4. Add basic middleware: cors (allow localhost:5173), express.json(), error handler
5. Create services/claude.js with an Anthropic SDK client initialized from env (do not call it yet)
6. Add backend/.env.example documenting all needed variables

Constraints:
- Each stub endpoint should return realistic-looking mock data shaped like the eventual real response
- Do NOT install authentication middleware
- Do NOT install Zod or schema validators yet — type-check inline
- Do NOT call the Anthropic API in this task
- Use async/await everywhere; no callback or .then() chains

Exit: `curl localhost:3001/api/dashboard/week` returns mock JSON. Every route from the system
diagram exists and responds.
```

**Exit criteria:**
- All routes hit-able with curl, returning mock data
- File structure matches PRD §6.4 exactly (under `src/`)
- `claude.js` instantiates the SDK without erroring

---

## Task 5 — Design System & Frontend Shell

**Plan Mode prompt:**

```
Read docs/desktop-mockup.html and docs/PRD.md section 9 carefully.

Goal: Port the visual design system from docs/desktop-mockup.html into the React frontend as
reusable building blocks, and set up the route shell. We are NOT building feature screens yet.

Tasks:
1. Extract all CSS variables from the mockup's :root block into frontend/src/styles/tokens.css
2. Extract typography rules into frontend/src/styles/typography.css (with Google Fonts import for
   Fraunces and Nunito)
3. Extract reusable component styles into frontend/src/styles/components.css (buttons, cards,
   emoji buttons, mood slider, skill tiles — anything that appears on more than one screen)
4. Set up React Router with these routes (all empty placeholder pages for now):
   - / → TodayPage
   - /practice/:skillName → PracticePage
   - /break → BrainBreakPage
   - /parent → ParentDashboardPage
   - /parent/agents → AgentActivityPage
   - /settings → SettingsPage
5. Build the persistent TopNav component matching the mockup (logo, nav links, streak pill, avatar)
6. Build a Layout wrapper that puts the nav above each routed page

Constraints:
- Match the mockup's aesthetic exactly — fonts, colors, shadows, border radii, the slightly-rotated
  logo mark
- Use plain CSS imports, no CSS modules, no styled-components
- Use Zustand for any shared state (e.g., the streak count in the nav) — install it now
- Do NOT install any UI component library (Radix, shadcn, MUI, Chakra — none of these)
- Each placeholder page should display its name and a "TODO" so I can verify routing works

Exit: Navigating to each route shows the persistent nav with that route's placeholder content,
styled to match the mockup's aesthetic.
```

**Exit criteria:**
- All 6 routes navigable
- Top nav matches the mockup pixel-for-pixel
- Fraunces + Nunito loading correctly

---

## Task 6 — Today Page (Mood Check + Skill Picker)

**Plan Mode prompt:**

```
Read docs/desktop-mockup.html section 1 (the hero/mood-check screen) and docs/PRD.md sections
4.1 and 9.2.

Goal: Build the Today page — Brielle's landing screen with the mood check-in and skill picker.

Tasks:
1. Build the MoodCheckIn component:
   - 5 emoji buttons (😢 😟 😐 🙂 😄) with the selection state from the mockup
   - 0–10 slider that auto-syncs to emoji (😄=8, 🙂=6, 😐=5, 😟=3, 😢=1) but is independently
     adjustable
   - Persists selection in component state, exposes onChange
2. Build the TodayPlanCard (the dark card on the right of the mockup) — title, meta row, "Let's go" CTA
3. Build the SkillTile component — icon, name, level + duration meta. Variant for "suggested today"
4. Build the skill suggester service:
   - Create backend/src/services/skill-suggester.js with a function getSuggestedSkill(studentId)
   - V1 heuristic: pick the skill with the lowest current_accuracy from student_skill_levels.
     If multiple skills tie (or no sessions logged yet), fall back to the skill with the most
     items_due (count from item_mastery WHERE next_review_at <= NOW()). If still tied, default
     to Reading.
   - Add a TODO comment: "V1 heuristic; will be replaced by Content Agent in Task 12. See PRD §11.2.1"
5. Compose components into the TodayPage matching the mockup layout exactly
6. When "Let's go" is clicked:
   - Validate that mood is set
   - POST /api/session/start with skill, pre_mood_emoji, pre_mood_score
   - Navigate to /practice/:skillName
7. Update backend's /api/session/start stub to actually insert a row into the sessions table
   and return the session_id (this is the first real DB write)

Constraints:
- The skill picker should call GET /api/dashboard/skills to fetch real levels (update that stub
  to query student_skill_levels in the DB)
- Mood check-in is REQUIRED before the start button enables (PRD FR-1)
- If pre_mood_score <= 3, navigate to /break instead of /practice (PRD FR-2) and pass a flag
  so the brain break knows to offer practice afterward
- Match the mockup styling — the warm cream background, decorative circles, dashed borders

Exit: Selecting a mood and skill, clicking "Let's go," creates a real session row in the
database (verify in Supabase Studio) and navigates to the practice page.
```

**Exit criteria:**
- Mood check-in works, slider and emojis stay in sync
- Skill levels show real values from DB
- Clicking "Let's go" creates a `sessions` row visible in Studio

---

## Task 7 — SRS Engine

This is the meat. Plan Mode is going to ask the most clarifying questions here — that's good.

**Plan Mode prompt:**

```
Read docs/PRD.md section 4.3 in detail. This is the core learning logic.

Goal: Build the spaced repetition engine — the Kumon-style mastery system.

Tasks:
1. Build backend/src/services/srs.js with these pure functions (no DB calls inside):
   - calculateNextTier(currentTier, isCorrect, responseTimeSeconds, masteryStats, tuning):
     returns new tier (0–4)
     - masteryStats is a plain object with: consecutive_correct, total_correct,
       distinct_sessions_correct, all_responses_under_20s
     - tuning is the student's current values from student_tuning
     - Wrong answer drops to tier 1 regardless (FR-14)
     - Tier transitions follow the table in FR-13, enforcing "4× in a row" and
       "6× across 3+ sessions, all under 20s"
   - calculateNextReviewAt(tier, lastSeenAt): returns the next_review_at timestamp using
     intervals from FR-13 (1, 3, 7, 30 days)
   - shouldAdvanceSkillLevel(recentAttempts, currentTuning): returns boolean per FR-15
   - shouldDropSkillLevel(weeklyAccuracy, currentTuning): returns boolean per FR-16
2. Build backend/src/services/queue-builder.js:
   - buildSessionQueue(studentId, skillId, count): queries item_mastery with tier and
     next_review_at, applies the 60/25/15 ratio (FR-17), returns an ordered list of items
   - The function should respect any pre-built queue in a `next_session_queue` cache table
     IF it exists for that student/skill — otherwise build fresh. (Cache table and Content
     Agent come later.)
3. Wire these into the real /api/items/queue/:skill_id endpoint:
   - Require a session_id query parameter
   - Validate that the session exists, is in progress (ended_at IS NULL), and matches the skill_id
   - Derive student_id from the session row
   - Return 400 if session_id is missing/invalid or session has ended
4. Wire item attempt recording into POST /api/items/:id/attempt:
   - Require session_id in the request body
   - Validate session is in progress; derive student_id from it
   - Fetch masteryStats (query item_mastery + recent attempts) and tuning before calling srs.js
   - Insert a row into attempts
   - Update item_mastery using calculateNextTier + calculateNextReviewAt
   - Check shouldAdvanceSkillLevel / shouldDropSkillLevel and update student_skill_levels
   - Return the next item or { sessionComplete: true }
5. Write Vitest tests for srs.js covering:
   - All tier transitions (0→1, 1→2, 2→3, 3→4)
   - Wrong answer at every tier drops to 1
   - Response time threshold edge cases
   - Skill level advancement at exactly 80% and 30s
   - "4× in a row" promotion to tier 3
   - "6× across 3+ sessions, all under 20s" promotion to tier 4

Constraints:
- All thresholds (80%, 30s, 60%) must be read from student_tuning, NOT hardcoded
- Functions in srs.js must be pure — no DB, no side effects, fully testable
- Use Vitest (better Vite integration than Jest)
- Seed at least 50 items per skill at level 1 in a new migration (006_item_seed.sql) so you
  have data to query — but for math, use templates per Task 8's rendition model (placeholders
  for now are fine; templates come in Task 8)

Exit: All Vitest tests pass. Hitting /api/items/queue/math with a valid session_id returns 5–8
items in proper 60/25/15 distribution. Submitting an attempt updates item_mastery correctly
(verify in Studio).
```

**Exit criteria:**
- Vitest tests pass
- Queue endpoint returns properly distributed items
- Submitting attempts moves items through tiers in Studio

---

## Task 8 — Activity View (Math First, End-to-End)

**Plan Mode prompt:**

```
Read docs/desktop-mockup.html section 2 (the math activity view) and docs/PRD.md sections
4.2 (FR-9), 4.5, and 4.4 (FR-20).

Goal: Build the math activity view end-to-end — Claude generates the problem, Brielle answers,
Claude grades, the result flows through SRS. This proves the entire loop works for one skill
before we replicate it for the other three.

IMPORTANT — schema change for templates and renditions:

The seeded math items in Task 7 are placeholders. The right model is templates with rendered
variants:

1. Repurpose `items` as templates. Each row represents a concept at a difficulty level
   (e.g., "division-as-rate, level 3, dog-themed"). The `prompt` JSONB describes the concept
   and constraints, not a finished problem. The `answer` JSONB describes the type of answer
   expected (e.g., "positive integer with unit 'days'").
2. Add a new migration 009_item_renditions.sql:
   CREATE TABLE item_renditions (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     item_id UUID REFERENCES items(id),
     session_id UUID REFERENCES sessions(id),
     rendered_prompt JSONB NOT NULL,
     rendered_answer JSONB NOT NULL,
     created_at TIMESTAMPTZ DEFAULT NOW()
   );
3. Rename attempts.item_id to attempts.rendition_id and have it reference item_renditions(id).
   Mastery still tracks the template, attempts track the specific rendition shown.
4. Replace the math placeholder seed rows with ~20 real templates describing distinct concepts
   at varying levels. Keep spelling and typing placeholders as-is — those skills DO benefit
   from exact repetition.
5. Update queue-builder.js to return template `items` rows. The renderer (this task) calls
   Claude with the template, gets a fresh rendition, inserts into item_renditions, and that's
   what the frontend displays.
6. Update docs/PRD.md section 7 to document the renditions table and the attempts.rendition_id
   change.

Tasks:
1. Build the math content generator in backend/src/services/content-generator.js:
   - generateMathRendition(template, student): calls Claude with the system prompt template
     from PRD 8.3
   - Includes student level, interests, recent_misses (query from attempts joined to renditions),
     IEP goal
   - Returns structured JSON: { prompt, structured_steps, answer, answer_unit }
   - Inserts the rendition into item_renditions and returns the rendition id
   - Caches by input_hash in ai_generations
2. Build the grader in backend/src/services/grader.js:
   - gradeAttempt(rendition, userResponse): calls Claude with the FR-24 schema
   - Returns { correct, feedback, explanation, response_time_seconds }
3. Build the system prompts in backend/src/prompts/:
   - math-generator.md (the FR-23 template, takes a template description as input)
   - math-grader.md
   - math-nudge.md (single-sentence concept hint, no problem breakdown)
   - math-solved.md (full SOLVED-style breakdown per FR-20)
4. Build the React PracticePage for math:
   - Match mockup section 2 exactly: activity tag, progress bar, structured-step boxes,
     input field, Hint / Check buttons, "I'm stuck" link, sidebar coach card
   - On mount, fetch the queue (passing session_id)
   - For each item: request a rendition from the generator, show prompt, capture response with
     response time, POST attempt, show feedback
   - After session_item_count items (default 5 per Brielle's tuning), navigate to a basic
     "session complete" screen (full post-session flow is Task 9)
5. The "Hint" button calls /api/ai/hint with hint_type="nudge" — Claude returns ONE sentence
   pointing to the relevant concept, not a problem breakdown. Tracked as hint_used=true on the
   attempt.
6. The "I'm stuck" button calls /api/ai/hint with hint_type="solved" — Claude returns the full
   SOLVED-style breakdown per FR-20. Tracked as hint_used=true AND stuck_used=true on the attempt.
7. Add stuck_used BOOLEAN DEFAULT FALSE to attempts in a new migration 010_attempts_stuck.sql.
   Add a comment on the column noting it's read by the Frustration Agent (Task 12).
8. Build a minimal /practice/:skill/complete page:
   - Shows "Session complete!" headline, accuracy summary, list of items that moved up a tier
   - "Back to Today" button calls POST /api/session/:id/end which sets sessions.ended_at = NOW()
   - The /end endpoint validates session is in progress before ending it (idempotent)
   - Add a comment that this is a stub to be expanded in Task 9 with full FR-6 flow
9. Update student_tuning seed: session_item_count current_value=5, default_value=5, min=3, max=10.
   Update PRD FR-3 to read "5–8 items per session, starting at 5 with tuning-driven adjustment."

Constraints:
- Use the real Anthropic SDK now. Set ANTHROPIC_API_KEY in .env.
- Use claude-sonnet-4-7 (the model string from the PRD)
- Track response time client-side from when the item renders to when the user submits
- Show a loading state during AI calls (the mockup doesn't show one — invent one that fits)
- Do NOT yet build reading, spelling, or typing — math only
- Do NOT yet build the brain break trigger logic — that's Task 9
- Do NOT capture post_mood or reflection on the completion screen — that's Task 9

Exit: Brielle can complete a full 5-item math session with real Claude-generated problems,
real grading, accurate item_mastery updates, and a basic completion screen. Sessions end
cleanly with ended_at set.
```

**Exit criteria:**
- Real word problems appear (about her interests)
- Grading produces sensible feedback
- After 5 items, a session ends cleanly with all data in DB
- `ended_at` is set on sessions when "Back to Today" is clicked

---

## Task 9 — CBT Layer (Brain Break + Frustration Triggers + Reflection)

**Plan Mode prompt:**

```
Read docs/PRD.md sections 4.4 (FR-18 through FR-21) and 4.1 (FR-5, FR-6).
Read docs/desktop-mockup.html section 3 (the brain break screen).

Goal: Add the CBT layer — automatic brain breaks, the post-session mood check + reflection
(replacing the Task 8 stub completion screen).

Tasks:
1. Build the BrainBreakPage matching the mockup:
   - 6-second-cycle breathing animation (CSS keyframes, no library)
   - Countdown timer (default 3 minutes, configurable)
   - "I'm ready to keep going" link
   - Logs a row to brain_breaks with triggered_by reason
2. Add the auto-trigger logic in PracticePage (FR-5):
   - 2 wrong in a row → offer brain break (modal with "Take a break" / "Keep going")
   - Single item > 60 seconds → offer brain break
   - Brain break can be accepted or declined; if accepted, navigate to /break with returnTo state
3. Replace the Task 8 stub completion screen with the full post-session flow:
   - Post-mood check-in (reuse the MoodCheckIn component)
   - Single freeform reflection input (FR-21)
   - Summary: items attempted, items correct, items moved up a tier
   - "Done for today" button writes post_mood + reflection to the existing session row
     (the row's ended_at was already set by the Task 8 completion stub — preserve that)
4. Pre-session low mood path (FR-2):
   - When TodayPage navigates to /break instead of /practice (low mood detected), the brain
     break shows different copy ("Tough start to today — let's just breathe for a bit")
   - After the break, offer practice as optional, not required

Constraints:
- The brain break is reachable from THREE places: pre-session low mood, in-session frustration
  trigger, and the persistent button in the activity sidebar (already in Task 8)
- The breathing animation must be CSS-only — no JS animation loops
- Do NOT add sound effects or haptics in v1
- The "I'm stuck" SOLVED hint from Task 8 stays as-is

Exit: A session that hits 2 wrong in a row offers a break. Taking the break logs to brain_breaks.
The post-session flow captures mood + reflection. Studio shows the complete session arc.
```

**Exit criteria:**
- Brain break triggers automatically per the rules
- Post-session captures mood and reflection
- Full session arc visible in `sessions` and `attempts` tables

---

## Task 10 — Reading, Spelling, Typing Modules

**Plan Mode prompt:**

```
Read docs/PRD.md section 4.2 — FR-8 (reading), FR-10 (spelling), FR-11 (typing).

Goal: Replicate the math module's end-to-end pattern for reading, spelling, and typing.

Tasks:
1. Reading module:
   - Generator prompt produces a 100–300 word passage at the student's level on an interest topic,
     plus 3 questions (main idea, supporting detail, inference)
   - Uses the template/rendition model from Task 8
   - Grader handles open-ended responses against expected answer
   - PracticePage variant shows the passage above and one question at a time
2. Spelling module:
   - Generator picks words from the multisyllabic / r-controlled / variant-vowel pools
     matching the student's level (these need to be seeded in items — generate ~150 graded words
     per pool in a new migration 011_spelling_seed.sql)
   - Spelling words are EXACT repetition items — no rendition layer needed; the items table
     row IS the word
   - Browser SpeechSynthesis API speaks the word; user types
   - Grader is exact string match (case-insensitive); no Claude call needed for this skill
3. Typing module:
   - Generator produces a 10–25 word sentence using punctuation and capitalization patterns
     from her IEP writing goal (uses rendition model)
   - PracticePage variant shows the target sentence and an input that tracks WPM and accuracy
     in real time
   - Grader compares input to target, reporting per-character accuracy and WPM (no Claude call)
4. Refactor the PracticePage to dispatch by skill type — don't duplicate the entire page four times.
   Each skill is a "module" with these things: a prompt template (or pool), a renderer component,
   and a grading rule.

Constraints:
- Spelling does not call Claude for grading — string match is faster and free
- Typing does not call Claude for grading — pure JS comparison
- Reading uses Claude for grading because answers are open-ended
- All four skills share the same SRS / mastery / brain break / post-session infrastructure
- Test each skill end-to-end with at least one full session before declaring done

Exit: All four skills are playable. Each writes to attempts and item_mastery correctly.
Spelling and typing don't burn API calls on grading.
```

**Exit criteria:**
- All four skills run a full session
- Spelling TTS works
- Typing tracks WPM live

---

## Task 11 — Parent Dashboard

**Plan Mode prompt:**

```
Read docs/desktop-mockup.html section 4 and docs/PRD.md section 4.6 (FR-26, FR-27, FR-28, FR-29).

Goal: Build the parent dashboard with the weekly view, stat cards, skill bars, before/after mood
chart, and the agent activity feed (placeholder until agents are built in Task 12).

Tasks:
1. Build SQL views or queries for:
   - weeklyStats(studentId, weekStart): returns avg accuracy, days practiced, brain breaks, avg mood
   - skillAccuracy(studentId, weekStart): returns per-skill accuracy bars
   - moodSeries(studentId, weekStart): returns 7 days of pre/post mood pairs
2. Wire /api/dashboard/week to return all of the above for a given week
3. Build the React ParentDashboardPage matching the mockup:
   - 4 stat cards with delta arrows (compare to previous week)
   - Per-skill accuracy bars with the 80% IEP target line marker
   - Before/after mood chart with the 7-day grid
   - Weekly insight box (placeholder text "No insight yet — agents not running")
   - Agent activity feed (placeholder list — will be wired up in Task 12)
4. Add a 4-digit PIN gate before /parent and /parent/agents (FR-29 / §9.2):
   - PIN is set in /settings, hashed (use bcrypt) and stored in a new settings table
   - PIN gate is friction, not real auth — show a clear note that this is a child-locking layer
5. Build the IEP-export PDF endpoint /api/export/iep-pdf using pdf-lib (replaces the Task 4 stub):
   - 12-week trends per skill
   - Mood trends
   - Brain break frequency
   - Items mastered count
   - All weekly insights from the period (placeholder for now)
   - Returns the PDF for download

Constraints:
- Use Recharts for charts (better tree-shaking, simpler API than Chart.js for this use case)
- The PIN gate must persist via session storage so re-entering isn't required every page nav
- The PDF must be A4-compatible (the IEP team may print)

Exit: /parent shows real numbers from this week's sessions. The IEP PDF generates and downloads.
```

**Exit criteria:**
- Real stats render
- Mood chart shows before/after pairs
- IEP PDF downloads and looks reasonable

---

## Task 12 — Agent System

This is the biggest task. Be ready to spend extra time on the plan review.

**Plan Mode prompt:**

```
Read docs/PRD.md section 11 in full. Also re-read sections 6.3, 6.4, 7.2, and 8.4.

Goal: Build the agent system — four background agents that run on cron, observe data, and
take actions. The mockup does not cover agent UI in detail, so use sensible patterns.

Tasks:
1. Build backend/src/services/agent-runner.js:
   - Generic loop that takes an agent config (name, system prompt, tools)
   - Runs the Claude conversation with tool use until stop_reason === "end_turn"
   - Logs the run to agent_runs (observations, reasoning, status, cost_usd)
   - Logs each action to agent_actions (action_type, before_value, after_value, requires_approval)
2. Build the tool definitions in backend/src/agents/tools/:
   - db-tools.js: query_recent_attempts, query_skill_progression, query_due_items,
     query_recent_misses, query_brain_break_history, query_session_outcomes,
     query_week_summary, query_skill_trends, query_iep_alignment, query_recent_reflections,
     query_other_agent_activity, query_current_tuning, query_interests, query_iep_goals
   - action-tools.js: propose_tuning_change, curate_queue, request_new_items,
     update_frustration_signals, write_weekly_insight, flag_iep_concern
3. Build the four agents in backend/src/agents/:
   - calibration-agent.js: daily 2am, all actions require_approval = TRUE
   - content-agent.js: daily 3am, writes to a new next_session_queue cache table (add migration
     012_queue_cache.sql)
   - frustration-agent.js: weekly Sunday 1am
   - insight-agent.js: weekly Sunday 11pm
4. Build the system prompts for each agent in backend/src/agents/prompts/ — each prompt should:
   - Define the agent's purpose and constraints
   - List the tools it has
   - Include example reasoning chains from PRD §11.2
   - Be conservative — when in doubt, propose rather than act
5. Wire up node-cron in backend/src/server.js to schedule all four agents
6. Wire up the agent activity feed UI on /parent and the full log on /parent/agents:
   - List recent runs and actions
   - Pending approvals show Approve / Reject buttons → POST /api/agents/actions/:id/approve
   - Applied actions show a Revert button
   - Each entry expands to show full reasoning text
7. Add a settings toggle per agent (FR §11.3 final paragraph) to enable/disable each agent
8. Add a manual trigger endpoint /api/agents/:name/run for testing — fires the agent immediately
   regardless of schedule

Constraints:
- Build agents in this order to minimize risk:
  1. Insight Agent FIRST — only writes to weekly_insights, lowest blast radius
  2. Calibration Agent — all actions gated by approval, can't break anything
  3. Content Agent — writes to a cache table the SRS reads first; if cache empty, falls back
  4. Frustration Agent — writes signals the activity loop reads as additive, not replacement
- DO NOT install LangChain, AutoGen, CrewAI, or any agent framework. Use the Anthropic SDK
  directly with the tool-use API. PRD §11.4 explains why.
- Each agent should be ~150–250 lines including its system prompt
- Agents must NEVER make changes without logging to agent_actions first
- Agents must NEVER call other agents directly — they communicate only through the database
- Add a kill switch: AGENT_SYSTEM_ENABLED env var. If false, cron doesn't schedule anything.

Exit: All four agents run on schedule. Studio shows agent_runs and agent_actions populated.
The /parent dashboard shows real agent activity. Approving a Calibration Agent action updates
student_tuning. Reverting a Content Agent action restores the previous queue.
```

**Exit criteria:**
- Manual trigger of each agent works via `/api/agents/:name/run`
- Cron schedules fire at the right times (you'll have to wait or temporarily set a fast schedule to verify)
- Approval flow works end-to-end
- Studio shows real entries in `agent_runs` and `agent_actions`

---

## Task 13 — Polish & Pilot

**Plan Mode prompt:**

```
Read docs/PRD.md section 10, Phase 6 (Polish & Pilot).

Goal: Final polish before Brielle starts using it daily.

Tasks:
1. Settings page: interests editor, IEP goals override, level overrides per skill, PIN setup,
   per-agent toggles, font size selector
2. Error states everywhere: API failure, empty queues, missing AI responses, network drop
3. Loading states with appropriate copy ("Picking your problems...", "Checking your answer...")
4. Accessibility pass: keyboard nav (every interaction reachable without mouse), focus rings,
   ARIA labels on all icon buttons, font size selector wired to a CSS variable on body
5. Add a /onboarding flow for first-time setup: parent enters interests, sets PIN, picks
   default session length (start at 10 min per the risk mitigation in PRD §10)
6. Cost monitor on /parent/agents: show cumulative monthly API spend pulled from agent_runs
   and ai_generations
7. Add a "session length" setting that overrides the default 5–8 items count
8. Final QA checklist:
   - One full math session
   - One full reading session
   - One full spelling session
   - One full typing session
   - Trigger each frustration condition
   - Verify every brain break trigger reason
   - Run each agent manually
   - Approve and revert at least one agent action of each type
   - Export an IEP PDF

Constraints:
- Do NOT add features beyond what's listed
- Do NOT refactor working code unless it's blocking polish work
- The font size selector should affect ONLY body text, not UI chrome

Exit: I can hand the laptop to Brielle and she can run a full week of sessions without you
needing to fix anything.
```

---

## Operating Notes

**On Plan Mode itself:** Cursor will ask clarifying questions before generating a plan. Answer them honestly even if it slows you down — a precise plan saves more time than the questions cost. If the generated plan looks vague or wrong, edit it directly in the markdown panel before clicking build. Better to spend 10 minutes editing a plan than 2 hours undoing bad code.

**On the order:** The agent system is at Task 12, second-to-last. Don't be tempted to build agents earlier — they need real data to be useful, and you won't have any until the loop has been running for a week. Agents built against an empty database produce hallucinated insights.

**The hard tasks:** Tasks 7, 8, and 12 are where you'll hit walls if you hit them anywhere. SRS logic, the first end-to-end skill, and the agent system. The Cursor doc has good advice for that situation — if Agent builds something that doesn't match what you wanted, *revert and refine the plan* rather than trying to fix it in follow-up prompts. Faster, cleaner result.

**Keep the PRD in sync:** As Plan Mode catches inconsistencies between the PRD, the mockup, and the task descriptions (it will), update `docs/PRD.md` to reflect the resolution. Every future task reads the PRD as context — keeping it accurate is what makes the whole sequence work.
