// ═══════════════════════════════════════════════════════════════════════════
// Sidebar — persistent right rail (not a modal). Renders the selected node's
// details generically: status, subtitle, liveness, badge pills, adapter-
// supplied detail rows, and the source path.
//
// The old NC5 version had tier-specific blocks with internal <a href> links to
// /projects/... and /domain pages. Those Next.js router links are GONE — this
// is a self-contained Vite SPA with no router. We just show the source path.
//
// Mobile (<768px): the placeholder "click any node to inspect" panel is hidden
// (it'd eat 1/3 of a phone screen); when a node IS selected, the inspector
// renders as a full-screen overlay so it's actually readable.
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import { X, Clock, Folder } from 'lucide-react';
import type { HvNode, KindStyle, DetailRow } from '@core/types';
import {
  SURFACE_BG,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  TEXT_MUTED,
  STATUS_TONE,
  formatAgo,
  ageSeconds,
} from '@core/styles';

interface Props {
  node: HvNode | null;
  /** kind → style map from the graph, used for accent/emoji/label. */
  kindStyles: Record<string, KindStyle>;
  onClose: () => void;
}

const MOBILE_MAX_PX = 768;

// Neutral fallback if a node's kind has no style entry (defensive).
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

// Local liveness helper — core ships ageSeconds but not isStale.
function isStale(
  lastHeartbeatIso: string | null | undefined,
  expectedIntervalSec: number | undefined,
): boolean {
  if (!expectedIntervalSec || !lastHeartbeatIso) return false;
  return ageSeconds(lastHeartbeatIso) > expectedIntervalSec * 2;
}

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

