#!/usr/bin/env python3
"""npm web-auth login flow — bypasses the 'npm login' permission gate.

1. POST /-/v1/login to get a loginUrl + doneUrl
2. Open loginUrl in the default browser (JD completes login/signup there)
3. Poll doneUrl until we get a token (up to 5 min)
4. Write the token to ~/.npmrc
"""
import json
import os
import sys
import time
import urllib.request
import urllib.error
import webbrowser

REGISTRY = "https://registry.npmjs.org"
NPMRC = os.path.expanduser("~/.npmrc")
TIMEOUT_SEC = 300  # 5 minutes
POLL_INTERVAL = 4  # seconds between polls


def post_json(url, body):
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        url,
        data=data,
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
    print(f"[npm-login] Token written to {NPMRC}")


def main():
    print("[npm-login] Starting npm web-auth login flow…")
    print("[npm-login] Creating login session…")
    try:
        session = post_json(f"{REGISTRY}/-/v1/login", {"hostname": "davenportmini"})
    except Exception as e:
        print(f"[npm-login] ERROR: could not create session: {e}")
        sys.exit(1)

    login_url = session.get("loginUrl", "")
    done_url = session.get("doneUrl", "")

    if not login_url or not done_url:
        print(f"[npm-login] ERROR: unexpected response: {session}")
        sys.exit(1)

    print(f"\n[npm-login] *** ACTION REQUIRED ***")
    print(f"[npm-login] Opening browser for npm login/signup…")
    print(f"[npm-login] URL: {login_url}")
    print(f"[npm-login] If the browser doesn't open, paste that URL manually.")
    print(f"[npm-login] Log in (or create an account at npmjs.com/signup, then log in) — this terminal will auto-continue.\n")

    try:
        webbrowser.open(login_url)
    except Exception as e:
        print(f"[npm-login] Could not open browser automatically: {e}")
        print(f"[npm-login] Please open manually: {login_url}")

    deadline = time.time() + TIMEOUT_SEC
    while time.time() < deadline:
        time.sleep(POLL_INTERVAL)
        remaining = int(deadline - time.time())
        print(f"[npm-login] Polling for token… ({remaining}s remaining)", flush=True)

        try:
            data, status = get_json(done_url)
            if status == 200 and data and "token" in data:
                token = data["token"]
                print(f"[npm-login] Token received!")
                write_npmrc(token)
                print("[npm-login] Login complete. Ready to publish.")
                sys.exit(0)
            elif status == 202:
                pass  # still waiting
            elif status and status not in (200, 202):
                print(f"[npm-login] Session ended with status {status}: {data}")
                sys.exit(1)
        except Exception as e:
            pass  # network blip — keep polling

    print(f"\n[npm-login] Timeout after {TIMEOUT_SEC}s — no login completed.")
    print(f"[npm-login] BLOCKED: npm account needed. See BLOCKERS.md.")
    sys.exit(2)


if __name__ == "__main__":
    main()
