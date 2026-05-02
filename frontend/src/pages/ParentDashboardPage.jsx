import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import DashboardWeekCore, { ISO_DATE, shiftWeekStart } from '../components/DashboardWeekCore'
import { API_BASE_URL } from '../constants/api'

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

  return (
    <DashboardWeekCore
      payload={payload}
      weekStart={weekStart}
      firstName="Brielle"
      errorMessage={errorMessage}
      isLoading={isLoading}
      onPrevWeek={handlePrevWeek}
      onNextWeek={handleNextWeek}
      slotAfterStats={
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
      }
      slotAfterInsight={
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
      }
    />
  )
}

export default ParentDashboardPage
