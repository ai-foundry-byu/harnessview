# harnessview

## Goal
When this project is done, we will have a published npm package (`npx harnessview`) that any Claude Code user can run to visually inspect their agent harness — subagents, MCP servers, skills, hooks, plugins — with a correct, readable layout at any harness size.

## Why
The NC5 org-chart visualization was coupled to Next.js + Supabase. Decoupling it into a zero-config local tool makes "inspect your harness" accessible to all Claude Code users, not just this organization. The cost of not doing it: developers ship broken wiring (dead hook paths, missing MCP commands) that they can't see.

## Status
active

## Owner
Clawd

## Domain
ops

## Started
2026-06-09

## Target
npm publish of v0.1.0 (M2 — blocked on npm auth token)

## Scope (what lives in this project)
- `~/code/harnessview` — the OSS repo (git, public on GitHub)
- State/tracking lives here at `~/clawd/projects/harnessview/`

## Out of scope
- Anything requiring Supabase, Vercel, or a backend database
- Nerve Center–specific agent logic
