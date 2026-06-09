// ═══════════════════════════════════════════════════════════════════════════
// GroupCollapse — UI + state for collapsing/expanding kind groups.
// Persists per-user collapse state in localStorage so reloads remember it.
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { HvGroup } from '@core/types';
import { TEXT_PRIMARY, TEXT_MUTED } from '@core/styles';

// localStorage key. Namespaced to harnessview; the `:v1` suffix lets us
// invalidate all persisted state in one bump if a default ever needs to be
// re-forced on every client (see NC5 history for why this matters).
const LS_KEY = 'harnessview:group-collapse:v1';

export type CollapseMap = Record<string, boolean>;

export function loadCollapse(groups: HvGroup[]): CollapseMap {
  if (typeof window === 'undefined') {
    // SSR — use defaults.
    const out: CollapseMap = {};
    for (const g of groups) out[g.id] = g.collapsed_default;
    return out;
  }
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    const saved = raw ? (JSON.parse(raw) as CollapseMap) : {};
    const out: CollapseMap = {};
    for (const g of groups) {
      out[g.id] = saved[g.id] ?? g.collapsed_default;
    }
    return out;
  } catch {
    const out: CollapseMap = {};
    for (const g of groups) out[g.id] = g.collapsed_default;
    return out;
  }
}

export function saveCollapse(map: CollapseMap) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(map));
  } catch {
    /* quota — ignore */
  }
}

export function useCollapseState(groups: HvGroup[]) {
  const [map, setMap] = useState<CollapseMap>(() => loadCollapse(groups));

  // Re-hydrate when the groups list shape ACTUALLY changes (new kind added).
  // Dep on the joined group IDs — NOT the array reference — otherwise every
  // render with a fresh `[]` literal (e.g. `data?.groups ?? []` before load
  // resolves) re-fires this effect and causes an infinite setState loop.
  const groupKey = groups.map((g) => `${g.id}:${g.collapsed_default ? 1 : 0}`).join('|');
  useEffect(() => {
    setMap((prev) => {
      const next: CollapseMap = {};
      for (const g of groups) next[g.id] = prev[g.id] ?? g.collapsed_default;
      // Skip setState if structurally identical — returning a new object
      // reference still triggers a re-render.
      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(next);
      if (prevKeys.length === nextKeys.length && prevKeys.every((k) => prev[k] === next[k])) {
        return prev;
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupKey]);

  const toggle = (id: string) => {
    setMap((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      saveCollapse(next);
      return next;
    });
  };

  const setAll = (collapsed: boolean) => {
    const next: CollapseMap = {};
    for (const g of groups) next[g.id] = collapsed;
    saveCollapse(next);
    setMap(next);
  };

  return { collapsed: map, toggle, setAll };
}

export function GroupToggles({
  groups,
  collapsed,
  onToggle,
  onSetAll,
  counts,
}: {
  groups: HvGroup[];
  collapsed: CollapseMap;
  onToggle: (id: string) => void;
  onSetAll?: (collapsed: boolean) => void;
  counts: Record<string, number>;
}) {
  // Are ALL groups currently collapsed? Used to flip the bulk-toggle label.
  const allCollapsed = groups.length > 0 && groups.every((g) => collapsed[g.id]);

  return (
    <div
      style={{
        display: 'flex',
        gap: 8,
        flexWrap: 'wrap',
        alignItems: 'center',
      }}
    >
      {onSetAll && (
        <button
          onClick={() => onSetAll(!allCollapsed)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '4px 10px',
            borderRadius: 8,
            background: 'rgba(255,184,0,0.10)',
            border: '1px solid rgba(255,184,0,0.35)',
            color: '#FFB800',
            fontSize: 11,
            fontWeight: 700,
            cursor: 'pointer',
            fontFamily: "'JetBrains Mono', monospace",
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
          }}
          data-testid="hv-bulk-toggle"
          aria-label={allCollapsed ? 'Expand all groups' : 'Collapse all groups'}
        >
          {allCollapsed ? 'Expand All' : 'Collapse All'}
        </button>
      )}
      {groups.map((g) => {
        const isCollapsed = !!collapsed[g.id];
        const count = counts[g.id] ?? 0;
        return (
          <button
            key={g.id}
            onClick={() => onToggle(g.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 10px',
              borderRadius: 8,
              background: isCollapsed ? 'rgba(255,255,255,0.04)' : 'rgba(0,255,224,0.08)',
              border: `1px solid ${isCollapsed ? 'rgba(255,255,255,0.10)' : 'rgba(0,255,224,0.30)'}`,
              color: isCollapsed ? TEXT_MUTED : TEXT_PRIMARY,
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: "'JetBrains Mono', monospace",
              letterSpacing: '0.04em',
            }}
            data-testid={`hv-group-toggle-${g.id}`}
            aria-pressed={!isCollapsed}
          >
            {isCollapsed
              ? <ChevronRight size={12} strokeWidth={2.5} />
              : <ChevronDown size={12} strokeWidth={2.5} />
            }
            <span>{g.label}</span>
            <span style={{ opacity: 0.55 }}>{count}</span>
          </button>
        );
      })}
    </div>
  );
}
