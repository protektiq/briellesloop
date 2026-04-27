# Brielle's Loop — Product Requirements Document

**Version:** 2.0 (adds agentic system)
**Date:** April 26, 2026
**Author:** Internal
**Status:** Draft for build

**Changes from v1.0:** Added §11 (Agentic System) defining four background agents that monitor progress and autonomously adjust the learning experience. Updated §3 (scope), §6 (architecture), §7 (data model), §8 (API usage), and §10 (build plan) to incorporate agent infrastructure. Section numbering shifted to accommodate.

---

## 1. Problem Statement

Brielle is a 5th-grade student with ADHD whose IEP (dated 03/27/2026) documents specific, measurable academic gaps: reading comprehension at the 1st percentile (declining from 62% → 44% benchmark), math at the 16th–27th percentile (accurate but extremely slow — up to one hour per test), Level 1 SBAC writing, and persistent struggles with multisyllabic spelling. Her IEP behavior goal calls for her to identify when she's "upset" and use a pre-planned 3-minute brain break or cool-down tool.

Existing educational software (IXL, Khan Academy, Prodigy, etc.) targets the median student and fails Brielle on three counts:

1. **No connection to her IEP.** Generic content is not aligned with the specific goals her IEP team is measuring against.
2. **No CBT integration.** Frustration during practice triggers shutdown, which her IEP behavior goal directly addresses, but no off-the-shelf product implements coping tools at the moment of need.
3. **No spaced repetition tied to mastery.** Apps either drill randomly or move on too fast. Brielle benefits from the Kumon model: small daily sets, repeated until automatic, advancing only when mastery is demonstrated.
4. **No personalized adaptation.** Static rules ("advance at 80% accuracy") are designed for a generic learner. Brielle has unique patterns — her own attention curve, her own frustration precursors, her own interest fluctuations — that fixed rules cannot capture.

**This PRD specifies a locally-hosted desktop web application that solves all four.** It runs on the parent's machine, uses the Anthropic API for content generation, grading, and a system of background agents that continuously monitor and adapt the learning experience to Brielle's individual patterns.

---

## 2. Objectives & KPIs

The product is successful when, measured over rolling 4-week windows:

| Objective | KPI | Target |
|---|---|---|
| Brielle uses the app consistently | Days practiced per week | ≥ 4 |
| Skill accuracy improves toward IEP target | Avg accuracy across all skills | ≥ 80% (her IEP target) |
| Frustration-driven shutdowns decrease | Brain breaks triggered per session | Trending downward week-over-week |
| Sessions improve mood, not worsen it | Avg post-session mood − pre-session mood | ≥ +1.0 |
| Spaced repetition reaches mastery | Items moved to "mastered" tier per week | ≥ 5 |
| Parent can act on insights | Weekly insights reviewed by parent | 100% |
| **Agents catch issues early** | **Agent-flagged adjustments accepted by parent** | **≥ 60%** |
| **Agents reduce manual tuning** | **Manual override frequency** | **Trending down month-over-month** |

These are tracked in the parent dashboard and exportable as a single PDF for the IEP annual review.

---

## 3. Scope

### 3.1 In Scope (v1)

- Local desktop web app (Chrome/Firefox/Safari on macOS or Windows)
- Four skills: Reading, Math, Spelling, Typing
- Daily session loop: mood check-in → skill practice → brain break (on demand or auto-triggered) → mood check-out → reflection
- Spaced repetition system (SRS) modeled on Kumon: items move through tiers based on mastery
- AI-generated content via Anthropic API, personalized to Brielle's interests and current level
- AI-graded responses with explanations, also via Anthropic API
- **Background agent system: four autonomous agents that monitor progress, adapt parameters, curate content, and surface insights — all with parent oversight (see §11)**
- Parent dashboard with weekly view, agent activity feed, and IEP-export PDF
- Local Postgres database with Supabase Studio for visualization

### 3.2 Out of Scope (v1)

- Cloud hosting, multi-user accounts, sharing with classmates or teachers
- Mobile app (responsive desktop only)
- Voice input / text-to-speech (deferred to v2)
- Live tutoring, video, or chat features
- Gamification beyond the streak counter (no XP, leaderboards, avatars, or in-app currency)
- Offline mode (requires network for Anthropic API calls; everything else local)
- Parental controls beyond the dashboard (no app-locking, screen-time limits)
- **Agents that act without any parent visibility — every agent action is logged, and consequential actions require parent approval (see §11.4)**

---

## 4. Functional Requirements

### 4.1 Daily Session Loop

**FR-1.** On launch, the app displays the home screen with the day's suggested session and a mood check-in widget (5 emoji + 0–10 slider). The mood entry is required before the session can start.

**FR-2.** If pre-session mood is ≤ 3 OR the user selects the "😢" or "😟" emoji, the app skips practice content and instead presents a brain break + a single CBT-lite reflection prompt ("What's making today hard?"). Practice is offered again afterward but not required.

