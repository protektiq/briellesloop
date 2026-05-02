import { useCallback, useEffect, useMemo, useState } from 'react'

const API_BASE_URL = 'http://localhost:3001'

const AgentActivityPage = () => {
  const [agents, setAgents] = useState([])
  const [actions, setActions] = useState([])
  const [runs, setRuns] = useState([])
  const [costSummary, setCostSummary] = useState(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [busyId, setBusyId] = useState('')
  const [expanded, setExpanded] = useState(() => new Set())

  const loadAll = useCallback(async () => {
    try {
      setErrorMessage('')
      const [costRes, agentRes, actionRes, runRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/agents/cost-summary`),
        fetch(`${API_BASE_URL}/api/agents`),
        fetch(`${API_BASE_URL}/api/agents/actions?limit=120`),
        fetch(`${API_BASE_URL}/api/agents/runs?limit=60`),
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
      const costPayload = await costRes.json()
      const agentPayload = await agentRes.json()
      const actionPayload = await actionRes.json()
      const runPayload = await runRes.json()
      setCostSummary(typeof costPayload === 'object' && costPayload !== null ? costPayload : null)
      setAgents(Array.isArray(agentPayload.agents) ? agentPayload.agents : [])
      setActions(Array.isArray(actionPayload.actions) ? actionPayload.actions : [])
      setRuns(Array.isArray(runPayload.runs) ? runPayload.runs : [])
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not load agents.'
      setErrorMessage(msg)
      setCostSummary(null)
    }
  }, [])

  useEffect(() => {
    loadAll()
  }, [loadAll])

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
          {agents.map((a) => (
            <li key={a.name} className="dash-feed-item">
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
            </li>
          ))}
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
      </div>
    </section>
  )
}

export default AgentActivityPage
