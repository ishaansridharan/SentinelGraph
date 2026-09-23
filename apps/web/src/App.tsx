import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import DashboardView from './views/DashboardView';
import InvestigateView from './views/InvestigateView';
import AnalyticsView from './views/AnalyticsView';

const navLinkStyle = ({ isActive }: { isActive: boolean }) => ({
  padding: '8px 16px',
  borderRadius: '6px',
  textDecoration: 'none',
  fontSize: '14px',
  fontWeight: 500,
  color: isActive ? '#e2e8f0' : '#718096',
  background: isActive ? '#2d3748' : 'transparent',
  transition: 'all 0.15s',
});

export default function App() {
  return (
    <BrowserRouter>
      <div style={{ minHeight: '100vh', background: '#0d0d1a', fontFamily: 'system-ui, sans-serif' }}>
        {/* Navbar */}
        <nav style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '12px 24px',
          background: '#111128',
          borderBottom: '1px solid #1e1e3a',
          position: 'sticky',
          top: 0,
          zIndex: 100,
        }}>
          <span style={{ fontWeight: 700, fontSize: '16px', color: '#e74c3c', marginRight: '24px', letterSpacing: '-0.02em' }}>
            ⬡ SentinelGraph
          </span>
          <NavLink to="/" end style={navLinkStyle}>Dashboard</NavLink>
          <NavLink to="/investigate" style={navLinkStyle}>Investigate</NavLink>
          <NavLink to="/analytics" style={navLinkStyle}>Analytics</NavLink>
        </nav>

        {/* Views */}
        <main>
          <Routes>
            <Route path="/" element={<DashboardView />} />
            <Route path="/investigate" element={<InvestigateView />} />
            <Route path="/analytics" element={<AnalyticsView />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
