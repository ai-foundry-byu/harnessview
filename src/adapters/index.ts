// Adapter registry + scan orchestrator.
//
// Auto-detection: every registered adapter gets a cheap detect() against the
// target root; the highest-priority match wins. Claude Code is the default
// and also the fallback when nothing else recognises the directory.

import type { Adapter, HarnessGraph } from '../core/types.js';
import { claudeCodeAdapter } from './claude-code.js';

export const ADAPTERS: Adapter[] = [claudeCodeAdapter];

export async function pickAdapter(root: string): Promise<Adapter> {
  const matched: Adapter[] = [];
  for (const a of ADAPTERS) {
    try {
      if (await a.detect(root)) matched.push(a);
    } catch {
      /* detect must never throw the whole scan */
    }
  }
  matched.sort((x, y) => y.priority - x.priority);
  return matched[0] ?? claudeCodeAdapter;
}

export async function scanHarness(root: string): Promise<HarnessGraph> {
  const adapter = await pickAdapter(root);
  return adapter.scan(root);
}
