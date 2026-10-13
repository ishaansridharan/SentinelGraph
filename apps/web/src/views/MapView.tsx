import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, Maximize, Minimize, X } from 'lucide-react';
import {
  api, type CampaignMap, type CampaignStory, type CaseFile, type EntityExplanation, type GEdge, type GNode,
  type RelationshipExplanation, type StoryRef,
} from '../lib/api';
import { useSchema } from '../lib/schema';
import { metaFor } from '../theme/graphColors';
import GraphCanvas from '../components/GraphCanvas';
import ContextPanel from '../components/ContextPanel';
import { Spinner } from '../components/ui';

type Explain =
  | { kind: 'edge'; id: string; data: RelationshipExplanation | null }
  | { kind: 'node'; node: GNode; data: EntityExplanation | null }
  | null;

/**
 * The attack map. "All campaigns" shows every campaign as a lane; picking one
 * narrows the map to it and walks through the attack step by step. Clicking
 * any card or arrow explains it in plain language.
 */
export default function MapView() {
  const [params, setParams] = useSearchParams();
  const { version } = useSchema();
  const storyKey = params.get('story');
  const [map, setMap] = useState<CampaignMap | null>(null);
  const [cases, setCases] = useState<CaseFile[]>([]);
  const [story, setStory] = useState<CampaignStory | null>(null);
  const [step, setStep] = useState(0);
  const [explain, setExplain] = useState<Explain>(null);
  const [details, setDetails] = useState<GNode | null>(null);
  const [full, setFull] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { api.cases().then(setCases).catch(() => {}); }, [version]);

  useEffect(() => {
    setErr(null);
    setMap(null);
    setExplain(null);
    setDetails(null);
    setStep(0);
    api.map(storyKey ? [storyKey] : undefined).then(setMap).catch((e) => setErr(e.message));
    if (storyKey) api.campaignStory(storyKey).then(setStory).catch(() => setStory(null));
    else setStory(null);
  }, [storyKey, version]);

  // Full-screen mode hides the app chrome; Esc leaves it
  useEffect(() => {
    document.body.classList.toggle('focus-mode', full);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setFull(false);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); document.body.classList.remove('focus-mode'); };
  }, [full]);

  const campaigns = useMemo(
    () => cases.flatMap((c) => c.campaigns).filter((c, i, a) => a.findIndex((x) => x.key === c.key) === i),
    [cases],
  );
  const caseFor = (k: string) => cases.find((c) => c.campaignIds.length === 1 && c.campaignIds[0] === k);

  const current = story?.story[step];
  const highlight = useMemo(() => (current?.entityKeys ? new Set(current.entityKeys) : null), [current]);
  // Zoom to the current story step once the walkthrough has started, or to a clicked card and its neighbours
  const [zoomTo, setZoomTo] = useState<Set<string> | null>(null);
  useEffect(() => { if (story && step > 0 && highlight) setZoomTo(highlight); }, [story, step, highlight]);

  const selectNode = (n: GNode | null) => {
    setDetails(null);
    if (!n) { setExplain(null); return; }
    setExplain({ kind: 'node', node: n, data: null });
    if (map) {
      const near = new Set([n.key]);
      map.edges.forEach((e) => {
        const other = e.source === n.id ? e.target : e.target === n.id ? e.source : null;
        const o = other && map.nodes.find((x) => x.id === other);
        if (o) near.add(o.key);
      });
      setZoomTo(near);
    }
    api.explainEntity(n.key).then((data) => setExplain({ kind: 'node', node: n, data })).catch(() => {});
  };
  const selectEdge = (e: GEdge) => {
    setDetails(null);
    setExplain({ kind: 'edge', id: e.id, data: null });
    api.explainRelationship(e.id).then((data) => setExplain({ kind: 'edge', id: e.id, data })).catch(() => setExplain(null));
  };
  const jumpTo = (ref: StoryRef) => {
    if (ref.campaignKey !== storyKey) setParams({ story: ref.campaignKey });
    setTimeout(() => setStep(ref.index - 1), ref.campaignKey !== storyKey ? 400 : 0);
    setExplain(null);
  };

  return (
    <div className="story-map">
      <div className="story-bar">
        <div className="seg">
          <button className={!storyKey ? 'on' : ''} onClick={() => setParams({})}>All campaigns</button>
          {campaigns.map((c) => (
            <button key={c.key} className={storyKey === c.key ? 'on' : ''} onClick={() => setParams({ story: c.key })}>{c.name}</button>
          ))}
        </div>
        <span className="spacer" />
        <span className="faint" style={{ fontSize: 12 }}>Scroll to zoom · drag to move</span>
        <span className="legend-inline">
          <span><i className="sw hit" />hit</span>
          <span><i className="sw exposed" />exposed, not hit</span>
          <span><i className="sw shared" />shared between campaigns</span>
        </span>
        <button className="btn ghost sm" onClick={() => setFull((f) => !f)} title={full ? 'Exit full screen (Esc)' : 'Full screen'}>
          {full ? <Minimize size={14} /> : <Maximize size={14} />} {full ? 'Exit' : 'Full screen'}
        </button>
      </div>

      <div className="story-body">
        <div className="story-canvas">
          {err && <div className="empty"><div className="error-box" style={{ display: 'inline-block' }}>{err}</div></div>}
          {!map && !err && <div className="empty" style={{ paddingTop: 120 }}><Spinner /></div>}
          {map && (
            <GraphCanvas
              layout="lanes"
              lanes={map.lanes}
              nodes={map.nodes}
              edges={map.edges}
              selectedId={explain?.kind === 'node' ? explain.node.id : null}
              onSelect={selectNode}
              onEdgeSelect={selectEdge}
              selectedEdgeId={explain?.kind === 'edge' ? explain.id : null}
              highlight={explain ? null : highlight}
              onOpenLane={(lane) => setParams({ story: lane.campaigns[0] })}
              labelThreshold={0}
              minFitZoom={storyKey ? 0 : 0.62}
              maxZoom={storyKey ? 1 : 0.9}
              zoomTo={zoomTo}
              minimap
            />
          )}
          {!explain && !storyKey && map && (
            <div className="canvas-hint">Pick a campaign above to walk through the attack. Click any card or arrow to have it explained.</div>
          )}
        </div>

        <aside className="story-panel">
          {details ? (
            <>
              <button className="btn ghost sm" style={{ margin: '10px 10px 0' }} onClick={() => setDetails(null)}><ArrowLeft size={13} /> Back to explanation</button>
              <ContextPanel entityKey={details.key} onNavigate={(n) => selectNode(n)} onDeleted={() => setDetails(null)} />
            </>
          ) : explain ? (
            <ExplainPanel explain={explain} onClose={() => setExplain(null)} onJump={jumpTo} onDetails={setDetails} />
          ) : story ? (
            <StoryPanel story={story} step={step} setStep={setStep} caseId={caseFor(story.key)?.id} />
          ) : (
            <Overview campaigns={campaigns} cases={cases} onPick={(k) => setParams({ story: k })} />
          )}
        </aside>
      </div>
    </div>
  );
}

