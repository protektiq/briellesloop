import { useCallback, useEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'

const API_BASE_URL = 'http://localhost:3001'
const STORAGE_KEY = 'briellesloop_parent_unlocked_v1'

const PIN_REGEX = /^\d{4}$/

const ParentGateLayout = () => {
  const [phase, setPhase] = useState('loading')
  const [configured, setConfigured] = useState(false)
  const [pin, setPin] = useState('')
  const [pinError, setPinError] = useState('')
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        setLoadError('')
        const response = await fetch(`${API_BASE_URL}/api/settings/parent-pin`)
        if (!response.ok) {
          throw new Error(`Request failed: ${response.status}`)
        }
        const payload = await response.json()
        if (cancelled) {
          return
        }
        const isConfigured = payload.configured === true
        setConfigured(isConfigured)
        const unlocked = sessionStorage.getItem(STORAGE_KEY) === '1'
        if (!isConfigured || unlocked) {
          setPhase('ready')
        } else {
          setPhase('gate')
        }
      } catch {
        if (!cancelled) {
          setLoadError(
            'Could not reach the server to check PIN status — parent routes stay open; save a PIN when the API is available.',
          )
          setConfigured(false)
          setPhase('ready')
        }
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  const handlePinChange = useCallback((event) => {
    const raw = event?.target?.value ?? ''
    const digits = raw.replace(/\D/g, '').slice(0, 4)
    setPin(digits)
    setPinError('')
  }, [])

  const handleUnlock = useCallback(async () => {
    if (!PIN_REGEX.test(pin)) {
      setPinError('Enter exactly 4 digits.')
      return
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/parent/verify-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      })

      if (response.ok) {
        sessionStorage.setItem(STORAGE_KEY, '1')
        setPhase('ready')
        setPin('')
        setPinError('')
        return
      }

      if (response.status === 401) {
        setPinError('Incorrect PIN.')
        return
      }

      const body = await response.json().catch(() => ({}))
      setPinError(body.message ?? 'Could not verify PIN.')
    } catch {
      setPinError('Network error — try again.')
    }
  }, [pin])

  const handleKeyDown = useCallback(
    (event) => {
      if (event.key === 'Enter') {
        handleUnlock()
      }
    },
    [handleUnlock],
  )

  if (phase === 'loading') {
    return (
      <div className="parent-gate-wrap">
        <p className="parent-gate-loading" role="status">
          Loading parent view…
        </p>
      </div>
    )
  }

  if (phase === 'gate') {
    return (
      <div className="parent-gate-wrap">
        <div className="parent-gate-card">
          <h1 className="parent-gate-title">Parent view locked</h1>
          <p className="parent-gate-lead">
            Enter the 4-digit PIN you set in Settings. This is a simple child-lock layer on this
            device — not bank-grade security. Anyone with access to this browser profile can clear
            session storage or change the PIN in Settings.
          </p>
          {loadError ? <p className="parent-gate-error">{loadError}</p> : null}
          <label className="parent-gate-label" htmlFor="parent-pin-input">
            PIN
          </label>
          <input
            id="parent-pin-input"
            className="parent-gate-input"
            type="password"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={4}
            value={pin}
            onChange={handlePinChange}
            onKeyDown={handleKeyDown}
            aria-invalid={pinError ? 'true' : 'false'}
            aria-describedby={pinError ? 'parent-pin-error' : undefined}
          />
          {pinError ? (
            <p id="parent-pin-error" className="parent-gate-error" role="alert">
              {pinError}
            </p>
          ) : null}
          <button type="button" className="primary-btn parent-gate-btn" onClick={handleUnlock}>
            Unlock parent view
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="parent-routed-wrap">
      {loadError ? (
        <div className="parent-soft-banner parent-soft-banner-warn" role="alert">
          {loadError}
        </div>
      ) : null}
      {!configured && !loadError ? (
        <div className="parent-soft-banner" role="status">
          Set a PIN in <strong>Settings</strong> to lock Parent view on shared devices.
        </div>
      ) : null}
      <Outlet />
    </div>
  )
}

export default ParentGateLayout
