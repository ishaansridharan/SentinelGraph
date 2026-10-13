import { useEffect, useMemo, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Plus, Search } from 'lucide-react';
import { api, type FieldDef, type GNode } from '../lib/api';
import { useSchema } from '../lib/schema';
import { ENTITY_META, metaFor } from '../theme/graphColors';
import ContextPanel from '../components/ContextPanel';
import { EntityForm } from '../components/EntityForm';
import { EntityIcon, Spinner, fmtDate, fmtValue } from '../components/ui';

const PAGE = 25;

const SORTS: Record<string, { value: string; label: string }[]> = {
  Incident: [{ value: 'detected', label: 'Newest' }, { value: 'severity', label: 'Severity' }, { value: 'degree', label: 'Most connected' }],
  default: [{ value: 'name', label: 'Name' }, { value: 'degree', label: 'Most connected' }, { value: 'recent', label: 'Recently added' }],
};

function cellFor(f: FieldDef, n: GNode) {
  const v = n.props[f.name];
  if (f.name === 'severity' && v) return <span className={`sev ${v}`}>{String(v)}</span>;
  if (f.type === 'date' || f.type === 'datetime') return <span className="muted">{fmtDate(v, f.type === 'datetime')}</span>;
  if (f.name === 'hash' && typeof v === 'string') return <span className="mono muted" style={{ fontSize: 11.5 }}>{v.slice(0, 12)}…</span>;
  return <span>{fmtValue(v)}</span>;
}

export default function EntitiesView() {
  const { label = '' } = useParams();
  const { schema, version } = useSchema();
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('');
  const [page, setPage] = useState(0);
  const [data, setData] = useState<{ total: number; items: GNode[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<GNode | null>(null);
  const [creating, setCreating] = useState(false);

  const sorts = SORTS[label] ?? SORTS.default;
  const activeSort = sort || sorts[0].value;

  useEffect(() => { setQ(''); setSort(''); setPage(0); setSelected(null); }, [label]);

  useEffect(() => {
    if (!ENTITY_META[label]) return;
    setErr(null);
    const t = setTimeout(() => {
      api.entities(label, { q, sort: activeSort, skip: page * PAGE, limit: PAGE })
        .then(setData)
        .catch((e) => setErr(e.message));
    }, q ? 180 : 0);
    return () => clearTimeout(t);
  }, [label, q, activeSort, page, version]);

  const columns = useMemo(() => {
    const def = schema?.labels.find((l) => l.label === label);
    const fields = def?.fields.filter((f) => f.name !== 'name') ?? [];
    const shown = fields.filter((f) => f.type !== 'textarea');
    return label === 'Incident' ? shown.filter((f) => f.name !== 'title') : shown.slice(0, 4);
  }, [schema, label]);

  if (!ENTITY_META[label]) return <Navigate to="/" replace />;
  const meta = metaFor(label);
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE)) : 1;

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <div style={{ flex: 1, overflow: 'auto', minWidth: 0 }}>
        <div className="page">
          <div className="page-head">
            <div className="row" style={{ gap: 12 }}>
              <EntityIcon label={label} size={40} />
              <div>
                <h1 className="page-title">{meta.plural}</h1>
                <p className="page-sub">{data ? `${data.total} ${data.total === 1 ? meta.singular.toLowerCase() : meta.plural.toLowerCase()}` : 'Loading…'} stored as <span className="mono">:{label}</span> nodes</p>
              </div>
            </div>
            <button className="btn primary" onClick={() => setCreating(true)}><Plus size={15} /> New {meta.singular.toLowerCase()}</button>
          </div>

          <div className="row" style={{ marginBottom: 12, gap: 10 }}>
            <div className="search-box" style={{ width: 320 }}>
              <Search size={15} />
              <input value={q} placeholder={`Filter ${meta.plural.toLowerCase()}…`} onChange={(e) => { setQ(e.target.value); setPage(0); }} />
            </div>
            <span className="spacer" />
            <span className="muted" style={{ fontSize: 12.5 }}>Sort</span>
            <div className="tabs" style={{ padding: 2 }}>
              {sorts.map((s) => (
                <button key={s.value} className={`tab${activeSort === s.value ? ' on' : ''}`} style={{ height: 26 }} onClick={() => { setSort(s.value); setPage(0); }}>{s.label}</button>
              ))}
            </div>
          </div>

          {err && <div className="error-box" style={{ marginBottom: 12 }}>{err}</div>}
          <div className="card" style={{ overflow: 'hidden' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>{label === 'Incident' ? 'Incident' : 'Name'}</th>
                  <th>Key</th>
                  {columns.map((c) => <th key={c.name}>{c.label}</th>)}
                  <th className="num">Links</th>
                </tr>
              </thead>
              <tbody>
                {!data && (
                  <tr><td colSpan={columns.length + 3}><div className="empty"><Spinner /></div></td></tr>
                )}
                {data?.items.length === 0 && (
                  <tr><td colSpan={columns.length + 3}><div className="empty">No {meta.plural.toLowerCase()} match.</div></td></tr>
                )}
                {data?.items.map((n) => (
                  <tr key={n.id} className="row-link" onClick={() => setSelected(n)} style={selected?.id === n.id ? { background: 'var(--active)' } : undefined}>
                    <td style={{ maxWidth: 280 }}>
                      <div className="row" style={{ gap: 10 }}>
                        <EntityIcon label={label} size={26} />
                        <span className="ellipsis" style={{ fontWeight: 500 }}>{label === 'Incident' ? String(n.props.title ?? n.name) : n.name}</span>
                      </div>
                    </td>
                    <td><span className="tag">{n.key}</span></td>
                    {columns.map((c) => <td key={c.name}>{cellFor(c, n)}</td>)}
                    <td className="num muted">{n.degree ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data && data.total > PAGE && (
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
              <span className="muted" style={{ fontSize: 12.5 }}>Page {page + 1} of {pages}</span>
              <button className="btn icon sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}><ChevronLeft size={15} /></button>
              <button className="btn icon sm" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}><ChevronRight size={15} /></button>
            </div>
          )}
        </div>
      </div>

      {selected && (
        <aside className="drawer">
          <ContextPanel
            entityKey={selected.key}
            onClose={() => setSelected(null)}
            onNavigate={(n) => setSelected(n)}
            onDeleted={() => setSelected(null)}
          />
        </aside>
      )}

      {creating && <EntityForm label={label} onClose={() => setCreating(false)} onSaved={(n) => { setCreating(false); setSelected(n); }} />}
    </div>
  );
}
