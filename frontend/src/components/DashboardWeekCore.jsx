import { useMemo } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

export const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

export const shiftWeekStart = (weekStartStr, deltaDays) => {
  if (typeof weekStartStr !== 'string' || !ISO_DATE.test(weekStartStr)) {
    return null
  }
  const [y, m, d] = weekStartStr.split('-').map((x) => Number.parseInt(x, 10))
  const next = new Date(Date.UTC(y, m - 1, d + deltaDays))
  return next.toISOString().slice(0, 10)
}

export const formatPercent = (ratio) => {
  if (ratio === null || ratio === undefined || Number.isNaN(ratio)) {
    return '—'
  }
  return `${Math.round(ratio * 100)}%`
}

export const formatDeltaNumber = (value, decimals = 1) => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '—'
  }
  const rounded = decimals === 0 ? Math.round(value) : Number(value.toFixed(decimals))
  const sign = rounded > 0 ? '+' : ''
  return `${sign}${rounded}`
}

export const DeltaBadge = ({ delta, kind }) => {
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

const useMoodChartData = (payload) =>
  useMemo(() => {
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

const useOrderedSkillAccuracy = (payload) =>
  useMemo(() => {
    const canonicalOrder = ['math', 'reading', 'spelling', 'typing', 'writing']
    const sourceRows = Array.isArray(payload?.skill_accuracy) ? payload.skill_accuracy : []
    const byName = new Map()
    for (const row of sourceRows) {
      if (!row || typeof row !== 'object' || typeof row.skill_name !== 'string') {
        continue
      }
      byName.set(row.skill_name.toLowerCase(), row)
    }
    return canonicalOrder.map((skillName) => {
      const row = byName.get(skillName)
      if (row) {
        return row
      }
      return { skill_name: skillName, accuracy: null, iep_target_pct: 80 }
    })
  }, [payload])

const useInsightBlock = (payload) =>
  useMemo(() => {
    const insight = payload?.weekly_insight
    if (insight?.insight_text || insight?.suggested_adjustment) {
      return (
        <div className="insight-box">
          <div className="insight-label">
            Pattern this week <span className="ai-tag">AI</span>
          </div>
          <p className="insight-body">
            {insight.insight_text ? <strong>{insight.insight_text}</strong> : null}{' '}
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

/**
 * @param {object} props
 * @param {object | null} props.payload
 * @param {string} props.weekStart
 * @param {string} props.firstName — display first name for title (possessive week heading)
 * @param {string} [props.errorMessage]
 * @param {boolean} props.isLoading
 * @param {() => void} props.onPrevWeek
 * @param {() => void} props.onNextWeek
 * @param {{ label: string, words_per_minute: number | null, accuracy_pct: number | null }[]} [props.fluencySeries]
 * @param {import('react').ReactNode} [props.slotAfterStats]
 * @param {import('react').ReactNode} [props.slotAfterInsight]
 */
const DashboardWeekCore = ({
  payload,
  weekStart,
  firstName,
  errorMessage,
  isLoading,
  onPrevWeek,
  onNextWeek,
  fluencySeries,
  slotAfterStats,
  slotAfterInsight,
}) => {
  const moodChartData = useMoodChartData(payload)
  const orderedSkillAccuracy = useOrderedSkillAccuracy(payload)
  const insightBlock = useInsightBlock(payload)

  const weeklyStats = payload?.weekly_stats
  const cur = weeklyStats?.current
  const deltas = weeklyStats?.deltas

  const safeFirst =
    typeof firstName === 'string' && firstName.trim().length > 0 ? firstName.trim() : 'Student'
  const possessive = safeFirst.endsWith('s') ? `${safeFirst}'` : `${safeFirst}'s`

  const fluencyData = useMemo(() => {
    if (!Array.isArray(fluencySeries) || fluencySeries.length < 2) {
      return []
    }
    return fluencySeries.map((row) => ({
      label: typeof row?.label === 'string' ? row.label : '—',
      wpm:
        row?.words_per_minute !== null &&
        row?.words_per_minute !== undefined &&
        Number.isFinite(Number(row.words_per_minute))
          ? Number(row.words_per_minute)
          : null,
      acc:
        row?.accuracy_pct !== null &&
        row?.accuracy_pct !== undefined &&
        Number.isFinite(Number(row.accuracy_pct))
          ? Number(row.accuracy_pct)
          : null,
    }))
  }, [fluencySeries])

  if (isLoading && !payload) {
    return (
      <section className="dash-section" aria-busy="true">
        <p className="dash-loading">Loading {possessive} week…</p>
      </section>
    )
  }

  return (
    <section className="dash-section">
      <div className="dash-frame">
        <div className="dash-header">
          <div>
            <h2 className="dash-title">
              {possessive} <em>week</em>
            </h2>
            <p className="dash-meta">
              {payload?.week_start && payload?.week_end
                ? `${payload.week_start} – ${payload.week_end} · UTC week`
                : '—'}
            </p>
            <div className="dash-week-nav">
              <button type="button" className="ghost-btn" onClick={onPrevWeek}>
                ← Previous week
              </button>
              <button type="button" className="ghost-btn" onClick={onNextWeek}>
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
            <div className="num">{cur?.days_practiced ?? 0}/7</div>
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
              {cur?.avg_mood === null || cur?.avg_mood === undefined ? '—' : cur.avg_mood.toFixed(1)}
            </div>
            <div className="label">Avg Mood</div>
          </div>
        </div>

        {slotAfterStats ?? null}

        <div className="dash-grid">
          <div>
            <div className="dash-section-title">Skills · Weekly Accuracy</div>
            {orderedSkillAccuracy.map((row) => {
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

        {fluencyData.length >= 2 ? (
          <div className="dash-fluency-block">
            <div className="dash-section-title">Reading fluency (read-aloud)</div>
            <div className="mood-chart-host">
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={fluencyData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(42,33,24,0.12)" />
                  <XAxis dataKey="label" tick={{ fill: 'var(--ink-soft)', fontSize: 12 }} />
                  <YAxis
                    yAxisId="wpm"
                    domain={[0, 'auto']}
                    tick={{ fill: 'var(--ink-soft)', fontSize: 12 }}
                    label={{
                      value: 'WPM',
                      angle: -90,
                      position: 'insideLeft',
                      fill: 'var(--ink-faint)',
                      fontSize: 11,
                    }}
                  />
                  <YAxis
                    yAxisId="acc"
                    orientation="right"
                    domain={[0, 100]}
                    tick={{ fill: 'var(--ink-soft)', fontSize: 12 }}
                    label={{
                      value: 'Accuracy %',
                      angle: 90,
                      position: 'insideRight',
                      fill: 'var(--ink-faint)',
                      fontSize: 11,
                    }}
                  />
                  <Tooltip
                    formatter={(value, name) => {
                      if (value === null || value === undefined) {
                        return ['—', name]
                      }
                      const n = Number(value)
                      const label = name === 'acc' ? 'Accuracy %' : 'WPM'
                      return [`${Number.isFinite(n) ? n.toFixed(0) : '—'}`, label]
                    }}
                  />
                  <Legend />
                  <Line
                    yAxisId="wpm"
                    type="monotone"
                    dataKey="wpm"
                    name="WPM"
                    stroke="var(--ink)"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                  <Line
                    yAxisId="acc"
                    type="monotone"
                    dataKey="acc"
                    name="Accuracy %"
                    stroke="var(--green)"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        ) : null}

        {insightBlock}

        {slotAfterInsight ?? null}
      </div>
    </section>
  )
}

export default DashboardWeekCore
