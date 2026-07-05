// Harnessview smoke tests — 4 user stories.
//
// The server scans tests/fixtures/test-harness (a minimal CLAUDE.md fixture).
// The adapter also picks up the user-scope config from ~/.claude, providing
// real agent/skill/mcp nodes. Tests use generic selectors so they are
// resilient to config changes.
//
// Run with: pnpm test:smoke

import { test, expect } from '@playwright/test';

// How long to wait for the ELK layout to complete and nodes to appear in DOM.
const LAYOUT_TIMEOUT = 20_000;

test.describe('harnessview smoke', () => {
  // ── US-1 ─────────────────────────────────────────────────────────────────
  test('US-1 — graph renders', async ({ page }) => {
    await page.goto('/');

    // No application-level error overlay.
    await expect(page.locator('text=Application error')).toHaveCount(0);

    // Header is visible and identifies the tool.
    const header = page.locator('[data-testid="hv-header"]');
    await expect(header).toBeVisible();

    // Adapter badge shows 'claude-code'.
    await expect(page.locator('[data-testid="hv-adapter"]')).toHaveText('claude-code');

    // Canvas mount point is present.
    await expect(page.locator('[data-testid="hv-canvas"]')).toBeVisible();

    // ELK layout completes: at least the root node appears in the DOM.
    await expect(
      page.locator('[data-testid^="hv-node-root-"]').first(),
    ).toBeVisible({ timeout: LAYOUT_TIMEOUT });
  });

  // ── US-2 ─────────────────────────────────────────────────────────────────
  test('US-2 — node click opens inspector', async ({ page }) => {
    await page.goto('/');

    // Wait for the graph to render (agents group is expanded by default).
    const agentNode = page.locator('[data-testid^="hv-node-agent-"]').first();
    await agentNode.waitFor({ state: 'visible', timeout: LAYOUT_TIMEOUT });

    // Click the agent node. force:true bypasses the ReactFlow panel overlay
    // check and dispatches the event directly on the node element.
    await agentNode.click({ force: true });

    // Inspector sidebar opens for an agent kind.
    const sidebar = page.locator('[data-testid="hv-sidebar-agent"]');
    await expect(sidebar).toBeVisible({ timeout: 5_000 });

    // Sidebar body is non-empty (shows node label / Inspector section).
    await expect(sidebar).not.toBeEmpty();
  });

  // ── US-3 ─────────────────────────────────────────────────────────────────
  test('US-3 — group collapse/expand', async ({ page }) => {
    await page.goto('/');

    // Wait for graph to render.
    await page.locator('[data-testid^="hv-node-root-"]').first().waitFor({
      state: 'visible',
      timeout: LAYOUT_TIMEOUT,
    });

    // Skills group is collapsed by default (adapter hard-codes collapsed_default:true).
    const skillToggle = page.locator('[data-testid="hv-group-toggle-g-skill"]');
    await skillToggle.waitFor({ state: 'visible' });
    await expect(skillToggle).toHaveAttribute('aria-pressed', 'false');

    // No skill nodes in DOM while collapsed.
    await expect(page.locator('[data-testid^="hv-node-skill-"]').first()).not.toBeAttached();

    // Expand skills: click toggle.
    await skillToggle.click();
    await expect(skillToggle).toHaveAttribute('aria-pressed', 'true');

    // At least one skill node now appears after ELK re-layout.
    await expect(
      page.locator('[data-testid^="hv-node-skill-"]').first(),
    ).toBeVisible({ timeout: LAYOUT_TIMEOUT });

    // Collapse again.
    await skillToggle.click();
    await expect(skillToggle).toHaveAttribute('aria-pressed', 'false');

    // Skill nodes removed from DOM.
    await expect(
      page.locator('[data-testid^="hv-node-skill-"]').first(),
    ).not.toBeAttached({ timeout: 10_000 });
  });

  // ── US-4 ─────────────────────────────────────────────────────────────────
  test('US-4 — live badge appears', async ({ page }) => {
    await page.goto('/');

    // Wait for data load so the SyncBadge panel renders.
    await page.locator('[data-testid^="hv-node-root-"]').first().waitFor({
      state: 'visible',
      timeout: LAYOUT_TIMEOUT,
    });

    // Either the SSE 'live' badge or the 'polling 10s' degraded badge must
    // be visible. Both indicate the sync-status component rendered.
    const live = page.locator('[data-testid="hv-live"]');
    const degraded = page.locator('[data-testid="hv-degraded"]');

    await expect(live.or(degraded)).toBeVisible({ timeout: 8_000 });
  });
});
