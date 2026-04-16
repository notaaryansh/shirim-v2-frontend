import {
  useState, useEffect, useRef, useMemo, useCallback,
  type CSSProperties, type ReactNode,
} from 'react';
import {
  Plus, Play, Save, Trash2, ChevronLeft, Search, Zap, Bolt, Power,
  Check, Minus, Maximize2, GitBranch, AlertTriangle, Settings2,
  MousePointer2, Keyboard,
} from 'lucide-react';
import {
  getWorkflows, saveWorkflow, deleteWorkflow, createEmptyWorkflow,
  newNodeId, newEdgeId, PLACEHOLDER_APPS,
  type Workflow, type WorkflowNode, type NodeKind,
  type PlaceholderApp,
} from './workflows';
import { getInstalls, formatRelative, type InstalledEntry } from './installs';

/* ------------------------- CONSTANTS ------------------------- */

const NODE_WIDTH = 240;
const NODE_MIN_HEIGHT = 92;
const PORT_SIZE = 12;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 2.0;
// Gap between the bezier endpoint and the port circle, so the arrow head and
// the source dot don't visually crash into the ports. Tuned to just clear the
// 12px port circle plus the small arrow marker.
const EDGE_SOURCE_GAP = 8;
const EDGE_TARGET_GAP = 14;

/* ------------------------- LIBRARY ITEM TYPE ------------------------- */

type LibraryApp = {
  id: string;
  name: string;
  description: string;
  icon: string | null;
  supportsTrigger: boolean;
  supportsAction: boolean;
  isReal: boolean;                 // true if it comes from getInstalls(), false for fallback
  placeholder?: PlaceholderApp;    // present when isReal === false
};

/** Merge real installed apps with the placeholder catalog. Real apps win on id
 *  collisions. If nothing is installed at all, we return the placeholder set
 *  with a flag so the UI can show a subtle "Demo apps" label. */
function buildLibrary(installed: InstalledEntry[]): { apps: LibraryApp[]; isDemo: boolean } {
  if (installed.length === 0) {
    return {
      isDemo: true,
      apps: PLACEHOLDER_APPS.map(p => ({
        id: p.id,
        name: p.name,
        description: p.description,
        icon: null,
        supportsTrigger: p.supportsTrigger,
        supportsAction: p.supportsAction,
        isReal: false,
        placeholder: p,
      })),
    };
  }

  // Real apps — we can't know their trigger/action capabilities, so we make
  // every installed app available as both a trigger and an action. Users can
  // choose which kind when they drop it on the canvas.
  const real = installed.map<LibraryApp>(i => ({
    id: i.owner_repo,
    name: i.name,
    description: i.desc || i.result.summary || '—',
    icon: i.image_url,
    supportsTrigger: true,
    supportsAction: true,
    isReal: true,
  }));
  return { apps: real, isDemo: false };
}

/* ------------------------- MAIN EXPORT ------------------------- */

type View = { kind: 'list' } | { kind: 'canvas'; workflowId: string };

export default function WorkflowsPage() {
  const [view, setView] = useState<View>({ kind: 'list' });
  const [workflows, setWorkflows] = useState<Workflow[]>(() => getWorkflows());

  // Keep in sync with localStorage changes (e.g. after save in canvas view).
  useEffect(() => {
    const handler = () => setWorkflows(getWorkflows());
    window.addEventListener('shirim-workflows-changed', handler);
    return () => window.removeEventListener('shirim-workflows-changed', handler);
  }, []);

  const activeWorkflow = view.kind === 'canvas'
    ? workflows.find(w => w.id === view.workflowId) ?? null
    : null;

  const handleNewWorkflow = () => {
    const wf = createEmptyWorkflow('Untitled workflow');
    saveWorkflow(wf);
    setWorkflows(getWorkflows());
    setView({ kind: 'canvas', workflowId: wf.id });
  };

  const handleOpenWorkflow = (id: string) => setView({ kind: 'canvas', workflowId: id });
  const handleBack = () => setView({ kind: 'list' });

  const handleDelete = (id: string) => {
    deleteWorkflow(id);
    setWorkflows(getWorkflows());
    if (view.kind === 'canvas' && view.workflowId === id) setView({ kind: 'list' });
  };

  if (view.kind === 'canvas' && activeWorkflow) {
    return (
      <WorkflowCanvas
        key={activeWorkflow.id}
        workflow={activeWorkflow}
        onBack={handleBack}
        onDelete={() => handleDelete(activeWorkflow.id)}
      />
    );
  }

  if (view.kind === 'canvas' && !activeWorkflow) {
    // Workflow was deleted out from under us — bounce back to list.
    return <div />;
  }

  return (
    <WorkflowsListView
      workflows={workflows}
      onNew={handleNewWorkflow}
      onOpen={handleOpenWorkflow}
      onDelete={handleDelete}
    />
  );
}

/* ------------------------- LIST VIEW ------------------------- */

