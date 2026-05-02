# Data Flow Diagram

```mermaid
flowchart TD
  frontendApp[frontendApp localhost:5173] --> backendApi[backendApi localhost:3001]
  backendApi --> sessionApi[/api/session/*]
  backendApi --> itemsApi[/api/items/*]
  backendApi --> aiApi[/api/ai/*]
  backendApi --> dashboardApi[/api/dashboard/*]
  backendApi --> agentsApi[/api/agents/*]
  backendApi --> exportApi[/api/export/iep-pdf]
  backendApi --> settingsApi[/api/settings/*]
  backendApi --> parentApi[/api/parent/*]

  parentDashboard[ParentDashboard] --> studentsTbl[students]
  parentDashboard --> parentSettingsTbl[parent_settings]
  settingsApi --> parentSettingsTbl
  parentApi --> parentSettingsTbl
  parentDashboard --> sessionsTbl[sessions]
  sessionsTbl --> attemptsTbl[attempts]
  sessionsTbl --> brainBreaksTbl[brain_breaks]
  studentsTbl --> studentSkillLevelsTbl[student_skill_levels]
  studentsTbl --> itemMasteryTbl[item_mastery]
  skillsTbl[skills] --> itemsTbl[items]
  skillsTbl --> sessionsTbl
  itemsTbl --> itemMasteryTbl
  itemsTbl --> attemptsTbl
  studentsTbl --> weeklyInsightsTbl[weekly_insights]

  agentsTbl[agents] --> agentRunsTbl[agent_runs]
  agentRunsTbl --> agentActionsTbl[agent_actions]
  studentsTbl --> studentTuningTbl[student_tuning]
  agentsTbl --> studentTuningTbl
  agentActionsTbl --> studentTuningTbl
  agentActionsTbl --> sessionsTbl
  agentActionsTbl --> studentSkillLevelsTbl
  sessionApi --> sessionsTbl
  itemsApi --> itemsTbl
  itemsApi --> attemptsTbl
  dashboardApi --> weeklyInsightsTbl
  dashboardApi --> sessionsTbl
  dashboardApi --> brainBreaksTbl
  exportApi --> sessionsTbl
  exportApi --> weeklyInsightsTbl
  exportApi --> itemMasteryTbl
  agentsApi --> agentsTbl
  agentsApi --> agentRunsTbl
  agentsApi --> agentActionsTbl
```

## Notes

- Core learning flow: `students` + `skills` drive session queueing, attempts, and item mastery updates.
- Agent flow: `agents` create `agent_runs`, write `agent_actions`, and adjust `student_tuning` that influences future sessions.
- Weekly summaries are persisted in `weekly_insights` for parent review and IEP reporting.
- API layer now includes SRS-driven queue building and mastery updates in `/api/items/*`.
- **Parent PIN:** `parent_settings.parent_pin_hash` (bcrypt). `GET /api/settings/parent-pin`, `POST /api/settings/parent-pin`. Unlock: `POST /api/parent/verify-pin`. Frontend keeps an unlocked flag in `sessionStorage` for `/parent/*`.
- **Parent dashboard data:** `GET /api/dashboard/week` aggregates `sessions`, `brain_breaks`, `skills`, `weekly_insights` (UTC Monday week windows).
- **IEP PDF:** `GET /api/export/iep-pdf` builds an A4 `pdf-lib` report (12-week tables + snapshots).

## Frontend Route Shell (Design System Foundation)

```mermaid
flowchart TD
  browser[Browser] --> reactRouter[ReactRouter]
  reactRouter --> layout[Layout]
  layout --> topNav[TopNav]
  layout --> routeOutlet[RouteOutlet]
  uiStore[ZustandUiStore] --> topNav
  routeOutlet --> todayPage[TodayPage]
  routeOutlet --> practicePage[PracticePage]
  routeOutlet --> breakPage[BrainBreakPage]
  routeOutlet --> parentGate[ParentGateLayout]
  parentGate --> parentPage[ParentDashboardPage]
  parentGate --> agentPage[AgentActivityPage]
  routeOutlet --> settingsPage[SettingsPage]
  cssTokens[tokensCss] --> topNav
  cssTypography[typographyCss] --> topNav
  cssComponents[componentsCss] --> topNav
  cssTokens --> routeOutlet
  cssTypography --> routeOutlet
  cssComponents --> routeOutlet
```