export default function Sidebar({ node, kindStyles, onClose }: Props) {
  const isSmall = useIsSmallViewport();

  if (!node) {
    // Mobile: hide the empty-state panel entirely so the chart owns the screen.
    if (isSmall) return null;
    return (
      <aside
        style={{
          width: 320,
          padding: 24,
          background: SURFACE_BG,
          backdropFilter: 'blur(20px) saturate(150%)',
          WebkitBackdropFilter: 'blur(20px) saturate(150%)',
          borderLeft: '1px solid rgba(255,255,255,0.06)',
          color: TEXT_MUTED,
          fontSize: 12,
          fontFamily: "'Inter', sans-serif",
          height: '100%',
          overflowY: 'auto',
        }}
        data-testid="hv-sidebar"
      >
        <div style={{ marginBottom: 12, fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: TEXT_SECONDARY }}>
          Inspector
        </div>
        <p>Click any node to inspect.</p>
      </aside>
    );
  }

  const style = kindStyles[node.kind] ?? FALLBACK_STYLE;
  const stale = isStale(node.data.last_heartbeat, node.data.expected_interval_seconds);
  const badges = node.data.badges ?? [];
  const detail = node.data.detail ?? [];

  return (
    <aside
      style={
        isSmall
          ? {
              // Full-screen overlay on mobile so the inspector is readable.
              position: 'absolute',
              inset: 0,
              width: '100%',
              zIndex: 30,
              background: SURFACE_BG,
              backdropFilter: 'blur(24px) saturate(150%)',
              WebkitBackdropFilter: 'blur(24px) saturate(150%)',
              color: TEXT_PRIMARY,
              fontFamily: "'Inter', sans-serif",
              overflowY: 'auto',
            }
          : {
              width: 360,
              background: SURFACE_BG,
              backdropFilter: 'blur(20px) saturate(150%)',
              WebkitBackdropFilter: 'blur(20px) saturate(150%)',
              borderLeft: `1px solid ${style.accent}33`,
              color: TEXT_PRIMARY,
              fontFamily: "'Inter', sans-serif",
              height: '100%',
              overflowY: 'auto',
              position: 'relative',
            }
      }
      data-testid={`hv-sidebar-${node.kind}`}
    >
      {/* Header */}
      <div
        style={{
          padding: '20px 20px 16px',
          borderBottom: `1px solid ${style.accent}22`,
          position: 'sticky',
          top: 0,
          background: SURFACE_BG,
          backdropFilter: 'blur(20px)',
          zIndex: 2,
        }}
      >
        <button
          onClick={onClose}
          aria-label="Close inspector"
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            background: 'transparent',
            border: 'none',
            color: TEXT_MUTED,
            cursor: 'pointer',
            padding: 4,
            borderRadius: 6,
          }}
        >
          <X size={16} />
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 28 }}>{node.data.emoji || style.emoji}</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 16, lineHeight: 1.2 }}>{node.label}</div>
            <div style={{ fontSize: 10, letterSpacing: '0.10em', textTransform: 'uppercase', color: style.textColor, marginTop: 4, fontFamily: "'JetBrains Mono', monospace" }}>
              {style.label}
            </div>
          </div>
        </div>

        {/* Status row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>
          <span
            style={{
              padding: '2px 8px',
              borderRadius: 6,
              background: `${STATUS_TONE[node.data.status]}22`,
              border: `1px solid ${STATUS_TONE[node.data.status]}66`,
              color: STATUS_TONE[node.data.status],
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            {node.data.status}
          </span>
          {stale && (
            <span
              style={{
                padding: '2px 8px',
                borderRadius: 6,
                background: '#FFB80022',
                border: '1px solid #FFB80066',
                color: '#FFB800',
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
              }}
            >
              stale
            </span>
          )}
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 18 }}>
        {node.data.description && (
          <p style={{ fontSize: 13, lineHeight: 1.55, color: TEXT_SECONDARY, margin: 0 }}>
            {node.data.description}
          </p>
        )}

        {node.data.subtitle && (
          <Section title="Subtitle">
            <div style={{ fontSize: 12, color: TEXT_PRIMARY, fontFamily: "'JetBrains Mono', monospace", wordBreak: 'break-word' }}>
              {node.data.subtitle}
            </div>
          </Section>
        )}

        {/* A non-fatal scan problem for this node renders as an error block. */}
        {node.data.problem && (
          <Section title="Problem">
            <div style={{ fontSize: 12, color: STATUS_TONE.error, lineHeight: 1.5 }}>
              {node.data.problem}
            </div>
          </Section>
        )}

        <Section title="Liveness">
          <Field icon={<Clock size={11} />} label="Last heartbeat" value={formatAgo(node.data.last_heartbeat)} />
          {node.data.expected_interval_seconds && (
            <Field
              icon={<Clock size={11} />}
              label="Expected interval"
              value={formatInterval(node.data.expected_interval_seconds)}
            />
          )}
        </Section>

        {badges.length > 0 && (
          <Section title="Badges">
            <PillList items={badges} emptyText="" />
          </Section>
        )}

        {detail.length > 0 && (
          <Section title="Details">
            {detail.map((row: DetailRow) => (
              <Field
                key={row.label}
                label={row.label}
                value={row.value}
                mono={row.mono}
              />
            ))}
          </Section>
        )}

        <Section title="Source">
          <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: 11, color: TEXT_MUTED, fontFamily: "'JetBrains Mono', monospace", wordBreak: 'break-all' }}>
            <Folder size={11} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{node.data.source}</span>
          </div>
        </Section>
      </div>
    </aside>
  );
}

// ── small composable bits ─────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 10, letterSpacing: '0.10em', textTransform: 'uppercase', color: TEXT_SECONDARY, marginBottom: 8, fontFamily: "'JetBrains Mono', monospace" }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{children}</div>
    </div>
  );
}

function Field({
  icon,
  label,
  value,
  mono,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, fontSize: 12 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: TEXT_SECONDARY, flexShrink: 0 }}>
        {icon}
        {label}
      </span>
      <span
        style={{
          color: TEXT_PRIMARY,
          fontFamily: mono ? "'JetBrains Mono', monospace" : "'Inter', sans-serif",
          fontSize: 11,
          textAlign: 'right',
          wordBreak: mono ? 'break-all' : 'normal',
        }}
      >
        {value}
      </span>
    </div>
  );
}

function PillList({ items, emptyText }: { items: string[]; emptyText: string }) {
  if (items.length === 0) {
    return <div style={{ fontSize: 11, color: TEXT_MUTED, fontStyle: 'italic' }}>{emptyText}</div>;
  }
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {items.map((item) => (
        <span
          key={item}
          style={{
            padding: '3px 8px',
            borderRadius: 6,
            background: 'rgba(59,130,246,0.12)',
            border: '1px solid rgba(59,130,246,0.30)',
            color: '#93C5FD',
            fontSize: 10,
            fontFamily: "'JetBrains Mono', monospace",
            fontWeight: 600,
          }}
        >
          {item}
        </span>
      ))}
    </div>
  );
}

function formatInterval(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h`;
  return `${Math.round(sec / 86400)}d`;
}
