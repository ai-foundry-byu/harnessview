// ═══════════════════════════════════════════════════════════════════════════
// BaseNode — the single React Flow custom node used by EVERY kind. Since node
// kinds are dynamic strings (adapter-supplied), there is no per-kind component
// map; React Flow registers just `{ hv: BaseNode }` and this component reads
// the actual kind + its resolved style from `data`.
//
// kindStyle injection: React Flow only hands a node component `{ data, selected }`,
// so it can't reach HarnessGraph.kindStyles by prop. Graph injects the resolved
// `KindStyle` into each node's data as `data.kindStyle`; we read it here (with a
// neutral fallback if missing). `data.status` is likewise read off `data`.
//
// PulseRing renders INSIDE the node JSX — its transform inherits the React Flow
// node transform, so it can never desync from the node's position.
// ═══════════════════════════════════════════════════════════════════════════

import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { HvNodeData, KindStyle } from '@core/types';
import { TEXT_PRIMARY, TEXT_MUTED, VOID_BG } from '@core/styles';
import PulseRing from '../components/PulseRing';

// Neutral fallback style if an adapter ships a node whose kind has no entry in
// kindStyles (defensive — shouldn't happen, but never render a blank box).
const FALLBACK_STYLE: KindStyle = {
  label: 'node',
  accent: '#9CA3AF',
  bg: 'rgba(26, 26, 32, 0.72)',
  glow: 'rgba(156,163,175,0.15)',
  textColor: '#D1D5DB',
  emoji: '⬢',
  width: 160,
  height: 90,
  layer: 'normal',
};

// React Flow node `data` is the HvNodeData blob from /api/graph + a `label`
// and a resolved `kindStyle` injected by Graph.
interface Props {
  data: HvNodeData & { label?: string; kindStyle?: KindStyle };
  selected?: boolean;
}

function BaseNodeInner({ data, selected }: Props) {
  const kind = data.kind;
  const style = data.kindStyle ?? FALLBACK_STYLE;
  const accent = style.accent;

  // Handle visibility is derived from the kind's layer hint (replaces the old
  // hardcoded `tier !== 'human'` / `tier !== 'mcp' && 'project'` checks):
  //   'first' kinds are roots — no incoming edge → no top handle.
  //   'last'  kinds are leaves — no outgoing edge → no bottom handle.
  const isRoot = style.layer === 'first';
  const isLeaf = style.layer === 'last';
  const showTopHandle = !isRoot;
  const showBottomHandle = !isLeaf;

  // Leaf kinds (e.g. MCP servers) render in the old compact "mcp" variant.
  const compact = isLeaf;

  return (
    <div
      style={{
        background: style.bg,
        backdropFilter: 'blur(20px) saturate(150%)',
        WebkitBackdropFilter: 'blur(20px) saturate(150%)',
        border: `1.5px solid ${selected ? accent : 'rgba(255,255,255,0.08)'}`,
        boxShadow: selected
          ? `0 0 0 1px ${accent}, 0 0 30px ${style.glow}, 0 8px 32px rgba(0,0,0,0.5)`
          : `0 0 20px ${style.glow}, 0 4px 20px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)`,
        borderRadius: compact ? 10 : 16,
        padding: compact ? '8px 12px' : '14px 16px',
        width: style.width,
        height: style.height,
        cursor: 'pointer',
        transition: 'all 0.25s ease',
        position: 'relative',
        overflow: 'hidden',
        fontFamily: "'Inter', sans-serif",
      }}
      data-testid={`hv-node-${kind}-${(data.label ?? '').toString().toLowerCase()}`}
    >
      {/* Top accent line */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: '20%',
          right: '20%',
          height: 1,
          background: `linear-gradient(90deg, transparent, ${accent}60, transparent)`,
        }}
      />

      {/* PulseRing — top-right corner, INSIDE the node so it inherits transform */}
      <div style={{ position: 'absolute', top: 8, right: 8 }}>
        <PulseRing status={data.status} size={compact ? 7 : 9} />
      </div>

      {/* Handles (conditional by layer — roots have no parent, leaves no child) */}
      {showTopHandle && (
        <Handle
          type="target"
          position={Position.Top}
          style={{
            background: accent,
            border: `2px solid ${VOID_BG}`,
            width: 10,
            height: 10,
            top: -5,
          }}
        />
      )}
      {showBottomHandle && (
        <Handle
          type="source"
          position={Position.Bottom}
          style={{
            background: accent,
            border: `2px solid ${VOID_BG}`,
            width: 10,
            height: 10,
            bottom: -5,
          }}
        />
      )}

      {/* Emoji */}
      <div style={{ fontSize: compact ? 16 : 22, marginBottom: compact ? 2 : 6, lineHeight: 1 }}>
        {data.emoji || style.emoji}
      </div>

      {/* Label */}
      <div
        style={{
          color: TEXT_PRIMARY,
          fontWeight: 700,
          fontSize: compact ? 11 : 13,
          lineHeight: 1.3,
          marginBottom: 2,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          letterSpacing: '-0.01em',
          paddingRight: 14,
        }}
      >
        {data.label}
      </div>

      {/* Subtitle: model / command / phase — precomputed by the adapter */}
      {!compact && (
        <div
          style={{
            color: style.textColor,
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: '0.06em',
            textTransform: 'uppercase' as const,
            marginBottom: 6,
            fontFamily: "'JetBrains Mono', monospace",
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {data.subtitle || ''}
        </div>
      )}

      {/* Footer (compact): the kind's human label */}
      {!compact && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: 9,
            color: TEXT_MUTED,
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          <span>{style.label.toUpperCase()}</span>
        </div>
      )}
    </div>
  );
}

export default memo(BaseNodeInner);
