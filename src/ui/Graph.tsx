// ═══════════════════════════════════════════════════════════════════════════
// Graph — React Flow canvas with elkjs layered auto-layout and a
// click-to-inspect sidebar. The graph data + live state are supplied by App
// (which owns the single useGraph() call) so we never double-fetch.
//
// Performance contract: layout re-runs ONLY when the set of node ids or edge
// endpoints changes. Status-only updates don't trigger a re-layout (they just
// re-render the affected node component, via React Flow's per-node
// memoization in BaseNode).
//
// kindStyle injection: kinds are dynamic, so every React Flow node uses the
// single type 'hv' and we inject the resolved KindStyle into each node's
// `data.kindStyle` here (BaseNode reads it directly). `data.status` is passed
// through likewise so PulseRing can read it.
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type ReactFlowInstance,
  useNodesState,
  useEdgesState,
  Panel,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { layoutNodes, layoutKey, type PositionedNode } from './lib/layout';
import { NODE_TYPES } from './nodes';
import { formatAgo, STATUS_TONE } from '@core/styles';
import type { HvNode, HvEdge, HvGroup, HarnessGraph, EdgeKind, KindStyle } from '@core/types';
import Sidebar from './components/Sidebar';
import { useCollapseState, GroupToggles } from './components/GroupCollapse';
import { RefreshCw, AlertTriangle, Wifi, WifiOff, ChevronDown, ChevronRight } from 'lucide-react';

const MINIMAP_WIDTH = 200;
const MINIMAP_HEIGHT = 140;
// Mobile breakpoint — matches Tailwind's `md:` (768px). Below this we shrink
// the inspector Panel into a collapsed-by-default disclosure, drop the
// minimap (steals too much real estate on a phone), and let the elkjs layout
// fit at a lower maxZoom so the full chart is visible on first paint.
const MOBILE_MAX_PX = 768;

interface Props {
  data: HarnessGraph | undefined;
  error: unknown;
  isLoading: boolean;
  refresh: () => Promise<void> | void;
  /** true while the SSE stream is open (drives the "live" indicator). */
  live: boolean;
}

/**
 * useIsSmallViewport — true when window.innerWidth < MOBILE_MAX_PX.
 * Subscribes to matchMedia changes so a rotation / resize re-renders the
 * canvas with the right options.
 */
function useIsSmallViewport(): boolean {
  const [small, setSmall] = useState<boolean>(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia(`(max-width: ${MOBILE_MAX_PX - 1}px)`);
    const update = () => setSmall(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return small;
}

interface FilteredView {
  visibleNodes: HvNode[];
  visibleEdges: HvEdge[];
}

function filterVisible(data: HarnessGraph, collapsed: Record<string, boolean>): FilteredView {
  const visibleNodes = data.nodes.filter((n) => !collapsed[n.group_id]);
  const visibleIds = new Set(visibleNodes.map((n) => n.id));
  const visibleEdges = data.edges.filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target));
  return { visibleNodes, visibleEdges };
}

function countsByGroup(data: HarnessGraph | undefined): Record<string, number> {
  if (!data) return {};
  const counts: Record<string, number> = {};
  for (const n of data.nodes) {
    if (n.kind === 'hub') continue; // hub is structural; don't count it
    counts[n.group_id] = (counts[n.group_id] ?? 0) + 1;
  }
  return counts;
}