function WorkflowsListView({
  workflows,
  onNew,
  onOpen,
  onDelete,
}: {
  workflows: Workflow[];
  onNew: () => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return workflows;
    return workflows.filter(w =>
      w.name.toLowerCase().includes(q) ||
      w.description.toLowerCase().includes(q)
    );
  }, [workflows, query]);

  return (
    <div style={{ padding: '32px 40px 48px' }} className="fade-in">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: '28px' }}>
        <div>
          <h1 style={{ fontSize: '28px', fontWeight: 600, letterSpacing: '-0.02em', marginBottom: '8px', color: 'var(--text-primary)' }}>
            Workflows
          </h1>
          <p style={{ fontSize: '14px', color: 'var(--text-secondary)', maxWidth: '560px', lineHeight: 1.5 }}>
            Wire your installed apps together. When one fires, another responds — no glue code required.
          </p>
        </div>
        <PrimaryButton icon={<Plus size={16} />} onClick={onNew}>New workflow</PrimaryButton>
      </div>

      {/* Search pill */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '12px',
        backgroundColor: 'var(--surface-2)',
        border: `1px solid ${focused ? 'var(--accent)' : 'var(--border)'}`,
        boxShadow: focused ? '0 0 0 3px var(--accent-glow)' : 'none',
        borderRadius: '100px', padding: '12px 20px',
        transition: 'all 120ms ease-out',
        marginBottom: '28px',
      }}>
        <Search size={18} color="var(--text-muted)" />
        <input
          placeholder="search workflows..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            background: 'transparent', border: 'none', outline: 'none',
            color: 'var(--text-primary)', fontFamily: 'var(--font-pixel)',
            fontSize: '15px', width: '100%',
          }}
        />
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <EmptyState query={query} onNew={onNew} />
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
          gap: '16px',
        }}>
          {filtered.map(w => (
            <WorkflowCard key={w.id} workflow={w} onOpen={() => onOpen(w.id)} onDelete={() => onDelete(w.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState({ query, onNew }: { query: string; onNew: () => void }) {
  const hasQuery = query.trim().length > 0;
  return (
    <div className="fade-in" style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', padding: '80px 20px',
      border: '1px dashed var(--border)', borderRadius: '12px',
      backgroundColor: 'var(--surface)',
    }}>
      <div style={{
        width: '56px', height: '56px', borderRadius: '50%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backgroundColor: 'var(--surface-2)',
        color: 'var(--text-muted)',
        marginBottom: '20px',
      }}>
        <GitBranch size={24} />
      </div>
      <div style={{ fontSize: '16px', color: 'var(--text-primary)', marginBottom: '6px' }}>
        {hasQuery ? `No workflows match "${query}"` : 'No workflows yet'}
      </div>
      <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '20px', textAlign: 'center', maxWidth: '360px', lineHeight: 1.5 }}>
        {hasQuery
          ? 'Try a different search term or clear the filter.'
          : 'Create your first workflow to connect two or more installed apps.'}
      </div>
      {!hasQuery && <PrimaryButton icon={<Plus size={16} />} onClick={onNew}>Create workflow</PrimaryButton>}
    </div>
  );
}

function WorkflowCard({
  workflow,
  onOpen,
  onDelete,
}: {
  workflow: Workflow;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const nodeCount = workflow.nodes.length;
  const edgeCount = workflow.edges.length;

  return (
    <div
      className="glow-hover"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onOpen}
      style={{
        position: 'relative',
        backgroundColor: hovered ? 'var(--card-hover)' : 'var(--surface-2)',
        border: `1px solid ${hovered ? 'var(--border-active)' : 'var(--border)'}`,
        borderRadius: '12px',
        padding: '18px 20px 16px',
        cursor: 'pointer',
        transform: hovered ? 'translateY(-2px)' : 'translateY(0)',
        overflow: 'hidden',
      }}
    >
      {/* Header row: status + name + delete */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', marginBottom: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
          <StatusPill enabled={workflow.enabled} />
          <div style={{
            fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {workflow.name}
          </div>
        </div>
        <button
          onClick={e => { e.stopPropagation(); onDelete(); }}
          title="Delete workflow"
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'var(--text-muted)', padding: '4px', borderRadius: '4px',
            opacity: hovered ? 1 : 0,
            transition: 'opacity 120ms ease-out, color 120ms ease-out',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--error)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; }}
        >
          <Trash2 size={14} />
        </button>
      </div>

      {/* Description */}
      <div style={{
        fontSize: '12.5px', color: 'var(--text-secondary)', lineHeight: 1.5,
        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
        overflow: 'hidden', marginBottom: '16px', minHeight: '38px',
      }}>
        {workflow.description}
      </div>

      {/* Mini flow preview */}
      <MiniFlowPreview workflow={workflow} />

      {/* Footer */}
      <div style={{
        marginTop: '14px', paddingTop: '12px',
        borderTop: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        fontSize: '11.5px', color: 'var(--text-muted)',
      }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <GitBranch size={11} /> {nodeCount} {nodeCount === 1 ? 'step' : 'steps'}
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <Zap size={11} /> {edgeCount} {edgeCount === 1 ? 'link' : 'links'}
          </span>
        </span>
        <LastRunBadge workflow={workflow} />
      </div>
    </div>
  );
}

function StatusPill({ enabled }: { enabled: boolean }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '5px',
      padding: '2px 8px', borderRadius: '100px',
      fontSize: '10px', letterSpacing: '0.06em', textTransform: 'uppercase',
      backgroundColor: enabled ? 'var(--accent-glow)' : 'transparent',
      border: `1px solid ${enabled ? 'var(--running)' : 'var(--border)'}`,
      color: enabled ? 'var(--running)' : 'var(--text-muted)',
      flexShrink: 0,
    }}>
      <span style={{
        width: '6px', height: '6px', borderRadius: '50%',
        backgroundColor: enabled ? 'var(--running)' : 'var(--idle)',
        boxShadow: enabled ? '0 0 6px var(--running)' : 'none',
      }} />
      {enabled ? 'Enabled' : 'Paused'}
    </span>
  );
}

function LastRunBadge({ workflow }: { workflow: Workflow }) {
  if (workflow.last_run_status === 'never' || workflow.last_run_at === null) {
    return <span style={{ color: 'var(--text-muted)' }}>Never run</span>;
  }
  const isOk = workflow.last_run_status === 'success';
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
      {isOk ? <Check size={11} color="var(--running)" /> : <AlertTriangle size={11} color="var(--error)" />}
      <span style={{ color: isOk ? 'var(--text-secondary)' : 'var(--error)' }}>
        {formatRelative(workflow.last_run_at)}
      </span>
    </span>
  );
}

/** Compact preview of a workflow, shown on each card. Uses real HTML for boxes
 *  (so text renders at real font sizes) with an inline SVG behind for the dashed
 *  connector lines. Max 3 nodes. */
function MiniFlowPreview({ workflow }: { workflow: Workflow }) {
  const nodes = workflow.nodes.slice(0, 3);
  if (nodes.length === 0) {
    return (
      <div style={{
        height: '72px', borderRadius: '8px',
        border: '1px dashed var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--text-muted)', fontSize: '11px',
      }}>
        empty workflow
      </div>
    );
  }

  return (
    <div style={{
      position: 'relative',
      borderRadius: '8px',
      backgroundColor: 'var(--surface)',
      border: '1px solid var(--border)',
      padding: '12px 10px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '6px',
      overflow: 'hidden',
      minHeight: '72px',
    }}>
      {nodes.map((n, i) => (
        <div key={n.id} style={{ display: 'contents' }}>
          <MiniNode node={n} />
          {i < nodes.length - 1 && <MiniConnector />}
        </div>
      ))}
    </div>
  );
}

