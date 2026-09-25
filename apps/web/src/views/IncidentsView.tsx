import { useEffect, useState } from 'react';

const API_BASE = 'http://localhost:8000';

const EVENT_TYPES = ['phishing_email', 'malware_execution', 'network_scan'];
const SEVERITIES = ['low', 'medium', 'high', 'critical'];

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#e74c3c',
  high:     '#e67e22',
  medium:   '#f1c40f',
  low:      '#2ecc71',
};

interface Indicator {
  type: string;
  value: string;
  confidence: number;
}

interface Risk {
  score: number;
  severity: string;
  reasons: string[];
}

interface Incident {
  eventId: string;
  eventType: string;
  observedAt: string;
  classification: string;
  region: string;
  version: string;
  rawPayload: Record<string, unknown>;
  extractedIndicators: Indicator[];
  risk: Risk;
}

interface EditForm {
  eventType: string;
  observedAt: string;
  classification: string;
  region: string;
  version: string;
  rawPayloadText: string;
  extractedIndicatorsText: string;
  riskScore: string;
  riskSeverity: string;
  riskReasonsText: string;
}

interface CreateForm extends EditForm {
  eventId: string;
}

function generateEventId(): string {
  const hex = Array.from({ length: 12 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `evt-${hex}`;
}

function blankCreateForm(): CreateForm {
  return {
    eventId: generateEventId(),
    eventType: EVENT_TYPES[0],
    observedAt: toDatetimeLocal(new Date().toISOString()),
    classification: 'TLP:AMBER',
    region: 'IN',
    version: '1.0',
    rawPayloadText: '{}',
    extractedIndicatorsText: '[]',
    riskScore: '50',
    riskSeverity: 'medium',
    riskReasonsText: '',
  };
}

function parseIncidentForm(form: EditForm) {
  let rawPayload: Record<string, unknown>;
  let extractedIndicators: Indicator[];
  try {
    rawPayload = JSON.parse(form.rawPayloadText);
  } catch {
    throw new Error('Raw payload is not valid JSON');
  }
  try {
    extractedIndicators = JSON.parse(form.extractedIndicatorsText);
  } catch {
    throw new Error('Extracted indicators is not valid JSON');
  }
  const riskScore = Number(form.riskScore);
  if (Number.isNaN(riskScore)) throw new Error('Risk score must be a number');

  return {
    eventType: form.eventType,
    observedAt: form.observedAt ? new Date(form.observedAt).toISOString() : undefined,
    classification: form.classification,
    region: form.region,
    version: form.version,
    rawPayload,
    extractedIndicators,
    risk: {
      score: riskScore,
      severity: form.riskSeverity,
      reasons: form.riskReasonsText.split(',').map((s) => s.trim()).filter(Boolean),
    },
  };
}

function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toIncidentForm(incident: Incident): EditForm {
  return {
    eventType: incident.eventType,
    observedAt: toDatetimeLocal(incident.observedAt),
    classification: incident.classification,
    region: incident.region,
    version: incident.version,
    rawPayloadText: JSON.stringify(incident.rawPayload ?? {}, null, 2),
    extractedIndicatorsText: JSON.stringify(incident.extractedIndicators ?? [], null, 2),
    riskScore: String(incident.risk?.score ?? 50),
    riskSeverity: incident.risk?.severity ?? 'medium',
    riskReasonsText: (incident.risk?.reasons ?? []).join(', '),
  };
}

const inputStyle = {
  width: '100%',
  padding: '8px 10px',
  background: '#0d0d1a',
  border: '1px solid #2a2a4e',
  borderRadius: '6px',
  color: '#e2e8f0',
  fontSize: '13px',
  boxSizing: 'border-box' as const,
};

const labelStyle = {
  display: 'block',
  marginBottom: '4px',
  color: '#718096',
  fontSize: '12px',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.05em',
};

const fieldWrap = { marginBottom: '14px' };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={fieldWrap}>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  );
}