**FR-3.** When the user starts a session, the app loads 5–8 items from the chosen skill's queue, **starting at 5 with tuning-driven adjustment** (`student_tuning.session_item_count`), ordered by spaced-repetition priority (see §4.3) and **curated by the Content Agent** (see §11.2).

**FR-4.** Each item is presented one at a time in the activity view. The user submits a response and receives immediate feedback (correct / incorrect with a 1–2 sentence explanation generated by Claude).

**FR-5.** If the user gets 2 items wrong in a row, OR spends > 60 seconds on one item, OR clicks the "I'm stuck" button, the app offers a brain break. The user can accept or decline. **The Frustration Agent (see §11.3) may also trigger this proactively based on learned patterns.**

**FR-6.** After all items are completed (or the user ends the session early), the app presents:
- Post-session mood check-in (same widget as pre-session)
- A single reflection prompt: "What was something hard? What was something you did well?"
- A summary screen showing accuracy, time spent, and items moved to the next mastery tier

**FR-7.** All session data (item responses, timing, mood, brain breaks triggered) is written to the local database before the next session can start. **This data feeds the agent system on its next scheduled run (see §11).**

### 4.2 Skill Modules

Each skill module follows a common interface but generates content specific to its IEP goal.

**FR-8 (Reading).** Generates a passage of 100–300 words at the user's current level using interest-based topics (configured by parent), followed by 3 questions: (1) main idea, (2) supporting detail, (3) inference. Targets IEP reading goal of 80% accuracy.

**FR-9 (Math).** Generates word problems broken into structured steps: "What we know" → "What we're finding" → "Step 1" → "Step 2" → "Answer." User types each step's answer separately. Targets IEP math goal of completing multi-step problems without time pressure or repetition. Topics tied to her interests where possible.

**FR-10 (Spelling).** Presents words from her IEP-flagged weak categories: multisyllabic words (24/24 missed on Primary Spelling Inventory), r-controlled vowels, variant vowels. Words are spoken via browser TTS; user types. Repetition queue prioritizes recently-missed words.

**FR-11 (Typing).** Presents short sentences (10–25 words) at her reading level. Tracks WPM and accuracy. Doubles as written-expression practice — sentences include the punctuation and capitalization patterns from her IEP writing goal.

### 4.3 Spaced Repetition System (Kumon-Style)

The Kumon method's three principles, adapted:

1. **Small daily sets, every day.** Sessions are short (5–8 items) but consistent. The streak counter rewards daily use.
2. **Mastery before advancement.** A learner doesn't move to the next level until they demonstrate ease — not just correctness, but speed and confidence — at the current level.
3. **Repetition until automatic.** Items reappear until they're effortless, not just until they've been answered right once.

**FR-12.** Every learnable item (a math word problem template, a vocabulary word, a spelling word, a sentence pattern) is stored in the `items` table with a difficulty rating 1–10.

**FR-13.** Each user has a mastery state per item, tracked in `item_mastery`, with five tiers:

| Tier | Name | Behavior |
|---|---|---|
| 0 | New | Never seen. Surfaces when queue is short. |
| 1 | Learning | Seen once. Reappears within 1 day. |
| 2 | Practicing | Answered correctly 2× in a row. Reappears within 3 days. |
| 3 | Confident | Answered correctly 4× in a row, < 30s response time. Reappears within 7 days. |
| 4 | Mastered | Answered correctly 6× across 3+ sessions, all < 20s. Reappears within 30 days. |

**FR-14.** Any wrong answer drops the item back to Tier 1, regardless of current tier.

**FR-15.** When the user achieves ≥ 80% accuracy AND average response time < 30s across 10+ Tier-3 items in a skill, the skill's overall level (1–10) advances by 1. **The Calibration Agent (§11.1) may adjust these thresholds for Brielle specifically based on observed patterns.**

**FR-16.** When accuracy drops below 60% for a week, the skill level drops by 1 and recently-missed items are re-prioritized.

**FR-17.** The session queue is built each morning by the SRS engine in a 60/25/15 ratio (review/learning/new). **The Content Agent (§11.2) refines this queue overnight by analyzing recent performance and selecting specific items rather than random samples within each tier.**

### 4.4 CBT Integration

**FR-18.** Mood is logged before AND after every session. Both timestamps are stored separately in `mood_logs`.

**FR-19.** The brain break is a 3-minute timer with a synchronized breathing animation (6-second inhale, 6-second exhale cycle). It can be skipped at any time. Triggers and durations are logged in `brain_breaks`.

**FR-20.** The "I'm stuck" button presents a SOLVED-style prompt (kid-sized): "Let's break it smaller. What's the very first thing we know? What's one thing we could try?" Claude generates a hint that simplifies the problem rather than solving it.

**FR-21.** End-of-session reflection captures one freeform response per session, stored in `reflections`. **The Insight Agent (§11.4) scans these weekly to surface patterns for the parent dashboard.**

### 4.5 AI Content & Grading