## Today Page Flow (Mood + Skill Start)

```mermaid
flowchart TD
  todayPage[TodayPage] --> moodCheckIn[MoodCheckIn]
  todayPage --> skillPicker[SkillTileGrid]
  todayPage --> planCard[TodayPlanCard]

  todayPage --> dashboardSkillsApi[GET /api/dashboard/skills]
  dashboardSkillsApi --> skillsTbl[skills]
  dashboardSkillsApi --> studentSkillLevelsTbl[student_skill_levels]
  dashboardSkillsApi --> itemMasteryTbl[item_mastery]
  dashboardSkillsApi --> suggestedSkillSvc[getSuggestedSkill]

  planCard --> sessionStartApi[POST /api/session/start]
  sessionStartApi --> sessionsTbl[sessions]
  sessionStartApi --> skillsLookup[skills]

  todayPage --> moodDecision{lowMoodOrLowScore}
  moodDecision -->|yes| breakRoute[/break]
  moodDecision -->|no| practiceRoute[/practice/:skillName]
```

## SRS Queue + Attempt Flow

```mermaid
flowchart TD
  practicePage[PracticePage] --> queueApi[GET /api/items/queue/:skill_id?session_id]
  queueApi --> sessionValidation[ValidateActiveSession]
  sessionValidation --> queueBuilder[buildSessionQueue]
  queueBuilder --> cacheCheck[next_session_queue exists]
  cacheCheck -->|yes cache hit| cachedItems[UseCachedQueue]
  cacheCheck -->|no cache| ratioBuilder[Build60_25_15Mix]
  ratioBuilder --> itemMasteryTbl[item_mastery]
  ratioBuilder --> itemsTbl[items]
  cachedItems --> queueResponse[QueueResponse]
  ratioBuilder --> queueResponse

  practicePage --> attemptApi[POST /api/items/:id/attempt]
  attemptApi --> attemptInsert[InsertAttemptsRow]
  attemptInsert --> masteryStats[LoadMasteryStatsAndTuning]
  masteryStats --> srsPure[srs.js pure functions]
  srsPure --> masteryUpdate[Update item_mastery]
  masteryUpdate --> levelDecision[AdvanceOrDrop student_skill_levels]
  levelDecision --> nextItemResponse[NextItemOrSessionComplete]
```

## Math Activity Loop (Claude generation + grading + hint)

```mermaid
flowchart TD
  practicePage[PracticePage math] --> queueApi[GET /api/items/queue/math?session_id]
  queueApi --> ensureItems[ensureMathQueueItems]
  ensureItems --> contentGenerator[content-generator.generateMathItem]
  contentGenerator --> claudeApi[Claude messages API]
  contentGenerator --> aiGenerationsTbl[ai_generations cache]
  contentGenerator --> itemsTbl[items]
  contentGenerator --> itemMasteryTbl[item_mastery tier 0]
  queueApi --> queueBuilderMath[buildSessionQueue 60/25/15]
  queueBuilderMath --> queueResponseMath[QueueResponse]

  practicePage --> attemptApiMath[POST /api/items/:id/attempt]
  attemptApiMath --> graderSvc[grader.gradeAttempt]
  graderSvc --> claudeApi
  graderSvc --> aiGenerationsTbl
  attemptApiMath --> attemptsTbl[attempts ai_feedback]
  attemptApiMath --> itemMasteryTbl
  attemptApiMath --> studentSkillLevelsTbl[student_skill_levels]
  attemptApiMath --> attemptResp[NextItem or sessionComplete + tier_changed]

  practicePage --> hintApi[POST /api/ai/hint]
  hintApi --> hintSvc[grader.generateHint]
  hintSvc --> claudeApi
  hintSvc --> aiGenerationsTbl
  hintApi --> coachCard[CoachCard hint]

  practicePage --> completeRoute[/practice/math/complete]
  completeRoute --> sessionEndApi[POST /api/session/:id/end]
  sessionEndApi --> sessionsEndedAt[sessions ended_at + items_attempted/correct]
```

