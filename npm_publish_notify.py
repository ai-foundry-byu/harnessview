#!/usr/bin/env python3
"""
M2 publish helper: generates npm login session, notifies JD via outbox relay,
opens browser, then polls and auto-publishes when login completes.

Run from background:
  nohup python3 ~/clawd/projects/harnessview/npm_publish_notify.py > /tmp/npm-publish-notify.log 2>&1 &
"""
import base64
import hashlib
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
OUTBOX_DIR = os.path.expanduser("~/agent-system/state/telegram-outbox")
TIMEOUT_SEC = 3600   # 1 hour
POLL_INTERVAL = 5


def drop_outbox(text, source="harnessview-m2"):
    """Drop a Telegram outbox file for the relay to pick up."""
    os.makedirs(OUTBOX_DIR, exist_ok=True)
    fname = f".drop-{int(time.time())}.tmp"
    final = fname.replace(".tmp", ".json").lstrip(".")
    payload = json.dumps({"kind": "send", "text": text, "source": source})
    tmp_path = os.path.join(OUTBOX_DIR, fname)
    final_path = os.path.join(OUTBOX_DIR, final)
    with open(tmp_path, "w") as f:
        f.write(payload)
    os.rename(tmp_path, final_path)
    print(f"  Outbox drop: {final}")


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
    return False


def notify_macos(title, message):
    try:
        script = f'display notification "{message}" with title "{title}" sound name "Ping"'
        subprocess.run(["osascript", "-e", script], capture_output=True, timeout=5)
    except Exception:
        pass


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
    print(f"  Token written to {NPMRC}")


def should_include(rel_path, files_spec):
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

    print(f"  Tarball: {tarball_path} ({len(included)} files)")
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


def publish_package(token, pkg_json, tarball_path, tarball_name):
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

    print(f"  Uploading ({size:,} bytes)...")
    result, status = put_json(f"{REGISTRY}/{name}", body, token)

    if status in (200, 201):
        print(f"\nPublished {name}@{version}!")
        print(f"  https://www.npmjs.com/package/{name}")
        return True
    else:
        print(f"\nPublish failed (HTTP {status}): {json.dumps(result, indent=2)}")
        return False


def poll_for_token(done_url, login_url):
    """Poll doneUrl, auto-renew session on expiry."""
    deadline = time.time() + TIMEOUT_SEC
    session_deadline = time.time() + 600

    current_done_url = done_url

    while time.time() < deadline:
        time.sleep(POLL_INTERVAL)
        remaining = int(deadline - time.time())
        try:
            data, status = get_json(current_done_url)
            if status == 200 and data and "token" in data:
                print(f"\n  Login successful!")
                return data["token"]
            elif status == 202:
                print(f"  Waiting... ({remaining}s remaining)", flush=True)
                if time.time() > session_deadline:
                    print("  Renewing session...")
                    session = post_json(f"{REGISTRY}/-/v1/login", {"hostname": "davenportmini"})
                    new_login = session.get("loginUrl", "")
                    current_done_url = session.get("doneUrl", "")
                    session_deadline = time.time() + 600
                    open_browser(new_login)
                    drop_outbox(f"harnessview M2: session renewed. New npm login:\n{new_login}")
            elif status == 404:
                print("  Session expired — renewing...")
                session = post_json(f"{REGISTRY}/-/v1/login", {"hostname": "davenportmini"})
                new_login = session.get("loginUrl", "")
                current_done_url = session.get("doneUrl", "")
                session_deadline = time.time() + 600
                print(f"  New login URL: {new_login}")
                open_browser(new_login)
                drop_outbox(f"harnessview M2: session renewed. New npm login:\n{new_login}\n\nLog in or create account (real browser only), then click Authorize.")
        except Exception as e:
            print(f"  Poll error ({remaining}s): {e}", flush=True)

    return None


def main():
    print("=== harnessview M2: npm publish ===\n")

    with open(os.path.join(REPO, "package.json")) as f:
        pkg_json = json.load(f)
    print(f"Package: {pkg_json['name']}@{pkg_json['version']}")

    # Already published?
    existing, status = get_json(f"{REGISTRY}/{pkg_json['name']}/{pkg_json['version']}")
    if status == 200:
        print(f"\nAlready published!")
        print(f"  https://www.npmjs.com/package/{pkg_json['name']}")
        drop_outbox("harnessview M2 DONE: npx harnessview is live! https://www.npmjs.com/package/harnessview")
        return True

    # Existing token?
    token = token_from_npmrc()
    if token:
        print("  Found token in ~/.npmrc, verifying...")
        me, s = get_json(f"{REGISTRY}/-/whoami", token=token)
        if s == 200 and me:
            print(f"  Logged in as: {me.get('username', '?')}")
            tarball_path, tarball_name = create_tarball(pkg_json)
            success = publish_package(token, pkg_json, tarball_path, tarball_name)
            if success:
                drop_outbox("harnessview M2 SHIPPED! harnessview v0.1.0 live on npm. https://www.npmjs.com/package/harnessview")
                return True
            return False
        else:
            print(f"  Token invalid (HTTP {s}) — starting web auth...")
            token = None

    # No token: start web auth session
    print("\n→ Creating npm login session...")
    session = post_json(f"{REGISTRY}/-/v1/login", {"hostname": "davenportmini"})
    login_url = session.get("loginUrl", "")
    done_url = session.get("doneUrl", "")

    if not login_url:
        print(f"ERROR: {session}")
        return False

    print(f"  Login URL: {login_url}")
    notify_macos("harnessview M2", "npm login needed - Telegram sent")
    open_browser(login_url)

    drop_outbox(
        "harnessview M2 needs npm login (5 min):\n\n"
        "Tap to log in / create account:\n"
        f"{login_url}\n\n"
        "After login/signup -> verify email -> click Authorize.\n"
        "Agent polls 1hr and auto-publishes when done."
    )

    print("\n→ Polling for 1 hour (Telegram notification sent)...\n")

    token = poll_for_token(done_url, login_url)
    if not token:
        print("TIMEOUT: no login in 1 hour.")
        drop_outbox("harnessview M2: npm login timed out (1hr). Run npm_publish_notify.py again when ready.")
        return False

    write_token(token)

    me, s = get_json(f"{REGISTRY}/-/whoami", token=token)
    if s == 200 and me:
        print(f"  Logged in as: {me.get('username', '?')}")

    print("\n→ Building tarball...")
    tarball_path, tarball_name = create_tarball(pkg_json)

    print("\n→ Publishing...")
    success = publish_package(token, pkg_json, tarball_path, tarball_name)

    if success:
        drop_outbox("harnessview M2 SHIPPED! v0.1.0 live: https://www.npmjs.com/package/harnessview  try: npx harnessview")
        return True
    else:
        drop_outbox("harnessview M2: publish failed after login. Check /tmp/npm-publish-notify.log")
        return False


if __name__ == "__main__":
    ok = main()
    sys.exit(0 if ok else 1)
