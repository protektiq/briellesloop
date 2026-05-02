import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import DashboardWeekCore, { ISO_DATE, shiftWeekStart } from '../components/DashboardWeekCore'
import { API_BASE_URL } from '../constants/api'

const TOKEN_HEX = /^[a-f0-9]{64}$/i

const TeacherDashboardPage = () => {
  const { token: tokenParam } = useParams()
  const token = typeof tokenParam === 'string' ? tokenParam.trim() : ''

  const [gate, setGate] = useState('checking')
  const [firstName, setFirstName] = useState('')
  const [weekStart, setWeekStart] = useState('')
  const [payload, setPayload] = useState(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [isLoadingWeek, setIsLoadingWeek] = useState(false)

  const tokenOk = useMemo(() => TOKEN_HEX.test(token), [token])

  useEffect(() => {
    if (!tokenOk) {
      setGate('invalid')
      return
    }

    let cancelled = false

    const run = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/share/validate/${encodeURIComponent(token)}`)
        const data = await response.json().catch(() => ({}))
        if (cancelled) {
          return
        }
        if (data.valid === true && typeof data.student_name === 'string') {
          setFirstName(data.student_name)
          setGate('ready')
          return
        }
        setGate('invalid')
      } catch {
        if (!cancelled) {
          setGate('invalid')
        }
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [token, tokenOk])

  const loadWeek = useCallback(
    async (ws) => {
      if (!tokenOk) {
        return
      }
      try {
        setIsLoadingWeek(true)
        setErrorMessage('')
        const qs = new URLSearchParams()
        if (typeof ws === 'string' && ISO_DATE.test(ws)) {
          qs.set('week_start', ws)
        }
        const response = await fetch(
          `${API_BASE_URL}/api/share/week/${encodeURIComponent(token)}?${qs.toString()}`,
        )
        if (response.status === 401) {
          setGate('invalid')
          return
        }
        const body = await response.json().catch(() => ({}))
        if (!response.ok) {
          throw new Error(body.message ?? `Load failed (${response.status})`)
        }
        setPayload(body)
        if (typeof body.week_start === 'string') {
          setWeekStart(body.week_start)
        }
      } catch (err) {
        let msg = err instanceof Error ? err.message : 'Could not load dashboard.'
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          msg = 'You appear to be offline. Connect to the internet, then reload this page.'
        }
        setErrorMessage(msg)
        setPayload(null)
      } finally {
        setIsLoadingWeek(false)
      }
    },
    [token, tokenOk],
  )

  useEffect(() => {
    if (gate !== 'ready') {
      return
    }
    void loadWeek('')
  }, [gate, loadWeek])

  const handlePrevWeek = useCallback(() => {
    const next = shiftWeekStart(weekStart, -7)
    if (next) {
      void loadWeek(next)
    }
  }, [weekStart, loadWeek])

  const handleNextWeek = useCallback(() => {
    const next = shiftWeekStart(weekStart, 7)
    if (next) {
      void loadWeek(next)
    }
  }, [weekStart, loadWeek])

  if (!tokenOk || gate === 'invalid') {
    return (
      <div className="page-shell share-gate">
        <h1 className="share-gate-title">Link not available</h1>
        <p className="share-gate-body" role="alert">
          This link has expired or is not valid. Ask the parent for a new share link if you still need
          access.
        </p>
      </div>
    )
  }

  if (gate === 'checking') {
    return (
      <div className="page-shell share-gate" aria-busy="true">
        <p className="dash-loading">Checking link…</p>
      </div>
    )
  }

  return (
    <div className="share-teacher-shell">
      <DashboardWeekCore
        payload={payload}
        weekStart={weekStart}
        firstName={firstName}
        errorMessage={errorMessage}
        isLoading={isLoadingWeek}
        onPrevWeek={handlePrevWeek}
        onNextWeek={handleNextWeek}
        fluencySeries={Array.isArray(payload?.fluency_series) ? payload.fluency_series : []}
      />
    </div>
  )
}

export default TeacherDashboardPage
