#!/usr/bin/env node
// harnessview CLI — `npx harnessview [path] [--port N] [--no-open]`
//
// Sets HV_* env and hands off to the local server. Prefers the built server
// (dist/server/index.js); in a dev checkout with no build it falls back to
// running the TypeScript source via tsx.

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');

const argv = process.argv.slice(2);
let target = process.cwd();
let port = process.env.HV_PORT || '4317';
let open = true;

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--help' || a === '-h') {
    printHelp();
    process.exit(0);
  } else if (a === '--port' || a === '-p') {
    port = argv[++i];
  } else if (a === '--no-open') {
    open = false;
  } else if (!a.startsWith('-')) {
    target = path.resolve(a);
  }
}

if (!existsSync(target)) {
  console.error(`harnessview: path not found: ${target}`);
  process.exit(1);
}

process.env.HV_ROOT = target;
process.env.HV_PORT = String(port);
process.env.HV_OPEN = open ? '1' : '0';

const built = path.join(PKG, 'dist', 'server', 'index.js');
if (existsSync(built)) {
  await import(pathToFileUrl(built));
} else {
  // Dev fallback: run the TS source through tsx.
  const src = path.join(PKG, 'src', 'server', 'index.ts');
  const child = spawn('npx', ['tsx', src], { stdio: 'inherit', env: process.env });
  child.on('exit', (code) => process.exit(code ?? 0));
}

function pathToFileUrl(p) {
  return new URL(`file://${p}`).href;
}

function printHelp() {
  console.log(`
  harnessview — visually inspect your Claude Code agent harness

  Usage:
    npx harnessview [path] [options]

  Arguments:
    path             directory to scan (default: current directory)

  Options:
    -p, --port <n>   port to serve on (default: 4317)
    --no-open        don't auto-open the browser
    -h, --help       show this help

  Opens a local web UI graphing your subagents, MCP servers, skills,
  commands, hooks, and plugins. Runs fully offline.
`);
}
