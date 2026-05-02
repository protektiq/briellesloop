import { useEffect } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useOnboardingGate } from '../hooks/useBodyFontPreference'
import TopNav from './TopNav'

const EXEMPT_ONBOARDING_PREFIXES = ['/onboarding', '/settings']

const isOnboardingExemptPath = (pathname) =>
  EXEMPT_ONBOARDING_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))

const Layout = () => {
  const location = useLocation()
  const navigate = useNavigate()
  const { loading, needsOnboarding } = useOnboardingGate()

  useEffect(() => {
    if (loading) {
      return
    }
    if (!needsOnboarding) {
      return
    }
    if (isOnboardingExemptPath(location.pathname)) {
      return
    }
    navigate('/onboarding', { replace: true })
  }, [loading, needsOnboarding, location.pathname, navigate])

  return (
    <div className="app-shell">
      <TopNav />
      <main className="page-shell">
        <Outlet />
      </main>
    </div>
  )
}

export default Layout
