import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import AgentActivityPage from './pages/AgentActivityPage'
import BrainBreakPage from './pages/BrainBreakPage'
import ParentDashboardPage from './pages/ParentDashboardPage'
import PracticePage from './pages/PracticePage'
import SettingsPage from './pages/SettingsPage'
import TodayPage from './pages/TodayPage'

const App = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<TodayPage />} />
          <Route path="/practice/:skillName" element={<PracticePage />} />
          <Route path="/break" element={<BrainBreakPage />} />
          <Route path="/parent" element={<ParentDashboardPage />} />
          <Route path="/parent/agents" element={<AgentActivityPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
