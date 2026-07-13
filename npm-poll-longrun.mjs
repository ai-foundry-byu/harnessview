/**
 * npm-poll-longrun.mjs — Long-running npm login poller with auto-renewal.
 * Runs up to 24 hours. Auto-renews session on expiry. Auto-publishes on login.
 * Launched by run 11 (2026-07-05).
 */
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const REGISTRY = 'https://registry.npmjs.org';
const REPO = join(homedir(), 'code', 'harnessview');
const NPMRC = join(homedir(), '.npmrc');
const OUTBOX_DIR = join(homedir(), 'agent-system', 'state', 'telegram-outbox');
const LOG_FILE = join(homedir(), 'clawd', 'projects', 'harnessview', 'npm-poll-longrun.log');
const MAX_RUNTIME_MS = 24 * 60 * 60 * 1000; // 24 hours
const SESSION_DURATION_MS = 8 * 60 * 1000;   // Renew every 8 min (sessions last ~10min)

const sleep = ms => new Promise(r => setTimeout(r, ms));

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { appendFileSync(LOG_FILE, line + '\n'); } catch {}
}

function dropTelegram(text) {
  try {
    mkdirSync(OUTBOX_DIR, { recursive: true });
    const fname = `drop-npm-longrun-${Date.now()}.json`;
    writeFileSync(join(OUTBOX_DIR, fname), JSON.stringify({ kind: 'send', text, source: 'harnessview-m2' }));
    log(`Telegram drop: ${fname}`);
  } catch (e) {
    log(`Telegram drop failed: ${e.message}`);
  }
}

function openBrowser(url) {
  try {
    execSync(`open "${url}"`, { stdio: 'ignore' });
    log(`Browser opened: ${url}`);
  } catch (e) {
    log(`Browser open failed: ${e.message}`);
  }
}

