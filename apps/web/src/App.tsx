import { useEffect, useRef, useState } from 'react';
import { BrowserRouter, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ChartNetwork, Crosshair, LayoutDashboard, Map as MapIcon, Moon, Plus, Search, SquareTerminal, Sun, Waypoints } from 'lucide-react';
import './App.css';
import { api, type CaseFile, type GNode } from './lib/api';
import { SchemaProvider, useSchema } from './lib/schema';
import { setTheme, useTheme } from './lib/theme';
import { ENTITY_ORDER, metaFor } from './theme/graphColors';
import { EntityForm } from './components/EntityForm';
import { ResultRow, Spinner, ToastProvider } from './components/ui';
import DashboardView from './views/DashboardView';
import ExplorerView from './views/ExplorerView';
import InvestigateView from './views/InvestigateView';
import QueryLabView from './views/QueryLabView';
import EntitiesView from './views/EntitiesView';
import AnalyticsView from './views/AnalyticsView';
import MapView from './views/MapView';
import CaseView, { PriorityPill } from './views/CaseView';

const NAV = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/map', label: 'Campaign map', icon: MapIcon },
  { to: '/investigate', label: 'Investigate', icon: Crosshair },
  { to: '/explore', label: 'Graph explorer', icon: Waypoints },
  { to: '/query', label: 'Query lab', icon: SquareTerminal },
];

function Sidebar() {
  const { stats, online, version } = useSchema();
  const [cases, setCases] = useState<CaseFile[]>([]);
  useEffect(() => { api.cases().then(setCases).catch(() => {}); }, [version]);
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="5" cy="6" r="2.2" /><circle cx="19" cy="6" r="2.2" /><circle cx="12" cy="18" r="2.2" />
            <path d="M7 7l3.6 9M17 7l-3.6 9M7.2 6h9.6" />
          </svg>
        </div>
        <div>
          <div className="brand-name">SentinelGraph</div>
          <div className="brand-sub">Threat intelligence graph</div>
        </div>
      </div>
      {NAV.map(({ to, label, icon: Icon, end }) => (
        <NavLink key={to} to={to} end={end} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
          <Icon size={16} strokeWidth={1.9} /> {label}
        </NavLink>
      ))}
      <div className="nav-section">Cases</div>
      {cases.map((c) => (
        <NavLink key={c.id} to={`/cases/${c.id}`} className={({ isActive }) => `nav-item nav-case${isActive ? ' active' : ''}`}>
          <span className="t">{c.title.split(':')[0]}</span>
          <span className="row" style={{ gap: 6 }}>
            <PriorityPill p={c.priority} />
            <span className="faint" style={{ fontSize: 11 }}>{c.stats?.open ?? 0} open · {c.owner.split(' ')[0]}</span>
          </span>
        </NavLink>
      ))}
      <div className="nav-section">Data</div>
      {ENTITY_ORDER.map((l) => {
        const m = metaFor(l);
        return (
          <NavLink key={l} to={`/entities/${l}`} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`} style={{ padding: '5px 10px', fontSize: 13 }}>
            <span className="nav-dot" style={{ background: m.color }} />
            {m.plural}
            <span className="count">{stats?.labels[l]?.count ?? ''}</span>
          </NavLink>
        );
      })}
      <NavLink to="/analytics" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`} style={{ padding: '5px 10px', fontSize: 13 }}>
        <ChartNetwork size={14} strokeWidth={1.9} /> Graph analytics
      </NavLink>
      <div className="sidebar-foot">
        <div className="status-pill">
          <span className={`led${online ? '' : ' down'}`} />
          {online ? (
            <span>MongoDB + Neo4j · {stats ? `${stats.nodes} nodes · ${stats.relationships} links` : 'connecting…'}</span>
          ) : (
            <span>API offline</span>
          )}
        </div>
      </div>
    </aside>
  );
}

function GlobalSearch() {
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<GNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        input.current?.focus();
        setOpen(true);
      }
    };
    const out = (e: MouseEvent) => wrap.current && !wrap.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener('keydown', h);
    document.addEventListener('mousedown', out);
    return () => { window.removeEventListener('keydown', h); document.removeEventListener('mousedown', out); };
  }, []);

  useEffect(() => {
    if (!text.trim()) { setResults([]); return; }
    setLoading(true);
    const t = setTimeout(() => api.search(text.trim(), 10).then(setResults).catch(() => setResults([])).finally(() => setLoading(false)), 140);
    return () => clearTimeout(t);
  }, [text]);

  const go = (n: GNode) => {
    navigate(`/explore?focus=${encodeURIComponent(n.key)}`);
    setText('');
    setOpen(false);
    input.current?.blur();
  };

  return (
    <div className="search" ref={wrap}>
      <div className="search-box" onClick={() => input.current?.focus()}>
        <Search size={15} />
        <input
          ref={input}
          value={text}
          placeholder="Search by IP, domain, CVE, actor, incident…  e.g. 198.51.100.42 or DarkLoader"
          onFocus={() => setOpen(true)}
          onChange={(e) => { setText(e.target.value); setSel(0); setOpen(true); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
            if (e.key === 'Enter' && results[sel]) go(results[sel]);
            if (e.key === 'Escape') { setOpen(false); input.current?.blur(); }
          }}
        />
        {loading ? <Spinner size={14} /> : <span className="kbd">Ctrl K</span>}
      </div>
      {open && text.trim() && (
        <div className="dropdown">
          {!loading && results.length === 0 && <div className="dropdown-empty">No entities match “{text}”</div>}
          {results.map((n, i) => <ResultRow key={n.id} n={n} sel={i === sel} onClick={() => go(n)} />)}
        </div>
      )}
    </div>
  );
}

