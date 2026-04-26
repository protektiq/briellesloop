import { Outlet } from 'react-router-dom'
import TopNav from './TopNav'

const Layout = () => {
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