export default function Graph({ data, error, isLoading, refresh, live }: Props) {
  const isSmall = useIsSmallViewport();

  // Stabilize `groups` reference — `data?.groups ?? []` produces a new []
  // literal each render when data is undefined, causing every consumer hook
  // (useCollapseState) to see a fresh reference + an infinite re-render loop.
  const EMPTY_GROUPS = useMemo<HvGroup[]>(() => [], []);
  const groups = data?.groups ?? EMPTY_GROUPS;
  const { collapsed, toggle, setAll } = useCollapseState(groups);

  // Stable empty kindStyles ref for the same reason.
  const EMPTY_KIND_STYLES = useMemo<Record<string, KindStyle>>(() => ({}), []);
  const kindStyles = data?.kindStyles ?? EMPTY_KIND_STYLES;

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selected, setSelected] = useState<HvNode | null>(null);
  const [lastLayoutKey, setLastLayoutKey] = useState('');
  const [positioned, setPositioned] = useState<PositionedNode[]>([]);
  // React Flow only auto-fits on mount. When a group is expanded/collapsed the
  // node set (and thus the layout) changes, so we re-fit manually via the
  // captured instance — otherwise the viewport stays on the old, smaller graph
  // and newly-revealed nodes sit off-screen.
  const rfRef = useRef<ReactFlowInstance | null>(null);
  // Mobile-only: the SyncBadge + Stats + GroupToggles Panel covers ~40% of a
  // phone screen when expanded. Collapsed-by-default keeps the chart viewable
  // on first paint; a small "▸ Filters" pill toggles it open.
  const [panelOpen, setPanelOpen] = useState<boolean>(!isSmall);
  // Re-sync when viewport changes (rotation): open on desktop, closed on phone.
  useEffect(() => {
    setPanelOpen(!isSmall);
  }, [isSmall]);

  const view = useMemo(() => {
    if (!data) return { visibleNodes: [] as HvNode[], visibleEdges: [] as HvEdge[] };
    return filterVisible(data, collapsed);
  }, [data, collapsed]);

  // Re-run elk layout ONLY when the node/edge set changes (not on status tick).
  useEffect(() => {
    const key = layoutKey(view.visibleNodes, view.visibleEdges);
    if (!view.visibleNodes.length) return;
    if (key === lastLayoutKey) return;
    let cancelled = false;
    (async () => {
      const result = await layoutNodes(view.visibleNodes, view.visibleEdges, kindStyles);
      if (cancelled) return;
      setPositioned(result);
      setLastLayoutKey(key);
    })();
    return () => { cancelled = true; };
  }, [view.visibleNodes, view.visibleEdges, lastLayoutKey, kindStyles]);

  // Project positioned nodes + live API data to React Flow state. Status
  // changes flow through here without re-layout. We inject the resolved
  // KindStyle into each node's data so BaseNode/PulseRing can read it.
  useEffect(() => {
    if (!positioned.length) return;
    const apiById = new Map(data?.nodes.map((n) => [n.id, n]) ?? []);
    const rfNodes: Node[] = positioned.map((p) => {
      const apiNode = apiById.get(p.id);
      const nodeData = apiNode ? apiNode.data : p.data;
      return {
        id: p.id,
        type: 'hv', // single dynamic node type — kind is read from data.kind
        position: p.position,
        data: {
          ...nodeData,
          label: apiNode?.label ?? p.label,
          // Injected so BaseNode can reach the per-kind style without a prop.
          kindStyle: kindStyles[nodeData.kind],
        },
        draggable: false,
        selectable: true,
        style: { width: p.width, height: p.height },
      };
    });
    setNodes(rfNodes);

    const visibleIds = new Set(rfNodes.map((n) => n.id));
    const rfEdges: Edge[] = view.visibleEdges
      .filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target))
      .map((e) => {
        const source = apiById.get(e.source);
        const isActive = source?.data.status === 'active';
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          type: 'default',
          animated: e.animated || isActive,
          style: {
            stroke: edgeColor(e.kind, isActive),
            strokeWidth: e.kind === 'hierarchy' ? 1.4 : 1,
            strokeDasharray: e.kind === 'uses' ? '6,4' : undefined,
            opacity: e.kind === 'hierarchy' ? 0.85 : 0.55,
          },
        } as Edge;
      });
    setEdges(rfEdges);
  }, [positioned, data, view.visibleEdges, kindStyles, setNodes, setEdges]);

  // Wide harnesses (one root → dozens of leaves) need a low maxZoom-out floor
  // to fit; a phone needs tighter padding. Shared by the mount fit + re-fit.
  const fitOpts = useMemo(
    () => (isSmall ? { padding: 0.06, maxZoom: 0.8 } : { padding: 0.1, maxZoom: 1 }),
    [isSmall],
  );

  // Re-fit whenever the laid-out node set changes (group expand/collapse).
  useEffect(() => {
    if (!lastLayoutKey || !rfRef.current) return;
    const inst = rfRef.current;
    const raf = requestAnimationFrame(() => inst.fitView(fitOpts));
    return () => cancelAnimationFrame(raf);
  }, [lastLayoutKey, fitOpts]);

  const onNodeClick = useCallback(
    (_e: React.MouseEvent, n: Node) => {
      if (!data) return;
      const found = data.nodes.find((x) => x.id === n.id) || null;
      setSelected(found);
    },
    [data],
  );

  const onPaneClick = useCallback(() => setSelected(null), []);

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0, position: 'relative' }}>
      {/* Canvas */}
      <div style={{ flex: 1, position: 'relative', minWidth: 0 }} data-testid="hv-canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          onInit={(inst) => { rfRef.current = inst; }}
          nodeTypes={NODE_TYPES}
          fitView
          fitViewOptions={fitOpts}
          minZoom={isSmall ? 0.08 : 0.12}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
          panOnDrag
          zoomOnPinch
          panOnScroll={!isSmall}
        >
          <Background color="#1a1a26" gap={32} size={1.5} />
          <Controls
            showInteractive={false}
            style={{
              background: 'rgba(18,18,26,0.85)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 8,
            }}
          />
          {/* Minimap consumes ~140×200px — useful on desktop, theft on a
              375×812 phone. Hide on small viewports. */}
          {!isSmall && (
            <MiniMap
              nodeColor={(n) => {
                const ks = (n.data as { kindStyle?: KindStyle })?.kindStyle;
                return ks?.accent ?? '#374151';
              }}
              maskColor="rgba(10,10,15,0.85)"
              style={{
                background: 'rgba(18,18,26,0.85)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 8,
                width: MINIMAP_WIDTH,
                height: MINIMAP_HEIGHT,
              }}
              pannable
              zoomable
              ariaLabel="Harness graph minimap"
              position="bottom-right"
            />
          )}

          <Panel
            position="top-left"
            style={isSmall ? mobilePanelStyle(panelOpen) : panelStyle}
          >
            {/* Mobile: collapsed-by-default. The header is always shown; the
                body (Stats + GroupToggles + warnings) is gated on panelOpen. */}
            {isSmall && (
              <button
                type="button"
                onClick={() => setPanelOpen((v) => !v)}
                aria-expanded={panelOpen}
                aria-controls="hv-mobile-panel-body"
                data-testid="hv-panel-toggle"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  background: 'transparent',
                  border: 'none',
                  color: '#E8E8F0',
                  fontSize: 11,
                  fontWeight: 600,
                  fontFamily: "'JetBrains Mono', monospace",
                  letterSpacing: '0.04em',
                  padding: 0,
                  cursor: 'pointer',
                }}
              >
                {panelOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                <span>Filters</span>
                {!panelOpen && data && (
                  <span style={{ color: '#8888AA', fontWeight: 400, marginLeft: 4 }}>
                    {statSummary(data.stats)}
                  </span>
                )}
              </button>
            )}
            {(!isSmall || panelOpen) && (
              <div
                id="hv-mobile-panel-body"
                style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
              >
                <SyncBadge
                  isLoading={isLoading}
                  error={error}
                  generated_at={data?.generated_at}
                  live={live}
                  onRefresh={() => void refresh()}
                />
                <Stats data={data} />
                <GroupToggles
                  groups={groups}
                  collapsed={collapsed}
                  onToggle={toggle}
                  onSetAll={setAll}
                  counts={countsByGroup(data)}
                />
                {data?.warnings && data.warnings.length > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#FFB800', fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>
                    <AlertTriangle size={12} />
                    <span>{data.warnings.length} warning{data.warnings.length > 1 ? 's' : ''}: {data.warnings[0]}</span>
                  </div>
                )}
              </div>
            )}
          </Panel>
        </ReactFlow>
      </div>

      {/* Sidebar */}
      <Sidebar node={selected} kindStyles={kindStyles} onClose={() => setSelected(null)} />
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

