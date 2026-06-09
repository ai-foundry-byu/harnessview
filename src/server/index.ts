// ═══════════════════════════════════════════════════════════════════════════
// harnessview local server
//
// Runs on the user's machine, so unlike nerve-center-v5 (which had to mirror
// the filesystem into Supabase because Vercel couldn't read the Mac) this just
// scans the fs on demand and watches it for changes.
//
//   GET /api/graph   → scan the harness, return HarnessGraph JSON
//   GET /events      → Server-Sent Events; emits `change` when config changes
//   GET /*           → static files from the built UI (dist/ui), SPA fallback
//
// Config via env (set by bin/harnessview.mjs):
//   HV_ROOT  target dir to scan          (default: process.cwd())
//   HV_PORT  port                        (default: 4317)
//   HV_OPEN  '0' to skip opening browser (default: open)
//   HV_UI    path to built UI dir        (default: <pkg>/dist/ui)
// ═══════════════════════════════════════════════════════════════════════════

import http from 'node:http';
import { promises as fs, existsSync, watch, type FSWatcher } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scanHarness } from '../adapters/index.js';

const ROOT = path.resolve(process.env.HV_ROOT || process.cwd());
const PORT = Number(process.env.HV_PORT || 4317);
const HERE = path.dirname(fileURLToPath(import.meta.url));
// dist/server/index.js → dist/ui
const UI_DIR = process.env.HV_UI || path.resolve(HERE, '..', 'ui');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

// ── SSE clients + filesystem watch ──────────────────────────────────────────

const clients = new Set<http.ServerResponse>();

function broadcast(): void {
  const payload = `event: change\ndata: ${Date.now()}\n\n`;
  for (const res of clients) {
    try {
      res.write(payload);
    } catch {
      /* drop dead client on next sweep */
    }
  }
}

// Files that churn constantly and must NOT trigger a re-scan.
const IGNORE = /(?:^|[/\\])(?:history\.jsonl|.*\.lock|.*\.log|.*\.bak)$|(?:^|[/\\])(?:sessions|file-history|shell-snapshots|session-env|telemetry|paste-cache|debug|backups|projects|cache|todos|statsig|worktrees)(?:[/\\]|$)/i;

let debounceTimer: NodeJS.Timeout | null = null;
function onFsEvent(filename: string | null): void {
  if (filename && IGNORE.test(filename)) return;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(broadcast, 300);
}

function startWatchers(): FSWatcher[] {
  const userDir = path.join(os.homedir(), '.claude');
  const targets: Array<{ dir: string; recursive: boolean }> = [
    { dir: ROOT, recursive: false }, // catches .mcp.json, CLAUDE.md
    { dir: path.join(ROOT, '.claude'), recursive: true },
    { dir: userDir, recursive: false }, // settings.json (recursive would catch noisy history)
    { dir: path.join(userDir, 'agents'), recursive: true },
    { dir: path.join(userDir, 'skills'), recursive: true },
    { dir: path.join(userDir, 'commands'), recursive: true },
  ];
  const watchers: FSWatcher[] = [];
  for (const { dir, recursive } of targets) {
    if (!existsSync(dir)) continue;
    try {
      watchers.push(watch(dir, { recursive }, (_e, filename) => onFsEvent(filename)));
    } catch {
      /* watch unsupported for this target — skip */
    }
  }
  return watchers;
}

// ── HTTP handlers ───────────────────────────────────────────────────────────

async function serveStatic(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  let filePath = path.join(UI_DIR, urlPath);
  // prevent path traversal
  if (!filePath.startsWith(UI_DIR)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  if (!existsSync(filePath)) {
    // SPA fallback
    filePath = path.join(UI_DIR, 'index.html');
    if (!existsSync(filePath)) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end(
        'UI not built. Run `npm run build` (or use `npm run dev` for the Vite dev server).',
      );
      return;
    }
  }
  try {
    const body = await fs.readFile(filePath);
    res.writeHead(200, { 'content-type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(500).end('read error');
  }
}

const server = http.createServer(async (req, res) => {
  const url = (req.url || '/').split('?')[0];

  if (url === '/api/graph') {
    try {
      const graph = await scanHarness(ROOT);
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(graph));
    } catch (err) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  if (url === '/events') {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    res.write('retry: 3000\n\n');
    clients.add(res);
    const keepAlive = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        /* noop */
      }
    }, 25000);
    req.on('close', () => {
      clearInterval(keepAlive);
      clients.delete(res);
    });
    return;
  }

  await serveStatic(req, res);
});

function openBrowser(url: string): void {
  if (process.env.HV_OPEN === '0') return;
  const cmd = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
  } catch {
    /* user can open it manually */
  }
}

server.listen(PORT, () => {
  startWatchers();
  const url = `http://localhost:${PORT}`;
  // eslint-disable-next-line no-console
  console.log(`\n  harnessview  ▸  ${url}`);
  // eslint-disable-next-line no-console
  console.log(`  scanning     ▸  ${ROOT}\n`);
  openBrowser(url);
});
