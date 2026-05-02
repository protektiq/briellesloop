import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

const API_BASE_URL = 'http://localhost:3001'

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

const shiftWeekStart = (weekStartStr, deltaDays) => {
  if (typeof weekStartStr !== 'string' || !ISO_DATE.test(weekStartStr)) {
    return null
  }
  const [y, m, d] = weekStartStr.split('-').map((x) => Number.parseInt(x, 10))
  const next = new Date(Date.UTC(y, m - 1, d + deltaDays))
  return next.toISOString().slice(0, 10)
}

const formatPercent = (ratio) => {
  if (ratio === null || ratio === undefined || Number.isNaN(ratio)) {
    return '—'
  }
  return `${Math.round(ratio * 100)}%`
}

const formatDeltaNumber = (value, decimals = 1) => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '—'
  }
  const rounded = decimals === 0 ? Math.round(value) : Number(value.toFixed(decimals))
  const sign = rounded > 0 ? '+' : ''
  return `${sign}${rounded}`
}

const DeltaBadge = ({ delta, kind }) => {
  if (delta === null || delta === undefined || Number.isNaN(delta)) {
    return <span className="dash-delta muted">—</span>
  }

  let positiveGood = true
  if (kind === 'brain_breaks') {
    positiveGood = false
  }

  const isPositive = delta > 0
  const good = positiveGood ? isPositive : !isPositive
  const arrow = isPositive ? '▲' : '▼'
  const cls = good ? 'dash-delta good' : 'dash-delta warn'

  let text = ''
  if (kind === 'accuracy') {
    text = `${arrow} ${formatDeltaNumber(delta * 100, 0)} pts`
  } else if (kind === 'mood') {
    text = `${arrow} ${formatDeltaNumber(delta, 1)}`
  } else {
    text = `${arrow} ${formatDeltaNumber(delta, 0)}`
  }

  return <span className={cls}>{text}</span>
}

