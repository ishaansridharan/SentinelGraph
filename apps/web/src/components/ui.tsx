import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { LoaderCircle, Search, X } from 'lucide-react';
import { api, type GNode } from '../lib/api';
import { metaFor } from '../theme/graphColors';

/* ---------------------------------------------------------------- format */
export function timeAgo(iso: string): string {
  const t = new Date(iso.endsWith('Z') || iso.includes('+') ? iso : `${iso}Z`).getTime();
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function fmtDate(v: unknown, withTime = false): string {
  if (!v) return '—';
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

export function fmtValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return fmtDate(v, true);
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/* ------------------------------------------------------------ entity icon */
export function EntityIcon({ label, size = 28 }: { label: string; size?: number }) {
  const m = metaFor(label);
  const Icon = m.icon;
  return (
    <span className="ent-icon" style={{ width: size, height: size, ['--ec' as string]: m.color, borderRadius: size > 32 ? 12 : 8 }}>
      <Icon size={Math.round(size * 0.5)} strokeWidth={2} />
    </span>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return <LoaderCircle size={size} className="spin" style={{ color: 'var(--muted)' }} />;
}

/* ------------------------------------------------------------------ modal */
export function Modal({ title, icon, onClose, children, footer, width }: {
  title: string; icon?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return createPortal(
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={width ? { maxWidth: width } : undefined} role="dialog" aria-label={title}>
        <div className="modal-head">
          {icon}
          <h3 className="modal-title">{title}</h3>
          <span className="spacer" />
          <button className="btn ghost icon sm" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmModal({ title, message, confirmLabel = 'Delete', onConfirm, onClose }: {
  title: string; message: ReactNode; confirmLabel?: string; onConfirm: () => Promise<void> | void; onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={title}
      onClose={onClose}
      width={440}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try { await onConfirm(); } finally { setBusy(false); }
            }}
          >
            {busy && <Spinner size={14} />} {confirmLabel}
          </button>
        </>
      }
    >
      <div style={{ color: 'var(--text-2)', fontSize: 13.5 }}>{message}</div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ toast */
type Toast = { id: number; text: string; err?: boolean };
const ToastCtx = createContext<(text: string, err?: boolean) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, err = false) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, err }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), err ? 5000 : 2600);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-wrap">
        {toasts.map((t) => <div key={t.id} className={`toast${t.err ? ' err' : ''}`}>{t.text}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}

/* ------------------------------------------------------- entity picker */
export function EntityPicker({ value, onChange, label, placeholder = 'Search entities…', autoFocus }: {
  value: GNode | null; onChange: (n: GNode | null) => void; label?: string; placeholder?: string; autoFocus?: boolean;
}) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<GNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!text.trim()) { setResults([]); return; }
    setLoading(true);
    const t = setTimeout(() => {
      api.search(text.trim(), 8, label).then(setResults).catch(() => setResults([])).finally(() => setLoading(false));
    }, 160);
    return () => clearTimeout(t);
  }, [text, label]);

  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const pick = (n: GNode) => { onChange(n); setText(''); setOpen(false); };

  if (value) {
    return (
      <div className="search-box" style={{ cursor: 'default', color: 'var(--text)' }}>
        <EntityIcon label={value.label} size={20} />
        <span className="ellipsis" style={{ flex: 1, fontWeight: 500 }}>{value.name}</span>
        <span className="tag">{value.key}</span>
        <button className="btn ghost icon sm" style={{ width: 22, height: 22 }} onClick={() => onChange(null)} aria-label="Clear"><X size={13} /></button>
      </div>
    );
  }
  return (
    <div className="search" ref={ref} style={{ margin: 0, maxWidth: 'none' }}>
      <div className="search-box">
        <Search size={15} />
        <input
          autoFocus={autoFocus}
          value={text}
          placeholder={placeholder}
          onFocus={() => setOpen(true)}
          onChange={(e) => { setText(e.target.value); setOpen(true); setSel(0); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
            if (e.key === 'Enter' && results[sel]) { e.preventDefault(); pick(results[sel]); }
          }}
        />
        {loading && <Spinner size={14} />}
      </div>
      {open && text.trim() && (
        <div className="dropdown">
          {results.length === 0 && !loading && <div className="dropdown-empty">No matching entities</div>}
          {results.map((n, i) => <ResultRow key={n.id} n={n} sel={i === sel} onClick={() => pick(n)} />)}
        </div>
      )}
    </div>
  );
}

export function ResultRow({ n, sel, onClick }: { n: GNode; sel?: boolean; onClick: () => void }) {
  const m = metaFor(n.label);
  return (
    <button className={`dropdown-item${sel ? ' sel' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
      <EntityIcon label={n.label} size={26} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="ellipsis" style={{ fontWeight: 500, fontSize: 13 }}>{n.name}</div>
        <div className="muted" style={{ fontSize: 11.5 }}>{m.singular}{n.label === 'Incident' && n.props.title ? ` · ${n.props.title}` : ''}</div>
      </div>
      <span className="tag">{n.key}</span>
      {n.degree !== undefined && <span className="faint mono" style={{ fontSize: 11 }}>{n.degree} links</span>}
    </button>
  );
}

/* ---------------------------------------------------------- cypher view */
const KW = /\b(MATCH|OPTIONAL|WHERE|RETURN|WITH|ORDER BY|LIMIT|UNWIND|AS|AND|OR|NOT|DISTINCT|CALL|YIELD|IN|IS|NULL|COUNT|CASE|WHEN|THEN|ELSE|END|DESC|ASC|EXISTS|SELECT|FROM|JOIN|ON|GROUP BY|UNION|LEFT|INNER)\b/g;

export function CodeBlock({ code, lang = 'cypher' }: { code: string; lang?: 'cypher' | 'sql' }) {
  const html = code
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/('[^']*')/g, '<span class="st">$1</span>')
    .replace(KW, '<span class="kw">$1</span>')
    .replace(lang === 'cypher' ? /(:[A-Z][A-Za-z]+)(?=[\s)\]{|])/g : /^\b$/g, '<span class="lb">$1</span>')
    .replace(lang === 'cypher' ? /(\[[a-z0-9]*:)([A-Z_]+)/g : /^\b$/g, '$1<span class="rt">$2</span>');
  return <pre className="code" dangerouslySetInnerHTML={{ __html: html }} />;
}
