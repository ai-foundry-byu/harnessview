// ═══════════════════════════════════════════════════════════════════════════
// Claude Code adapter — the default harness scanner.
//
// Reads a project's local Claude Code configuration straight off disk and
// composes a graph of: the project root, its subagents, MCP servers, skills,
// slash commands, hooks, and installed plugins. No network, no database — the
// server runs on the user's machine so it just reads the filesystem.
//
// Settings precedence honoured for discovery (low → high):
//   enterprise-managed → ~/.claude (user) → <root>/.claude (project) → .local
//
// A nice property of scanning static config (vs. NC5's live heartbeats): we
// can flag BROKEN wiring. A hook or stdio MCP whose command path doesn't
// exist on disk is surfaced as an `error` node — "inspect your harness" also
// means "find what's quietly broken".
// ═══════════════════════════════════════════════════════════════════════════

import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type {
  Adapter,
  HarnessGraph,
  HvNode,
  HvEdge,
  HvGroup,
  KindStyle,
  NodeStatus,
  DetailRow,
} from '../core/types.js';

// ── Per-kind visual + layout styles (shipped in the payload) ────────────────
const KIND_STYLES: Record<string, KindStyle> = {
  root: {
    label: 'Project', accent: '#E8E8F0', bg: 'rgba(35,35,48,0.78)',
    glow: 'rgba(232,232,240,0.22)', textColor: '#E8E8F0', emoji: '📁',
    width: 196, height: 104, layer: 'first',
  },
  agent: {
    label: 'Subagent', accent: '#FBBF24', bg: 'rgba(34,30,22,0.78)',
    glow: 'rgba(251,191,36,0.20)', textColor: '#FBBF24', emoji: '🤖',
    width: 176, height: 100, layer: 'normal',
  },
  plugin: {
    label: 'Plugin', accent: '#34D399', bg: 'rgba(18,34,28,0.78)',
    glow: 'rgba(52,211,153,0.20)', textColor: '#6EE7B7', emoji: '🧩',
    width: 176, height: 100, layer: 'normal',
  },
  mcp: {
    label: 'MCP Server', accent: '#3B82F6', bg: 'rgba(15,25,40,0.80)',
    glow: 'rgba(59,130,246,0.26)', textColor: '#93C5FD', emoji: '🔌',
    width: 132, height: 64, layer: 'last',
  },
  skill: {
    label: 'Skill', accent: '#A78BFA', bg: 'rgba(34,28,52,0.78)',
    glow: 'rgba(167,139,250,0.22)', textColor: '#C4B5FD', emoji: '✨',
    width: 150, height: 70, layer: 'last',
  },
  command: {
    label: 'Command', accent: '#00FFE0', bg: 'rgba(16,32,34,0.78)',
    glow: 'rgba(0,255,224,0.20)', textColor: '#5EEAD4', emoji: '⚡',
    width: 150, height: 64, layer: 'last',
  },
  hook: {
    label: 'Hook', accent: '#F472B6', bg: 'rgba(36,20,30,0.78)',
    glow: 'rgba(244,114,182,0.22)', textColor: '#F9A8D4', emoji: '🪝',
    width: 160, height: 78, layer: 'last',
  },
};

// ── Small fs + parse helpers ────────────────────────────────────────────────

async function readText(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, 'utf8');
  } catch {
    return null;
  }
}

async function readJson<T = any>(p: string): Promise<T | null> {
  const t = await readText(p);
  if (t == null) return null;
  try {
    return JSON.parse(t) as T;
  } catch {
    return null;
  }
}

async function listFiles(dir: string): Promise<string[]> {
  try {
    const ents = await fs.readdir(dir, { withFileTypes: true });
    return ents.filter((e) => e.isFile()).map((e) => path.join(dir, e.name));
  } catch {
    return [];
  }
}

async function listDirs(dir: string): Promise<string[]> {
  try {
    const ents = await fs.readdir(dir, { withFileTypes: true });
    return ents.filter((e) => e.isDirectory()).map((e) => path.join(dir, e.name));
  } catch {
    return [];
  }
}