const panelStyle: React.CSSProperties = {
  background: 'rgba(18,18,26,0.85)',
  backdropFilter: 'blur(20px)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 10,
  padding: 12,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  maxWidth: 480,
};

// Mobile variant — narrower max-width so it doesn't crowd the chart, and
// reduced padding when expanded; when collapsed, just the toggle header.
function mobilePanelStyle(open: boolean): React.CSSProperties {
  return {
    background: 'rgba(18,18,26,0.92)',
    backdropFilter: 'blur(20px)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 10,
    padding: open ? 10 : '6px 10px',
    display: 'flex',
    flexDirection: 'column',
    gap: open ? 8 : 0,
    // Phone-safe: never wider than ~88vw so there's room for the chart edges.
    maxWidth: 'min(88vw, 320px)',
  };
}

// Edge colors: uses = blue dashed (old mcp-use), owns = pink (old domain-owns),
// hierarchy = cyan.
function edgeColor(kind: EdgeKind, isActive: boolean): string {
  if (kind === 'uses') return isActive ? '#3B82F6' : '#3B82F688';
  if (kind === 'owns') return '#F472B6AA';
  return isActive ? '#00FFE0' : '#00FFE099';
}

// Compact "8a · 16m" line for the collapsed mobile panel header — first few
// stat entries, generic over whatever keys the adapter emits.
function statSummary(stats: Record<string, number>): string {
  return Object.entries(stats)
    .slice(0, 3)
    .map(([k, v]) => `${v}${k.charAt(0)}`)
    .join(' · ');
}

