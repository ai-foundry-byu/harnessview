// ═══════════════════════════════════════════════════════════════════════════
// harnessview — core data contract
//
// This is the single contract between ANY adapter (the thing that scans a
// harness) and the UI (the React Flow canvas that draws it). It is the
// generalized descendant of nerve-center-v5's OrgApiResponse — but where that
// hard-coded a fixed tier union (human|orch|domain|specialist|worker|mcp|
// project) baked into the renderer, this version makes node *kinds* free
// strings AND ships their visual styles INSIDE the payload (`kindStyles`).
//
// Net effect: the UI renders whatever an adapter emits without code changes.
// A Claude Code adapter emits kinds like agent/mcp/skill/command/hook; a
// future adapter for some other framework can emit entirely different kinds
// and the canvas just adapts. That's the "dynamically fit to the system"
// requirement.
// ═══════════════════════════════════════════════════════════════════════════

export type NodeStatus = 'active' | 'idle' | 'stale' | 'error' | 'unknown';

/** Visual + layout description for one node kind. Adapter-supplied. */
export interface KindStyle {
  /** Human label shown in group toggles + inspector ("Subagent", "MCP Server"). */
  label: string;
  accent: string;
  bg: string;
  glow: string;
  textColor: string;
  emoji: string;
  width: number;
  height: number;
  /**
   * elk layering hint. 'first' pins to the top layer (roots), 'last' pins to a
   * dedicated bottom layer (leaves like MCPs), 'normal' lets the layout decide.
   */
  layer?: 'first' | 'last' | 'normal';
}

export interface HvGroup {
  id: string;
  label: string;
  /** the node kind this group collects */
  kind: string;
  collapsed_default: boolean;
}

/** One key/value row rendered in the inspector's detail table. */
export interface DetailRow {
  label: string;
  value: string;
  /** optional monospace rendering (paths, commands) */
  mono?: boolean;
}

export interface HvNodeData {
  status: NodeStatus;
  kind: string;
  emoji?: string;
  description?: string;
  /** absolute or repo-relative path this node was derived from */
  source: string;
  /** short subtitle under the label (model id, command, phase…) */
  subtitle?: string;
  /** pill list shown in a node + inspector (tool names, mcps used, etc.) */
  badges?: string[];
  /** arbitrary inspector detail rows */
  detail?: DetailRow[];
  /** a non-fatal problem found while scanning this node (renders as error) */
  problem?: string;
  // Liveness (optional — only adapters with a heartbeat source set these).
  last_heartbeat?: string | null;
  expected_interval_seconds?: number;
}

export interface HvNode {
  id: string;
  /** node kind — must match a key in HarnessGraph.kindStyles + a group's kind */
  kind: string;
  label: string;
  group_id: string;
  data: HvNodeData;
}

export type EdgeKind = 'hierarchy' | 'uses' | 'owns';

export interface HvEdge {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  animated?: boolean;
}

export interface HarnessGraph {
  generated_at: string;
  /** which adapter produced this graph (e.g. "claude-code") */
  adapter: string;
  /** the root path that was scanned */
  root: string;
  /** human title for the header (e.g. project dir name) */
  title: string;
  /** ordered settings scopes that were merged, for the header */
  scopes: string[];
  /** named counts shown in the stat strip (e.g. { agents: 8, mcps: 16 }) */
  stats: Record<string, number>;
  /** kind → visual/layout style. The UI is driven entirely by this. */
  kindStyles: Record<string, KindStyle>;
  groups: HvGroup[];
  nodes: HvNode[];
  edges: HvEdge[];
  /** non-fatal scan problems (a degraded source, an unreadable file…) */
  warnings: string[];
}

/** An adapter scans a directory and returns a graph (or throws to be skipped). */
export interface Adapter {
  name: string;
  /** higher wins when multiple adapters match */
  priority: number;
  /** cheap check: does this adapter recognise the harness at `root`? */
  detect(root: string): Promise<boolean> | boolean;
  /** full scan → graph */
  scan(root: string): Promise<HarnessGraph>;
}
