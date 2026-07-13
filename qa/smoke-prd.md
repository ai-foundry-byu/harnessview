# harnessview — Smoke QA PRD

**Target:** `http://localhost:14317` (local harnessview server scanning `tests/fixtures/test-harness/`)
**Mode:** smoke

Tests are in `tests/smoke.spec.ts` (Playwright, chromium). Run with:
```
node node_modules/@playwright/test/cli.js test --project=chromium
```

Each user story maps to one automated Playwright test.

---

## US-1 — Graph renders

- **AC-1.1** Navigating to `/` produces a page with zero elements matching `text=Application error`.
- **AC-1.2** `[data-testid="hv-header"]` is visible within 5 s of page load.
- **AC-1.3** `[data-testid="hv-adapter"]` contains the text `claude-code`.
- **AC-1.4** `[data-testid="hv-canvas"]` is visible.
- **AC-1.5** At least one node matching `[data-testid^="hv-node-root-"]` is visible within 20 s (ELK layout must complete).

## US-2 — Node click opens inspector

- **AC-2.1** After the graph renders, a node matching `[data-testid^="hv-node-agent-"]` is visible (agents group is expanded by default).
- **AC-2.2** Clicking that node causes `[data-testid="hv-sidebar-agent"]` to appear within 5 s.
- **AC-2.3** The sidebar element is not empty (shows node label and Inspector sections).

## US-3 — Group collapse/expand

- **AC-3.1** `[data-testid="hv-group-toggle-g-skill"]` is visible after graph load.
- **AC-3.2** Initially the toggle has `aria-pressed="false"` (skills collapsed by default per adapter).
- **AC-3.3** No element matching `[data-testid^="hv-node-skill-"]` is attached to the DOM while skills are collapsed.
- **AC-3.4** Clicking the toggle changes `aria-pressed` to `"true"` and causes at least one `[data-testid^="hv-node-skill-"]` to become visible within 20 s.
- **AC-3.5** Clicking the toggle again changes `aria-pressed` back to `"false"` and removes all `[data-testid^="hv-node-skill-"]` from the DOM within 10 s.

## US-4 — Live badge appears

- **AC-4.1** After the graph renders, either `[data-testid="hv-live"]` (SSE connected) or `[data-testid="hv-degraded"]` (polling fallback) is visible within 8 s.