**FR-22.** All generative content (passages, questions, word problems, hints, feedback) is generated by Claude via the Anthropic API. No content is pre-baked or scraped from external sources.

**FR-23.** The system prompt for content generation includes:
- Brielle's current skill level (1–10) per skill
- Her stored interests (parent-configured)
- The specific IEP goal being targeted
- A list of recently-missed items, to be reincorporated as variants
- The skill's specific format requirements
- **Any tuning notes from the Calibration Agent (e.g., "Brielle's optimal session length is currently 6 items, not 8")**

**FR-24.** Grading is done by Claude with a structured JSON response:
```json
{
  "correct": true,
  "feedback": "Nice — 30 ÷ 2 = 15, so the bag lasts 15 days.",
  "explanation": "When something is used at a steady rate, divide the total by the rate to find how long it lasts.",
  "response_time_seconds": 24
}
```

**FR-25.** API responses are cached in `ai_generations` with the input prompt, so re-runs don't waste tokens and content can be audited.

### 4.6 Parent Dashboard

**FR-26.** A separate `/parent` route shows the weekly view: 4 stat cards (avg accuracy, days practiced, brain breaks, avg mood), per-skill accuracy bars with the 80% IEP target line, before/after mood chart, and an AI-generated weekly insight.

**FR-27.** The weekly insight is generated by the **Insight Agent** every Sunday night, summarizing patterns from the week's sessions in 2–3 sentences with one suggested adjustment.

**FR-28.** The dashboard has an "Export for IEP Review" button that generates a PDF with: 12-week trend charts per skill, mood trends, brain-break frequency, items mastered, and the AI insights from the period.

**FR-29 (new).** The dashboard includes an **Agent Activity Feed** showing what the agents have done in the past week: parameters they've adjusted, content they've curated, frustration patterns they've identified, insights they've surfaced. Each item shows the agent that did it, the reasoning, and an "Approve / Revert" control where applicable (see §11.4).

---

## 5. Non-Functional Requirements

| Category | Requirement |
|---|---|
| Performance | Page transitions < 200ms. AI responses < 5s in the synchronous loop. **Agent runs may take 30s–5min and execute outside the user-facing critical path.** |
| Reliability | App must work offline for everything except AI content generation. Cached items continue working without network. **Agents fail gracefully — a missed nightly run does not break the daily loop.** |
| Privacy | All data stays on the local machine. No telemetry, no analytics, no third-party scripts beyond fonts. |
| Security | Anthropic API key stored in `.env`, never committed, never sent to the browser. All API calls proxied through the local backend. |
| Accessibility | Keyboard-navigable. Screen-reader friendly. Font size adjustable in settings. |
| Browser support | Latest Chrome, Firefox, Safari. No IE. |
| Cost | Hosting: $0 (local). API: estimated $10–25/month with agents at typical usage (see §8). |
| **Auditability** | **Every agent action is logged with timestamp, agent name, reasoning, inputs observed, and decisions made. Nothing happens to Brielle's experience that the parent cannot review.** |

---

## 6. Technical Architecture

### 6.1 Tech Stack

| Layer | Choice | Why |
|---|---|---|
| **Frontend** | React 18 + Vite | Fast, simple, no SSR needed for a local app. |
| **Styling** | Plain CSS (the design system from the desktop mockup) | Hand-built; the mockup works as-is. |
| **State** | Zustand | Lightweight; no Redux ceremony. |
| **Backend** | Node.js + Express | Tiny server. Proxies Anthropic, reads/writes DB, hosts agents. |
| **Database** | PostgreSQL 15 | Real database with constraints, joins, Studio support. |
| **DB hosting** | Supabase Local CLI | Postgres + Studio + everything in Docker on localhost. Free. |
| **DB GUI** | Supabase Studio (bundled) | Visual table editor, query runner, schema viewer at `localhost:54323`. |
| **AI** | Anthropic API (Claude Sonnet 4.7) | Content generation, grading, agent reasoning. |
| **Agent runtime** | **Node-cron + custom scheduler** | **Schedule and orchestrate agent runs. No external framework — Anthropic SDK + cron is enough at this scale.** |
| **Agent tooling** | **Anthropic SDK tool-use API** | **Each agent gets a defined toolset (DB queries, parameter writes, content prompts). Tools enforce what each agent is allowed to do.** |
| **PDF export** | `pdf-lib` | For the IEP review PDF. |
| **Auth** | None | Single user, local machine. |

### 6.2 Why Supabase Local

The Supabase CLI runs the entire stack (Postgres, Studio, REST API, auth, storage) in Docker containers on your machine. Free, open source, gives you the exact UI you wanted.

```bash
brew install supabase/tap/supabase
supabase init
supabase start
```

After `supabase start`:
- Postgres: `localhost:54322`
- Studio dashboard: `localhost:54323`
- API: `localhost:54321`

Studio gives you visual table editor, SQL runner, schema diagrams, RLS GUI — running entirely on your machine.

### 6.3 System Diagram (text)