function MiniNode({ node }: { node: WorkflowNode }) {
  const dotColor = node.kind === 'trigger' ? 'var(--building)' : 'var(--accent)';
  return (
    <div style={{
      flex: '1 1 0',
      minWidth: 0,
      backgroundColor: 'var(--surface-2)',
      border: '1px solid var(--border-active)',
      borderRadius: '6px',
      padding: '6px 8px',
      display: 'flex',
      flexDirection: 'column',
      gap: '2px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '5px', minWidth: 0 }}>
        <span style={{
          width: '6px', height: '6px', borderRadius: '50%',
          backgroundColor: dotColor, flexShrink: 0,
        }} />
        <span style={{
          fontSize: '10.5px', color: 'var(--text-secondary)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {node.appName}
        </span>
      </div>
      <div style={{
        fontSize: '9px', color: 'var(--text-muted)',
        letterSpacing: '0.04em', textTransform: 'uppercase',
      }}>
        {node.kind}
      </div>
    </div>
  );
}

function MiniConnector() {
  return (
    <svg width="18" height="12" viewBox="0 0 18 12" style={{ flexShrink: 0 }}>
      <path
        d="M 1 6 L 17 6"
        stroke="var(--accent-dim)"
        strokeWidth={1.5}
        fill="none"
        className="wf-mini-flow"
      />
    </svg>
  );
}

/* ------------------------- CANVAS VIEW ------------------------- */

function WorkflowCanvas({
  workflow: initial,
  onBack,
  onDelete,
}: {
  workflow: Workflow;
  onBack: () => void;
  onDelete: () => void;
}) {
  const [workflow, setWorkflow] = useState<Workflow>(initial);
  const [dirty, setDirty] = useState(false);

  // Selection
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  // Viewport transform
  const [pan, setPan] = useState({ x: 40, y: 40 });
  const [zoom, setZoom] = useState(1);

  // Interaction state (refs so we don't thrash re-renders during drag)
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const interactionRef = useRef<
    | { kind: 'pan'; startScreenX: number; startScreenY: number; startPanX: number; startPanY: number }
    | { kind: 'drag-node'; nodeId: string; startScreenX: number; startScreenY: number; startNodeX: number; startNodeY: number }
    | { kind: 'connect'; fromNodeId: string; currentScreenX: number; currentScreenY: number }
    | null
  >(null);

  // Force-render helper for smooth drag/connect previews
  const [, setTick] = useState(0);
  const nudge = useCallback(() => setTick(t => (t + 1) % 1_000_000), []);

  // Measured node heights (keyed by node id). Updated via ResizeObserver attached
  // inside NodeBlock so connection endpoints always hit the port's real center,
  // regardless of how tall the node actually renders.
  const [nodeHeights, setNodeHeights] = useState<Record<string, number>>({});
  const reportNodeHeight = useCallback((nodeId: string, h: number) => {
    setNodeHeights(prev => prev[nodeId] === h ? prev : { ...prev, [nodeId]: h });
  }, []);
  const nodeHeightOf = (id: string) => nodeHeights[id] ?? NODE_MIN_HEIGHT;

  // Keyboard state
  const [spacePressed, setSpacePressed] = useState(false);

  // Library
  const [installed, setInstalled] = useState<InstalledEntry[]>(() => getInstalls());
  useEffect(() => {
    const handler = () => setInstalled(getInstalls());
    window.addEventListener('shirim-installs-changed', handler);
    return () => window.removeEventListener('shirim-installs-changed', handler);
  }, []);
  const library = useMemo(() => buildLibrary(installed), [installed]);

  /* ---- persistence ---- */

  const persist = useCallback((next: Workflow) => {
    saveWorkflow(next);
    setDirty(false);
  }, []);

  const mutate = useCallback((updater: (prev: Workflow) => Workflow) => {
    setWorkflow(prev => {
      const next = updater(prev);
      setDirty(true);
      return next;
    });
  }, []);

  /* ---- coordinate helpers ---- */

  const screenToCanvas = useCallback((screenX: number, screenY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const localX = screenX - rect.left;
    const localY = screenY - rect.top;
    return {
      x: (localX - pan.x) / zoom,
      y: (localY - pan.y) / zoom,
    };
  }, [pan, zoom]);

  /* ---- global mouse handlers (drag / pan / connect) ---- */

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      const op = interactionRef.current;
      if (!op) return;
      if (op.kind === 'pan') {
        setPan({
          x: op.startPanX + (e.clientX - op.startScreenX),
          y: op.startPanY + (e.clientY - op.startScreenY),
        });
      } else if (op.kind === 'drag-node') {
        const dx = (e.clientX - op.startScreenX) / zoom;
        const dy = (e.clientY - op.startScreenY) / zoom;
        const nextX = op.startNodeX + dx;
        const nextY = op.startNodeY + dy;
        mutate(w => ({
          ...w,
          nodes: w.nodes.map(n => n.id === op.nodeId ? { ...n, x: nextX, y: nextY } : n),
        }));
      } else if (op.kind === 'connect') {
        op.currentScreenX = e.clientX;
        op.currentScreenY = e.clientY;
        nudge();
      }
    };
    const onMouseUp = (e: MouseEvent) => {
      const op = interactionRef.current;
      if (!op) return;
      if (op.kind === 'connect') {
        // See if we landed on a node's input port via elementFromPoint.
        const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
        const targetNodeId = el?.closest<HTMLElement>('[data-node-id]')?.dataset.nodeId;
        const isInputPort = el?.closest<HTMLElement>('[data-port="input"]');
        if (targetNodeId && targetNodeId !== op.fromNodeId && isInputPort) {
          // Guard against duplicate edges
          mutate(w => {
            const exists = w.edges.some(x => x.from === op.fromNodeId && x.to === targetNodeId);
            if (exists) return w;
            return {
              ...w,
              edges: [...w.edges, { id: newEdgeId(), from: op.fromNodeId, to: targetNodeId }],
            };
          });
        }
      }
      interactionRef.current = null;
      nudge();
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [zoom, mutate, nudge]);

  /* ---- keyboard ---- */

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input/textarea
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;

      if (e.code === 'Space') { setSpacePressed(true); e.preventDefault(); }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedNodeId) {
          mutate(w => ({
            ...w,
            nodes: w.nodes.filter(n => n.id !== selectedNodeId),
            edges: w.edges.filter(ed => ed.from !== selectedNodeId && ed.to !== selectedNodeId),
          }));
          setSelectedNodeId(null);
        } else if (selectedEdgeId) {
          mutate(w => ({ ...w, edges: w.edges.filter(ed => ed.id !== selectedEdgeId) }));
          setSelectedEdgeId(null);
        }
      }
      if (e.key === '=' || e.key === '+') { setZoom(z => clamp(z + 0.1, MIN_ZOOM, MAX_ZOOM)); e.preventDefault(); }
      if (e.key === '-' || e.key === '_') { setZoom(z => clamp(z - 0.1, MIN_ZOOM, MAX_ZOOM)); e.preventDefault(); }
      if (e.key === '0') { setZoom(1); setPan({ x: 40, y: 40 }); }
      if (e.key === 'f' || e.key === 'F') { fitView(); }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpacePressed(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNodeId, selectedEdgeId, workflow]);

  const fitView = useCallback(() => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || workflow.nodes.length === 0) {
      setZoom(1);
      setPan({ x: 40, y: 40 });
      return;
    }
    const minX = Math.min(...workflow.nodes.map(n => n.x));
    const minY = Math.min(...workflow.nodes.map(n => n.y));
    const maxX = Math.max(...workflow.nodes.map(n => n.x + NODE_WIDTH));
    const maxY = Math.max(...workflow.nodes.map(n => n.y + NODE_MIN_HEIGHT));
    const contentW = maxX - minX;
    const contentH = maxY - minY;
    const padding = 80;
    const scaleX = (rect.width - padding * 2) / contentW;
    const scaleY = (rect.height - padding * 2) / contentH;
    const nextZoom = clamp(Math.min(scaleX, scaleY), MIN_ZOOM, MAX_ZOOM);
    setZoom(nextZoom);
    setPan({
      x: (rect.width - contentW * nextZoom) / 2 - minX * nextZoom,
      y: (rect.height - contentH * nextZoom) / 2 - minY * nextZoom,
    });
  }, [workflow.nodes]);

  /* ---- canvas mouse handlers ---- */

  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    // Only pan when clicking the canvas background (not a node / port), OR when space held, OR middle-click
    const target = e.target as HTMLElement;
    const clickedNode = target.closest('[data-node-id]');
    const clickedPort = target.closest('[data-port]');
    const isBackground = !clickedNode && !clickedPort;
    if (isBackground) {
      // Background click clears selection
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
    }
    if (e.button === 1 || spacePressed || isBackground) {
      interactionRef.current = {
        kind: 'pan',
        startScreenX: e.clientX,
        startScreenY: e.clientY,
        startPanX: pan.x,
        startPanY: pan.y,
      };
      e.preventDefault();
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      // Zoom to cursor
      e.preventDefault();
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const delta = -e.deltaY * 0.0015;
      const nextZoom = clamp(zoom * (1 + delta * 3), MIN_ZOOM, MAX_ZOOM);
      // Anchor math: canvas point under cursor stays fixed
      const wx = (cx - pan.x) / zoom;
      const wy = (cy - pan.y) / zoom;
      setPan({ x: cx - wx * nextZoom, y: cy - wy * nextZoom });
      setZoom(nextZoom);
    } else {
      // Pan via scroll
      e.preventDefault();
      setPan(p => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }));
    }
  };

  /* ---- node interactions ---- */

  const handleNodeMouseDown = (e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();
    const node = workflow.nodes.find(n => n.id === nodeId);
    if (!node) return;
    setSelectedNodeId(nodeId);
    setSelectedEdgeId(null);
    interactionRef.current = {
      kind: 'drag-node',
      nodeId,
      startScreenX: e.clientX,
      startScreenY: e.clientY,
      startNodeX: node.x,
      startNodeY: node.y,
    };
  };

  const handleOutputPortMouseDown = (e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();
    interactionRef.current = {
      kind: 'connect',
      fromNodeId: nodeId,
      currentScreenX: e.clientX,
      currentScreenY: e.clientY,
    };
    nudge();
  };

  const handleEdgeClick = (e: React.MouseEvent, edgeId: string) => {
    e.stopPropagation();
    setSelectedEdgeId(edgeId);
    setSelectedNodeId(null);
  };

  /* ---- add node from library ---- */

  const addNodeFromLibrary = (app: LibraryApp, kind: NodeKind, dropScreen?: { x: number; y: number }) => {
    // If we got a drop position, convert it; otherwise drop in the viewport center.
    const rect = canvasRef.current?.getBoundingClientRect();
    let canvasX = 120;
    let canvasY = 120;
    if (dropScreen && rect) {
      canvasX = (dropScreen.x - rect.left - pan.x) / zoom;
      canvasY = (dropScreen.y - rect.top - pan.y) / zoom;
    } else if (rect) {
      canvasX = (rect.width / 2 - pan.x) / zoom - NODE_WIDTH / 2;
      canvasY = (rect.height / 2 - pan.y) / zoom - NODE_MIN_HEIGHT / 2;
    }
    // Offset newer nodes a bit so they don't stack perfectly
    canvasX += Math.random() * 20 - 10;
    canvasY += Math.random() * 20 - 10;

    const ph = app.placeholder;
    const title = ph?.defaultTitle[kind] ?? (kind === 'trigger' ? `When ${app.name} fires` : `Run ${app.name}`);
    const subtitle = ph?.defaultSubtitle[kind] ?? '';
    const config = ph?.defaultConfig[kind] ?? {};

    const node: WorkflowNode = {
      id: newNodeId(),
      kind,
      appId: app.id,
      appName: app.name,
      appIcon: app.icon,
      title,
      subtitle,
      config: { ...config },
      x: canvasX,
      y: canvasY,
    };
    mutate(w => ({ ...w, nodes: [...w.nodes, node] }));
    setSelectedNodeId(node.id);
  };

  /* ---- toolbar actions ---- */

  const handleSave = () => persist(workflow);
  const handleToggleEnabled = () => mutate(w => ({ ...w, enabled: !w.enabled }));
  const handleRenameWorkflow = (name: string) => mutate(w => ({ ...w, name }));
  const handleTestRun = () => {
    // Purely simulated: flash the "last_run" state
    mutate(w => ({
      ...w,
      last_run_at: Date.now(),
      last_run_status: 'success',
    }));
  };

  /* ---- derived ---- */

  const selectedNode = selectedNodeId ? workflow.nodes.find(n => n.id === selectedNodeId) ?? null : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Toolbar */}
      <CanvasToolbar
        workflow={workflow}
        dirty={dirty}
        onBack={onBack}
        onRename={handleRenameWorkflow}
        onToggleEnabled={handleToggleEnabled}
        onTestRun={handleTestRun}
        onSave={handleSave}
        onDelete={onDelete}
      />

      {/* Body: library / canvas / inspector */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <NodeLibrary library={library} onAdd={(app, kind) => addNodeFromLibrary(app, kind)} />

        {/* Canvas */}
        <div
          ref={canvasRef}
          onMouseDown={handleCanvasMouseDown}
          onWheel={handleWheel}
          style={{
            flex: 1,
            position: 'relative',
            overflow: 'hidden',
            backgroundColor: 'var(--bg)',
            cursor: interactionRef.current?.kind === 'pan'
              ? 'grabbing'
              : spacePressed
                ? 'grab'
                : 'default',
          }}
        >
          {/* Dot grid background (scales w/ pan & zoom) */}
          <div
            className="wf-canvas-bg"
            style={{
              position: 'absolute', inset: 0,
              backgroundSize: `${20 * zoom}px ${20 * zoom}px`,
              backgroundPosition: `${pan.x}px ${pan.y}px`,
            }}
          />

          {/* Transformed content layer */}
          <div
            style={{
              position: 'absolute',
              left: 0, top: 0,
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: '0 0',
              width: 1, height: 1, // actual content is positioned absolutely inside
            }}
          >
            {/* SVG connection layer */}
            <svg
              style={{
                position: 'absolute', left: 0, top: 0,
                width: '4000px', height: '4000px',
                overflow: 'visible',
                pointerEvents: 'none',
              }}
            >
              <defs>
                <marker
                  id="wf-arrow" viewBox="0 0 10 10" refX="8" refY="5"
                  markerWidth="6" markerHeight="6" orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 Z" fill="var(--accent-dim)" />
                </marker>
                <marker
                  id="wf-arrow-active" viewBox="0 0 10 10" refX="8" refY="5"
                  markerWidth="6" markerHeight="6" orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 Z" fill="var(--accent)" />
                </marker>
              </defs>

              {/* Existing edges */}
              {workflow.edges.map(edge => {
                const from = workflow.nodes.find(n => n.id === edge.from);
                const to = workflow.nodes.find(n => n.id === edge.to);
                if (!from || !to) return null;
                const p1 = { x: from.x + NODE_WIDTH + EDGE_SOURCE_GAP, y: from.y + nodeHeightOf(from.id) / 2 };
                const p2 = { x: to.x - EDGE_TARGET_GAP, y: to.y + nodeHeightOf(to.id) / 2 };
                const path = bezierPath(p1, p2);
                const isActive = workflow.enabled && edge.id === selectedEdgeId;
                const isSelected = edge.id === selectedEdgeId;
                return (
                  <g key={edge.id} style={{ pointerEvents: 'auto', cursor: 'pointer' }}
                     onMouseDown={e => e.stopPropagation()}
                     onClick={e => handleEdgeClick(e, edge.id)}>
                    {/* invisible wide hit area */}
                    <path d={path} stroke="transparent" strokeWidth={18} fill="none" />
                    <path
                      d={path}
                      stroke={isSelected ? 'var(--accent)' : 'var(--accent-dim)'}
                      strokeWidth={isSelected ? 2.5 : 2}
                      fill="none"
                      markerEnd={`url(#${isActive || isSelected ? 'wf-arrow-active' : 'wf-arrow'})`}
                      className={isActive ? 'wf-connection wf-connection-active' : 'wf-connection'}
                    />
                  </g>
                );
              })}

              {/* Live preview edge while dragging a connection */}
              {interactionRef.current?.kind === 'connect' && (() => {
                const op = interactionRef.current;
                const from = workflow.nodes.find(n => n.id === op.fromNodeId);
                if (!from) return null;
                const p1 = { x: from.x + NODE_WIDTH + EDGE_SOURCE_GAP, y: from.y + nodeHeightOf(from.id) / 2 };
                const p2 = screenToCanvas(op.currentScreenX, op.currentScreenY);
                return (
                  <path
                    d={bezierPath(p1, p2)}
                    stroke="var(--accent)"
                    strokeWidth={2}
                    fill="none"
                    className="wf-connection"
                  />
                );
              })()}
            </svg>

            {/* Nodes */}
            {workflow.nodes.map(node => (
              <NodeBlock
                key={node.id}
                node={node}
                selected={node.id === selectedNodeId}
                enabled={workflow.enabled}
                onMouseDown={e => handleNodeMouseDown(e, node.id)}
                onPortMouseDown={e => handleOutputPortMouseDown(e, node.id)}
                onHeightChange={h => reportNodeHeight(node.id, h)}
              />
            ))}
          </div>

          {/* Empty-state hint overlay */}
          {workflow.nodes.length === 0 && (
            <div className="fade-in" style={{
              position: 'absolute', inset: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              pointerEvents: 'none',
            }}>
              <div style={{
                backgroundColor: 'var(--surface)',
                border: '1px dashed var(--border)',
                borderRadius: '12px',
                padding: '24px 32px',
                textAlign: 'center',
                maxWidth: '360px',
              }}>
                <MousePointer2 size={18} style={{ color: 'var(--text-muted)', marginBottom: '10px' }} />
                <div style={{ fontSize: '14px', color: 'var(--text-primary)', marginBottom: '6px' }}>
                  Empty canvas
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  Click an app in the left panel to drop it here. Wire outputs to inputs to connect them.
                </div>
              </div>
            </div>
          )}

          {/* Zoom controls */}
          <ZoomControls
            zoom={zoom}
            onZoomIn={() => setZoom(z => clamp(z + 0.1, MIN_ZOOM, MAX_ZOOM))}
            onZoomOut={() => setZoom(z => clamp(z - 0.1, MIN_ZOOM, MAX_ZOOM))}
            onReset={() => { setZoom(1); setPan({ x: 40, y: 40 }); }}
            onFit={fitView}
          />

          {/* Shortcut hint — compact icon that expands on hover */}
          <ShortcutHint />
        </div>

        <Inspector
          node={selectedNode}
          onConfigChange={(key, value) => {
            if (!selectedNode) return;
            mutate(w => ({
              ...w,
              nodes: w.nodes.map(n => n.id === selectedNode.id
                ? { ...n, config: { ...n.config, [key]: value } }
                : n),
            }));
          }}
          onTitleChange={(title) => {
            if (!selectedNode) return;
            mutate(w => ({
              ...w,
              nodes: w.nodes.map(n => n.id === selectedNode.id ? { ...n, title } : n),
            }));
          }}
          onSubtitleChange={(subtitle) => {
            if (!selectedNode) return;
            mutate(w => ({
              ...w,
              nodes: w.nodes.map(n => n.id === selectedNode.id ? { ...n, subtitle } : n),
            }));
          }}
          onDeleteNode={() => {
            if (!selectedNode) return;
            mutate(w => ({
              ...w,
              nodes: w.nodes.filter(n => n.id !== selectedNode.id),
              edges: w.edges.filter(ed => ed.from !== selectedNode.id && ed.to !== selectedNode.id),
            }));
            setSelectedNodeId(null);
          }}
        />
      </div>
    </div>
  );
}