function StoryPanel({ story, step, setStep, caseId }: { story: CampaignStory; step: number; setStep: (n: number) => void; caseId?: string }) {
  const s = story.story[step];
  return (
    <div className="panel-scroll">
      <div className="eyebrow">Campaign · {story.status}</div>
      <h2 className="panel-title">{story.name}</h2>
      {story.actor && <div className="muted" style={{ fontSize: 13 }}>Run by <strong style={{ color: 'var(--text)' }}>{story.actor.name}</strong>, {story.actor.alias}</div>}
      <p className="panel-text">{story.summary}</p>

      <div className="steps-head">
        <span>How the attack unfolds</span>
        <span className="row" style={{ gap: 4 }}>
          <button className="btn icon sm" disabled={step === 0} onClick={() => setStep(step - 1)} aria-label="Previous step"><ChevronLeft size={15} /></button>
          <span className="mono faint" style={{ fontSize: 11.5, minWidth: 34, textAlign: 'center' }}>{step + 1}/{story.story.length}</span>
          <button className="btn icon sm" disabled={step === story.story.length - 1} onClick={() => setStep(step + 1)} aria-label="Next step"><ChevronRight size={15} /></button>
        </span>
      </div>
      <ol className="steps">
        {story.story.map((st, i) => (
          <li key={i} className={i === step ? 'on' : ''} onClick={() => setStep(i)}>
            <span className="step-n">{i + 1}</span>
            <div>
              <div className="step-stage">{st.stage}</div>
              <div className="step-title">{st.title}</div>
              {i === step && <div className="step-text">{s.text}</div>}
            </div>
          </li>
        ))}
      </ol>

      {story.realWorld && (
        <div className="callout">
          <div className="eyebrow" style={{ marginBottom: 4 }}>Real-world parallel</div>
          {story.realWorld}
        </div>
      )}
      {caseId && <Link to={`/cases/${caseId}`} className="btn sm" style={{ marginTop: 14 }}>Open the case file <ArrowRight size={13} /></Link>}
    </div>
  );
}