```
┌──────────────────────────────────────────────────────┐
│  Browser (localhost:5173)                            │
│  React app — the UI from the desktop mockup          │
└──────────────────────────────────────────────────────┘
                       │ HTTP/JSON
                       ▼
┌──────────────────────────────────────────────────────┐
│  Local Backend (localhost:3001)                      │
│  Node + Express                                      │
│  • /api/session/*       — session loop               │
│  • /api/items/*         — SRS queue                  │
│  • /api/ai/generate     — synchronous Claude call    │
│  • /api/ai/grade        — synchronous Claude call    │
│  • /api/dashboard/*     — parent view                │
│  • /api/agents/*        — agent activity feed,       │
│                           approvals, manual triggers │
│  • /api/export/iep-pdf  — PDF generation             │
└──────────────────────────────────────────────────────┘
        │              │                      │
        ▼              ▼                      ▼
┌──────────────┐  ┌──────────────────┐  ┌────────────────┐
│ Supabase     │  │ Agent Scheduler  │  │ Anthropic API  │
│ Local        │  │ (node-cron)      │  │ Claude 4.7     │
│ Postgres +   │  │                  │  │                │
│ Studio       │  │ ┌──────────────┐ │  │ Used by both   │
│              │◄─┼─┤ Calibration  ├─┼──► the sync loop  │
│              │◄─┼─┤ Content      ├─┼──► AND each agent │
│              │◄─┼─┤ Frustration  ├─┼──► via tool-use   │
│              │◄─┼─┤ Insight      ├─┼──►                │
│              │  │ └──────────────┘ │  │                │
└──────────────┘  └──────────────────┘  └────────────────┘
```

### 6.4 Folder Structure

```
brielles-loop/
├── frontend/              # React app (Vite)
├── backend/               # Express server
│   ├── routes/
│   ├── services/
│   │   ├── srs.js         # spaced repetition logic
│   │   ├── claude.js      # Anthropic API client
│   │   └── agent-runner.js # agent scheduler & orchestrator
│   ├── agents/            # NEW
│   │   ├── calibration-agent.js
│   │   ├── content-agent.js
│   │   ├── frustration-agent.js
│   │   ├── insight-agent.js
│   │   ├── tools/         # tool definitions for agent use
│   │   │   ├── db-tools.js
│   │   │   └── action-tools.js
│   │   └── prompts/       # system prompts per agent
│   └── prompts/           # synchronous-call prompts
├── supabase/
└── README.md
```

---

## 7. Data Model

Twelve tables now (eight from v1 plus four new ones for the agent system).

### 7.1 Core Schema (unchanged from v1)

```sql
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

CREATE TABLE ai_generations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose TEXT NOT NULL,
  input_prompt TEXT,
  input_hash TEXT,
  model TEXT,
  output JSONB,
  tokens_in INT,
  tokens_out INT,
  cost_usd DECIMAL(8,4),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE weekly_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES students(id),
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  insight_text TEXT,
  suggested_adjustment TEXT,
  applied BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 7.2 Agent Schema (NEW)

```sql
-- Catalog of agents. Pre-seeded with the four v1 agents.
CREATE TABLE agents (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,                 -- 'calibration','content','frustration','insight'
  description TEXT,
  schedule_cron TEXT,                        -- e.g., '0 2 * * *' for 2am daily
  enabled BOOLEAN DEFAULT TRUE,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ
);

-- Every time an agent runs, a row is written here.
CREATE TABLE agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id INT REFERENCES agents(id),
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  status TEXT,                               -- 'running','completed','failed'
  error_message TEXT,
  observations JSONB,                        -- what the agent saw
  reasoning TEXT,                            -- the agent's chain of thought
  tokens_used INT,
  cost_usd DECIMAL(8,4)
);

-- Every action an agent decides to take. Some apply immediately; some need approval.
CREATE TABLE agent_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_run_id UUID REFERENCES agent_runs(id),
  action_type TEXT NOT NULL,                 -- 'tune_threshold','curate_queue','flag_pattern','suggest_intervention'
  target TEXT,                               -- e.g., 'student_skill_levels:math:level','session_settings:max_items'
  before_value JSONB,
  after_value JSONB,
  rationale TEXT,                            -- agent's explanation for parent
  requires_approval BOOLEAN DEFAULT FALSE,
  approved BOOLEAN,                          -- NULL = pending, TRUE = approved, FALSE = rejected
  approved_at TIMESTAMPTZ,
  applied BOOLEAN DEFAULT FALSE,
  applied_at TIMESTAMPTZ,
  reverted BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Per-student tunable parameters that agents are allowed to adjust.