/* ------------------------- CANVAS TOOLBAR ------------------------- */

function CanvasToolbar({
  workflow, dirty,
  onBack, onRename, onToggleEnabled, onTestRun, onSave, onDelete,
}: {
  workflow: Workflow;
  dirty: boolean;
  onBack: () => void;
  onRename: (name: string) => void;
  onToggleEnabled: () => void;
  onTestRun: () => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(workflow.name);
  useEffect(() => { setDraft(workflow.name); }, [workflow.name]);

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '14px 20px 14px 16px',
      borderBottom: '1px solid var(--border)',
      backgroundColor: 'var(--surface)',
      flexShrink: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
        <button onClick={onBack} title="Back to workflows"
                style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: 'var(--text-secondary)', padding: '6px', borderRadius: '6px',
                  display: 'flex', alignItems: 'center',
                }}
                onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.backgroundColor = 'var(--accent-glow)'; }}
                onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.backgroundColor = 'transparent'; }}>
          <ChevronLeft size={18} />
        </button>
        <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Workflows /</span>
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={() => { setEditing(false); if (draft.trim()) onRename(draft.trim()); else setDraft(workflow.name); }}
            onKeyDown={e => {
              if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); }
              if (e.key === 'Escape') { setDraft(workflow.name); setEditing(false); }
            }}
            style={{
              background: 'var(--surface-2)', border: '1px solid var(--accent)',
              borderRadius: '6px', padding: '4px 8px',
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-pixel)', fontSize: '15px', fontWeight: 600,
              outline: 'none', minWidth: '200px',
              boxShadow: '0 0 0 3px var(--accent-glow)',
            }}
          />
        ) : (
          <button onClick={() => setEditing(true)}
                  style={{
                    background: 'transparent', border: 'none', cursor: 'text',
                    color: 'var(--text-primary)', fontSize: '15px', fontWeight: 600,
                    padding: '4px 8px', borderRadius: '6px',
                    fontFamily: 'var(--font-pixel)', letterSpacing: '-0.01em',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--accent-glow)'; }}
                  onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; }}>
            {workflow.name}
          </button>
        )}
        {dirty && (
          <span style={{
            fontSize: '11px', color: 'var(--building)',
            display: 'flex', alignItems: 'center', gap: '4px',
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--building)' }} />
            unsaved
          </span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <ToggleChip
          icon={<Power size={13} />}
          label={workflow.enabled ? 'Enabled' : 'Paused'}
          active={workflow.enabled}
          onClick={onToggleEnabled}
        />
        <SecondaryButton icon={<Play size={13} />} onClick={onTestRun}>Test run</SecondaryButton>
        <SecondaryButton icon={<Trash2 size={13} />} onClick={() => {
          if (confirm(`Delete workflow "${workflow.name}"? This cannot be undone.`)) onDelete();
        }}>Delete</SecondaryButton>
        <PrimaryButton icon={<Save size={13} />} onClick={onSave}>Save</PrimaryButton>
      </div>
    </div>
  );
}

/* ------------------------- NODE LIBRARY ------------------------- */

function NodeLibrary({
  library,
  onAdd,
}: {
  library: { apps: LibraryApp[]; isDemo: boolean };
  onAdd: (app: LibraryApp, kind: NodeKind) => void;
}) {
  const triggerApps = library.apps.filter(a => a.supportsTrigger);
  const actionApps = library.apps.filter(a => a.supportsAction);

  return (
    <div style={{
      width: '240px', flexShrink: 0,
      backgroundColor: 'var(--surface)',
      borderRight: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
    }}>
      <div style={{ padding: '16px 16px 8px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontSize: '12px', color: 'var(--text-primary)', letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: '4px' }}>
          Node library
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
          {library.isDemo
            ? 'No apps installed yet — showing demo apps.'
            : `${library.apps.length} installed app${library.apps.length === 1 ? '' : 's'}.`}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
        <LibrarySection title="Triggers" subtitle="What kicks this off" icon={<Bolt size={12} />}>
          {triggerApps.map(app => (
            <LibraryItem key={`t-${app.id}`} app={app} kind="trigger" onAdd={() => onAdd(app, 'trigger')} />
          ))}
          {triggerApps.length === 0 && <EmptyLibraryGroup text="No trigger-capable apps" />}
        </LibrarySection>

        <LibrarySection title="Actions" subtitle="What happens next" icon={<Zap size={12} />}>
          {actionApps.map(app => (
            <LibraryItem key={`a-${app.id}`} app={app} kind="action" onAdd={() => onAdd(app, 'action')} />
          ))}
          {actionApps.length === 0 && <EmptyLibraryGroup text="No action-capable apps" />}
        </LibrarySection>
      </div>
    </div>
  );
}

function LibrarySection({ title, subtitle, icon, children }: { title: string; subtitle: string; icon: ReactNode; children: ReactNode }) {
  return (
    <div style={{ marginBottom: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 4px 8px' }}>
        <span style={{ color: 'var(--text-muted)', display: 'flex' }}>{icon}</span>
        <span style={{ fontSize: '11px', color: 'var(--text-secondary)', letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 600 }}>{title}</span>
        <span style={{ fontSize: '10px', color: 'var(--text-muted)', marginLeft: '4px' }}>{subtitle}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {children}
      </div>
    </div>
  );
}

function EmptyLibraryGroup({ text }: { text: string }) {
  return (
    <div style={{
      fontSize: '11px', color: 'var(--text-muted)',
      padding: '10px', border: '1px dashed var(--border)',
      borderRadius: '6px', textAlign: 'center',
    }}>
      {text}
    </div>
  );
}

function LibraryItem({ app, kind, onAdd }: { app: LibraryApp; kind: NodeKind; onAdd: () => void }) {
  const [hovered, setHovered] = useState(false);
  const dotColor = kind === 'trigger' ? 'var(--building)' : 'var(--accent)';

  return (
    <button
      onClick={onAdd}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="glow-hover"
      style={{
        width: '100%', textAlign: 'left', cursor: 'pointer',
        backgroundColor: hovered ? 'var(--card-hover)' : 'var(--surface-2)',
        border: `1px solid ${hovered ? 'var(--border-active)' : 'var(--border)'}`,
        borderRadius: '8px',
        padding: '10px 12px',
        display: 'flex', flexDirection: 'column', gap: '4px',
        fontFamily: 'var(--font-pixel)', color: 'var(--text-primary)',
        transform: hovered ? 'translateY(-1px)' : 'translateY(0)',
      }}
      title={`Click to add as ${kind}`}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{
          width: '8px', height: '8px', borderRadius: '50%',
          backgroundColor: dotColor, flexShrink: 0,
          boxShadow: hovered ? `0 0 6px ${dotColor}` : 'none',
          transition: 'box-shadow 140ms ease-out',
        }} />
        <span style={{ fontSize: '12.5px', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {app.name}
        </span>
        {!app.isReal && (
          <span style={{
            marginLeft: 'auto', fontSize: '9px', letterSpacing: '0.06em',
            color: 'var(--text-muted)', textTransform: 'uppercase',
          }}>
            demo
          </span>
        )}
      </div>
      <div style={{
        fontSize: '11px', color: 'var(--text-muted)', lineHeight: 1.4,
        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
      }}>
        {app.description}
      </div>
    </button>
  );
}

/* ------------------------- NODE BLOCK ------------------------- */

function NodeBlock({
  node, selected, enabled,
  onMouseDown, onPortMouseDown, onHeightChange,
}: {
  node: WorkflowNode;
  selected: boolean;
  enabled: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
  onPortMouseDown: (e: React.MouseEvent) => void;
  onHeightChange: (height: number) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const isTrigger = node.kind === 'trigger';
  const accentColor = isTrigger ? 'var(--building)' : 'var(--accent)';

  // Report our real rendered height so connection endpoints can anchor to the
  // port's true vertical center (port is positioned at `top: 50%` inside us).
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    onHeightChange(el.offsetHeight);
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const h = (entry.target as HTMLElement).offsetHeight;
        onHeightChange(h);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [onHeightChange]);

  return (
    <div
      ref={rootRef}
      data-node-id={node.id}
      onMouseDown={onMouseDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`wf-node ${enabled && isTrigger ? 'wf-node-enabled' : ''}`}
      style={{
        position: 'absolute',
        left: node.x,
        top: node.y,
        width: NODE_WIDTH,
        backgroundColor: 'var(--surface)',
        border: `1.5px solid ${selected ? 'var(--accent)' : hovered ? 'var(--border-active)' : 'var(--border)'}`,
        boxShadow: selected ? '0 0 0 3px var(--accent-glow), 0 8px 20px rgba(0,0,0,0.2)' : '0 2px 6px rgba(0,0,0,0.12)',
        borderRadius: '10px',
        padding: '12px 14px',
        cursor: 'grab',
        userSelect: 'none',
        color: 'var(--text-primary)',
        fontFamily: 'var(--font-pixel)',
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <span style={{
          padding: '2px 6px', borderRadius: '4px',
          fontSize: '9px', letterSpacing: '0.08em', textTransform: 'uppercase',
          backgroundColor: 'var(--surface-2)',
          border: `1px solid ${accentColor}`,
          color: accentColor,
          fontWeight: 600,
        }}>
          {node.kind}
        </span>
        {node.appIcon ? (
          <img src={node.appIcon} alt=""
               style={{ width: 16, height: 16, borderRadius: '3px', objectFit: 'cover' }} />
        ) : (
          <span style={{
            width: 16, height: 16, borderRadius: '3px',
            backgroundColor: 'var(--surface-2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-muted)',
          }}>
            {isTrigger ? <Bolt size={10} /> : <Zap size={10} />}
          </span>
        )}
        <span style={{
          fontSize: '11px', color: 'var(--text-secondary)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          flex: 1,
        }}>
          {node.appName}
        </span>
      </div>

      {/* Title */}
      <div style={{
        fontSize: '13.5px', fontWeight: 600, color: 'var(--text-primary)',
        marginBottom: '2px', lineHeight: 1.3,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {node.title || <span style={{ color: 'var(--text-muted)' }}>Untitled step</span>}
      </div>
      {node.subtitle && (
        <div style={{
          fontSize: '11px', color: 'var(--text-muted)', lineHeight: 1.4,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {node.subtitle}
        </div>
      )}

      {/* Input port (left) — actions accept input; triggers still render one for demo symmetry,
           but triggers shouldn't be used as targets (guarded in edge commit). */}
      {!isTrigger && (
        <div
          data-port="input"
          style={{
            position: 'absolute',
            left: -PORT_SIZE / 2,
            top: '50%',
            width: PORT_SIZE, height: PORT_SIZE,
            borderRadius: '50%',
            backgroundColor: 'var(--surface-2)',
            border: `2px solid ${accentColor}`,
            transform: 'translateY(-50%)',
          }}
          className="wf-port"
        />
      )}

      {/* Output port (right) */}
      <div
        data-port="output"
        onMouseDown={onPortMouseDown}
        style={{
          position: 'absolute',
          right: -PORT_SIZE / 2,
          top: '50%',
          width: PORT_SIZE, height: PORT_SIZE,
          borderRadius: '50%',
          backgroundColor: accentColor,
          border: '2px solid var(--surface)',
          transform: 'translateY(-50%)',
          cursor: 'crosshair',
        }}
        className="wf-port"
      />
    </div>
  );
}

/* ------------------------- INSPECTOR ------------------------- */

function Inspector({
  node,
  onConfigChange,
  onTitleChange,
  onSubtitleChange,
  onDeleteNode,
}: {
  node: WorkflowNode | null;
  onConfigChange: (key: string, value: string) => void;
  onTitleChange: (v: string) => void;
  onSubtitleChange: (v: string) => void;
  onDeleteNode: () => void;
}) {
  return (
    <div style={{
      width: '320px', flexShrink: 0,
      backgroundColor: 'var(--surface)',
      borderLeft: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
    }}>
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Settings2 size={14} style={{ color: 'var(--text-muted)' }} />
        <span style={{ fontSize: '12px', color: 'var(--text-primary)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          Inspector
        </span>
      </div>

      {!node ? (
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          padding: '24px', textAlign: 'center',
          color: 'var(--text-muted)',
        }}>
          <MousePointer2 size={18} style={{ marginBottom: '10px' }} />
          <div style={{ fontSize: '12px', lineHeight: 1.5 }}>
            Select a node on the canvas to configure it.
          </div>
        </div>
      ) : (
        <div key={node.id} className="fade-in" style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
          {/* Node summary */}
          <div style={{ marginBottom: '18px' }}>
            <div style={{
              fontSize: '10px', color: 'var(--text-muted)', letterSpacing: '0.08em',
              textTransform: 'uppercase', marginBottom: '4px',
            }}>
              {node.kind} · {node.appName}
            </div>
            <InspectorInput label="Title" value={node.title} onChange={onTitleChange} />
            <div style={{ height: '10px' }} />
            <InspectorInput label="Subtitle" value={node.subtitle} onChange={onSubtitleChange} />
          </div>

          {/* Config block */}
          <div style={{
            fontSize: '11px', color: 'var(--text-secondary)', letterSpacing: '0.06em',
            textTransform: 'uppercase', marginBottom: '10px',
          }}>
            Configuration
          </div>
          {Object.keys(node.config).length === 0 ? (
            <div style={{
              fontSize: '11px', color: 'var(--text-muted)',
              border: '1px dashed var(--border)', borderRadius: '6px',
              padding: '12px', textAlign: 'center',
            }}>
              This app has no configurable fields.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {Object.entries(node.config).map(([key, value]) => (
                <InspectorInput
                  key={key}
                  label={key}
                  value={value}
                  multiline={key.toLowerCase().includes('body') || key.toLowerCase().includes('message')}
                  onChange={v => onConfigChange(key, v)}
                />
              ))}
            </div>
          )}

          {/* Delete */}
          <button
            onClick={onDeleteNode}
            style={{
              marginTop: '22px', width: '100%',
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              padding: '8px 12px',
              color: 'var(--text-secondary)',
              fontFamily: 'var(--font-pixel)', fontSize: '12px',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
              transition: 'all 120ms ease-out',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--error)'; e.currentTarget.style.borderColor = 'var(--error)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.borderColor = 'var(--border)'; }}
          >
            <Trash2 size={12} /> Remove node
          </button>
        </div>
      )}
    </div>
  );
}

function InspectorInput({
  label, value, onChange, multiline,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const style: CSSProperties = {
    width: '100%',
    backgroundColor: 'var(--surface-2)',
    border: `1px solid ${focused ? 'var(--accent)' : 'var(--border)'}`,
    boxShadow: focused ? '0 0 0 3px var(--accent-glow)' : 'none',
    borderRadius: '6px',
    padding: '8px 10px',
    color: 'var(--text-primary)',
    fontFamily: 'var(--font-pixel)',
    fontSize: '12px',
    outline: 'none',
    transition: 'all 120ms ease-out',
    resize: 'vertical',
  };
  return (
    <label style={{ display: 'block' }}>
      <span style={{
        display: 'block', fontSize: '10px', color: 'var(--text-muted)',
        marginBottom: '4px', letterSpacing: '0.04em',
      }}>{label}</span>
      {multiline ? (
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          rows={3}
          style={{ ...style, minHeight: '60px', lineHeight: 1.4 }}
        />
      ) : (
        <input
          value={value}
          onChange={e => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={style}
        />
      )}
    </label>
  );
}

/* ------------------------- ZOOM CONTROLS ------------------------- */

function ZoomControls({
  zoom, onZoomIn, onZoomOut, onReset, onFit,
}: {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  onFit: () => void;
}) {
  const btnStyle: CSSProperties = {
    width: 30, height: 30,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    color: 'var(--text-secondary)',
    borderRadius: '6px',
    cursor: 'pointer',
    transition: 'all 120ms ease-out',
  };
  return (
    <div style={{
      position: 'absolute', right: 16, bottom: 16,
      display: 'flex', alignItems: 'center', gap: '6px',
      padding: '6px',
      backgroundColor: 'var(--surface-2)',
      border: '1px solid var(--border)',
      borderRadius: '8px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
    }}>
      <button onClick={onZoomOut} title="Zoom out" style={btnStyle}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.borderColor = 'var(--border-active)'; }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.borderColor = 'var(--border)'; }}>
        <Minus size={14} />
      </button>
      <button onClick={onReset} title="Reset zoom (0)" style={{
        ...btnStyle, width: 'auto', padding: '0 10px',
        fontFamily: 'var(--font-pixel)', fontSize: '12px',
        color: 'var(--text-primary)',
      }}>
        {Math.round(zoom * 100)}%
      </button>
      <button onClick={onZoomIn} title="Zoom in" style={btnStyle}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.borderColor = 'var(--border-active)'; }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.borderColor = 'var(--border)'; }}>
        <Plus size={14} />
      </button>
      <button onClick={onFit} title="Fit to view (F)" style={btnStyle}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.borderColor = 'var(--border-active)'; }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.borderColor = 'var(--border)'; }}>
        <Maximize2 size={13} />
      </button>
    </div>
  );
}

/* ------------------------- SHARED UI BITS ------------------------- */

function PrimaryButton({
  children, onClick, icon,
}: {
  children: ReactNode;
  onClick: () => void;
  icon?: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '6px',
        padding: '8px 14px',
        background: 'linear-gradient(135deg, var(--accent) 0%, var(--accent-2) 100%)',
        color: 'var(--on-accent)',
        border: 'none',
        borderRadius: '8px',
        fontFamily: 'var(--font-pixel)', fontSize: '12.5px', fontWeight: 600,
        cursor: 'pointer',
        transition: 'opacity 120ms ease-out, transform 120ms ease-out',
      }}
      onMouseEnter={e => { e.currentTarget.style.opacity = '0.88'; }}
      onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
    >
      {icon}
      {children}
    </button>
  );
}

function SecondaryButton({
  children, onClick, icon,
}: {
  children: ReactNode;
  onClick: () => void;
  icon?: ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '6px',
        padding: '7px 12px',
        backgroundColor: hovered ? 'var(--accent-glow)' : 'transparent',
        color: hovered ? 'var(--text-primary)' : 'var(--text-secondary)',
        border: `1px solid ${hovered ? 'var(--border-active)' : 'var(--border)'}`,
        borderRadius: '6px',
        fontFamily: 'var(--font-pixel)', fontSize: '12px',
        cursor: 'pointer',
        transition: 'all 120ms ease-out',
      }}
    >
      {icon}
      {children}
    </button>
  );
}

