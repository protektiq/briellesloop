import { useEffect } from 'react'
import { NavLink } from 'react-router-dom'
import { API_BASE_URL } from '../constants/api'
import { useUiStore } from '../store/uiStore'

const getLinkClassName = ({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')

const TopNav = () => {
  const streakCount = useUiStore((state) => state.streakCount)
  const setStreakCount = useUiStore((state) => state.setStreakCount)

  useEffect(() => {
    let cancelled = false

    const loadStreak = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/dashboard/skills`)
        const payload = await response.json().catch(() => ({}))
        if (!response.ok || cancelled) {
          return
        }
        const raw = payload?.practice_streak_days
        const parsed = Number.parseInt(String(raw ?? '0'), 10)
        if (Number.isInteger(parsed) && parsed >= 0) {
          setStreakCount(parsed)
        }
      } catch {
        /* keep current streak */
      }
    }

    void loadStreak()
    return () => {
      cancelled = true
    }
  }, [setStreakCount])

  return (
    <header className="top-nav" aria-label="Primary">
      <NavLink to="/" className="logo" aria-label="Brielle home">
        <span className="logo-mark" aria-hidden="true">
          B
        </span>
        <span>
          Brielle<em>Loop</em>
        </span>
      </NavLink>

      <nav className="nav-links" aria-label="Main navigation">
        <NavLink to="/" className={getLinkClassName} end>
          Today
        </NavLink>
        <NavLink to="/break" className={getLinkClassName}>
          Brain Break
        </NavLink>
        <NavLink to="/parent" className={getLinkClassName}>
          Parent
        </NavLink>
        <NavLink to="/settings" className={getLinkClassName}>
          Settings
        </NavLink>
      </nav>

      <div className="nav-right">
        <div className="streak-pill" aria-live="polite">
          🔥 {streakCount} day streak
        </div>
        <div className="avatar" aria-label="Brielle avatar">
          B
        </div>
      </div>
    </header>
  )
}

export default TopNav