-- This is the "knobs" surface that the Calibration Agent operates on.
CREATE TABLE student_tuning (
  student_id UUID REFERENCES students(id),
  parameter_name TEXT,                       -- 'tier_advance_accuracy','tier_advance_response_time','session_item_count','frustration_wrong_threshold','frustration_time_threshold'
  current_value DECIMAL(8,2),
  default_value DECIMAL(8,2),
  min_value DECIMAL(8,2),
  max_value DECIMAL(8,2),
  last_changed_at TIMESTAMPTZ,
  changed_by_agent INT REFERENCES agents(id),
  PRIMARY KEY (student_id, parameter_name)
);
```

### 7.3 Visualization in Supabase Studio

In Studio at `localhost:54323`, the **Database → Schema Visualizer** renders all 12 tables and their foreign keys as an interactive ER diagram. The new agent tables sit as a cluster connected to `students` and `sessions` — you can see at a glance how agent decisions flow into the user-facing tables.

The Studio query runner is the primary "agent control panel" if you want to inspect raw activity:

```sql
-- See the last 24 hours of agent activity
SELECT a.name, ar.started_at, ar.status, ar.reasoning, ar.cost_usd
FROM agent_runs ar
JOIN agents a ON a.id = ar.agent_id
WHERE ar.started_at > NOW() - INTERVAL '24 hours'
ORDER BY ar.started_at DESC;