function SyncBadge({
  isLoading,
  error,
  generated_at,
  live,
  onRefresh,
}: {
  isLoading: boolean;
  error: unknown;
  generated_at: string | undefined;
  live: boolean;
  onRefresh: () => void;
}) {
  const ago = generated_at ? formatAgo(generated_at) : '—';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11, color: '#8888AA', fontFamily: "'JetBrains Mono', monospace" }}>
      <button
        onClick={onRefresh}
        aria-label="Refresh"
        style={{
          background: 'transparent',
          border: '1px solid rgba(255,255,255,0.12)',
          color: '#E8E8F0',
          borderRadius: 6,
          padding: 4,
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
        }}
        data-testid="hv-refresh"
      >
        <RefreshCw size={12} className={isLoading ? 'spin-slow' : ''} />
      </button>
      <span>
        last sync: <strong style={{ color: '#E8E8F0' }}>{ago}</strong>
      </span>
      {live ? (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#00FFE0' }} data-testid="hv-live">
          <Wifi size={11} />
          live
        </span>
      ) : (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#FFB800' }} data-testid="hv-degraded">
          <WifiOff size={11} />
          polling 10s
        </span>
      )}
      {error != null && (
        <span style={{ color: '#FF00AA' }}>
          fetch error
        </span>
      )}
    </div>
  );
}

function Stats({ data }: { data: HarnessGraph | undefined }) {
  if (!data) return null;
  // Status counts.
  const sc: Record<string, number> = {};
  for (const n of data.nodes) sc[n.data.status] = (sc[n.data.status] ?? 0) + 1;
  return (
    <div style={{ display: 'flex', gap: 14, fontSize: 11, fontFamily: "'JetBrains Mono', monospace", flexWrap: 'wrap' }}>
      {/* Generic over whatever stat keys the adapter emits. */}
      {Object.entries(data.stats).map(([k, v]) => (
        <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#E8E8F0' }}>
          <span style={{ color: '#8888AA' }}>{k}</span>
          <span style={{ fontWeight: 700 }}>{v}</span>
        </div>
      ))}
      <span style={{ color: '#444460' }}>·</span>
      {(['active', 'stale', 'error'] as const).map((s) => (
        <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 4, color: STATUS_TONE[s] }}>
          <div style={{ width: 6, height: 6, borderRadius: 3, background: STATUS_TONE[s] }} />
          <span style={{ fontWeight: 700 }}>{sc[s] ?? 0}</span>
        </div>
      ))}
    </div>
  );
}
