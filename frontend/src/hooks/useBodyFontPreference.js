import { useCallback, useEffect, useState } from 'react'
import { API_BASE_URL, FONT_STEP_STORAGE_KEY, FONT_STEPS } from '../constants/api'

export const getStoredFontStep = () => {
  if (typeof window === 'undefined') {
    return '0'
  }
  try {
    const raw = window.localStorage.getItem(FONT_STEP_STORAGE_KEY)
    return FONT_STEPS.includes(raw) ? raw : '0'
  } catch {
    return '0'
  }
}

export const notifyProfileChanged = () => {
  if (typeof window === 'undefined') {
    return
  }
  window.dispatchEvent(new CustomEvent('briellesloop-profile-changed'))
}

export const applyFontStepToDocument = (step) => {
  if (typeof document === 'undefined') {
    return
  }
  const safe = FONT_STEPS.includes(step) ? step : '0'
  document.body.dataset.fontStep = safe
}

export const useBodyFontPreference = () => {
  const [fontStep, setFontStepState] = useState(() => getStoredFontStep())

  useEffect(() => {
    applyFontStepToDocument(fontStep)
  }, [fontStep])

  const setFontStep = useCallback((next) => {
    const safe = FONT_STEPS.includes(String(next)) ? String(next) : '0'
    try {
      window.localStorage.setItem(FONT_STEP_STORAGE_KEY, safe)
    } catch {
      /* ignore */
    }
    setFontStepState(safe)
    applyFontStepToDocument(safe)
  }, [])

  return { fontStep, setFontStep }
}

export const useOnboardingGate = () => {
  const [state, setState] = useState(() => ({
    loading: true,
    needsOnboarding: false,
    studentId: '',
  }))

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/settings/profile`)
      if (!response.ok) {
        setState({ loading: false, needsOnboarding: false, studentId: '' })
        return
      }
      const data = await response.json()
      const sid = typeof data.student_id === 'string' ? data.student_id : ''
      const completed = data.onboarding_completed_at != null
      setState({
        loading: false,
        needsOnboarding: !completed,
        studentId: sid,
      })
    } catch {
      setState({ loading: false, needsOnboarding: false, studentId: '' })
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    const handler = () => {
      refresh()
    }
    window.addEventListener('briellesloop-profile-changed', handler)
    return () => window.removeEventListener('briellesloop-profile-changed', handler)
  }, [refresh])

  return { ...state, refreshGate: refresh }
}
