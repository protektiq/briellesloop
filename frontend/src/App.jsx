import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import ParentGateLayout from './components/ParentGateLayout'
import { useBodyFontPreference } from './hooks/useBodyFontPreference'
import AgentActivityPage from './pages/AgentActivityPage'
import BrainBreakPage from './pages/BrainBreakPage'
import OnboardingPage from './pages/OnboardingPage'
import ParentDashboardPage from './pages/ParentDashboardPage'
import PracticePage from './pages/PracticePage'
import SessionCompletePage from './pages/SessionCompletePage'
import SettingsPage from './pages/SettingsPage'
import TeacherDashboardPage from './pages/TeacherDashboardPage'
import TodayPage from './pages/TodayPage'

const FontBootstrap = () => {
  useBodyFontPreference()
  return null
}

const App = () => {
  return (
    <BrowserRouter>
      <FontBootstrap />
      <Routes>
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route path="/share/:token" element={<TeacherDashboardPage />} />
        <Route element={<Layout />}>
          <Route path="/" element={<TodayPage />} />
          <Route path="/practice/:skillName" element={<PracticePage />} />
          <Route
            path="/practice/:skillName/complete"
            element={<SessionCompletePage />}
          />
          <Route path="/break" element={<BrainBreakPage />} />
          <Route path="/parent" element={<ParentGateLayout />}>
            <Route index element={<ParentDashboardPage />} />
            <Route path="agents" element={<AgentActivityPage />} />
          </Route>
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
