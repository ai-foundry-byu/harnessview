#!/usr/bin/env python3
"""
End-to-end npm publish via HTTP API — no npm CLI required.

1. Checks ~/.npmrc for existing token
2. If not found, opens npm web-auth login in the system browser and polls
3. Creates proper npm .tgz tarball using Python's tarfile module
4. Publishes directly to the npm registry REST API (PUT request)

Run: python3 ~/clawd/projects/harnessview/npm_publish_direct.py
"""
import base64
import gzip
import hashlib
import io
import json
import os
import re
import subprocess
import sys
import tarfile as tarmod
import time
import urllib.error
import urllib.request

REGISTRY = "https://registry.npmjs.org"
REPO = os.path.expanduser("~/code/harnessview")
NPMRC = os.path.expanduser("~/.npmrc")
TIMEOUT_SEC = 3600   # 1 hour total
SESSION_TIMEOUT = 600  # renew session every 10 min
POLL_INTERVAL = 5


# ── helpers ──────────────────────────────────────────────────────────────────

def post_json(url, body, token=None):
    data = json.dumps(body).encode()
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "npm-auth-type": "web",
        "User-Agent": "npm/10.0.0 node/v20.0.0",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read())


def get_json(url, token=None):
    headers = {"Accept": "application/json", "User-Agent": "npm/10.0.0 node/v20.0.0"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read()), resp.status
    except urllib.error.HTTPError as e:
        body = None
        try:
            body = json.loads(e.read())
        except Exception:
            pass
        return body, e.code


def put_json(url, body, token):
    data = json.dumps(body).encode()
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "User-Agent": "npm/10.0.0 node/v20.0.0",
        "npm-command": "publish",
    }
    req = urllib.request.Request(url, data=data, headers=headers, method="PUT")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read()), resp.status
    except urllib.error.HTTPError as e:
        body = None
        try:
            body = json.loads(e.read())
        except Exception:
            pass
        return body, e.code


def open_browser(url):
    try:
        subprocess.run(["open", url], check=True, capture_output=True)
        return True
    except Exception:
        pass
    try:
        import webbrowser
        webbrowser.open(url)
        return True
    except Exception:
        return False


def notify(title, message):
    try:
        script = f'display notification "{message}" with title "{title}" sound name "Ping"'
        subprocess.run(["osascript", "-e", script], capture_output=True, timeout=5)
    except Exception:
        pass


# ── token acquisition ─────────────────────────────────────────────────────────

def token_from_npmrc():
    if not os.path.exists(NPMRC):
        return None
    with open(NPMRC) as f:
        for line in f:
            m = re.search(r"_authToken=(.+)", line.strip())
            if m:
                t = m.group(1).strip()
                if t:
                    return t
    return None


def write_token(token):
    existing = ""
    if os.path.exists(NPMRC):
        with open(NPMRC) as f:
            lines = [l for l in f.read().splitlines() if "_authToken" not in l]
            existing = "\n".join(lines) + "\n" if lines else ""
    with open(NPMRC, "w") as f:
        f.write(existing + f"//registry.npmjs.org/:_authToken={token}\n")
    print(f"  ✓ Token written to {NPMRC}")


def start_session():
    session = post_json(f"{REGISTRY}/-/v1/login", {"hostname": "davenportmini"})
    return session.get("loginUrl", ""), session.get("doneUrl", "")


def web_auth_flow():
    """Open real browser for npm login, poll until token arrives. Auto-renews sessions."""
    notify("harnessview M2", "npm login browser opening — please log in or create account")

    login_url, done_url = start_session()
    if not login_url:
        print("ERROR: could not create login session")
        return None

    def show_prompt(url):
        print(f"\n{'='*60}")
        print(f"  NPM LOGIN REQUIRED — harnessview M2")
        print(f"{'='*60}")
        print(f"  URL: {url}")
        print(f"  → Log in, OR click 'Create an account'")
        print(f"    (username: jddavenport, email: jddavenport46@gmail.com)")
        print(f"    then verify email and click Authorize")
        print(f"{'='*60}\n")
        open_browser(url)

    show_prompt(login_url)

    deadline = time.time() + TIMEOUT_SEC
    session_deadline = time.time() + SESSION_TIMEOUT
    while time.time() < deadline:
        time.sleep(POLL_INTERVAL)
        remaining = int(deadline - time.time())
        try:
            data, status = get_json(done_url)
            if status == 200 and data and "token" in data:
                print(f"\n  ✓ Login successful! Token received.")
                notify("harnessview M2", "npm login complete — publishing now!")
                return data["token"]
            elif status == 202:
                print(f"  Waiting for npm login... ({remaining}s remaining)", flush=True)
                if time.time() > session_deadline:
                    print("  Session timeout — creating new session and reopening browser...")
                    notify("harnessview M2", "npm login still needed — browser reopening")
                    login_url, done_url = start_session()
                    session_deadline = time.time() + SESSION_TIMEOUT
                    show_prompt(login_url)
            elif status == 404:
                print("  Session expired — creating new session...")
                login_url, done_url = start_session()
                session_deadline = time.time() + SESSION_TIMEOUT
                show_prompt(login_url)
        except Exception as e:
            print(f"  Polling... ({remaining}s) [{e}]", flush=True)

    print(f"\nTIMEOUT after {TIMEOUT_SEC}s: No login completed.")
    return None