export default function IncidentsView() {
  const [incidents, setIncidents] = useState<Incident[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [editing, setEditing] = useState<Incident | null>(null);
  const [form, setForm] = useState<EditForm | null>(null);
  const [actionLoading, setActionLoading] = useState<'patch' | 'put' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [createForm, setCreateForm] = useState<CreateForm | null>(null);
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const fetchIncidents = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/incidents`);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = await res.json();
      setIncidents(data.incidents);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchIncidents();
  }, []);

  const openEdit = (incident: Incident) => {
    setEditing(incident);
    setForm(toIncidentForm(incident));
    setActionError(null);
    setActionMessage(null);
  };

  const closeEdit = () => {
    setEditing(null);
    setForm(null);
    setActionError(null);
    setActionMessage(null);
  };

  const submitPatch = async () => {
    if (!editing || !form) return;
    setActionError(null);
    setActionMessage(null);

    let parsed: ReturnType<typeof parseIncidentForm>;
    try {
      parsed = parseIncidentForm(form);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Invalid form data');
      return;
    }

    const original = toIncidentForm(editing);
    const diff: Record<string, unknown> = {};
    if (parsed.eventType !== original.eventType) diff.eventType = parsed.eventType;
    if (form.observedAt !== original.observedAt) diff.observedAt = parsed.observedAt;
    if (parsed.classification !== original.classification) diff.classification = parsed.classification;
    if (parsed.region !== original.region) diff.region = parsed.region;
    if (parsed.version !== original.version) diff.version = parsed.version;
    if (form.rawPayloadText !== original.rawPayloadText) diff.rawPayload = parsed.rawPayload;
    if (form.extractedIndicatorsText !== original.extractedIndicatorsText) diff.extractedIndicators = parsed.extractedIndicators;
    if (
      form.riskScore !== original.riskScore ||
      form.riskSeverity !== original.riskSeverity ||
      form.riskReasonsText !== original.riskReasonsText
    ) {
      diff.risk = parsed.risk;
    }

    if (Object.keys(diff).length === 0) {
      setActionMessage('No changes to save.');
      return;
    }

    setActionLoading('patch');
    try {
      const res = await fetch(`${API_BASE}/api/v1/incidents/${encodeURIComponent(editing.eventId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(diff),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      setActionMessage('Incident updated (PATCH) and queued for graph projection.');
      await fetchIncidents();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setActionLoading(null);
    }
  };

  const submitPut = async () => {
    if (!editing || !form) return;
    setActionError(null);
    setActionMessage(null);

    let parsed: ReturnType<typeof parseIncidentForm>;
    try {
      parsed = parseIncidentForm(form);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Invalid form data');
      return;
    }

    const body = {
      eventId: editing.eventId,
      eventType: parsed.eventType,
      observedAt: parsed.observedAt,
      classification: parsed.classification,
      region: parsed.region,
      version: parsed.version,
      rawPayload: parsed.rawPayload,
      extractedIndicators: parsed.extractedIndicators,
      risk: parsed.risk,
    };

    setActionLoading('put');
    try {
      const res = await fetch(`${API_BASE}/api/v1/incidents/${encodeURIComponent(editing.eventId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      setActionMessage('Incident replaced (PUT) and queued for graph projection.');
      await fetchIncidents();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setActionLoading(null);
    }
  };

  const deleteIncident = async (eventId: string) => {
    if (!window.confirm(`Delete incident "${eventId}"? This also removes it from the graph.`)) return;
    setDeleteError(null);
    setDeletingId(eventId);
    try {
      const res = await fetch(`${API_BASE}/api/v1/incidents/${encodeURIComponent(eventId)}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      if (editing?.eventId === eventId) closeEdit();
      await fetchIncidents();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setDeletingId(null);
    }
  };

  const openCreate = () => {
    setCreateForm(blankCreateForm());
    setCreateError(null);
  };

  const closeCreate = () => {
    setCreateForm(null);
    setCreateError(null);
  };

  const submitCreate = async () => {
    if (!createForm) return;
    setCreateError(null);

    if (!createForm.eventId.trim()) {
      setCreateError('Event ID is required');
      return;
    }

    let parsed: ReturnType<typeof parseIncidentForm>;
    try {
      parsed = parseIncidentForm(createForm);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Invalid form data');
      return;
    }

    const body = {
      eventId: createForm.eventId.trim(),
      eventType: parsed.eventType,
      observedAt: parsed.observedAt,
      classification: parsed.classification,
      region: parsed.region,
      version: parsed.version,
      rawPayload: parsed.rawPayload,
      extractedIndicators: parsed.extractedIndicators,
      risk: parsed.risk,
    };

    setCreateLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/incidents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      closeCreate();
      await fetchIncidents();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setCreateLoading(false);
    }
  };

  const btnStyle = (color: string, disabled?: boolean) => ({
    padding: '8px 16px',
    background: disabled ? '#2d3748' : color,
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: '13px',
    fontWeight: 600 as const,
  });

  return (
    <div style={{ padding: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h2 style={{ margin: 0, color: '#e2e8f0' }}>Incidents</h2>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={openCreate} style={btnStyle('#2ecc71')}>
            New Incident
          </button>
          <button onClick={fetchIncidents} style={btnStyle('#3182ce', loading)} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {loadError && (
        <div style={{ padding: '12px 16px', background: '#742a2a', borderRadius: '6px', color: '#fed7d7', marginBottom: '20px', fontSize: '14px' }}>
          Failed to load incidents: {loadError}
        </div>
      )}
      {deleteError && (
        <div style={{ padding: '12px 16px', background: '#742a2a', borderRadius: '6px', color: '#fed7d7', marginBottom: '20px', fontSize: '14px' }}>
          Failed to delete incident: {deleteError}
        </div>
      )}

      <div style={{ background: '#1a1a2e', border: '1px solid #2a2a4e', borderRadius: '8px', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #2a2a4e', textAlign: 'left' }}>
              <th style={{ padding: '10px 14px', color: '#718096', fontWeight: 600 }}>Event ID</th>
              <th style={{ padding: '10px 14px', color: '#718096', fontWeight: 600 }}>Type</th>
              <th style={{ padding: '10px 14px', color: '#718096', fontWeight: 600 }}>Severity</th>
              <th style={{ padding: '10px 14px', color: '#718096', fontWeight: 600 }}>Region</th>
              <th style={{ padding: '10px 14px', color: '#718096', fontWeight: 600 }}>Observed At</th>
              <th style={{ padding: '10px 14px', color: '#718096', fontWeight: 600 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {incidents?.map((incident) => (
              <tr key={incident.eventId} style={{ borderBottom: '1px solid #2a2a4e' }}>
                <td style={{ padding: '10px 14px', color: '#e2e8f0', fontFamily: 'monospace' }}>{incident.eventId}</td>
                <td style={{ padding: '10px 14px', color: '#e2e8f0' }}>{incident.eventType}</td>
                <td style={{ padding: '10px 14px' }}>
                  <span style={{
                    padding: '2px 8px', borderRadius: '9999px', fontSize: '11px', fontWeight: 700,
                    background: `${SEVERITY_COLORS[incident.risk?.severity] ?? '#718096'}33`,
                    color: SEVERITY_COLORS[incident.risk?.severity] ?? '#718096',
                  }}>
                    {(incident.risk?.severity ?? 'unknown').toUpperCase()}
                  </span>
                </td>
                <td style={{ padding: '10px 14px', color: '#a0aec0' }}>{incident.region}</td>
                <td style={{ padding: '10px 14px', color: '#a0aec0' }}>
                  {new Date(incident.observedAt).toLocaleString()}
                </td>
                <td style={{ padding: '10px 14px' }}>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={() => openEdit(incident)} style={btnStyle('#805ad5')}>
                      Edit
                    </button>
                    <button
                      onClick={() => deleteIncident(incident.eventId)}
                      disabled={deletingId === incident.eventId}
                      style={btnStyle('#e74c3c', deletingId === incident.eventId)}
                    >
                      {deletingId === incident.eventId ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {incidents && incidents.length === 0 && (
          <div style={{ padding: '24px', color: '#4a5568', fontSize: '13px', textAlign: 'center' }}>
            No incidents found.
          </div>
        )}
        {!incidents && !loadError && (
          <div style={{ padding: '24px', color: '#4a5568', fontSize: '13px', textAlign: 'center' }}>
            Loading incidents…
          </div>
        )}
      </div>

      {editing && form && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
          }}
          onClick={closeEdit}
        >
          <div
            style={{
              background: '#1a1a2e', border: '1px solid #2a2a4e', borderRadius: '8px',
              padding: '24px', width: '520px', maxHeight: '85vh', overflowY: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, color: '#e2e8f0', fontSize: '16px' }}>
                Edit Incident <span style={{ color: '#718096', fontFamily: 'monospace', fontSize: '13px' }}>{editing.eventId}</span>
              </h3>
              <button onClick={closeEdit} style={{ background: 'none', border: 'none', color: '#718096', fontSize: '18px', cursor: 'pointer' }}>
                ×
              </button>
            </div>

            <Field label="Event Type">
              <select
                style={inputStyle}
                value={form.eventType}
                onChange={(e) => setForm({ ...form, eventType: e.target.value })}
              >
                {EVENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>

            <Field label="Observed At">
              <input
                type="datetime-local"
                style={inputStyle}
                value={form.observedAt}
                onChange={(e) => setForm({ ...form, observedAt: e.target.value })}
              />
            </Field>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <Field label="Classification">
                <input style={inputStyle} value={form.classification} onChange={(e) => setForm({ ...form, classification: e.target.value })} />
              </Field>
              <Field label="Region">
                <input style={inputStyle} value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} />
              </Field>
            </div>

            <Field label="Version">
              <input style={inputStyle} value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} />
            </Field>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <Field label="Risk Score (0-100)">
                <input type="number" min={0} max={100} style={inputStyle} value={form.riskScore} onChange={(e) => setForm({ ...form, riskScore: e.target.value })} />
              </Field>
              <Field label="Risk Severity">
                <select style={inputStyle} value={form.riskSeverity} onChange={(e) => setForm({ ...form, riskSeverity: e.target.value })}>
                  {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
            </div>

            <Field label="Risk Reasons (comma-separated)">
              <input style={inputStyle} value={form.riskReasonsText} onChange={(e) => setForm({ ...form, riskReasonsText: e.target.value })} />
            </Field>

            <Field label="Raw Payload (JSON)">
              <textarea
                style={{ ...inputStyle, fontFamily: 'monospace', minHeight: '90px' }}
                value={form.rawPayloadText}
                onChange={(e) => setForm({ ...form, rawPayloadText: e.target.value })}
              />
            </Field>

            <Field label="Extracted Indicators (JSON array)">
              <textarea
                style={{ ...inputStyle, fontFamily: 'monospace', minHeight: '90px' }}
                value={form.extractedIndicatorsText}
                onChange={(e) => setForm({ ...form, extractedIndicatorsText: e.target.value })}
              />
            </Field>

            {actionError && (
              <div style={{ padding: '10px', background: '#742a2a', borderRadius: '6px', color: '#fed7d7', fontSize: '13px', marginBottom: '12px' }}>
                {actionError}
              </div>
            )}
            {actionMessage && (
              <div style={{ padding: '10px', background: '#22543d', borderRadius: '6px', color: '#9ae6b4', fontSize: '13px', marginBottom: '12px' }}>
                {actionMessage}
              </div>
            )}

            <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
              <button onClick={submitPatch} disabled={actionLoading !== null} style={btnStyle('#3182ce', actionLoading !== null)}>
                {actionLoading === 'patch' ? 'Saving…' : 'Save Changes (PATCH)'}
              </button>
              <button onClick={submitPut} disabled={actionLoading !== null} style={btnStyle('#805ad5', actionLoading !== null)}>
                {actionLoading === 'put' ? 'Replacing…' : 'Replace Incident (PUT)'}
              </button>
              <button
                onClick={() => deleteIncident(editing.eventId)}
                disabled={actionLoading !== null || deletingId === editing.eventId}
                style={btnStyle('#e74c3c', actionLoading !== null || deletingId === editing.eventId)}
              >
                {deletingId === editing.eventId ? 'Deleting…' : 'Delete (DELETE)'}
              </button>
            </div>
          </div>
        </div>
      )}

      {createForm && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
          }}
          onClick={closeCreate}
        >
          <div
            style={{
              background: '#1a1a2e', border: '1px solid #2a2a4e', borderRadius: '8px',
              padding: '24px', width: '520px', maxHeight: '85vh', overflowY: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, color: '#e2e8f0', fontSize: '16px' }}>New Incident</h3>
              <button onClick={closeCreate} style={{ background: 'none', border: 'none', color: '#718096', fontSize: '18px', cursor: 'pointer' }}>
                ×
              </button>
            </div>

            <Field label="Event ID">
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  style={inputStyle}
                  value={createForm.eventId}
                  onChange={(e) => setCreateForm({ ...createForm, eventId: e.target.value })}
                />
                <button
                  onClick={() => setCreateForm({ ...createForm, eventId: generateEventId() })}
                  style={{ ...btnStyle('#2d3748'), whiteSpace: 'nowrap' as const }}
                >
                  Generate
                </button>
              </div>
            </Field>

            <Field label="Event Type">
              <select
                style={inputStyle}
                value={createForm.eventType}
                onChange={(e) => setCreateForm({ ...createForm, eventType: e.target.value })}
              >
                {EVENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>

            <Field label="Observed At">
              <input
                type="datetime-local"
                style={inputStyle}
                value={createForm.observedAt}
                onChange={(e) => setCreateForm({ ...createForm, observedAt: e.target.value })}
              />
            </Field>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <Field label="Classification">
                <input style={inputStyle} value={createForm.classification} onChange={(e) => setCreateForm({ ...createForm, classification: e.target.value })} />
              </Field>
              <Field label="Region">
                <input style={inputStyle} value={createForm.region} onChange={(e) => setCreateForm({ ...createForm, region: e.target.value })} />
              </Field>
            </div>

            <Field label="Version">
              <input style={inputStyle} value={createForm.version} onChange={(e) => setCreateForm({ ...createForm, version: e.target.value })} />
            </Field>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <Field label="Risk Score (0-100)">
                <input type="number" min={0} max={100} style={inputStyle} value={createForm.riskScore} onChange={(e) => setCreateForm({ ...createForm, riskScore: e.target.value })} />
              </Field>
              <Field label="Risk Severity">
                <select style={inputStyle} value={createForm.riskSeverity} onChange={(e) => setCreateForm({ ...createForm, riskSeverity: e.target.value })}>
                  {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
            </div>

            <Field label="Risk Reasons (comma-separated)">
              <input style={inputStyle} value={createForm.riskReasonsText} onChange={(e) => setCreateForm({ ...createForm, riskReasonsText: e.target.value })} />
            </Field>

            <Field label="Raw Payload (JSON)">
              <textarea
                style={{ ...inputStyle, fontFamily: 'monospace', minHeight: '90px' }}
                value={createForm.rawPayloadText}
                onChange={(e) => setCreateForm({ ...createForm, rawPayloadText: e.target.value })}
              />
            </Field>

            <Field label="Extracted Indicators (JSON array)">
              <textarea
                style={{ ...inputStyle, fontFamily: 'monospace', minHeight: '90px' }}
                value={createForm.extractedIndicatorsText}
                onChange={(e) => setCreateForm({ ...createForm, extractedIndicatorsText: e.target.value })}
              />
            </Field>

            {createError && (
              <div style={{ padding: '10px', background: '#742a2a', borderRadius: '6px', color: '#fed7d7', fontSize: '13px', marginBottom: '12px' }}>
                {createError}
              </div>
            )}

            <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
              <button onClick={submitCreate} disabled={createLoading} style={btnStyle('#2ecc71', createLoading)}>
                {createLoading ? 'Creating…' : 'Create Incident (POST)'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
