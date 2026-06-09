// ═══════════════════════════════════════════════════════════════════════════
// Shared design tokens + status palette.
//
// Per-KIND styling is adapter-supplied (HarnessGraph.kindStyles) so the
// renderer can adapt to any harness. But STATUS tones + the base neon-glass
// surface tokens are universal across adapters, so they live here and are
// imported directly by both the adapters (to build kindStyles) and the UI.
// ═══════════════════════════════════════════════════════════════════════════

import type { NodeStatus } from './types.js';

export const SURFACE_BG = 'rgba(18, 18, 26, 0.7)';
export const BORDER_GLASS = 'rgba(255, 255, 255, 0.08)';
export const VOID_BG = '#0A0A0F';
export const TEXT_PRIMARY = '#E8E8F0';
export const TEXT_SECONDARY = '#8888AA';
export const TEXT_MUTED = '#555570';
export const NEON_CYAN = '#00FFE0';
export const MCP_BLUE = '#3B82F6';

export const STATUS_TONE: Record<NodeStatus, string> = {
  active: '#00FFE0',
  idle: '#6B7280',
  stale: '#FFB800',
  error: '#FF00AA',
  unknown: '#374151',
};

export function ageSeconds(iso: string | null | undefined): number {
  if (!iso) return Infinity;
  return (Date.now() - new Date(iso).getTime()) / 1000;
}

export function formatAgo(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const s = ageSeconds(iso);
  if (!isFinite(s)) return 'never';
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
