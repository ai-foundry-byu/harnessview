// ═══════════════════════════════════════════════════════════════════════════
// App — top-level shell. Owns the single useGraph() call and passes its
// results down to Graph (so we never double-fetch). Renders a thin header bar
// (title + scope chips + adapter name) above the canvas, which fills the rest.
// ═══════════════════════════════════════════════════════════════════════════

import { useGraph } from './lib/useGraph';
import Graph from './Graph';
import {
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  TEXT_MUTED,
  NEON_CYAN,
  VOID_BG,
} from '@core/styles';

export default function App() {
  const { data, error, isLoading, refresh, live } = useGraph();

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        background: VOID_BG,
        color: TEXT_PRIMARY,
        fontFamily: "'Inter', sans-serif",
      }}
    >
      <Header
        title={data?.title}
        scopes={data?.scopes ?? []}
        adapter={data?.adapter}
        root={data?.root}
      />

      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {isLoading && !data ? (
          <Centered>
            <div style={{ color: TEXT_SECONDARY, fontFamily: "'JetBrains Mono', monospace", fontSize: 13 }}>
              scanning harness…
            </div>
          </Centered>
        ) : error && !data ? (
          <Centered>
            <div style={{ color: '#FF00AA', fontFamily: "'JetBrains Mono', monospace", fontSize: 13, textAlign: 'center' }}>
              <div style={{ marginBottom: 8 }}>failed to load graph</div>
              <div style={{ color: TEXT_MUTED, fontSize: 11 }}>{String((error as Error)?.message ?? error)}</div>
            </div>
          </Centered>
        ) : (
          <Graph
            data={data}
            error={error}
            isLoading={isLoading}
            refresh={refresh}
            live={live}
          />
        )}
      </div>
    </div>
  );
}

// ── Header ─────────────────────────────────────────────────────────────────

function Header({
  title,
  scopes,
  adapter,
  root,
}: {
  title: string | undefined;
  scopes: string[];
  adapter: string | undefined;
  root: string | undefined;
}) {
  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '12px 20px',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        background: 'rgba(18,18,26,0.85)',
        backdropFilter: 'blur(20px)',
        flexShrink: 0,
        flexWrap: 'wrap',
      }}
      data-testid="hv-header"
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, minWidth: 0 }}>
        <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-0.01em', color: TEXT_PRIMARY }}>
          {title ?? 'harnessview'}
        </span>
        {root && (
          <span
            style={{
              fontSize: 11,
              color: TEXT_MUTED,
              fontFamily: "'JetBrains Mono', monospace",
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: 360,
            }}
            title={root}
          >
            {root}
          </span>
        )}
      </div>

      {/* Scope chips */}
      {scopes.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {scopes.map((s) => (
            <span
              key={s}
              style={{
                padding: '2px 8px',
                borderRadius: 6,
                background: 'rgba(0,255,224,0.08)',
                border: '1px solid rgba(0,255,224,0.25)',
                color: NEON_CYAN,
                fontSize: 10,
                fontWeight: 600,
                fontFamily: "'JetBrains Mono', monospace",
                letterSpacing: '0.04em',
              }}
              data-testid={`hv-scope-${s}`}
            >
              {s}
            </span>
          ))}
        </div>
      )}

      {/* Adapter name — pushed to the right */}
      {adapter && (
        <span
          style={{
            marginLeft: 'auto',
            fontSize: 10,
            color: TEXT_SECONDARY,
            fontFamily: "'JetBrains Mono', monospace",
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}
          data-testid="hv-adapter"
        >
          {adapter}
        </span>
      )}
    </header>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {children}
    </div>
  );
}
