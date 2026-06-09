// ═══════════════════════════════════════════════════════════════════════════
// elkjs layered auto-layout for the harness graph.
// Top-to-bottom flow. Layer pinning (roots at top, leaves like MCPs at the
// bottom) is no longer hardcoded per-tier — it's driven by each kind's
// `layer` hint, supplied by the adapter via HarnessGraph.kindStyles.
//
// IMPORTANT: the memoization key in callers must be based on the SET of
// nodes+edges, NOT on data.status — otherwise every heartbeat tick forces
// a re-layout and the chart jitters.
// ═══════════════════════════════════════════════════════════════════════════

import ELK, { type ElkNode, type ElkExtendedEdge } from 'elkjs/lib/elk.bundled.js';
import type { HvNode, HvEdge, KindStyle } from '@core/types';

const elk = new ELK();

// Fallback box size when a kind has no style (or width/height are absent).
const DEFAULT_NODE_SIZE = { w: 160, h: 90 } as const;

export interface PositionedNode extends HvNode {
  position: { x: number; y: number };
  width: number;
  height: number;
}

const LAYOUT_OPTIONS = {
  'elk.algorithm': 'layered',
  'elk.direction': 'DOWN',
  'elk.layered.spacing.nodeNodeBetweenLayers': '48',
  'elk.spacing.nodeNode': '22',
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
  // A harness fans WIDE: one project root → dozens of MCP/skill/hook leaves in
  // a single layer. Unwrapped that's a ~6000px strip that fitView shrinks to
  // an unreadable sliver. elk's layer-wrapping splits an over-wide layer into
  // stacked rows targeting an aspect ratio, turning the strip into a block.
  'elk.layered.wrapping.strategy': 'MULTI_EDGE',
  'elk.aspectRatio': '1.7',
  'elk.layered.wrapping.correctionFactor': '1.4',
};

/** Box size for a node, read from its kind's style (fallback to default). */
function nodeSize(
  kind: string,
  kindStyles: Record<string, KindStyle>,
): { w: number; h: number } {
  const ks = kindStyles[kind];
  if (!ks) return { w: DEFAULT_NODE_SIZE.w, h: DEFAULT_NODE_SIZE.h };
  return {
    w: ks.width || DEFAULT_NODE_SIZE.w,
    h: ks.height || DEFAULT_NODE_SIZE.h,
  };
}

/**
 * Compute node positions for a given set of nodes+edges.
 * Returns the input nodes enriched with {position, width, height}.
 * Edges are returned unchanged — React Flow handles their own routing.
 */
export async function layoutNodes(
  nodes: HvNode[],
  edges: HvEdge[],
  kindStyles: Record<string, KindStyle>,
): Promise<PositionedNode[]> {
  if (nodes.length === 0) return [];

  const elkNodes: ElkNode[] = nodes.map((n) => {
    const size = nodeSize(n.kind, kindStyles);
    return {
      id: n.id,
      width: size.w,
      height: size.h,
      // Hint at a layer ordering so leaves (e.g. MCPs) fall to the bottom
      // and roots pin to the top — read from the kind's style.
      layoutOptions: layerHint(kindStyles[n.kind]?.layer),
    };
  });

  const elkEdges: ElkExtendedEdge[] = edges.map((e) => ({
    id: e.id,
    sources: [e.source],
    targets: [e.target],
  }));

  const graph: ElkNode = {
    id: 'root',
    layoutOptions: LAYOUT_OPTIONS,
    children: elkNodes,
    edges: elkEdges,
  };

  const laid = await elk.layout(graph);
  const posById = new Map<string, { x: number; y: number }>();
  for (const child of laid.children || []) {
    posById.set(child.id, { x: child.x ?? 0, y: child.y ?? 0 });
  }

  return nodes.map((n) => {
    const size = nodeSize(n.kind, kindStyles);
    return {
      ...n,
      position: posById.get(n.id) ?? { x: 0, y: 0 },
      width: size.w,
      height: size.h,
    };
  });
}

/**
 * Map a kind's `layer` hint to an elk per-node layerConstraint.
 *   'first' → FIRST          (forced into the first/top layer — roots)
 *   'last'  → LAST_SEPARATE  (a NEW dedicated bottom layer — leaves like MCPs)
 *   else    → no constraint  (standard layering)
 *
 * (See elkjs/lib/elk.bundled.js — grep for 'layerConstraint'. LAST alone is
 * insufficient when leaf nodes of other kinds share that layer; LAST_SEPARATE
 * carves a dedicated bottom row.)
 */
function layerHint(layer: KindStyle['layer']): Record<string, string> {
  if (layer === 'first') return { 'elk.layered.layering.layerConstraint': 'FIRST' };
  // NOTE: we deliberately do NOT pin leaves with LAST_SEPARATE. That carves a
  // single dedicated bottom layer, which fights the layer-wrapping above (you
  // can't wrap a layer that's constrained to stay whole). Leaves have only
  // incoming edges, so they settle at the bottom on their own — and wrapping
  // is then free to fold the wide leaf layer into stacked rows.
  return {};
}

/**
 * Deterministic signature for a node+edge set. Used as a memoization key in
 * Graph. Status changes on nodes DO NOT affect this key.
 */
export function layoutKey(nodes: HvNode[], edges: HvEdge[]): string {
  const nodeKey = nodes.map((n) => n.id).sort().join('|');
  const edgeKey = edges.map((e) => `${e.source}>${e.target}`).sort().join('|');
  return `${nodeKey}::${edgeKey}`;
}