async function createSession() {
  const r = await fetch(`${REGISTRY}/-/v1/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'npm-auth-type': 'web', 'User-Agent': 'npm/10.0.0' },
    body: JSON.stringify({ hostname: 'davenportmini' }),
  });
  return await r.json();
}

function writeToken(token) {
  let existing = '';
  if (existsSync(NPMRC)) {
    existing = readFileSync(NPMRC, 'utf8').split('\n').filter(l => !l.includes('_authToken')).join('\n');
    if (existing && !existing.endsWith('\n')) existing += '\n';
  }
  writeFileSync(NPMRC, `${existing}//registry.npmjs.org/:_authToken=${token}\n`);
  log('Token written to ~/.npmrc');
}

function createTarball(pkgJson) {
  const { name, version } = pkgJson;
  const tarPath = `/tmp/${name}-${version}.tgz`;
  const filesSpec = pkgJson.files || [];
  const always = new Set(['package.json', 'README.md', 'LICENSE', 'CHANGELOG.md']);

  const allFiles = execSync(`find "${REPO}" -type f -not -path "*/node_modules/*" -not -path "*/.git/*"`, { encoding: 'utf8' })
    .split('\n').filter(Boolean);

  const files = allFiles.filter(f => {
    const rel = f.slice(REPO.length + 1);
    if (!rel || rel.startsWith('.')) return false;
    if (always.has(rel)) return true;
    return filesSpec.some(spec => {
      const s = spec.replace(/\/$/, '');
      return rel === s || rel.startsWith(s + '/');
    });
  });

  log(`Creating tarball: ${files.length} files → ${tarPath}`);

  const escapedPaths = files.map(f => `"${f.replace(/"/g, '\\"')}"`).join(' ');
  const escRepo = REPO.replace(/\//g, '\\/').replace(/\./g, '\\.');
  execSync(`tar -czf "${tarPath}" --transform='s,^${escRepo}/,package/,' ${escapedPaths}`, { shell: true });

  const content = readFileSync(tarPath);
  const sha512 = `sha512-${createHash('sha512').update(content).digest('base64')}`;
  const sha1 = createHash('sha1').update(content).digest('hex');
  log(`Tarball: ${content.length.toLocaleString()} bytes`);

  return { tarPath, tarName: `${name}-${version}.tgz`, tarB64: content.toString('base64'), integrity: sha512, sha1, size: content.length };
}

async function publishPackage(token, pkgJson) {
  const { name, version } = pkgJson;
  const { tarName, tarB64, integrity, sha1, size } = createTarball(pkgJson);

  const versionMeta = { ...pkgJson, _id: `${name}@${version}`, dist: { integrity, shasum: sha1, tarball: `${REGISTRY}/${name}/-/${tarName}` } };
  const body = {
    _id: name, name, description: pkgJson.description || '',
    'dist-tags': { latest: version },
    versions: { [version]: versionMeta },
    _attachments: { [tarName]: { content_type: 'application/octet-stream', data: tarB64, length: size } },
  };

  log(`Publishing ${name}@${version} (${size.toLocaleString()} bytes)...`);
  const r = await fetch(`${REGISTRY}/${name}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, Accept: 'application/json', 'User-Agent': 'npm/10.0.0', 'npm-command': 'publish' },
    body: JSON.stringify(body),
  });
  const result = await r.json().catch(() => ({}));
  if (r.status === 200 || r.status === 201) {
    log(`Published! https://www.npmjs.com/package/${name}`);
    return true;
  }
  log(`Publish failed HTTP ${r.status}: ${JSON.stringify(result)}`);
  return false;
}

async function main() {
  log('=== npm-poll-longrun starting (24h window) ===');

  const pkgJson = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'));

  // Check if already published
  const existing = await fetch(`${REGISTRY}/${pkgJson.name}/${pkgJson.version}`, { headers: { Accept: 'application/json' } });
  if (existing.status === 200) {
    log('Already published! https://www.npmjs.com/package/harnessview');
    process.exit(0);
  }

  const deadline = Date.now() + MAX_RUNTIME_MS;
  let session = null;
  let sessionDeadline = 0;
  let pollTick = 0;

  while (Date.now() < deadline) {
    // Create/renew session if needed
    if (!session || Date.now() > sessionDeadline) {
      try {
        session = await createSession();
        sessionDeadline = Date.now() + SESSION_DURATION_MS;
        const loginUrl = session.loginUrl;
        log(`Session URL: ${loginUrl}`);
        openBrowser(loginUrl);
        if (pollTick > 0) { // Don't spam Telegram on first session (Python script already did)
          dropTelegram(`harnessview npm — renewed session:\n${loginUrl}\n\nTap on iPhone → Continue with GitHub → Authorize.`);
        }
        pollTick = 0;
      } catch (e) {
        log(`Session create error: ${e.message}`);
        await sleep(10000);
        continue;
      }
    }

    await sleep(5000);

    try {
      const r = await fetch(session.doneUrl, { headers: { Accept: 'application/json', 'User-Agent': 'npm/10.0.0' } });
      if (r.status === 200) {
        const body = await r.json();
        if (body.token) {
          log('LOGIN DETECTED! Token received.');
          writeToken(body.token);
          const ok = await publishPackage(body.token, pkgJson);
          if (ok) {
            dropTelegram('🎉 harnessview v0.1.0 PUBLISHED on npm!\n\nnpx harnessview is now live.\nhttps://www.npmjs.com/package/harnessview');
            writeFileSync('/tmp/harnessview-m2-done.txt', `published ${new Date().toISOString()}\n`);
            process.exit(0);
          } else {
            dropTelegram('harnessview M2: login detected but publish failed. Token is in ~/.npmrc — try: npm publish --access public from ~/code/harnessview');
            process.exit(2);
          }
        }
      } else if (r.status === 404) {
        log('Session expired — renewing...');
        session = null;
        sessionDeadline = 0;
        continue;
      } else if (r.status === 202) {
        if (pollTick % 60 === 0) { // Every 5 minutes (60 * 5s)
          const remaining = Math.round((deadline - Date.now()) / 60000);
          log(`Waiting for login... (${remaining}min remaining)`);
        }
        pollTick++;
      }
    } catch (e) {
      log(`Poll error: ${e.message}`);
    }
  }

  log('24-hour timeout reached. Exiting.');
  dropTelegram('harnessview M2: 24-hour polling window expired. Run npm-poll-longrun.mjs again when ready to publish.');
  process.exit(1);
}

main();
