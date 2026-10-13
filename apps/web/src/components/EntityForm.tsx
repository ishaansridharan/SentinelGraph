import { useEffect, useMemo, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { api, type FieldDef, type GEdge, type GNode, type Props } from '../lib/api';
import { useSchema } from '../lib/schema';
import { ENTITY_ORDER, metaFor } from '../theme/graphColors';
import { EntityIcon, EntityPicker, Modal, Spinner, useToast } from './ui';

function toInput(f: FieldDef, v: unknown): string {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.join(', ');
  if (f.type === 'date') return String(v).slice(0, 10);
  if (f.type === 'datetime') return String(v).slice(0, 16);
  return String(v);
}

function FieldInput({ f, value, onChange, autoFocus }: { f: FieldDef; value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  if (f.type === 'bool') {
    return (
      <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    );
  }
  if (f.type === 'textarea') {
    return <textarea className="textarea" rows={3} value={value} onChange={(e) => onChange(e.target.value)} />;
  }
  if (f.type === 'select' && f.options) {
    return (
      <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  return (
    <input
      className="input"
      autoFocus={autoFocus}
      type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : f.type === 'datetime' ? 'datetime-local' : 'text'}
      step={f.type === 'number' ? 'any' : undefined}
      value={value}
      placeholder={f.type === 'list' ? 'comma, separated' : undefined}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/** Create a new entity (label picker shown when no label is given) or edit an existing one. */
export function EntityForm({ label: initialLabel, entity, onClose, onSaved }: {
  label?: string; entity?: GNode; onClose: () => void; onSaved: (n: GNode) => void;
}) {
  const { schema, notifyChange } = useSchema();
  const toast = useToast();
  const [label, setLabel] = useState(entity?.label ?? initialLabel ?? 'ThreatActor');
  const def = schema?.labels.find((l) => l.label === label);
  const [values, setValues] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    if (entity && def) def.fields.forEach((f) => (out[f.name] = toInput(f, entity.props[f.name])));
    return out;
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Seed edit values if the schema arrived after first render
  useEffect(() => {
    if (entity && def && Object.keys(values).length === 0) {
      const out: Record<string, string> = {};
      def.fields.forEach((f) => (out[f.name] = toInput(f, entity.props[f.name])));
      setValues(out);
    }
  }, [entity, def, values]);

  const fields = def?.fields ?? [];
  const missing = fields.filter((f) => f.required && !values[f.name]?.trim());

  const save = async () => {
    setErr(null);
    setBusy(true);
    const props: Props = {};
    fields.forEach((f) => {
      const v = values[f.name];
      if (v === undefined) return;
      if (!entity && v === '') return;
      props[f.name] = f.type === 'datetime' && v ? `${v}:00`.slice(0, 19) : v;
    });
    try {
      const saved = entity ? await api.updateEntity(entity.key, props) : await api.createEntity(label, props);
      toast(entity ? `${saved.name} updated` : `${metaFor(label).singular} ${saved.name} created`);
      notifyChange();
      onSaved(saved);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={entity ? `Edit ${entity.name}` : `New ${metaFor(label).singular}`}
      icon={<EntityIcon label={label} size={28} />}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy || missing.length > 0} onClick={save}>
            {busy && <Spinner size={14} />} {entity ? 'Save changes' : 'Create'}
          </button>
        </>
      }
    >
      {!entity && !initialLabel && (
        <div className="field" style={{ marginBottom: 16 }}>
          <label>Type</label>
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {ENTITY_ORDER.map((l) => (
              <button key={l} className={`chip${l === label ? ' on' : ''}`} onClick={() => { setLabel(l); setValues({}); }}>
                <span className="nav-dot" style={{ background: metaFor(l).color }} /> {metaFor(l).singular}
              </button>
            ))}
          </div>
        </div>
      )}
      {!schema && <Spinner />}
      <div className="form-grid">
        {fields.map((f, i) => (
          <div key={f.name} className={`field${i === 0 || f.type === 'textarea' ? ' full' : ''}`}>
            <label>{f.label}{f.required && <span style={{ color: 'var(--critical)' }}> *</span>}</label>
            <FieldInput f={f} value={values[f.name] ?? ''} autoFocus={i === 0} onChange={(v) => setValues((s) => ({ ...s, [f.name]: v }))} />
          </div>
        ))}
      </div>
      {!entity && <p className="muted" style={{ fontSize: 12, margin: '14px 0 0' }}>An entity key is generated automatically{label === 'Vulnerability' ? ' from the CVE ID' : ''}.</p>}
      {err && <div className="error-box" style={{ marginTop: 14 }}>{err}</div>}
    </Modal>
  );
}

/** Create a relationship from/to a fixed entity, or edit an existing relationship's evidence properties. */
export function RelationshipForm({ anchor, edge, edgeEnds, onClose, onSaved }: {
  anchor?: GNode;
  edge?: GEdge;
  edgeEnds?: { source: string; target: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  const { schema, notifyChange } = useSchema();
  const toast = useToast();
  const [direction, setDirection] = useState<'out' | 'in'>('out');
  const [other, setOther] = useState<GNode | null>(null);
  const [type, setType] = useState<string>(edge?.type ?? '');
  const [values, setValues] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    if (edge) Object.entries(edge.props).forEach(([k, v]) => (out[k] = v == null ? '' : String(v).slice(0, k.endsWith('Seen') ? 16 : undefined)));
    return out;
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const src = direction === 'out' ? anchor : other;
  const dst = direction === 'out' ? other : anchor;

  const validTypes = useMemo(() => {
    if (!schema || !anchor) return [];
    return schema.relationships.filter((r) =>
      r.pairs.some(([a, b]) => (direction === 'out' ? a === anchor.label && (!other || b === other.label) : b === anchor.label && (!other || a === other.label))),
    );
  }, [schema, anchor, other, direction]);

  const fields = (schema?.relationshipFields ?? []).filter(
    (f) => !['port', 'protocol'].includes(f.name) || (edge?.type ?? type) === 'COMMUNICATES_WITH',
  );

  const save = async () => {
    setErr(null);
    setBusy(true);
    const props: Props = {};
    fields.forEach((f) => {
      const v = values[f.name];
      if (v === undefined || (!edge && v === '')) return;
      props[f.name] = f.type === 'datetime' && v ? `${v}:00`.slice(0, 19) : v;
    });
    try {
      if (edge) {
        await api.updateRelationship(edge.id, props);
        toast(`${edge.type} updated`);
      } else {
        if (!src || !dst || !type) throw new Error('Pick the other entity and a relationship type');
        await api.createRelationship(type, src.key, dst.key, props);
        toast(`${src.name} —${type}→ ${dst.name}`);
      }
      notifyChange();
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={edge ? `Edit ${edge.type}` : 'New relationship'}
      onClose={onClose}
      width={600}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy || (!edge && (!other || !type))} onClick={save}>
            {busy && <Spinner size={14} />} {edge ? 'Save changes' : 'Create relationship'}
          </button>
        </>
      }
    >
      {edge && edgeEnds && (
        <div className="row" style={{ marginBottom: 16, fontSize: 13 }}>
          <strong>{edgeEnds.source}</strong>
          <span className="tag">{edge.type}</span>
          <ArrowRight size={14} className="muted" />
          <strong>{edgeEnds.target}</strong>
        </div>
      )}
      {!edge && anchor && (
        <div className="stack" style={{ gap: 14, marginBottom: 16 }}>
          <div className="tabs" style={{ width: 'fit-content' }}>
            <button className={`tab${direction === 'out' ? ' on' : ''}`} onClick={() => { setDirection('out'); setType(''); }}>Outgoing from {anchor.name}</button>
            <button className={`tab${direction === 'in' ? ' on' : ''}`} onClick={() => { setDirection('in'); setType(''); }}>Incoming to {anchor.name}</button>
          </div>
          <div className="field">
            <label>{direction === 'out' ? 'Target' : 'Source'} entity</label>
            <EntityPicker value={other} onChange={(n) => { setOther(n); setType(''); }} autoFocus />
          </div>
          <div className="field">
            <label>Relationship type</label>
            {validTypes.length === 0 ? (
              <div className="muted" style={{ fontSize: 12.5 }}>
                {other ? `No relationship type in the schema connects ${metaFor((src ?? anchor).label).singular} → ${metaFor((dst ?? anchor).label).singular}.` : 'Pick an entity to see valid types.'}
              </div>
            ) : (
              <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                {validTypes.map((r) => (
                  <button key={r.type} className={`chip mono${type === r.type ? ' on' : ''}`} style={{ fontSize: 11 }} onClick={() => setType(r.type)}>{r.type}</button>
                ))}
              </div>
            )}
          </div>
          {src && dst && type && (
            <div className="row code" style={{ padding: '8px 12px' }}>
              ({src.name}) -[:{type}]-&gt; ({dst.name})
            </div>
          )}
        </div>
      )}
      <div className="card-sub" style={{ marginBottom: 10 }}>Evidence properties</div>
      <div className="form-grid">
        {fields.map((f) => (
          <div key={f.name} className="field">
            <label>{f.label}</label>
            <FieldInput f={f} value={values[f.name] ?? ''} onChange={(v) => setValues((s) => ({ ...s, [f.name]: v }))} />
          </div>
        ))}
      </div>
      {err && <div className="error-box" style={{ marginTop: 14 }}>{err}</div>}
    </Modal>
  );
}