function ExplainPanel({ explain, onClose, onJump, onDetails }: {
  explain: NonNullable<Explain>; onClose: () => void; onJump: (r: StoryRef) => void; onDetails: (n: GNode) => void;
}) {
  const header = (eyebrow: string, title: string) => (
    <div className="row" style={{ alignItems: 'flex-start' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="eyebrow">{eyebrow}</div>
        <h2 className="panel-title">{title}</h2>
      </div>
      <button className="btn ghost icon sm" onClick={onClose} aria-label="Close"><X size={15} /></button>
    </div>
  );
  if (!explain.data) return <div className="panel-scroll"><Spinner /></div>;
  const steps = explain.data.steps;
  return (
    <div className="panel-scroll">
      {explain.kind === 'edge' ? (
        <>
          {header('Relationship', explain.data.type.replace(/_/g, ' ').toLowerCase())}
          <div className="rel-ends">
            <span><i style={{ background: metaFor(explain.data.from.label).color }} />{explain.data.from.name}</span>
            <ArrowRight size={13} className="faint" />
            <span><i style={{ background: metaFor(explain.data.to.label).color }} />{explain.data.to.name}</span>
          </div>
          <p className="panel-text">{explain.data.sentence}</p>
          <div className="kv" style={{ marginTop: 6 }}>
            <div>Confidence</div><div>{explain.data.evidence.confidence != null ? `${Math.round(explain.data.evidence.confidence * 100)}%` : '—'}</div>
            <div>Evidence from</div><div>{explain.data.evidence.source ?? '—'}</div>
            {explain.data.evidence.firstSeen && <><div>Seen</div><div>{explain.data.evidence.firstSeen}</div></>}
          </div>
        </>
      ) : (
        <>
          {header(metaFor(explain.data.label).singular, explain.data.name)}
          {explain.data.title && <div style={{ fontWeight: 500, marginTop: 2 }}>{explain.data.title}</div>}
          <p className="panel-text">{explain.data.text}</p>
          <button className="btn sm" onClick={() => onDetails(explain.node)}>Properties and connections</button>
        </>
      )}
      {steps.length > 0 && (
        <>
          <div className="steps-head" style={{ marginTop: 20 }}><span>Where this fits in the attack</span></div>
          {steps.map((r, i) => (
            <button key={i} className="step-ref" onClick={() => onJump(r)}>
              <div className="step-stage">{r.campaign} · step {r.index} of {r.of} · {r.stage}</div>
              <div className="step-title">{r.title}</div>
              <div className="step-text">{r.text}</div>
            </button>
          ))}
        </>
      )}
    </div>
  );
}

function Overview({ campaigns, cases, onPick }: { campaigns: CaseFile['campaigns']; cases: CaseFile[]; onPick: (k: string) => void }) {
  return (
    <div className="panel-scroll">
      <div className="eyebrow">Attack map</div>
      <h2 className="panel-title">Four campaigns, one shared link</h2>
      <p className="panel-text">
        Each band is one campaign, read left to right: who is behind it, the campaign, the tools and flaws it uses,
        its websites and servers, and the organisations it hits. The dashed band holds infrastructure used by two
        different campaigns, which is how analysts spot groups working together.
      </p>
      <div className="steps-head" style={{ marginTop: 18 }}><span>Walk through a campaign</span></div>
      {campaigns.map((c) => {
        const cs = cases.find((x) => x.campaignIds.length === 1 && x.campaignIds[0] === c.key);
        return (
          <button key={c.key} className="step-ref" onClick={() => onPick(c.key)}>
            <div className="step-title">{c.name}</div>
            <div className="step-text">{cs?.summary}</div>
          </button>
        );
      })}
    </div>
  );
}
