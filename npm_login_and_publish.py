#!/usr/bin/env python3
"""One-step npm login + publish for harnessview.

Run this, log in (or create an account) in the browser that opens, and
the script automatically captures the token, writes ~/.npmrc, and publishes.

Usage:
  python3 ~/clawd/projects/harnessview/npm_login_and_publish.py
"""
import json
import os
import subprocess
import sys
import time
import urllib.request
import urllib.error
import webbrowser

REGISTRY = "https://registry.npmjs.org"
NPMRC = os.path.expanduser("~/.npmrc")
REPO = os.path.expanduser("~/code/harnessview")
TIMEOUT_SEC = 360  # 6 minutes
POLL_INTERVAL = 4  # seconds between polls


def post_json(url, body):
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        url, data=data,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "npm-auth-type": "web",
            "User-Agent": "npm/10.0.0 node/v20.0.0",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode())


def get_json(url):
    req = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json",
            "User-Agent": "npm/10.0.0 node/v20.0.0",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode()), resp.status
    except urllib.error.HTTPError as e:
        body = None
        try:
            body = json.loads(e.read().decode())
        except Exception:
            pass
        return body, e.code


def write_npmrc(token):
    line = f"//registry.npmjs.org/:_authToken={token}\n"
    existing = ""
    if os.path.exists(NPMRC):
        with open(NPMRC, "r") as f:
            existing = f.read()
        lines = [l for l in existing.splitlines() if "_authToken" not in l]
        existing = "\n".join(lines) + "\n" if lines else ""
    with open(NPMRC, "w") as f:
        f.write(existing + line)
    print(f"✓ Token written to {NPMRC}")


def do_publish():
    print("\n→ Installing deps (pnpm install)…")
    r = subprocess.run(
        ["pnpm", "install", "--frozen-lockfile"],
        cwd=REPO, capture_output=True, text=True,
    )
    if r.returncode != 0:
        print(f"  pnpm install failed:\n{r.stderr}")
        sys.exit(1)

    print("→ Building (pnpm run build)…")
    r = subprocess.run(
        ["pnpm", "run", "build"],
        cwd=REPO, capture_output=True, text=True,
    )
    if r.returncode != 0:
        print(f"  pnpm build failed:\n{r.stderr}")
        sys.exit(1)

    print("→ Dry-run pack…")
    subprocess.run(["npm", "pack", "--dry-run"], cwd=REPO)

    print("→ Publishing to npm…")
    r = subprocess.run(
        ["npm", "publish", "--access", "public"],
        cwd=REPO, text=True,
    )
    if r.returncode != 0:
        print("  publish failed — check output above")
        sys.exit(1)

    pkg = json.loads(open(os.path.join(REPO, "package.json")).read())
    print(f"\n✓ Published {pkg['name']}@{pkg['version']} to npm!")
    print(f"  https://www.npmjs.com/package/{pkg['name']}")


def main():
    print("=== harnessview npm publish ===\n")

    # Check if a token already exists (skip login)
    if os.path.exists(NPMRC):
        with open(NPMRC) as f:
            content = f.read()
        if "_authToken" in content:
            print("Found existing npm token in ~/.npmrc — skipping login.")
            do_publish()
            return

    print("No npm token found. Starting web-auth login flow…\n")
    try:
        session = post_json(f"{REGISTRY}/-/v1/login", {"hostname": "davenportmini"})
    except Exception as e:
        print(f"ERROR: could not create login session: {e}")
        sys.exit(1)

    login_url = session.get("loginUrl", "")
    done_url = session.get("doneUrl", "")

    if not login_url or not done_url:
        print(f"ERROR: unexpected response: {session}")
        sys.exit(1)

    print("*** BROWSER OPENING — ACTION REQUIRED (< 2 min) ***")
    print(f"URL: {login_url}")
    print("  • Log into your npm account, OR")
    print("  • Click 'Create an account', sign up, then authorize the CLI.")
    print("  • This terminal completes automatically once you authorize.\n")

    try:
        webbrowser.open(login_url)
    except Exception as e:
        print(f"(Browser didn't open: {e})")
        print(f"Open manually: {login_url}\n")

    deadline = time.time() + TIMEOUT_SEC
    dots = 0
    while time.time() < deadline:
        time.sleep(POLL_INTERVAL)
        dots += 1
        print(f"  Waiting for browser login… {dots * POLL_INTERVAL}s", flush=True)

        try:
            data, status = get_json(done_url)
            if status == 200 and data and "token" in data:
                token = data["token"]
                print(f"\n✓ Got npm token!")
                write_npmrc(token)
                do_publish()
                return
            elif status == 202:
                pass  # still waiting
            elif status == 404:
                print("\nSession expired (404). Restarting login flow…")
                # Restart
                try:
                    session = post_json(f"{REGISTRY}/-/v1/login", {"hostname": "davenportmini"})
                    login_url = session.get("loginUrl", "")
                    done_url = session.get("doneUrl", "")
                    print(f"New URL: {login_url}")
                    webbrowser.open(login_url)
                except Exception:
                    pass
            elif status and status not in (200, 202, 404):
                print(f"\nSession error (status {status}): {data}")
                sys.exit(1)
        except Exception:
            pass  # network blip

    remaining_mins = int((deadline - time.time()) / 60) * -1
    print(f"\nTimeout after {TIMEOUT_SEC}s. No login completed.")
    print("Re-run this script when you're ready to log in.")
    sys.exit(2)


if __name__ == "__main__":
    main()
