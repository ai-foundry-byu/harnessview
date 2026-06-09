// ═══════════════════════════════════════════════════════════════════════════
// useGraph — fetch /api/graph + live-reload via Server-Sent Events.
//
// Replaces nerve-center-v5's SWR + Supabase realtime overlay. The harnessview
// node server watches the filesystem and pings an SSE stream at /events; on
// any message we re-fetch /api/graph. If the EventSource errors (server down,
// proxy hiccup), we flip `live=false` and fall back to a 10s poll so the
// chart still refreshes — just less promptly.
//
// No SWR, no Supabase — plain useState/useEffect, fully self-contained.
// ═══════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react';
import type { HarnessGraph, HvNode } from '@core/types';

const POLL_INTERVAL_MS = 10_000;

interface UseGraphReturn {
  data: HarnessGraph | undefined;
  error: unknown;
  isLoading: boolean;
  /** force-refetch /api/graph */
  refresh: () => Promise<void>;
  /** true while the EventSource is open (drives the "live" indicator) */
  live: boolean;
}

async function fetchGraph(): Promise<HarnessGraph> {
  const r = await fetch('/api/graph', { cache: 'no-store' });
  if (!r.ok) throw new Error(`/api/graph ${r.status}`);
  return r.json();
}

export function useGraph(): UseGraphReturn {
  const [data, setData] = useState<HarnessGraph | undefined>(undefined);
  const [error, setError] = useState<unknown>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [live, setLive] = useState(false);

  // Keep a stable reference to the fetch so effects don't re-subscribe.
  const refresh = useCallback(async () => {
    try {
      const g = await fetchGraph();
      setData(g);
      setError(undefined);
    } catch (e) {
      setError(e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial load.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Live-reload: subscribe to /events. On any message, re-fetch. On error,
  // close the stream, flip live=false, and poll every 10s as a fallback.
  useEffect(() => {
    let es: EventSource | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    const startPolling = () => {
      if (pollTimer || cancelled) return;
      pollTimer = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    };

    try {
      es = new EventSource('/events');
      es.onopen = () => {
        if (cancelled) return;
        setLive(true);
        // EventSource recovered — stop the polling fallback if it was running.
        if (pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
      };
      es.onmessage = () => {
        if (cancelled) return;
        void refresh();
      };
      es.onerror = () => {
        if (cancelled) return;
        setLive(false);
        startPolling();
      };
    } catch {
      // EventSource unsupported / construction threw — poll-only.
      setLive(false);
      startPolling();
    }

    return () => {
      cancelled = true;
      if (es) es.close();
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [refresh]);

  return { data, error, isLoading, refresh, live };
}

// ── Selector helpers ───────────────────────────────────────────────────────

/** Group nodes by kind. */
export function nodesByKind(data: HarnessGraph | undefined): Record<string, HvNode[]> {
  const out: Record<string, HvNode[]> = {};
  if (!data) return out;
  for (const n of data.nodes) {
    (out[n.kind] ||= []).push(n);
  }
  return out;
}