const TITLES: Record<string, string> = {
  '': 'Overview', map: 'Campaign map', cases: 'Case', explore: 'Graph explorer', investigate: 'Investigate', query: 'Query lab',
  analytics: 'Graph analytics', entities: 'Data',
};

function TopBar() {
  const theme = useTheme();
  const loc = useLocation();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const seg = loc.pathname.split('/')[1] ?? '';
  const sub = seg === 'entities' ? metaFor(loc.pathname.split('/')[2] ?? '').plural : null;
  return (
    <header className="topbar">
      <span className="topbar-title">{TITLES[seg] ?? ''}</span>
      {sub && <span className="topbar-crumb">/ {sub}</span>}
      <GlobalSearch />
      <button className="btn sm" onClick={() => setCreating(true)}><Plus size={14} /> New entity</button>
      <button className="btn ghost icon sm" title="Toggle theme" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
        {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
      </button>
      <div className="row" style={{ gap: 8, paddingLeft: 4 }}>
        <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--surface-3)', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 600 }}>A</div>
        <span style={{ fontSize: 13, color: 'var(--text-2)' }}>Analyst</span>
      </div>
      {creating && (
        <EntityForm
          onClose={() => setCreating(false)}
          onSaved={(n) => { setCreating(false); navigate(`/explore?focus=${encodeURIComponent(n.key)}`); }}
        />
      )}
    </header>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <SchemaProvider>
        <ToastProvider>
          <div className="app">
            <Sidebar />
            <div className="main">
              <TopBar />
              <div className="content">
                <Routes>
                  <Route path="/" element={<DashboardView />} />
                  <Route path="/map" element={<MapView />} />
                  <Route path="/cases/:id" element={<CaseView />} />
                  <Route path="/explore" element={<ExplorerView />} />
                  <Route path="/investigate" element={<InvestigateView />} />
                  <Route path="/query" element={<QueryLabView />} />
                  <Route path="/analytics" element={<AnalyticsView />} />
                  <Route path="/entities/:label" element={<EntitiesView />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </div>
            </div>
          </div>
        </ToastProvider>
      </SchemaProvider>
    </BrowserRouter>
  );
}