function ToggleChip({
  icon, label, active, onClick,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '6px',
        padding: '7px 12px',
        backgroundColor: active ? 'var(--accent-glow)' : 'transparent',
        color: active ? 'var(--running)' : 'var(--text-secondary)',
        border: `1px solid ${active ? 'var(--running)' : 'var(--border)'}`,
        borderRadius: '100px',
        fontFamily: 'var(--font-pixel)', fontSize: '11.5px',
        cursor: 'pointer',
        transition: 'all 120ms ease-out',
        letterSpacing: '0.02em',
      }}
    >
      {icon}
      {label}
    </button>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd style={{
      fontFamily: 'var(--font-pixel)',
      fontSize: '10px',
      color: 'var(--text-secondary)',
      backgroundColor: 'var(--surface-2)',
      border: '1px solid var(--border)',
      borderRadius: '3px',
      padding: '1px 5px',
      margin: '0 1px',
    }}>{children}</kbd>
  );
}

/** Compact keyboard-shortcut hint pinned to the bottom-left of the canvas.
 *  Collapsed state: small icon badge. Hover / focus: expands upward into a
 *  panel listing all shortcuts. Fixes overlap with the zoom controls. */
function ShortcutHint() {
  const [open, setOpen] = useState(false);
  return (
    <div
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      style={{
        position: 'absolute', left: 16, bottom: 16,
        display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
        gap: '6px',
      }}
    >
      {/* Expanded panel */}
      <div
        className="fade-in"
        style={{
          display: open ? 'flex' : 'none',
          flexDirection: 'column', gap: '6px',
          padding: '10px 12px',
          fontSize: '11px', color: 'var(--text-secondary)',
          backgroundColor: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
          whiteSpace: 'nowrap',
        }}
      >
        <ShortcutRow label="Pan"><Kbd>space</Kbd>+drag · middle-click</ShortcutRow>
        <ShortcutRow label="Zoom"><Kbd>⌘</Kbd>+scroll · <Kbd>+</Kbd> <Kbd>-</Kbd></ShortcutRow>
        <ShortcutRow label="Fit view"><Kbd>F</Kbd></ShortcutRow>
        <ShortcutRow label="Reset view"><Kbd>0</Kbd></ShortcutRow>
        <ShortcutRow label="Delete"><Kbd>del</Kbd> · <Kbd>⌫</Kbd></ShortcutRow>
      </div>

      {/* Collapsed badge */}
      <div
        style={{
          display: 'inline-flex', alignItems: 'center', gap: '6px',
          fontSize: '11px', color: open ? 'var(--text-primary)' : 'var(--text-muted)',
          backgroundColor: 'var(--surface)',
          border: `1px solid ${open ? 'var(--border-active)' : 'var(--border)'}`,
          borderRadius: '6px', padding: '5px 9px',
          cursor: 'help',
          transition: 'all 120ms ease-out',
          userSelect: 'none',
        }}
      >
        <Keyboard size={12} /> shortcuts
      </div>
    </div>
  );
}

function ShortcutRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: '200px' }}>
      <span style={{
        flex: '0 0 70px',
        fontSize: '10px',
        color: 'var(--text-muted)',
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
      }}>{label}</span>
      <span style={{ display: 'flex', alignItems: 'center' }}>{children}</span>
    </div>
  );
}

/* ------------------------- GEOMETRY HELPERS ------------------------- */

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function bezierPath(p1: { x: number; y: number }, p2: { x: number; y: number }): string {
  const dx = Math.max(40, Math.abs(p2.x - p1.x) * 0.5);
  const c1x = p1.x + dx;
  const c2x = p2.x - dx;
  return `M ${p1.x} ${p1.y} C ${c1x} ${p1.y}, ${c2x} ${p2.y}, ${p2.x} ${p2.y}`;
}

/* Re-export types for potential callers */
export type { Workflow };
