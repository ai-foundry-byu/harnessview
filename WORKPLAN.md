# harnessview — WORKPLAN

<!-- STATUS-BEGIN -->
Progress: 2 of 2 milestones complete (100%)
Last ship: 7d ago — Playwright smoke tests live: 4 user stories (graph renders, node click, group collapse/expand, live badge) — all 4 passing in chromium
⚠ STALLED: 7d since last ship
<!-- STATUS-END -->


## Next up (priority order)

1. **M2: npm publish** (blocked on npm auth token — see BLOCKERS.md)
   - Add `~/.npmrc` with a publish-scoped npm token
   - `pnpm run build` (reinstall deps first: `pnpm install`)
   - `npm publish --access public`

2. **M3: Playwright user-story tests**
   - Fill in `qa/smoke-prd.md` with real ACs
   - Activate `qa.yaml` (rename from qa.yaml.template, set URL)
   - Write Playwright tests covering: graph renders, node click opens inspector, group collapse/expand, live badge

## Milestones
- [x] M1: Fix star-layout regression — add category hub nodes (root → hub → leaves) so ELK wraps the expanded many-leaf view instead of rendering one wide row. Patch dist files in-place.
- [~] M2: npm publish to `harnessview` — PARKED (needs JD). Publishing a public package under JD's npm/GitHub identity is outward + irreversible → requires explicit approval + a QA pass first. Ship-driver: SKIP this milestone, do NOT auto-retry or page JD, until JD explicitly says "publish harnessview". (parked 2026-07-05 by CEO — was pinging JD every 8 min via a runaway poller)
- [x] M3: Playwright user-story tests (smoke-prd.md + qa.yaml activated)

## Blocked on JD decisions
- npm auth token needed for publish (see BLOCKERS.md)

## Follow-ups
- After npm publish: add a GitHub Actions workflow to auto-publish on version tag push
- Consider adding the `pnpm install` step to a Makefile/script so rebuilds don't need npm
- The UI bundle in dist/ui/assets/ is minified; a full `pnpm run build` should be done after any UI source changes (the cwt countsByGroup fix is patched in the minified bundle for now)
