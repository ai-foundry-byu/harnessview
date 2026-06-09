# harnessview

**Visually inspect your Claude Code agent harness.** Point it at any project and
it opens a local graph of your subagents, MCP servers, skills, slash commands,
hooks, and plugins — and flags the wiring that's quietly broken.

```bash
npx harnessview
```

That's it. No account, no config, no cloud. The server runs on your machine,
reads your `.claude/` configuration straight off disk, and opens a browser.

---

## What it shows

`harnessview` scans the Claude Code settings hierarchy at the target path —
enterprise → user (`~/.claude`) → project (`<root>/.claude`) → `.local` — and
composes a single graph:

| Node      | Source |
|-----------|--------|
| 📁 Project   | the root + its `CLAUDE.md` and merged model/settings |
| 🤖 Subagent  | `.claude/agents/*.md` (frontmatter: model, tools) |
| 🔌 MCP Server| `.mcp.json` + `settings.json#mcpServers` |
| ✨ Skill     | `.claude/skills/*.md` and `.claude/skills/*/SKILL.md` |
| ⚡ Command   | `.claude/commands/**/*.md` (namespaced) |
| 🪝 Hook      | `settings.json#hooks` (per event/matcher) |
| 🧩 Plugin    | `~/.claude/plugins` marketplaces |

Edges show the wiring: which subagents are granted which MCP servers
(`mcp__server__*` tool grants), and which plugins own which components.

**Broken-config detection.** A hook or stdio MCP whose command path doesn't
exist on disk is rendered as an `error` node — so "inspect your harness" also
surfaces the dead reference you forgot about.

**Live.** The server watches your config files; edit a settings file or drop in
a new agent and the graph updates without a refresh.

## Usage

```bash
npx harnessview                 # scan the current directory
npx harnessview ../some-project # scan another project
npx harnessview --port 8080     # custom port
npx harnessview --no-open       # don't auto-open the browser
```

## How it's built

- **`src/core/types.ts`** — the adapter↔UI contract. Node *kinds* are free
  strings and their visual styles ship *inside* the graph payload
  (`kindStyles`), so the renderer adapts to whatever an adapter emits.
- **`src/adapters/`** — pluggable scanners. `claude-code` is the default;
  `pickAdapter()` auto-detects by `detect()` + priority. Add an adapter for any
  other agent framework and the same canvas draws it.
- **`src/server/`** — a tiny Node http server: `/api/graph` (scan), `/events`
  (SSE live-reload on fs change), and the static UI.
- **`src/ui/`** — a React Flow + elkjs canvas (layered auto-layout,
  click-to-inspect inspector, collapsible groups). Ported from the
  nerve-center-v5 org chart, decoupled from Next.js and Supabase.

## Develop

```bash
npm install
npm run dev      # vite UI (:5317) + server (:4317), proxied
npm run scan     # dump the scanned graph as JSON
npm run build    # build UI + server into dist/
npm start        # run the built server
```

## License

MIT