-- See pending actions awaiting approval
SELECT a.name, aa.action_type, aa.target, aa.rationale, aa.created_at
FROM agent_actions aa
JOIN agent_runs ar ON ar.id = aa.agent_run_id
JOIN agents a ON a.id = ar.agent_id
WHERE aa.requires_approval = TRUE AND aa.approved IS NULL;
```

The parent dashboard (FR-29) wraps these queries in a friendly UI, but Studio is the power-user view.

---

## 8. Anthropic API Usage

### 8.1 Calls per Session (Synchronous)

| Call | When | Estimated tokens |
|---|---|---|
| Generate session items (5–8) | Once at session start, only if Content Agent hasn't pre-built the queue | ~2,000 in / ~3,000 out |
| Grade response | Once per item | ~500 in / ~200 out |
| Generate hint ("I'm stuck") | On demand | ~400 in / ~200 out |

### 8.2 Calls per Day (Agent System)

| Agent | Frequency | Estimated tokens per run |
|---|---|---|
| Calibration Agent | Daily, 2am | ~6,000 in / ~1,500 out |
| Content Agent | Daily, 3am | ~4,000 in / ~5,000 out (queue pre-build) |
| Frustration Agent | Weekly, Sunday 1am | ~5,000 in / ~1,000 out (model retrain) |
| Insight Agent | Weekly, Sunday 11pm | ~8,000 in / ~1,500 out |

### 8.3 Cost Estimate

At Claude Sonnet 4.7 pricing (~$3/M input, ~$15/M output) and 5 sessions/week with 6 items each, **plus** the agent runs:

- Synchronous loop: ~$2.20/month (unchanged from v1)
- Agent runs: ~$8/month (most of this is the daily Content Agent pre-building queues)
- **Total: ~$10–15/month typical, $25/month upper bound**

Set a $30 monthly cap in the Anthropic console as a safety net. Each agent reports its own cost in `agent_runs.cost_usd` so you can see where the spend goes in Studio.

### 8.4 Tool-Use API for Agents

Each agent runs as a Claude conversation with a defined toolset. The pattern:

```javascript
// backend/agents/calibration-agent.js (sketch)
const result = await anthropic.messages.create({
  model: "claude-sonnet-4-7",
  max_tokens: 4096,
  system: CALIBRATION_AGENT_SYSTEM_PROMPT,
  tools: [
    { name: "query_recent_attempts", description: "...", input_schema: {...} },
    { name: "query_skill_levels", description: "...", input_schema: {...} },
    { name: "propose_tuning_change", description: "...", input_schema: {...} }
  ],
  messages: [{ role: "user", content: "Run calibration check for Brielle." }]
});
// Loop: handle tool_use blocks, execute the tool, return results, until stop_reason === "end_turn"
```

This is the standard Anthropic agent loop. No frameworks (LangChain, etc.) needed — they add dependencies and abstractions for problems we don't have. Direct SDK + a small loop is easier to understand and debug.

---

## 9. User Experience

The UX is locked to the desktop mockup at `brielle_app_desktop.html`. The PRD adds one new surface: the Agent Activity Feed on the parent dashboard.

### 9.1 Routes

| Route | Screen |
|---|---|
| `/` | Today (mood + session start) |
| `/practice/:skill` | Active session |
| `/break` | Brain break |
| `/parent` | Weekly dashboard (with agent activity feed appended) |
| `/parent/agents` | **Full agent activity log + approval queue** |
| `/settings` | Interests, IEP goals, level overrides, **agent enable/disable toggles** |

### 9.2 Critical Interactions

- **Mood emoji + slider** sync: 😄 = 8, 🙂 = 6, 😐 = 5, 😟 = 3, 😢 = 1; user can override.
- **Activity view** shows structured-step boxes (math) or full passage (reading); sidebar collapses below 1100px.
- **Brain break** reachable from a persistent button in the sidebar AND triggered automatically per FR-5 / FR-29.
- **Parent dashboard** PIN-gated (4-digit code, friction not security).
- **Agent activity feed** appears below the weekly insight on the dashboard. Each entry shows: agent name (with icon), timestamp, action description in plain English, "Approve / Revert" buttons where applicable, and an expandable "Why?" section showing the agent's reasoning.

---

## 10. Build Plan

12 weeks now, 6 phases. Two extra weeks for the agent system.

### Phase 1 — Foundation (Week 1)

- Initialize repo, monorepo structure
- `supabase init` and `supabase start` working
- Run all 12 migrations from §7
- Open Supabase Studio at `localhost:54323`, verify schema
- Seed `skills`, `students`, `agents` tables
- Express boilerplate, `.env` loaded, Anthropic SDK installed
- React + Vite boilerplate, Fraunces + Nunito loaded

**Exit criteria:** `supabase start && npm run dev` shows a styled blank page that talks to a backend that talks to Postgres and to Claude.

### Phase 2 — Core Loop (Weeks 2–4)

- **Week 2:** Mood check-in component, session creation endpoint, navigation to placeholder activity view
- **Week 3:** SRS engine with the static FR-13 thresholds from `student_tuning` defaults. Unit tests for tier logic. Seed 50 items per skill at level 1.
- **Week 4:** Activity view with math end-to-end: Claude generates the item, user submits, Claude grades, attempt logged, mastery updates, next item loads.

**Exit criteria:** Full math session works end-to-end, all data lands in DB visible in Studio.

### Phase 3 — All Skills + CBT (Weeks 5–6)

- **Week 5:** Reading, Spelling (with browser TTS), Typing modules.
- **Week 6:** Brain break route, frustration auto-trigger logic, "I'm stuck" SOLVED hint, post-session reflection.

**Exit criteria:** All four skills work. Brain breaks fire. Sessions end with reflection.

### Phase 4 — Parent Dashboard (Weeks 7–8)

- **Week 7:** Dashboard page matches mockup section 4: stat cards, skill bars, mood chart, pulled from Postgres views.
- **Week 8:** PIN gate, settings page, IEP-export PDF using `pdf-lib`.

**Exit criteria:** Dashboard shows real data, IEP PDF exports cleanly.

### Phase 5 — Agent System (Weeks 9–10) — NEW

- **Week 9:** Agent runtime infrastructure:
  - `agent-runner.js` with node-cron scheduler
  - Tool definitions in `agents/tools/`
  - Tool execution loop (handle Claude's `tool_use` blocks, execute, return result, repeat until `end_turn`)
  - Logging to `agent_runs` and `agent_actions`
  - Build the **Insight Agent first** (lowest risk — it only writes to `weekly_insights`, nothing user-facing changes)
  - Build the **Calibration Agent** with `requires_approval = TRUE` for all actions initially
- **Week 10:**
  - Build the **Content Agent** (writes to a "candidate queue" that the SRS reads from; if empty, falls back to v1 behavior)
  - Build the **Frustration Agent** (writes pattern data; the activity loop reads it as an additional signal alongside the static rules in FR-5)
  - Agent Activity Feed UI on dashboard
  - Approval/revert flow

**Exit criteria:** All four agents run on schedule, log everything, and the parent dashboard shows their activity. Calibration Agent's threshold changes require parent approval; the others apply immediately but are revertable.

### Phase 6 — Polish & Pilot (Weeks 11–12)

- **Week 11:** Error states, loading states, accessibility pass (keyboard nav, font size toggle).
- **Week 12:** Brielle uses it for one full week. Daily debugging based on her actual usage. Tune agent prompts and approval thresholds based on observed behavior.

**Exit criteria:** Brielle uses it daily. Agents run without producing nonsense. Approval rate ≥ 60% (KPI from §2).

### Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Claude generates inappropriate content | System prompts include child-safety instructions. Generated content logged in `ai_generations`, reviewable. |
| API outage breaks practice | Cache 2 weeks of pre-generated items per skill. Grading degrades to string-match for typing/spelling. **Agents are non-blocking — a failed run logs the failure and retries next schedule.** |
| Brielle resists daily use | Streak counter + parent-set session length (start at 10 min). |
| SRS tuning is wrong | Tiers and thresholds are defaults in `student_tuning`. **The Calibration Agent personalizes them — but parent approval gate prevents bad changes from sticking.** |
| **Agents make bad decisions** | **All consequential changes (level shifts, threshold changes) require parent approval. Non-consequential changes (queue curation, insight phrasing) apply immediately but are revertable. Every action has a `before_value` so revert is one click.** |
| **Agents accumulate cost** | **Each agent's `cost_usd` is logged per run. Anthropic console cap at $30/month. Disable any agent via the settings toggle if costs spike.** |
| **Agents conflict with each other** | **Agents run on different schedules and operate on different surfaces (Calibration → tuning, Content → queue, Frustration → patterns, Insight → summaries). No shared write surface, so no merge conflicts.** |
| You hate maintaining it | Boring stack on purpose: React + Express + Postgres + Anthropic SDK. **Agents are plain JS files in `agents/` — each one ~200 lines. No framework to learn.** |

---

## 11. Agentic System (NEW)

This section defines the four background agents that monitor Brielle's progress and autonomously adapt the learning experience.

### 11.1 Design Principles

Before describing each agent, the principles that govern all of them:

1. **Agents observe and decide; the synchronous loop executes.** Agents do not run inside the activity view's critical path. Brielle never waits for an agent. Agents work overnight and on weekends and write their decisions to the database; the next session reads those decisions.

2. **Agents have narrow scopes.** Each agent has one job and one set of tools. The Calibration Agent cannot generate content. The Content Agent cannot change thresholds. This is for safety, debuggability, and cost control.

3. **Consequential actions require approval; cosmetic actions don't.** Changing a tier-advance threshold is consequential — it affects what Brielle experiences for weeks. Picking which 6 spelling words go in tomorrow's queue is cosmetic — if the agent is wrong, it costs one session. The approval surface is calibrated accordingly.

4. **Every action is reversible.** `before_value` is captured. Revert is one click in the Agent Activity Feed.

5. **Agents are observable.** Every run writes `observations`, `reasoning`, and `actions` to the database. You can read what an agent saw, what it concluded, and what it did, in plain English, in Studio or the dashboard.

6. **Agents fail safe.** A crashed or skipped agent run does not break the loop. The synchronous code falls back to the v1 static behavior if agent outputs are stale or missing.

### 11.2 The Four Agents

#### 11.2.1 Calibration Agent

**Purpose:** Personalize the SRS thresholds (originally hardcoded in FR-15 / FR-16) to Brielle's actual learning patterns.

**Schedule:** Daily, 2am.

**Inputs (read-only tools):**
- `query_recent_attempts(student_id, days)` — last N days of item attempts
- `query_skill_progression(student_id, skill_id)` — accuracy and response time trends
- `query_current_tuning(student_id)` — current parameter values

**Outputs (write tools, all `requires_approval = TRUE`):**
- `propose_tuning_change(parameter, new_value, rationale)` — proposes a change to one parameter in `student_tuning`

**Example reasoning chain:**
> "Looking at the last 14 days, Brielle's response time on Tier-3 math items averages 42 seconds, not the threshold of 30. But her accuracy at this speed is 89%. She's slower than the median learner but more accurate. Proposing to raise her tier-advance response time from 30s to 45s for math specifically — this should let her advance through math without the floor being unreachable."

**Why it matters:** Static thresholds designed for the median student systematically penalize ADHD learners who process slowly but accurately. Without this agent, Brielle might never advance in math despite mastery.

#### 11.2.2 Content Agent

**Purpose:** Pre-build tomorrow's session queues with deliberate item selection (rather than random sampling within the 60/25/15 ratio).

**Schedule:** Daily, 3am.

**Inputs:**
- `query_due_items(student_id, skill_id)` — items due for review per SRS
- `query_recent_misses(student_id, days)` — recently-missed items and the concepts they cover
- `query_interests(student_id)` — current interest list
- `query_iep_goals()` — IEP goal text per skill

**Outputs (apply immediately, revertable):**
- `curate_queue(student_id, skill_id, item_ids[])` — writes the next session's queue to a `next_session_queue` cache the SRS reads first
- `request_new_items(skill_id, level, topic, count)` — triggers the synchronous content generator to produce specific items the agent identified gaps in

**Example reasoning chain:**
> "Brielle has 12 spelling items due for review. Looking at the misses, 4 of them share the pattern 'r-controlled vowels in two-syllable words' (e.g., 'farther,' 'corner'). I'll cluster those 4 together early in the queue while she's fresh, mix in 2 confidence-builders from her Tier-3 mastered items, and leave 2 new items for the end. Skipping topic-rotation today since she's been on the dog theme three days in a row — generating one art-themed sentence for the typing module."

**Why it matters:** Random sampling within tiers misses the pedagogical opportunity to cluster related concepts. The Kumon method specifically arranges items to reinforce patterns; this agent does that programmatically.

#### 11.2.3 Frustration Agent

**Purpose:** Learn Brielle's personal frustration precursors and improve the brain-break trigger beyond the static FR-5 rules.

**Schedule:** Weekly, Sunday 1am (model "retrain").

**Inputs:**
- `query_brain_break_history(student_id, weeks)` — every brain break with its trigger
- `query_attempts_before_breaks(student_id)` — the 3-5 attempts immediately preceding each brain break, to identify patterns
- `query_session_outcomes(student_id, weeks)` — sessions that ended early, low post-session moods, etc.

**Outputs (apply immediately, revertable):**
- `update_frustration_signals(student_id, signal_type, threshold)` — writes a per-student frustration signal to `student_tuning` (e.g., "response_time_doubled" with a threshold)

**Example reasoning chain:**
> "Across the last 4 weeks, 8 of Brielle's 11 brain breaks were preceded by a specific pattern: her response time doubled from her trailing 5-attempt average, AND she used a hint, AND she got the next item wrong. Adding 'response_time_doubled_with_hint' as a new frustration signal that triggers a brain break offer one item earlier than the current 'two wrong in a row' rule."

**Why it matters:** "Two wrong in a row" is a generic rule. Brielle's actual shutdown pattern may be more subtle — a particular slowdown, a hint usage, a sigh in the reflection text. This agent finds her signature.

#### 11.2.4 Insight Agent

**Purpose:** Generate the weekly summary for the parent dashboard (FR-27) and the IEP-export PDF, plus surface emerging patterns.

**Schedule:** Weekly, Sunday 11pm.

**Inputs:**
- `query_week_summary(student_id, week_start)` — accuracy, mood, time, brain breaks for the week
- `query_skill_trends(student_id, weeks)` — multi-week trends per skill
- `query_iep_alignment(student_id)` — current performance vs. IEP target (80%)
- `query_recent_reflections(student_id, weeks)` — Brielle's freeform end-of-session reflections
- `query_other_agent_activity(week)` — what the other three agents did this week

**Outputs (apply immediately, revertable):**
- `write_weekly_insight(student_id, insight_text, suggested_adjustment)` — writes a row to `weekly_insights`
- `flag_iep_concern(student_id, skill_id, concern_text)` — flags items for parent attention with higher visibility on the dashboard

**Example output:**
> "Spelling held steady at 64% — multisyllabic words remain the snag, exactly the gap her IEP flags. Math improved 6 points to 85% (above the IEP target). Brain breaks fired 3 times this week, down from 5 last week. Notable: her reflections mention 'tired' twice on days following sessions after 7pm. **Suggested:** consider locking the session to before 6pm. Also: spelling has now been below the IEP target for 4 consecutive weeks — recommend bringing this to the next IEP team meeting."

**Why it matters:** This is the agent that does the actual work you'd otherwise have to do: pattern-finding across multiple data streams to produce a parent-readable summary. It also writes the artifact you bring to the IEP review.

### 11.3 Approval & Reversion Surface

The dashboard's Agent Activity Feed shows three categories:

| Category | Examples | Default behavior |
|---|---|---|
| **Pending approval** | Calibration threshold changes | Agent proposes; nothing happens until parent clicks Approve. Email/notification optional in v2. |
| **Applied (revertable)** | Content Agent queue choices, Insight Agent weekly summaries, Frustration Agent signals | Apply immediately. Visible in feed. One-click revert. |
| **Informational** | Patterns the agent noticed but didn't act on | Visible only — agent flagged for awareness. |

The settings page has a master switch per agent — toggle off any agent that's not earning its keep, without affecting the synchronous loop.

### 11.4 Why Not Frameworks (LangChain, AutoGen, etc.)

A reasonable question: why hand-roll the agent loop instead of using LangChain or similar?

The Anthropic SDK already supports tool-use natively. Each agent in this system is ~150–250 lines of plain JavaScript: a system prompt, a list of tools, a while-loop that hands tool calls to executor functions and feeds results back to Claude. Adding a framework adds dependencies, abstractions, and learning curve for problems this codebase doesn't have:

- We don't need multi-agent collaboration (each agent is independent).
- We don't need tool routing (each agent has a fixed toolset).
- We don't need vector stores (Postgres queries are the memory).
- We don't need a workflow engine (cron is enough).

The framework would be more code to learn and debug than the agents themselves. KISS.

---

## 12. Future Enhancements (v2+)

- Voice input (microphone → speech-to-text → answer) for Brielle's reading-aloud goal
- Text-to-speech for reading passages
- Multi-child support
- Sync to a cloud Supabase instance for cross-device use
- Teacher view (read-only dashboard share with her IEP team)
- Native iPad app via React Native or PWA wrapper
- **Fifth agent: Curriculum Alignment Agent that periodically re-reads the current IEP PDF (or its updated version) and proposes content/goal changes when the IEP itself changes**
- **Agent-to-agent messaging via a shared notes table — e.g., Frustration Agent leaves a note that Calibration Agent reads on its next run**
- **Agent simulation mode: run the agents against last month's data to test prompt changes before deploying them**

---

## 13. Open Questions

1. **Time of day for the daily session.** ADHD literature favors morning. Decide with Brielle in week 1.
2. **Reward/streak threshold.** Does 4 days/week feel achievable? Adjust before pilot.
3. **Voice input as v2 priority?** v1 says keyboard only.
4. **Who else sees the parent dashboard?** Just you, or also her other parent?
5. **Agent approval frequency.** If pending approvals pile up, should agents batch or escalate? (Likely: a weekly digest email if approvals sit > 7 days. v2.)
6. **Should the Insight Agent have read access to the IEP PDF directly?** v1 has IEP goals copied into `skills.iep_goal_text` as text; v2 might give the agent file access to the PDF for richer context. Tradeoff: more context vs. larger token cost.

---

*— End of PRD —*