const ParentDashboardPage = () => {
  const [weekStart, setWeekStart] = useState('')
  const [payload, setPayload] = useState(null)
  const [studentId, setStudentId] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [exportBusy, setExportBusy] = useState(false)

  const loadWeek = useCallback(async (ws) => {
    try {
      setIsLoading(true)
      setErrorMessage('')
      const qs = new URLSearchParams()
      if (typeof ws === 'string' && ISO_DATE.test(ws)) {
        qs.set('week_start', ws)
      }
      const response = await fetch(`${API_BASE_URL}/api/dashboard/week?${qs.toString()}`)
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.message ?? `Load failed (${response.status})`)
      }
      const data = await response.json()
      setPayload(data)
      if (typeof data.week_start === 'string') {
        setWeekStart(data.week_start)
      }
      if (typeof data.student_id === 'string') {
        setStudentId(data.student_id)
      }
    } catch (err) {
      let msg = err instanceof Error ? err.message : 'Could not load dashboard.'
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        msg =
          'You appear to be offline. Connect to the internet, then reload the parent dashboard.'
      }
      setErrorMessage(msg)
      setPayload(null)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadWeek('')
  }, [loadWeek])

  const handlePrevWeek = useCallback(() => {
    const next = shiftWeekStart(weekStart, -7)
    if (next) {
      loadWeek(next)
    }
  }, [weekStart, loadWeek])

  const handleNextWeek = useCallback(() => {
    const next = shiftWeekStart(weekStart, 7)
    if (next) {
      loadWeek(next)
    }
  }, [weekStart, loadWeek])

  const moodChartData = useMemo(() => {
    if (!payload?.mood_series || !Array.isArray(payload.mood_series)) {
      return []
    }
    return payload.mood_series.map((row) => ({
      label: row.label,
      Before: row.pre_mood ?? null,
      After: row.post_mood ?? null,
      rough: row.rough_day === true,
    }))
  }, [payload])

  const weeklyStats = payload?.weekly_stats
  const cur = weeklyStats?.current
  const deltas = weeklyStats?.deltas

  const insightBlock = useMemo(() => {
    const insight = payload?.weekly_insight
    if (insight?.insight_text || insight?.suggested_adjustment) {
      return (
        <div className="insight-box">
          <div className="insight-label">
            Pattern this week <span className="ai-tag">AI</span>
          </div>
          <p className="insight-body">
            {insight.insight_text ? (
              <strong>{insight.insight_text}</strong>
            ) : null}{' '}
            {insight.suggested_adjustment ? (
              <>
                <strong>Suggested:</strong> {insight.suggested_adjustment}
              </>
            ) : null}
          </p>
        </div>
      )
    }

    return (
      <div className="insight-box muted-insight">
        <div className="insight-label">Weekly insight</div>
        <p className="insight-body">No insight yet — agents not running</p>
      </div>
    )
  }, [payload])

  const handleExportPdf = useCallback(async () => {
    if (!weekStart || !ISO_DATE.test(weekStart)) {
      return
    }
    try {
      setExportBusy(true)
      const qs = new URLSearchParams({ week_start: weekStart })
      if (studentId) {
        qs.set('student_id', studentId)
      }
      const response = await fetch(`${API_BASE_URL}/api/export/iep-pdf?${qs.toString()}`)
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.message ?? `Export failed (${response.status})`)
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `iep-review-${weekStart}.pdf`
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'PDF export failed.')
    } finally {
      setExportBusy(false)
    }
  }, [weekStart, studentId])

  if (isLoading && !payload) {
    return (
      <section className="dash-section" aria-busy="true">
        <p className="dash-loading">Loading Brielle&apos;s week…</p>
      </section>
    )
  }

  return (
    <section className="dash-section">
      <div className="dash-frame">
        <div className="dash-header">
          <div>
            <h2 className="dash-title">
              Brielle&apos;s <em>week</em>
            </h2>
            <p className="dash-meta">
              {payload?.week_start && payload?.week_end
                ? `${payload.week_start} – ${payload.week_end} · UTC week`
                : '—'}
            </p>
            <div className="dash-week-nav">
              <button type="button" className="ghost-btn" onClick={handlePrevWeek}>
                ← Previous week
              </button>
              <button type="button" className="ghost-btn" onClick={handleNextWeek}>
                Next week →
              </button>
            </div>
          </div>
          <span className="dash-status" aria-label="Status">
            ● On track
          </span>
        </div>

        {errorMessage ? (
          <p className="dash-error" role="alert">
            {errorMessage}
          </p>
        ) : null}

        <div className="dash-stats">
          <div className="dash-stat accent">
            <DeltaBadge delta={deltas?.avg_accuracy ?? null} kind="accuracy" />
            <div className="num">{formatPercent(cur?.avg_accuracy)}</div>
            <div className="label">Avg Accuracy</div>
          </div>
          <div className="dash-stat">
            <DeltaBadge delta={deltas?.days_practiced ?? null} kind="days" />
            <div className="num">
              {cur?.days_practiced ?? 0}/7
            </div>
            <div className="label">Days Practiced</div>
          </div>
          <div className="dash-stat">
            <DeltaBadge delta={deltas?.brain_breaks ?? null} kind="brain_breaks" />
            <div className="num">{cur?.brain_breaks ?? 0}</div>
            <div className="label">Brain Breaks</div>
          </div>
          <div className="dash-stat">
            <DeltaBadge delta={deltas?.avg_mood ?? null} kind="mood" />
            <div className="num">
              {cur?.avg_mood === null || cur?.avg_mood === undefined
                ? '—'
                : cur.avg_mood.toFixed(1)}
            </div>
            <div className="label">Avg Mood</div>
          </div>
        </div>

        <div className="dash-toolbar">
          <button
            type="button"
            className="primary-btn"
            onClick={handleExportPdf}
            disabled={exportBusy || !weekStart}
          >
            {exportBusy ? 'Preparing PDF…' : 'Export for IEP Review'}
          </button>
          <span className="dash-toolbar-hint">12-week PDF · A4 · prints cleanly</span>
        </div>

        <div className="dash-grid">
          <div>
            <div className="dash-section-title">Skills · Weekly Accuracy</div>
            {(payload?.skill_accuracy ?? []).map((row) => {
              const pct =
                row.accuracy === null || row.accuracy === undefined
                  ? 0
                  : Math.min(100, Math.max(0, row.accuracy * 100))
              const target = Math.min(100, Math.max(0, row.iep_target_pct ?? 80))
              return (
                <div className="skill-row" key={row.skill_name}>
                  <span className="name">{row.skill_name}</span>
                  <div className="skill-bar-wrap">
                    <div className="skill-bar-track">
                      <div className="skill-bar-fill" style={{ width: `${pct}%` }} />
                      <div
                        className="skill-bar-target"
                        style={{ left: `${target}%` }}
                        title={`IEP target ${target}%`}
                      />
                    </div>
                  </div>
                  <span className="pct">{row.accuracy === null ? '—' : `${Math.round(pct)}%`}</span>
                </div>
              )
            })}
          </div>

          <div>
            <div className="dash-section-title">Mood · Before vs. After Session</div>
            <div className="mood-chart-host">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={moodChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(42,33,24,0.12)" />
                  <XAxis dataKey="label" tick={{ fill: 'var(--ink-soft)', fontSize: 12 }} />
                  <YAxis
                    domain={[0, 10]}
                    tick={{ fill: 'var(--ink-soft)', fontSize: 12 }}
                    label={{
                      value: 'Mood (0–10)',
                      angle: -90,
                      position: 'insideLeft',
                      fill: 'var(--ink-faint)',
                      fontSize: 11,
                    }}
                  />
                  <Tooltip
                    formatter={(value, name) => {
                      if (value === null || value === undefined) {
                        return ['No session', name]
                      }
                      return [Number(value).toFixed(1), name]
                    }}
                  />
                  <Legend />
                  <Bar dataKey="Before" fill="var(--bg-deeper)" stroke="var(--ink)" strokeWidth={1} />
                  <Bar dataKey="After" fill="var(--green)" stroke="var(--ink)" strokeWidth={1} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mood-legend">
              <span className="mood-legend-key">
                <span className="swatch before" /> Before
              </span>
              <span className="mood-legend-key">
                <span className="swatch after" /> After
              </span>
              <span className="mood-legend-key">
                <span className="swatch rough" /> Rough day (low before mood)
              </span>
            </div>
          </div>
        </div>

        {insightBlock}

        <div className="dash-agent-feed">
          <div className="dash-section-title">Agent activity</div>
          <p className="dash-feed-note">
            Recent runs for this week (UTC).{' '}
            <Link className="dash-feed-link" to="/parent/agents">
              Open full log &amp; approvals
            </Link>
          </p>
          <ul className="dash-feed-list">
            {(payload?.agent_activity ?? []).length === 0 ? (
              <li className="dash-feed-item muted">
                <span className="dash-feed-text">No agent runs recorded this week yet.</span>
              </li>
            ) : null}
            {(payload?.agent_activity ?? []).map((item) => (
              <li key={item.id} className="dash-feed-item">
                <span className="dash-feed-agent">{item.agent_name}</span>
                <span className="dash-feed-text">{item.summary}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}

export default ParentDashboardPage
