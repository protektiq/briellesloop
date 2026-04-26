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

  parentDashboard[ParentDashboard] --> studentsTbl[students]
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
  agentsApi --> agentsTbl
  agentsApi --> agentRunsTbl
  agentsApi --> agentActionsTbl
```

## Notes

- Core learning flow: `students` + `skills` drive session queueing, attempts, and item mastery updates.
- Agent flow: `agents` create `agent_runs`, write `agent_actions`, and adjust `student_tuning` that influences future sessions.
- Weekly summaries are persisted in `weekly_insights` for parent review and IEP reporting.
- API layer now includes SRS-driven queue building and mastery updates in `/api/items/*`.

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
  routeOutlet --> parentPage[ParentDashboardPage]
  routeOutlet --> agentPage[AgentActivityPage]
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
