import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Crosshair, Network, Unlink, Pencil, Plus, Trash2, X } from 'lucide-react';
import { api, type Connection, type EntityDetail, type GNode } from '../lib/api';
import { useSchema } from '../lib/schema';
import { metaFor } from '../theme/graphColors';
import { EntityForm, RelationshipForm } from './EntityForm';
import { ConfirmModal, EntityIcon, fmtDate, fmtValue, useToast } from './ui';

const HIDDEN = new Set(['entityKey', 'name', 'createdAt', 'updatedAt']);

type Tab = 'props' | 'related' | 'incidents';

/**
 * Selected-entity details: properties, immediate connections and related
 * incidents, with full CRUD for the entity and its relationships.
 */
export default function ContextPanel({ entityKey, onNavigate, onClose, onDeleted, compact = false }: {
  entityKey: string;
  onNavigate?: (n: GNode) => void;
  onClose?: () => void;
  onDeleted?: () => void;
  compact?: boolean;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const { version, notifyChange } = useSchema();
  const [detail, setDetail] = useState<EntityDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('props');
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [addingRel, setAddingRel] = useState(false);
  const [editRel, setEditRel] = useState<Connection | null>(null);
  const [deleteRel, setDeleteRel] = useState<Connection | null>(null);

  const load = useCallback(() => {
    setErr(null);
    api.entity(entityKey).then(setDetail).catch((e) => setErr(e.message));
  }, [entityKey]);

  useEffect(() => {
    setDetail(null);
    setTab('props');
  }, [entityKey]);
  useEffect(load, [load, version]);

  const grouped = useMemo(() => {
    const m = new Map<string, Connection[]>();
    detail?.connections.forEach((c) => {
      const k = `${c.direction === 'out' ? '→' : '←'} ${c.relationship.type}`;
      m.set(k, [...(m.get(k) ?? []), c]);
    });
    return [...m.entries()];
  }, [detail]);

  if (err) return <div className="drawer-body"><div className="error-box">{err}</div></div>;
  if (!detail) {
    return (
      <div className="drawer-body stack">
        <div className="skeleton" style={{ height: 52 }} />
        <div className="skeleton" style={{ height: 30 }} />
        <div className="skeleton" style={{ height: 200 }} />
      </div>
    );
  }

  const e = detail.entity;
  const meta = metaFor(e.label);
  const props = Object.entries(e.props).filter(([k]) => !HIDDEN.has(k));

  return (
    <>
      <div style={{ padding: compact ? '14px 16px 0' : '16px 16px 0' }}>
        <div className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
          <EntityIcon label={e.label} size={44} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="muted" style={{ fontSize: 12 }}>{meta.singular}</div>
            <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-0.01em', overflowWrap: 'anywhere' }}>{e.name}</div>
            {e.label === 'Incident' && e.props.title ? <div className="muted" style={{ fontSize: 12.5 }}>{String(e.props.title)}</div> : null}
          </div>
          {onClose && <button className="btn ghost icon sm" onClick={onClose} aria-label="Close"><X size={15} /></button>}
        </div>
        <div className="row" style={{ marginTop: 14, gap: 6 }}>
          <button className="btn primary sm" style={{ flex: 1 }} onClick={() => navigate(`/explore?focus=${encodeURIComponent(e.key)}`)}>
            <Network size={14} /> View in graph
          </button>
          <button className="btn sm" style={{ flex: 1 }} onClick={() => navigate(`/investigate?key=${encodeURIComponent(e.key)}`)}>
            <Crosshair size={14} /> Investigate
          </button>
          <button className="btn icon sm" title="Edit" onClick={() => setEditing(true)}><Pencil size={14} /></button>
          <button className="btn icon sm danger" title="Delete" onClick={() => setDeleting(true)}><Trash2 size={14} /></button>
        </div>
        <div className="tabs" style={{ marginTop: 14 }}>
          <button className={`tab${tab === 'props' ? ' on' : ''}`} onClick={() => setTab('props')}>Properties</button>
          <button className={`tab${tab === 'related' ? ' on' : ''}`} onClick={() => setTab('related')}>Related ({detail.connections.length})</button>
          <button className={`tab${tab === 'incidents' ? ' on' : ''}`} onClick={() => setTab('incidents')}>Incidents ({detail.incidents.length})</button>
        </div>
      </div>

      <div className="drawer-body" style={{ paddingTop: 10 }}>
        {tab === 'props' && detail.cases.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div className="card-sub" style={{ marginBottom: 6 }}>Appears in cases</div>
            {detail.cases.map((c) => (
              <Link key={c.id} to={`/cases/${c.id}`} className="conn" style={{ padding: '6px 8px' }}>
                <span className={`prio prio-${c.priority}`}>{c.priority}</span>
                <span className="ellipsis" style={{ fontSize: 13 }}>{c.title}</span>
              </Link>
            ))}
          </div>
        )}
        {tab === 'props' && (
          <div className="kv">
            <div>entityKey</div><div className="mono" style={{ fontSize: 12 }}>{e.key}</div>
            {props.map(([k, v]) => (
              <FragmentKV key={k} k={k} v={k === 'pageRank' && typeof v === 'number' ? v.toFixed(3) : fmtValue(v)} mono={k === 'hash'} />
            ))}
          </div>
        )}

        {tab === 'related' && (
          <div className="stack" style={{ gap: 14 }}>
            <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => setAddingRel(true)}>
              <Plus size={14} /> Add relationship
            </button>
            {grouped.length === 0 && <div className="empty">No relationships yet.</div>}
            {grouped.map(([g, conns]) => (
              <div key={g}>
                <div className="row faint mono" style={{ fontSize: 11, margin: '0 0 4px 8px' }}>{g} · {conns.length}</div>
                {conns.map((c) => (
                  <div key={c.relationship.id} className="conn" onClick={() => onNavigate?.(c.node)} role="button">
                    <EntityIcon label={c.node.label} size={26} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="ellipsis" style={{ fontSize: 13, fontWeight: 500 }}>{c.node.name}</div>
                      <div className="faint" style={{ fontSize: 11 }}>
                        {c.direction === 'out' ? <ArrowRight size={10} /> : <ArrowLeft size={10} />}{' '}
                        conf {fmtValue(c.relationship.props.confidence)}{c.relationship.props.source ? ` · ${c.relationship.props.source}` : ''}
                      </div>
                    </div>
                    <button className="btn ghost icon sm" title="Edit relationship" onClick={(ev) => { ev.stopPropagation(); setEditRel(c); }}><Pencil size={13} /></button>
                    <button className="btn ghost icon sm danger" title="Delete relationship" onClick={(ev) => { ev.stopPropagation(); setDeleteRel(c); }}><Unlink size={13} /></button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {tab === 'incidents' && (
          <div className="stack" style={{ gap: 2 }}>
            {detail.incidents.length === 0 && <div className="empty">No incidents within two hops.</div>}
            {detail.incidents.map((i) => (
              <div key={i.id} className="conn" onClick={() => onNavigate?.(i)} role="button">
                <EntityIcon label="Incident" size={26} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>{i.name}</span>
                    <span className={`sev ${i.props.severity}`}>{String(i.props.severity ?? '')}</span>
                  </div>
                  <div className="faint ellipsis" style={{ fontSize: 11.5 }}>{String(i.props.title ?? i.props.incidentType ?? '')}</div>
                </div>
                <span className="faint" style={{ fontSize: 11.5, whiteSpace: 'nowrap' }}>{fmtDate(i.props.detectedAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {editing && <EntityForm entity={e} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} />}
      {addingRel && <RelationshipForm anchor={e} onClose={() => setAddingRel(false)} onSaved={() => { setAddingRel(false); setTab('related'); }} />}
      {editRel && (
        <RelationshipForm
          edge={editRel.relationship}
          edgeEnds={editRel.direction === 'out' ? { source: e.name, target: editRel.node.name } : { source: editRel.node.name, target: e.name }}
          onClose={() => setEditRel(null)}
          onSaved={() => setEditRel(null)}
        />
      )}
      {deleteRel && (
        <ConfirmModal
          title="Delete relationship"
          message={<>Remove <span className="tag">{deleteRel.relationship.type}</span> between <strong>{e.name}</strong> and <strong>{deleteRel.node.name}</strong>? The entities themselves are kept.</>}
          onClose={() => setDeleteRel(null)}
          onConfirm={async () => {
            try {
              await api.deleteRelationship(deleteRel.relationship.id);
              toast('Relationship deleted');
              notifyChange();
            } catch (er) {
              toast((er as Error).message, true);
            }
            setDeleteRel(null);
          }}
        />
      )}
      {deleting && (
        <ConfirmModal
          title={`Delete ${meta.singular.toLowerCase()}`}
          message={<>Delete <strong>{e.name}</strong> and its {detail.connections.length} relationship{detail.connections.length === 1 ? '' : 's'}? This cannot be undone.</>}
          onClose={() => setDeleting(false)}
          onConfirm={async () => {
            try {
              await api.deleteEntity(e.key);
              toast(`${e.name} deleted`);
              setDeleting(false);
              notifyChange();
              onDeleted?.();
            } catch (er) {
              toast((er as Error).message, true);
              setDeleting(false);
            }
          }}
        />
      )}
    </>
  );
}

function FragmentKV({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <>
      <div>{k}</div>
      <div className={mono ? 'mono' : undefined} style={mono ? { fontSize: 11 } : undefined}>{v}</div>
    </>
  );
}

