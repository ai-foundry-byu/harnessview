/**
 * npm-poll-fresh.mjs — Poll a specific npm login session and publish when token received.
 * Session: 09d154ae-2c77-4d4b-acf8-6a730e88fcb6
 */
import { createHash } from 'node:crypto';
import { execSync, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const DONE_URL = 'https://registry.npmjs.org/-/v1/done?sessionId=09d154ae-2c77-4d4b-acf8-6a730e88fcb6';
const REGISTRY = 'https://registry.npmjs.org';
const REPO = join(homedir(), 'code', 'harnessview');
const NPMRC = join(homedir(), '.npmrc');
const OUTBOX_DIR = join(homedir(), 'agent-system', 'state', 'telegram-outbox');
const TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

const sleep = ms => new Promise(r => setTimeout(r, ms));

function dropTelegram(text) {
  try {
    mkdirSync(OUTBOX_DIR, { recursive: true });
    const fname = `drop-npm-poll-${Date.now()}.json`;
    writeFileSync(join(OUTBOX_DIR, fname), JSON.stringify({ kind: 'send', text, source: 'harnessview-m2' }));
    console.log('Telegram outbox drop:', fname);
  } catch (e) {
    console.log('Telegram drop failed:', e.message);
  }
}

async function pollForToken() {
  const deadline = Date.now() + TIMEOUT_MS;
  let tick = 0;
  while (Date.now() < deadline) {
    await sleep(5000);
    try {
      const r = await fetch(DONE_URL, { headers: { Accept: 'application/json', 'User-Agent': 'npm/10.0.0' } });
      const body = await r.json();
      if (r.status === 200 && body.token) {
        console.log('\n✓ Login detected! Token received.');
        return body.token;
      }
      if (r.status === 202) {
        if (tick % 12 === 0) console.log(`Polling (${Math.round((deadline - Date.now()) / 60000)}min remaining)...`);
        tick++;
      } else {
        console.log(`Poll status ${r.status}:`, JSON.stringify(body));
        if (r.status === 404) {
          console.log('Session expired — stopping poll.');
          return null;
        }
      }
    } catch (e) {
      console.log('Poll error:', e.message);
    }
  }
  return null;
}

function writeToken(token) {
  let existing = '';
  if (existsSync(NPMRC)) {
    existing = readFileSync(NPMRC, 'utf8').split('\n').filter(l => !l.includes('_authToken')).join('\n');
    if (!existing.endsWith('\n')) existing += '\n';
  }
  writeFileSync(NPMRC, `${existing}//registry.npmjs.org/:_authToken=${token}\n`);
  console.log('Token written to ~/.npmrc');
}

function createTarball(pkgJson) {
  const { name, version } = pkgJson;
  const tarPath = `/tmp/${name}-${version}.tgz`;
  const filesSpec = pkgJson.files || [];

  // Always include these regardless of files field
  const always = new Set(['package.json', 'README.md', 'LICENSE', 'CHANGELOG.md']);

  // Build include pattern: files field entries + always-include
  // Use find + tar to create the tarball with correct package/ prefix
  const includeArgs = [...filesSpec, ...always].filter(Boolean).map(f => f.replace(/\/$/, ''));

  // Use a find-based approach to get the file list respecting the files field
  const getFiles = () => {
    const allFiles = execSync(`find "${REPO}" -type f -not -path "*/node_modules/*" -not -path "*/.git/*"`, { encoding: 'utf8' })
      .split('\n').filter(Boolean);
    return allFiles.filter(f => {
      const rel = f.slice(REPO.length + 1);
      if (rel.startsWith('.')) return false;
      if (always.has(rel)) return true;
      return filesSpec.some(spec => {
        const s = spec.replace(/\/$/, '');
        return rel === s || rel.startsWith(s + '/');
      });
    });
  };

  const files = getFiles();
  console.log(`Creating tarball with ${files.length} files: ${tarPath}`);

  // Write a list file for tar
  const listFile = `/tmp/harnessview-files.txt`;
  writeFileSync(listFile, files.join('\n'));

  // Create tarball with package/ prefix transform
  execSync(`tar -czf "${tarPath}" --transform='s,^${REPO.replace(/\//g, '\\/')}/,package/,' ${files.map(f => `"${f}"`).join(' ')}`, { shell: true });

  const tarContent = readFileSync(tarPath);
  const sha512 = createHash('sha512').update(tarContent).digest('base64');
  const sha1 = createHash('sha1').update(tarContent).digest('hex');
  const integrity = `sha512-${sha512}`;
  const tarB64 = tarContent.toString('base64');
  const tarName = `${name}-${version}.tgz`;

  console.log(`Tarball: ${tarContent.length} bytes`);
  return { tarPath, tarName, tarB64, integrity, sha1, size: tarContent.length };
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

  console.log(`Publishing ${name}@${version} (${size.toLocaleString()} bytes)...`);
  const r = await fetch(`${REGISTRY}/${name}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'User-Agent': 'npm/10.0.0',
      'npm-command': 'publish',
    },
    body: JSON.stringify(body),
  });
  const result = await r.json().catch(() => ({}));
  if (r.status === 200 || r.status === 201) {
    console.log(`\n✅ Published! https://www.npmjs.com/package/${name}`);
    return true;
  }
  console.log(`✗ Publish failed HTTP ${r.status}:`, JSON.stringify(result));
  return false;
}

async function main() {
  console.log('=== npm-poll-fresh: polling session 09d154ae ===');
  console.log('Login URL: https://www.npmjs.com/login?next=/login/cli/09d154ae-2c77-4d4b-acf8-6a730e88fcb6\n');

  const pkgJson = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'));

  // Check if already published
  const existing = await fetch(`${REGISTRY}/${pkgJson.name}/${pkgJson.version}`, { headers: { Accept: 'application/json' } });
  if (existing.status === 200) {
    console.log('Already published! https://www.npmjs.com/package/harnessview');
    dropTelegram('harnessview ALREADY PUBLISHED ✅ https://www.npmjs.com/package/harnessview');
    process.exit(0);
  }

  console.log('Polling for JD to log in (up to 30 min)...');
  const token = await pollForToken();

  if (!token) {
    console.log('TIMEOUT: no login in 30 min. Session may have expired.');
    dropTelegram('harnessview M2: npm session timed out (30min). Run npm-poll-fresh.mjs again or log in and run publish.sh manually.');
    process.exit(1);
  }

  writeToken(token);

  const ok = await publishPackage(token, pkgJson);
  if (ok) {
    dropTelegram('🎉 harnessview v0.1.0 PUBLISHED on npm!\n\nnpx harnessview is now live.\nhttps://www.npmjs.com/package/harnessview\n\nM2 complete.');
    // Write a success signal file
    writeFileSync('/tmp/harnessview-m2-done.txt', `published at ${new Date().toISOString()}\n`);
    process.exit(0);
  } else {
    dropTelegram('harnessview M2: publish attempt failed after login. Check /tmp/npm-poll-fresh.log for details.');
    process.exit(2);
  }
}

main();