function stripQuotes(s: string): string {
  return s.replace(/^['"]|['"]$/g, '').trim();
}

/** Minimal YAML-frontmatter reader — handles `key: value`, comma lists,
 *  `[a, b]` inline arrays and `-` block lists. No yaml dependency. */
function parseFrontmatter(text: string): { fm: Record<string, any>; body: string } {
  if (!text.startsWith('---')) return { fm: {}, body: text };
  const end = text.indexOf('\n---', 3);
  if (end === -1) return { fm: {}, body: text };
  const raw = text.slice(3, end).trim();
  const body = text.slice(end + 4).replace(/^\r?\n/, '');
  const fm: Record<string, any> = {};
  let curKey: string | null = null;
  for (const line of raw.split(/\r?\n/)) {
    const item = line.match(/^\s*-\s+(.*)$/);
    if (item && curKey) {
      if (!Array.isArray(fm[curKey])) fm[curKey] = [];
      (fm[curKey] as string[]).push(stripQuotes(item[1]));
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/);
    if (kv) {
      curKey = kv[1];
      const v = kv[2].trim();
      if (v === '') fm[curKey] = '';
      else if (v.startsWith('[') && v.endsWith(']')) {
        fm[curKey] = v.slice(1, -1).split(',').map((s) => stripQuotes(s)).filter(Boolean);
      } else fm[curKey] = stripQuotes(v);
    }
  }
  return { fm, body };
}

function toList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string') return v.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}

function firstLine(s: string, max = 140): string {
  const line = (s || '').trim().split(/\r?\n/).find((l) => l.trim().length > 0) || '';
  return line.length > max ? line.slice(0, max - 1) + '…' : line;
}

/** Pull a filesystem path token out of a shell command, to existence-check it. */
function commandPath(cmd: string): string | null {
  const tokens = cmd.trim().split(/\s+/);
  for (const t of tokens) {
    const clean = stripQuotes(t);
    if (clean.includes('/') && !clean.startsWith('-')) return clean;
  }
  return null;
}

function exists(p: string | null): boolean {
  if (!p) return true; // nothing to check → assume ok
  try {
    return existsSync(p);
  } catch {
    return false;
  }
}

// ── Scope discovery ─────────────────────────────────────────────────────────

interface Scope {
  name: string;        // "user" | "project" | "project-local" | "enterprise"
  claudeDir: string;   // the .claude dir for this scope
  settingsFile: string;
}

function discoverScopes(root: string): Scope[] {
  const home = os.homedir();
  const scopes: Scope[] = [];
  // enterprise (mac path; best-effort)
  const ent = '/Library/Application Support/ClaudeCode/managed-settings.json';
  if (existsSync(ent)) {
    scopes.push({ name: 'enterprise', claudeDir: path.dirname(ent), settingsFile: ent });
  }
  // user
  const userDir = path.join(home, '.claude');
  if (existsSync(userDir)) {
    scopes.push({ name: 'user', claudeDir: userDir, settingsFile: path.join(userDir, 'settings.json') });
  }
  // project
  const projDir = path.join(root, '.claude');
  if (existsSync(projDir)) {
    scopes.push({ name: 'project', claudeDir: projDir, settingsFile: path.join(projDir, 'settings.json') });
    const local = path.join(projDir, 'settings.local.json');
    if (existsSync(local)) {
      scopes.push({ name: 'project-local', claudeDir: projDir, settingsFile: local });
    }
  }
  return scopes;
}

// ── Builder ─────────────────────────────────────────────────────────────────

export const claudeCodeAdapter: Adapter = {
  name: 'claude-code',
  priority: 100,

  detect(root: string): boolean {
    return (
      existsSync(path.join(root, '.claude')) ||
      existsSync(path.join(root, '.mcp.json')) ||
      existsSync(path.join(root, 'CLAUDE.md')) ||
      existsSync(path.join(os.homedir(), '.claude'))
    );
  },

  async scan(root: string): Promise<HarnessGraph> {
    const warnings: string[] = [];
    const nodes: HvNode[] = [];
    const edges: HvEdge[] = [];
    let edgeSeq = 0;
    const edge = (source: string, target: string, kind: HvEdge['kind'], animated = false): void => {
      edges.push({ id: `e${++edgeSeq}:${source}->${target}`, source, target, kind, animated });
    };

    const scopes = discoverScopes(root);
    const projectName = path.basename(root) || root;

    // ── Root node ─────────────────────────────────────────────────────────
    const rootClaudeMd = (await readText(path.join(root, 'CLAUDE.md'))) ??
      (await readText(path.join(root, '.claude', 'CLAUDE.md')));
    nodes.push({
      id: 'root',
      kind: 'root',
      label: projectName,
      group_id: 'g-root',
      data: {
        status: 'active',
        kind: 'root',
        emoji: '📁',
        description: rootClaudeMd ? firstLine(rootClaudeMd, 160) : 'Claude Code project root',
        source: root,
        subtitle: scopes.map((s) => s.name).join(' · ') || 'no settings found',
        detail: [
          { label: 'Path', value: root, mono: true },
          { label: 'Scopes', value: scopes.map((s) => s.name).join(', ') || 'none' },
          { label: 'CLAUDE.md', value: rootClaudeMd ? 'present' : 'none' },
        ],
      },
    });

    // ── Settings merge (for hooks + mcp from settings) ────────────────────
    const settingsByScope: { scope: Scope; data: any }[] = [];
    for (const s of scopes) {
      const data = await readJson(s.settingsFile);
      if (data) settingsByScope.push({ scope: s, data });
    }
    const mergedModel = settingsByScope.map((s) => s.data?.model).filter(Boolean).pop();
    if (mergedModel) {
      const rootNode = nodes[0];
      rootNode.data.detail!.push({ label: 'Model', value: String(mergedModel), mono: true });
      rootNode.data.subtitle = String(mergedModel);
    }

    // ── MCP servers ───────────────────────────────────────────────────────
    // Collected from <root>/.mcp.json + each scope's settings.mcpServers.
    // Project/.mcp.json wins on name collision.
    const mcpSeen = new Set<string>();
    const addMcp = (name: string, def: any, sourceLabel: string): void => {
      if (mcpSeen.has(name)) return;
      mcpSeen.add(name);
      const cmd: string = def?.command ?? '';
      const args: string[] = Array.isArray(def?.args) ? def.args : [];
      const type: string = def?.type ?? (def?.url ? 'http' : 'stdio');
      // Existence check for stdio servers that reference a script path.
      let problem: string | undefined;
      let status: NodeStatus = 'idle';
      if (type === 'stdio') {
        const scriptArg = args.find((a) => /\.(py|js|mjs|ts|sh)$/.test(a));
        const checkPath = scriptArg && scriptArg.includes('/') ? scriptArg
          : (cmd.includes('/') ? cmd : null);
        if (checkPath && !exists(checkPath)) {
          problem = `command path not found: ${checkPath}`;
          status = 'error';
        }
      }
      const detail: DetailRow[] = [
        { label: 'Type', value: type },
      ];
      if (cmd) detail.push({ label: 'Command', value: cmd, mono: true });
      if (args.length) detail.push({ label: 'Args', value: args.join(' '), mono: true });
      if (def?.url) detail.push({ label: 'URL', value: String(def.url), mono: true });
      detail.push({ label: 'Defined in', value: sourceLabel, mono: true });
      nodes.push({
        id: `mcp:${name}`,
        kind: 'mcp',
        label: name,
        group_id: 'g-mcp',
        data: {
          status, kind: 'mcp', emoji: '🔌',
          description: `MCP server (${type})`,
          source: sourceLabel,
          subtitle: type,
          problem,
          detail,
        },
      });
      edge('root', `mcp:${name}`, 'uses');
    };

    const dotMcp = await readJson(path.join(root, '.mcp.json'));
    if (dotMcp?.mcpServers) {
      for (const [name, def] of Object.entries(dotMcp.mcpServers)) {
        addMcp(name, def, path.join(root, '.mcp.json'));
      }
    }
    for (const { scope, data } of settingsByScope) {
      if (data?.mcpServers) {
        for (const [name, def] of Object.entries(data.mcpServers)) {
          addMcp(name, def, scope.settingsFile);
        }
      }
    }
    const mcpNames = new Set(mcpSeen);

    // ── Subagents, skills, commands (per scope; project wins) ─────────────
    const agentSeen = new Set<string>();
    const skillSeen = new Set<string>();
    const commandSeen = new Set<string>();

    // Process project scope before user scope so project definitions win.
    const orderedScopes = [...scopes].sort((a, b) => scopeRank(b.name) - scopeRank(a.name));

    for (const scope of orderedScopes) {
      // --- agents ---
      const agentFiles = await collectMarkdown(path.join(scope.claudeDir, 'agents'));
      for (const file of agentFiles) {
        const text = await readText(file);
        if (text == null) continue;
        const { fm, body } = parseFrontmatter(text);
        const name = String(fm.name || baseName(file));
        if (agentSeen.has(name)) continue;
        agentSeen.add(name);
        const tools = toList(fm.tools);
        const model = fm.model ? String(fm.model) : undefined;
        const id = `agent:${name}`;
        const detail: DetailRow[] = [{ label: 'Scope', value: scope.name }];
        if (model) detail.push({ label: 'Model', value: model, mono: true });
        if (tools.length) detail.push({ label: 'Tools', value: String(tools.length) });
        nodes.push({
          id, kind: 'agent', label: name, group_id: 'g-agent',
          data: {
            status: 'active', kind: 'agent', emoji: '🤖',
            description: String(fm.description || firstLine(body)),
            source: file,
            subtitle: model || `${tools.length || 'all'} tools`,
            badges: tools.slice(0, 12),
            detail,
          },
        });
        edge('root', id, 'hierarchy', true);
        // agent → mcp edges from explicit mcp__<server>__ tool grants
        const used = new Set<string>();
        for (const t of tools) {
          const m = t.match(/^mcp__([a-z0-9][a-z0-9-]*)/i);
          if (m && mcpNames.has(m[1])) used.add(m[1]);
          else if (mcpNames.has(t)) used.add(t);
        }
        for (const server of used) edge(id, `mcp:${server}`, 'uses');
      }

      // --- skills (flat *.md AND <name>/SKILL.md) ---
      const skillFiles = await collectSkills(path.join(scope.claudeDir, 'skills'));
      for (const { file, name: dirName } of skillFiles) {
        const text = await readText(file);
        if (text == null) continue;
        const { fm, body } = parseFrontmatter(text);
        const name = String(fm.name || dirName || baseName(file));
        if (skillSeen.has(name)) continue;
        skillSeen.add(name);
        const id = `skill:${name}`;
        nodes.push({
          id, kind: 'skill', label: name, group_id: 'g-skill',
          data: {
            status: 'idle', kind: 'skill', emoji: '✨',
            description: String(fm.description || firstLine(body)),
            source: file,
            subtitle: scope.name,
            detail: [{ label: 'Scope', value: scope.name }, { label: 'File', value: file, mono: true }],
          },
        });
        edge('root', id, 'owns');
      }

      // --- commands (nested *.md → namespaced slug) ---
      const commandsDir = path.join(scope.claudeDir, 'commands');
      const cmdFiles = await collectMarkdownDeep(commandsDir);
      for (const file of cmdFiles) {
        const rel = path.relative(commandsDir, file).replace(/\.md$/, '');
        const slug = '/' + rel.split(path.sep).join(':');
        if (commandSeen.has(slug)) continue;
        commandSeen.add(slug);
        const text = await readText(file);
        const { fm, body } = parseFrontmatter(text ?? '');
        const id = `command:${slug}`;
        nodes.push({
          id, kind: 'command', label: slug, group_id: 'g-command',
          data: {
            status: 'idle', kind: 'command', emoji: '⚡',
            description: String(fm.description || firstLine(body ?? '')),
            source: file,
            subtitle: scope.name,
            detail: [{ label: 'Scope', value: scope.name }, { label: 'File', value: file, mono: true }],
          },
        });
        edge('root', id, 'owns');
      }
    }

    // ── Hooks (from merged settings, tagged by scope) ─────────────────────
    let hookSeq = 0;
    for (const { scope, data } of settingsByScope) {
      const hooks = data?.hooks;
      if (!hooks || typeof hooks !== 'object') continue;
      for (const [event, matchers] of Object.entries(hooks)) {
        const matcherArr = Array.isArray(matchers) ? matchers : [];
        for (const matcher of matcherArr) {
          const hookList = (matcher as any)?.hooks;
          if (!Array.isArray(hookList)) continue;
          for (const h of hookList) {
            const cmd: string = h?.command ?? '';
            const cpath = commandPath(cmd);
            const broken = cpath != null && !exists(cpath);
            const id = `hook:${++hookSeq}`;
            const label = (matcher as any)?.matcher
              ? `${event} · ${(matcher as any).matcher}`
              : event;
            nodes.push({
              id, kind: 'hook', label, group_id: 'g-hook',
              data: {
                status: broken ? 'error' : 'idle',
                kind: 'hook', emoji: '🪝',
                description: h?.statusMessage || cmd,
                source: scope.settingsFile,
                subtitle: event,
                problem: broken ? `command path not found: ${cpath}` : undefined,
                detail: [
                  { label: 'Event', value: event },
                  { label: 'Type', value: String(h?.type || 'command') },
                  { label: 'Command', value: cmd || '(none)', mono: true },
                  { label: 'Scope', value: scope.name },
                ],
              },
            });
            edge('root', id, 'owns');
          }
        }
      }
    }

    // ── Plugins (best-effort) ─────────────────────────────────────────────
    try {
      await scanPlugins(nodes, edge, warnings);
    } catch (err) {
      warnings.push(`plugins: ${String(err)}`);
    }

    // ── Groups ────────────────────────────────────────────────────────────
    // The "spine" of a harness — root, subagents, plugins, MCPs — stays
    // expanded. Skills/commands/hooks are high-volume detail: collapsed by
    // default so the first paint reads cleanly, one toggle away from full.
    const groupDefs: Array<[string, string, string, boolean]> = [
      ['g-root', 'Project', 'root', false],
      ['g-agent', 'Subagents', 'agent', false],
      ['g-plugin', 'Plugins', 'plugin', false],
      ['g-mcp', 'MCP Servers', 'mcp', false],
      ['g-skill', 'Skills', 'skill', true],
      ['g-command', 'Commands', 'command', true],
      ['g-hook', 'Hooks', 'hook', true],
    ];
    const present = new Set(nodes.map((n) => n.group_id));
    const groups: HvGroup[] = groupDefs
      .filter(([id]) => present.has(id))
      .map(([id, label, kind, collapsed]) => ({ id, label, kind, collapsed_default: collapsed }));

    // ── Stats (only non-zero) ─────────────────────────────────────────────
    const countKind = (k: string) => nodes.filter((n) => n.kind === k).length;
    const stats: Record<string, number> = {};
    for (const k of ['agent', 'mcp', 'skill', 'command', 'hook', 'plugin']) {
      const c = countKind(k);
      if (c > 0) stats[pluralLabel(k)] = c;
    }
    const broken = nodes.filter((n) => n.data.status === 'error').length;
    if (broken > 0) stats['Broken'] = broken;

    return {
      generated_at: new Date().toISOString(),
      adapter: 'claude-code',
      root,
      title: projectName,
      scopes: scopes.map((s) => s.name),
      stats,
      kindStyles: KIND_STYLES,
      groups,
      nodes,
      edges,
      warnings,
    };
  },
};

// ── Plugin scanning ─────────────────────────────────────────────────────────

async function scanPlugins(
  nodes: HvNode[],
  edge: (s: string, t: string, k: HvEdge['kind'], a?: boolean) => void,
  warnings: string[],
): Promise<void> {
  const pluginsRoot = path.join(os.homedir(), '.claude', 'plugins');
  if (!existsSync(pluginsRoot)) return;
  const installed = await readJson(path.join(pluginsRoot, 'installed_plugins.json'));
  const installedNames = new Set<string>();
  if (installed && typeof installed === 'object') {
    for (const v of Object.values(installed as Record<string, any>)) {
      if (Array.isArray(v)) v.forEach((n) => installedNames.add(String(n)));
      else if (v && typeof v === 'object') Object.keys(v).forEach((n) => installedNames.add(n));
    }
  }
  // Walk marketplaces/*/<plugin> dirs looking for plugin manifests.
  const marketplaces = await listDirs(path.join(pluginsRoot, 'marketplaces'));
  const seen = new Set<string>();
  for (const mkt of marketplaces) {
    const candidates = [...(await listDirs(mkt))];
    // also one level deeper (marketplace/repo/plugins/*)
    for (const c of [...candidates]) {
      candidates.push(...(await listDirs(path.join(c, 'plugins'))));
    }
    for (const dir of candidates) {
      const manifest =
        (await readJson(path.join(dir, '.claude-plugin', 'plugin.json'))) ??
        (await readJson(path.join(dir, 'plugin.json')));
      if (!manifest) continue;
      const name = String(manifest.name || baseName(dir));
      if (seen.has(name)) continue;
      seen.add(name);
      const id = `plugin:${name}`;
      const nAgents = (await collectMarkdown(path.join(dir, 'agents'))).length;
      const nCommands = (await collectMarkdownDeep(path.join(dir, 'commands'))).length;
      const nSkills = (await collectSkills(path.join(dir, 'skills'))).length;
      nodes.push({
        id, kind: 'plugin', label: name, group_id: 'g-plugin',
        data: {
          status: installedNames.has(name) ? 'active' : 'idle',
          kind: 'plugin', emoji: '🧩',
          description: String(manifest.description || 'Claude Code plugin'),
          source: dir,
          subtitle: manifest.version ? `v${manifest.version}` : 'plugin',
          badges: [
            nAgents ? `${nAgents} agents` : '',
            nCommands ? `${nCommands} cmds` : '',
            nSkills ? `${nSkills} skills` : '',
          ].filter(Boolean),
          detail: [
            { label: 'Installed', value: installedNames.has(name) ? 'yes' : 'available' },
            { label: 'Path', value: dir, mono: true },
          ],
        },
      });
      edge('root', id, 'hierarchy');
    }
  }
  if (seen.size === 0 && installedNames.size > 0) {
    // Manifests not found but we know names — emit lightweight nodes.
    for (const name of installedNames) {
      const id = `plugin:${name}`;
      nodes.push({
        id, kind: 'plugin', label: name, group_id: 'g-plugin',
        data: {
          status: 'active', kind: 'plugin', emoji: '🧩',
          description: 'Installed plugin',
          source: pluginsRoot, subtitle: 'plugin',
          detail: [{ label: 'Installed', value: 'yes' }],
        },
      });
      edge('root', id, 'hierarchy');
    }
  }
}

// ── tiny utils ───────────────────────────────────────────────────────────────

function baseName(p: string): string {
  return path.basename(p).replace(/\.(md|json)$/, '');
}

function scopeRank(name: string): number {
  return { 'project-local': 4, project: 3, user: 2, enterprise: 1 }[name] ?? 0;
}

function pluralLabel(kind: string): string {
  return {
    agent: 'Agents', mcp: 'MCPs', skill: 'Skills',
    command: 'Commands', hook: 'Hooks', plugin: 'Plugins',
  }[kind] ?? kind;
}

/** Top-level *.md files in a dir (Claude Code subagents are flat). */
async function collectMarkdown(dir: string): Promise<string[]> {
  return (await listFiles(dir)).filter((f) => f.endsWith('.md') && !f.endsWith('.bak'));
}

/** Recursive *.md (commands support nested namespacing). */
async function collectMarkdownDeep(dir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (d: string) => {
    let ents;
    try {
      ents = await fs.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile() && e.name.endsWith('.md') && !e.name.endsWith('.bak')) out.push(full);
    }
  };
  await walk(dir);
  return out;
}

/** Skills come as flat `<skills>/name.md` OR `<skills>/name/SKILL.md`. */
async function collectSkills(dir: string): Promise<Array<{ file: string; name: string }>> {
  const out: Array<{ file: string; name: string }> = [];
  for (const f of await listFiles(dir)) {
    if (f.endsWith('.md') && !f.endsWith('.bak')) out.push({ file: f, name: baseName(f) });
  }
  for (const sub of await listDirs(dir)) {
    const skillMd = path.join(sub, 'SKILL.md');
    if (existsSync(skillMd)) out.push({ file: skillMd, name: path.basename(sub) });
  }
  return out;
}