## Reading, Spelling, and Typing (Task 10)

```mermaid
flowchart TD
  practicePage[PracticePage dispatch] --> skillViews[MathReadingSpellingTyping views]

  queueRead[GET queue reading] --> ensureRead[ensureReadingQueueItems]
  ensureRead --> genRead[skills-queue.generateReadingItem]
  genRead --> claudeRead[Claude]
  genRead --> itemsRead[items reading_passage]

  queueSpell[GET queue spelling] --> ensureSpell[ensureSpellingQueueItems]
  ensureSpell --> spellBank[items spelling_word seeded bank]

  queueType[GET queue typing] --> ensureType[ensureTypingQueueItems]
  ensureType --> genType[skills-queue.generateTypingItem]
  genType --> claudeType[Claude]
  genType --> itemsType[items typing_sentence]

  attemptRead[POST attempt reading] --> gradeRead[grader Claude reading_grade]
  attemptRead --> attemptsTbl
  attemptRead --> sessionTargetRead["sessionComplete when attempts >= session_item_count * 3"]

  attemptSpell[POST attempt spelling] --> gradeSpell[grader local string match]
  attemptType[POST attempt typing] --> gradeType[grader local accuracy + WPM]

  hintRead[POST /api/ai/hint reading] --> hintReadSvc[generateReadingHint Claude]
  hintSpell[spelling TTS] --> speechSynth[browser SpeechSynthesis]
```

- **Practice UI**: [`PracticePage.jsx`](frontend/src/pages/PracticePage.jsx) delegates rendering to [`PracticeSkillViews.jsx`](frontend/src/components/practice/PracticeSkillViews.jsx) per skill; spelling uses SpeechSynthesis; typing shows live WPM/accuracy vs target.
- **Reading**: Each queued row is one passage with three comprehension questions; the client sends `reading_question_index` (0–2) per attempt; session completion counts attempts at **3×** `session_item_count` so five passages still equal fifteen graded interactions.

## CBT Break + Post-Session Checkout Flow

```mermaid
flowchart TD
  todayPage[TodayPage] --> moodCheck[MoodCheckIn pre_mood]
  moodCheck --> lowMoodGate{score_lte_3_or_sad_worried}
  lowMoodGate -->|yes| breakRouteLow[/break triggered_by low_mood]
  lowMoodGate -->|no| practicePage[PracticePage]

  practicePage --> frustrationGate{two_wrong_or_over_60s_or_user_button}
  frustrationGate -->|offer_accept| breakRouteInSession[/break triggered_by auto_or_user]
  frustrationGate -->|decline| practicePage

  breakRouteLow --> breakLogApi[POST /api/session/:id/brain-break]
  breakRouteInSession --> breakLogApi
  breakLogApi --> brainBreaksTbl[brain_breaks]

  practicePage --> completePage[SessionCompletePage]
  completePage --> endApi[POST /api/session/:id/end]
  endApi --> sessionsTbl[sessions ended_at]
  completePage --> postCheckoutApi[POST /api/session/:id/post-checkout]
  postCheckoutApi --> sessionsMood[sessions post_mood_emoji post_mood_score reflection]
```

## Parent dashboard + PIN + IEP export

```mermaid
flowchart TD
  parentGate[ParentGateLayout] --> pinCheck{GET /api/settings/parent-pin}
  pinCheck -->|configured and not unlocked| pinScreen[PIN entry POST /api/parent/verify-pin]
  pinScreen --> sessionStorageFlag[sessionStorage briellesloop_parent_unlocked_v1]
  pinCheck -->|not configured or unlocked| parentDash[ParentDashboardPage]
  sessionStorageFlag --> parentDash

  parentDash --> weekApi[GET /api/dashboard/week]
  weekApi --> sessionsTbl[sessions]
  weekApi --> brainBreaksTbl[brain_breaks]
  weekApi --> skillsTbl[skills]
  weekApi --> weeklyInsightsTbl[weekly_insights]

  parentDash --> pdfApi[GET /api/export/iep-pdf]
  pdfApi --> itemMasteryTbl[item_mastery]

  settingsPage[SettingsPage] --> savePin[POST /api/settings/parent-pin]
  savePin --> parentSettingsTbl[parent_settings]
```
