import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { API_BASE_URL } from '../constants/api'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

const AgentActivityPage = () => {
  const [agents, setAgents] = useState([])
  const [actions, setActions] = useState([])
  const [runs, setRuns] = useState([])
  const [notes, setNotes] = useState([])
  const [costSummary, setCostSummary] = useState(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [busyId, setBusyId] = useState('')
  const [expanded, setExpanded] = useState(() => new Set())
  const [promptOpenAgent, setPromptOpenAgent] = useState('')
  const [promptTextByAgent, setPromptTextByAgent] = useState(() => ({}))
  const [promptLoaded, setPromptLoaded] = useState(() => new Set())
  const [promptBusy, setPromptBusy] = useState('')
  const [simulateAgent, setSimulateAgent] = useState('')
  const [simulateDateFrom, setSimulateDateFrom] = useState('')
  const [simulateDateTo, setSimulateDateTo] = useState('')
  const [simulateLoading, setSimulateLoading] = useState(false)
  const [simulateResult, setSimulateResult] = useState(null)
  const simulateDialogRef = useRef(null)
  const resultDialogRef = useRef(null)

  const loadAll = useCallback(async () => {
    try {
      setErrorMessage('')
      const [costRes, agentRes, actionRes, runRes, notesRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/agents/cost-summary`),
        fetch(`${API_BASE_URL}/api/agents`),
        fetch(`${API_BASE_URL}/api/agents/actions?limit=120`),
        fetch(`${API_BASE_URL}/api/agents/runs?limit=60`),
        fetch(`${API_BASE_URL}/api/agents/notes`),
      ])
      if (!costRes.ok) {
        throw new Error(`Cost summary ${costRes.status}`)
      }
      if (!agentRes.ok) {
        throw new Error(`Agents ${agentRes.status}`)
      }
      if (!actionRes.ok) {
        throw new Error(`Actions ${actionRes.status}`)
      }
      if (!runRes.ok) {
        throw new Error(`Runs ${runRes.status}`)
      }
      if (!notesRes.ok) {
        throw new Error(`Notes ${notesRes.status}`)
      }
      const costPayload = await costRes.json()
      const agentPayload = await agentRes.json()
      const actionPayload = await actionRes.json()
      const runPayload = await runRes.json()
      const notesPayload = await notesRes.json()
      setCostSummary(typeof costPayload === 'object' && costPayload !== null ? costPayload : null)
      setAgents(Array.isArray(agentPayload.agents) ? agentPayload.agents : [])
      setActions(Array.isArray(actionPayload.actions) ? actionPayload.actions : [])
      setRuns(Array.isArray(runPayload.runs) ? runPayload.runs : [])
      setNotes(Array.isArray(notesPayload.notes) ? notesPayload.notes : [])
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not load agents.'
      setErrorMessage(msg)
      setCostSummary(null)
    }
  }, [])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  useEffect(() => {
    const open = simulateAgent || simulateResult
    if (!open) {
      return undefined
    }
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (simulateResult) {
          setSimulateResult(null)
        } else {
          setSimulateAgent('')
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [simulateAgent, simulateResult])

  const pendingActions = useMemo(
    () =>
      actions.filter((a) => a.requires_approval === true && a.approved === null && a.reverted !== true),
    [actions],
  )

  const revertableActions = useMemo(
    () =>
      actions.filter(
        (a) =>
          a.applied === true &&
          a.reverted !== true &&
          a.action_type !== 'request_new_items',
      ),
    [actions],
  )

  const handleToggleExpand = useCallback((id) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  const handleApprove = useCallback(
    async (actionId) => {
      setBusyId(actionId)
      try {
        const response = await fetch(`${API_BASE_URL}/api/agents/actions/${actionId}/approve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
        if (!response.ok) {
          const body = await response.json().catch(() => ({}))
          throw new Error(body.error ?? `Approve failed (${response.status})`)
        }
        await loadAll()
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : 'Approve failed.')
      } finally {
        setBusyId('')
      }
    },
    [loadAll],
  )

  const handleReject = useCallback(
    async (actionId) => {
      setBusyId(actionId)
      try {
        const response = await fetch(`${API_BASE_URL}/api/agents/actions/${actionId}/reject`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
        if (!response.ok) {
          const body = await response.json().catch(() => ({}))
          throw new Error(body.error ?? `Reject failed (${response.status})`)
        }
        await loadAll()
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : 'Reject failed.')
      } finally {
        setBusyId('')
      }
    },
    [loadAll],
  )

  const handleRevert = useCallback(
    async (actionId) => {
      setBusyId(actionId)
      try {
        const response = await fetch(`${API_BASE_URL}/api/agents/actions/${actionId}/revert`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'parent_revert' }),
        })
        if (!response.ok) {
          const body = await response.json().catch(() => ({}))
          throw new Error(body.error ?? `Revert failed (${response.status})`)
        }
        await loadAll()
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : 'Revert failed.')
      } finally {
        setBusyId('')
      }
    },
    [loadAll],
  )

  const handleOpenSimulate = useCallback((agentName) => {
    setSimulateAgent(agentName)
    setSimulateDateFrom('')
    setSimulateDateTo('')
    setTimeout(() => simulateDialogRef.current?.querySelector('input')?.focus(), 0)
  }, [])

  const handleCloseSimulate = useCallback(() => {
    if (!simulateLoading) {
      setSimulateAgent('')
    }
  }, [simulateLoading])

  const handleSubmitSimulate = useCallback(async () => {
    const from = simulateDateFrom.trim()
    const to = simulateDateTo.trim()
    if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) {
      setErrorMessage('Use valid YYYY-MM-DD dates for the simulation range.')
      return
    }
    const t0 = Date.parse(`${from}T00:00:00.000Z`)
    const t1 = Date.parse(`${to}T00:00:00.000Z`)
    if (!Number.isFinite(t0) || !Number.isFinite(t1) || t0 >= t1) {
      setErrorMessage('Start date must be before end date.')
      return
    }
    const inclusiveDays = Math.floor((t1 - t0) / 86400000) + 1
    if (inclusiveDays > 90) {
      setErrorMessage('Range must be at most 90 calendar days.')
      return
    }
    setErrorMessage('')
    setSimulateLoading(true)
    try {
      const response = await fetch(`${API_BASE_URL}/api/agents/${encodeURIComponent(simulateAgent)}/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date_from: from, date_to: to }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(body.error ?? `Simulation failed (${response.status})`)
      }
      setSimulateAgent('')
      setSimulateResult(body)
      await loadAll()
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Simulation failed.')
    } finally {
      setSimulateLoading(false)
    }
  }, [simulateAgent, simulateDateFrom, simulateDateTo, loadAll])

  const handleCloseResult = useCallback(() => {
    setSimulateResult(null)
  }, [])

  const handleTogglePrompt = useCallback(
    async (agentName) => {
      if (promptOpenAgent === agentName) {
        setPromptOpenAgent('')
        return
      }
      setPromptOpenAgent(agentName)
      if (promptLoaded.has(agentName)) {
        return
      }
      try {
        setPromptBusy(agentName)
        const response = await fetch(`${API_BASE_URL}/api/agents/${encodeURIComponent(agentName)}/prompt`)
        if (!response.ok) {
          const body = await response.json().catch(() => ({}))
          throw new Error(body.error ?? `Load prompt failed (${response.status})`)
        }
        const data = await response.json()
        const text = typeof data.prompt_text === 'string' ? data.prompt_text : ''
        setPromptTextByAgent((prev) => ({ ...prev, [agentName]: text }))
        setPromptLoaded((prev) => new Set(prev).add(agentName))
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : 'Could not load prompt.')
        setPromptOpenAgent('')
      } finally {
        setPromptBusy('')
      }
    },
    [promptOpenAgent, promptLoaded],
  )

  const handlePromptChange = useCallback((agentName, value) => {
    setPromptTextByAgent((prev) => ({ ...prev, [agentName]: value }))
  }, [])

  const handleSavePrompt = useCallback(
    async (agentName) => {
      const text = promptTextByAgent[agentName]
      if (typeof text !== 'string' || text.trim().length === 0) {
        setErrorMessage('Prompt cannot be empty.')
        return
      }
      setPromptBusy(agentName)
      setErrorMessage('')
      try {
        const response = await fetch(`${API_BASE_URL}/api/agents/${encodeURIComponent(agentName)}/prompt`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt_text: text }),
        })
        if (!response.ok) {
          const body = await response.json().catch(() => ({}))
          throw new Error(body.error ?? `Save failed (${response.status})`)
        }
        await loadAll()
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : 'Save failed.')
      } finally {
        setPromptBusy('')
      }
    },
    [promptTextByAgent, loadAll],
  )

  const handleRestorePrompt = useCallback(
    async (agentName) => {
      setPromptBusy(agentName)
      setErrorMessage('')
      try {
        const response = await fetch(
          `${API_BASE_URL}/api/agents/${encodeURIComponent(agentName)}/prompt/restore`,
          { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) },
        )
        if (!response.ok) {
          const body = await response.json().catch(() => ({}))
          throw new Error(body.error ?? `Restore failed (${response.status})`)
        }
        const data = await response.json()
        const text = typeof data.prompt_text === 'string' ? data.prompt_text : ''
        setPromptTextByAgent((prev) => ({ ...prev, [agentName]: text }))
        await loadAll()
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : 'Restore failed.')
      } finally {
        setPromptBusy('')
      }
    },
    [loadAll],
  )

  return (
    <section className="dash-section">
      <div className="dash-frame">
        <h2 className="dash-title">
          Agent <em>activity</em>
        </h2>
        <p className="dash-meta" style={{ marginTop: 12 }}>
          Background agents log every run and action to Postgres. Pending calibration proposals need
          approval; applied queue and insight rows can be reverted here.
        </p>

        <div className="dash-cost-panel" aria-live="polite">
          <div className="dash-section-title" style={{ marginTop: 8 }}>
            API spend this month
          </div>
          {costSummary ? (
            <>
              <p className="dash-meta">
                Month <strong>{costSummary.month}</strong> · Total{' '}
                <strong>${Number(costSummary.total_usd ?? 0).toFixed(4)}</strong> USD (agent runs + practice
                AI calls).
              </p>
              <ul className="dash-cost-list">
                <li>
                  Background agents (scheduled runs):{' '}
                  <strong>${Number(costSummary.agent_runs_usd ?? 0).toFixed(4)}</strong>
                </li>
                <li>
                  Practice / grading / content (sync):{' '}
                  <strong>${Number(costSummary.ai_generations_usd ?? 0).toFixed(4)}</strong>
                </li>
              </ul>
              {Array.isArray(costSummary.agent_runs_by_agent) && costSummary.agent_runs_by_agent.length > 0 ? (
                <p className="dash-meta">
                  By agent:{' '}
                  {costSummary.agent_runs_by_agent
                    .map((row) => `${row.agent_name} $${Number(row.total_usd ?? 0).toFixed(4)}`)
                    .join(' · ')}
                </p>
              ) : null}
            </>
          ) : errorMessage ? (
            <p className="dash-meta">Cost summary unavailable (see message below).</p>
          ) : (
            <p className="dash-meta">Loading cost summary…</p>
          )}
        </div>

        {errorMessage ? (
          <p className="dash-error" role="alert">
            {errorMessage}
          </p>
        ) : null}

        <div className="dash-section-title" style={{ marginTop: 24 }}>
          Registered agents
        </div>
        <ul className="dash-feed-list">
          {agents.map((a) => {
            const openPrompt = promptOpenAgent === a.name
            return (
              <li key={a.name} className="dash-feed-item">
                <div>
                  <span className="dash-feed-agent">{a.name}</span>
                  <span className="dash-feed-text">
                    {a.enabled === false ? 'Disabled' : 'Enabled'} · cron <code>{a.schedule_cron}</code>
                    {a.last_run_at ? (
                      <>
                        {' '}
                        · last run {new Date(a.last_run_at).toLocaleString()}
                      </>
                    ) : null}
                  </span>
                  <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    <button
                      type="button"
                      className="ghost-btn"
                      disabled={a.enabled === false}
                      aria-label={`Simulate ${a.name} agent`}
                      onClick={() => handleOpenSimulate(a.name)}
                    >
                      Simulate
                    </button>
                    <button
                      type="button"
                      className="ghost-btn"
                      aria-expanded={openPrompt}
                      aria-controls={`prompt-panel-${a.name}`}
                      onClick={() => handleTogglePrompt(a.name)}
                    >
                      {openPrompt ? 'Hide prompt' : 'Prompt'}
                    </button>
                  </div>
                  {openPrompt ? (
                    <div
                      id={`prompt-panel-${a.name}`}
                      style={{ marginTop: 12, maxWidth: 'min(100%, 720px)' }}
                    >
                      <p className="dash-meta" style={{ color: '#b45309' }}>
                        Test prompt changes with Simulate before saving.
                      </p>
                      {promptBusy === a.name && !promptTextByAgent[a.name] ? (
                        <p className="dash-meta">Loading prompt…</p>
                      ) : (
                        <textarea
                          className="dash-reasoning-block"
                          style={{ width: '100%', minHeight: 180, resize: 'vertical' }}
                          value={promptTextByAgent[a.name] ?? ''}
                          onChange={(e) => handlePromptChange(a.name, e.target.value)}
                          aria-label={`Prompt text for ${a.name}`}
                        />
                      )}
                      <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className="primary-btn"
                          disabled={promptBusy === a.name}
                          onClick={() => handleSavePrompt(a.name)}
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          className="ghost-btn"
                          disabled={promptBusy === a.name}
                          onClick={() => handleRestorePrompt(a.name)}
                        >
                          Restore backup
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>

        <div className="dash-section-title" style={{ marginTop: 28 }}>
          Pending approval
        </div>
        {pendingActions.length === 0 ? (
          <p className="dash-meta">No proposals awaiting approval.</p>
        ) : (
          <ul className="dash-feed-list">
            {pendingActions.map((row) => (
              <li key={row.id} className="dash-feed-item">
                <div>
                  <span className="dash-feed-agent">{row.agent_name}</span>
                  <span className="dash-feed-text">
                    {row.action_type}
                    {row.rationale ? ` — ${String(row.rationale).slice(0, 160)}` : ''}
                  </span>
                  <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      className="primary-btn"
                      disabled={busyId === row.id}
                      aria-label={`Approve ${row.action_type}`}
                      onClick={() => handleApprove(row.id)}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="ghost-btn"
                      disabled={busyId === row.id}
                      aria-label={`Reject ${row.action_type}`}
                      onClick={() => handleReject(row.id)}
                    >
                      Reject
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="dash-section-title" style={{ marginTop: 28 }}>
          Applied actions (revert)
        </div>
        {revertableActions.length === 0 ? (
          <p className="dash-meta">No revertable actions loaded.</p>
        ) : (
          <ul className="dash-feed-list">
            {revertableActions.map((row) => (
              <li key={row.id} className="dash-feed-item">
                <div>
                  <span className="dash-feed-agent">{row.agent_name}</span>
                  <span className="dash-feed-text">{row.action_type}</span>
                  <div style={{ marginTop: 8 }}>
                    <button
                      type="button"
                      className="ghost-btn"
                      disabled={busyId === row.id || row.action_type === 'request_new_items'}
                      aria-label={`Revert ${row.action_type}`}
                      onClick={() => handleRevert(row.id)}
                    >
                      Revert
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="dash-section-title" style={{ marginTop: 28 }}>
          Recent runs
        </div>
        <ul className="dash-feed-list">
          {runs.map((run) => {
            const open = expanded.has(run.id)
            return (
              <li key={run.id} className="dash-feed-item">
                <div className="dash-feed-row">
                  <button
                    type="button"
                    className="dash-expand-btn"
                    aria-expanded={open}
                    aria-controls={`reason-${run.id}`}
                    aria-label={open ? 'Collapse agent reasoning' : 'Expand agent reasoning'}
                    onClick={() => handleToggleExpand(run.id)}
                  >
                    {open ? '▼' : '▶'}
                  </button>
                  <div style={{ flex: 1 }}>
                    <span className="dash-feed-agent">{run.agent_name}</span>
                    <span className="dash-feed-text">
                      {run.status}
                      {run.dry_run ? ' · simulation' : ''}
                      {run.cost_usd != null ? ` · $${Number(run.cost_usd).toFixed(4)}` : ''} ·{' '}
                      {run.started_at ? new Date(run.started_at).toLocaleString() : '—'}
                    </span>
                  </div>
                </div>
                {open ? (
                  <pre id={`reason-${run.id}`} className="dash-reasoning-block">
                    {typeof run.reasoning === 'string' && run.reasoning.trim().length > 0
                      ? run.reasoning
                      : '—'}
                  </pre>
                ) : null}
              </li>
            )
          })}
        </ul>

        <div className="dash-section-title" style={{ marginTop: 28 }}>
          Agent notes
        </div>
        {notes.length === 0 ? (
          <p className="dash-meta">No agent notes yet.</p>
        ) : (
          <ul className="dash-feed-list">
            {notes.map((n) => (
              <li key={n.id} className="dash-feed-item">
                <div>
                  <span className="dash-feed-agent">{n.from_agent_name ?? '—'}</span>
                  <span className="dash-feed-text">
                    {' → '}
                    {n.to_agent_id == null ? 'All' : n.to_agent_name ?? `agent #${n.to_agent_id}`}
                    {' · '}
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '2px 6px',
                        borderRadius: 4,
                        fontSize: 12,
                        background: 'rgba(0,0,0,0.08)',
                      }}
                    >
                      {n.note_type}
                    </span>
                    {n.read_at ? ' · read' : ' · unread'}
                    {' · '}
                    {n.created_at ? new Date(n.created_at).toLocaleString() : '—'}
                  </span>
                  <pre className="dash-reasoning-block" style={{ marginTop: 8, fontSize: 13 }}>
                    {JSON.stringify(n.content, null, 2)}
                  </pre>
                </div>
              </li>
            ))}
          </ul>
        )}

        {simulateAgent ? (
          <div
            className="dash-modal-backdrop"
            role="presentation"
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.45)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 50,
              padding: 16,
            }}
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                handleCloseSimulate()
              }
            }}
          >
            <div
              ref={simulateDialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="simulate-title"
              className="dash-frame"
              style={{ maxWidth: 420, width: '100%', background: 'var(--surface, #fff)', padding: 20 }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 id="simulate-title" className="dash-section-title">
                Simulate: {simulateAgent}
              </h3>
              <p className="dash-meta">UTC calendar range, max 90 days.</p>
              <label className="dash-meta" style={{ display: 'block', marginTop: 12 }}>
                From
                <input
                  type="date"
                  value={simulateDateFrom}
                  onChange={(e) => setSimulateDateFrom(e.target.value)}
                  style={{ display: 'block', marginTop: 4, width: '100%' }}
                />
              </label>
              <label className="dash-meta" style={{ display: 'block', marginTop: 12 }}>
                To
                <input
                  type="date"
                  value={simulateDateTo}
                  onChange={(e) => setSimulateDateTo(e.target.value)}
                  style={{ display: 'block', marginTop: 4, width: '100%' }}
                />
              </label>
              <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" className="ghost-btn" disabled={simulateLoading} onClick={handleCloseSimulate}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="primary-btn"
                  disabled={simulateLoading}
                  onClick={handleSubmitSimulate}
                >
                  {simulateLoading ? 'Running…' : 'Run simulation'}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {simulateResult ? (
          <div
            role="presentation"
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.45)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 60,
              padding: 16,
            }}
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                handleCloseResult()
              }
            }}
          >
            <div
              ref={resultDialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="sim-result-title"
              className="dash-frame"
              style={{
                maxWidth: 900,
                width: '100%',
                maxHeight: '90vh',
                overflow: 'auto',
                background: 'var(--surface, #fff)',
                padding: 20,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 id="sim-result-title" className="dash-section-title">
                Simulation results
              </h3>
              {simulateResult.skipped ? (
                <p className="dash-meta">Skipped: {simulateResult.reason}</p>
              ) : (
                <>
                  <p className="dash-meta">
                    Status: {simulateResult.run?.status ?? '—'} ·{' '}
                    {simulateResult.run?.started_at ? new Date(simulateResult.run.started_at).toLocaleString() : ''}
                  </p>
                  <div className="dash-section-title" style={{ marginTop: 16 }}>
                    Reasoning
                  </div>
                  <pre className="dash-reasoning-block">
                    {typeof simulateResult.run?.reasoning === 'string' && simulateResult.run.reasoning.trim()
                      ? simulateResult.run.reasoning
                      : '—'}
                  </pre>
                  <div className="dash-section-title" style={{ marginTop: 16 }}>
                    Would have done
                  </div>
                  {(simulateResult.simulated_actions ?? []).length === 0 ? (
                    <p className="dash-meta">No write tools were called.</p>
                  ) : (
                    <ul className="dash-feed-list">
                      {(simulateResult.simulated_actions ?? []).map((item, idx) => (
                        <li key={idx} className="dash-feed-item">
                          <span className="dash-feed-agent">{item.tool}</span>
                          <pre className="dash-reasoning-block" style={{ marginTop: 6, fontSize: 12 }}>
                            {JSON.stringify({ input: item.input, result: item.result }, null, 2)}
                          </pre>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="dash-section-title" style={{ marginTop: 20 }}>
                    What actually happened (same period)
                  </div>
                  {(simulateResult.actual_actions ?? []).length === 0 ? (
                    <p className="dash-meta">No recorded actions in this window.</p>
                  ) : (
                    <ul className="dash-feed-list">
                      {(simulateResult.actual_actions ?? []).map((act) => (
                        <li key={act.id} className="dash-feed-item">
                          <span className="dash-feed-agent">{act.agent_name}</span>
                          <span className="dash-feed-text">
                            {act.action_type}
                            {act.rationale ? ` — ${String(act.rationale).slice(0, 200)}` : ''}
                            {' · '}
                            {act.created_at ? new Date(act.created_at).toLocaleString() : ''}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
              <div style={{ marginTop: 20 }}>
                <button type="button" className="primary-btn" onClick={handleCloseResult}>
                  Close
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  )
}

export default AgentActivityPage