# ── tarball creation ──────────────────────────────────────────────────────────

def should_include(rel_path, files_spec):
    """Check if a file should be in the npm package."""
    always = {"package.json", "README.md", "README", "LICENSE", "LICENSE.md",
               "CHANGELOG.md", "NOTICE"}
    if rel_path in always:
        return True
    if rel_path.startswith("."):
        return False
    for spec in files_spec:
        spec = spec.rstrip("/")
        if rel_path == spec:
            return True
        if rel_path.startswith(spec + "/") or rel_path.startswith(spec + os.sep):
            return True
    return False


def create_tarball(pkg_json):
    name = pkg_json["name"]
    version = pkg_json["version"]
    tarball_name = f"{name}-{version}.tgz"
    tarball_path = f"/tmp/{tarball_name}"
    files_spec = pkg_json.get("files", [])

    print(f"  Creating {tarball_name}...")
    included = []
    with tarmod.open(tarball_path, "w:gz") as tar:
        for root, dirs, files in os.walk(REPO):
            dirs[:] = sorted(
                d for d in dirs
                if not d.startswith(".") and d not in ("node_modules", ".git")
            )
            for fname in sorted(files):
                full_path = os.path.join(root, fname)
                rel_path = os.path.relpath(full_path, REPO)
                if should_include(rel_path, files_spec):
                    tar.add(full_path, arcname=f"package/{rel_path}")
                    included.append(rel_path)

    for f in included:
        print(f"    + {f}")
    print(f"  ✓ Tarball: {tarball_path} ({len(included)} files)")
    return tarball_path, tarball_name


def tarball_hashes(path):
    sha512 = hashlib.sha512()
    sha1 = hashlib.sha1()
    size = 0
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            sha512.update(chunk)
            sha1.update(chunk)
            size += len(chunk)
    integrity = "sha512-" + base64.b64encode(sha512.digest()).decode()
    return integrity, sha1.hexdigest(), size


# ── publish ───────────────────────────────────────────────────────────────────

def publish(token, pkg_json, tarball_path, tarball_name):
    name = pkg_json["name"]
    version = pkg_json["version"]

    with open(tarball_path, "rb") as f:
        tarball_bytes = f.read()
    tarball_b64 = base64.b64encode(tarball_bytes).decode()
    integrity, shasum, size = tarball_hashes(tarball_path)

    tarball_url = f"{REGISTRY}/{name}/-/{tarball_name}"

    version_meta = {k: v for k, v in pkg_json.items()}
    version_meta["_id"] = f"{name}@{version}"
    version_meta["dist"] = {
        "integrity": integrity,
        "shasum": shasum,
        "tarball": tarball_url,
    }

    body = {
        "_id": name,
        "name": name,
        "description": pkg_json.get("description", ""),
        "dist-tags": {"latest": version},
        "versions": {version: version_meta},
        "_attachments": {
            tarball_name: {
                "content_type": "application/octet-stream",
                "data": tarball_b64,
                "length": size,
            }
        },
    }

    print(f"  Uploading to registry ({size:,} bytes tarball)...")
    result, status = put_json(f"{REGISTRY}/{name}", body, token)

    if status in (200, 201):
        print(f"\n✓✓✓ Published {name}@{version} to npm!")
        print(f"    https://www.npmjs.com/package/{name}")
        return True
    else:
        print(f"\nPublish failed (HTTP {status}):")
        print(json.dumps(result, indent=2))
        return False


# ── main ──────────────────────────────────────────────────────────────────────

def main():
    print("=== harnessview → npm (direct HTTP publish, no npm CLI) ===\n")

    with open(os.path.join(REPO, "package.json")) as f:
        pkg_json = json.load(f)
    print(f"Package: {pkg_json['name']}@{pkg_json['version']}")

    # 1. Check if already published
    existing, status = get_json(f"{REGISTRY}/{pkg_json['name']}/{pkg_json['version']}")
    if status == 200:
        print(f"\n✓ {pkg_json['name']}@{pkg_json['version']} already published on npm!")
        print(f"  https://www.npmjs.com/package/{pkg_json['name']}")
        return True

    # 2. Get auth token
    print("\n→ Getting auth token...")
    token = token_from_npmrc()
    if token:
        print(f"  Found existing token in ~/.npmrc")
    else:
        token = web_auth_flow()
        if not token:
            print("\nBLOCKED: No npm token obtained. Exiting.")
            return False
        write_token(token)

    # 3. Verify token works
    print("\n→ Verifying token...")
    me, status = get_json(f"{REGISTRY}/-/whoami", token=token)
    if status == 200 and me:
        print(f"  Logged in as: {me.get('username', '?')}")
    else:
        print(f"  Warning: token verify returned {status}: {me}")

    # 4. Create tarball
    print("\n→ Building package tarball...")
    tarball_path, tarball_name = create_tarball(pkg_json)

    # 5. Publish
    print("\n→ Publishing to npm registry...")
    return publish(token, pkg_json, tarball_path, tarball_name)


if __name__ == "__main__":
    ok = main()
    sys.exit(0 if ok else 1)
