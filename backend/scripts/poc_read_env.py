"""PoC #2B: Read the backend .env file — regression assertion.

After fix: file_uploads with type=path pointing to backend/.env must be blocked.
The run log must NOT contain "Resolved file path: ...backend\\.env (".
Before fix: the log DOES contain the resolved path, proving the file was read.

Usage:
    python poc_read_env.py --expected=blocked     # default: assert file read blocked
    python poc_read_env.py --expected=vulnerable  # assert file read still works
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
    parser = argparse.ArgumentParser(description="File read .env PoC regression assertion")
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
    base = args.base_url.rstrip("/")
    expected = args.expected

    if not SESSION or not CSRF:
        print("SKIP: Set APIWEAVE_SESSION and APIWEAVE_CSRF env vars")
        sys.exit(0)

    # Target: backend/.env (contains SECRET_KEY, OAuth secrets)
    target = os.path.abspath("../.env")
    if not os.path.exists(target):
        target = r"F:\Work\Visual API Test Story Builder\apiweave\backend\.env"

    print(f"[*] Expected outcome: {expected}")
    print(f"[*] Target file: {target}")

    wf = {
        "name": "File Read ENV PoC",
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
                "label": "ReadENV",
                "position": {"x": 100, "y": 0},
                "config": {
                    "method": "POST",
                    "url": f"{base}/api/auth/csrf-token",
                    "headers": "Content-Type: multipart/form-data",
                    "body": "",
                    "bodyType": None,
                    "timeout": 10,
                    "fileUploads": [
                        {
                            "active": True,
                            "type": "path",
                            "value": target,
                            "fieldName": "envfile",
                            "mimeType": "application/octet-stream",
                        }
                    ],
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
    code, w = req(base, "POST", "/api/workflows", wf)
    print(f"[+] workflow create: HTTP {code}")
    if code not in (200, 201):
        print(f"FAIL: create workflow: HTTP {code} {w}")
        sys.exit(2)
    wid = w["workflowId"]
    code, run = req(base, "POST", f"/api/workflows/{wid}/run", {})
    rid = run.get("runId")
    print(f"[+] run: HTTP {code} -> {rid}")
    if code not in (200, 202):
        print(f"FAIL: trigger run: HTTP {code} {run}")
        sys.exit(3)

    for _ in range(30):
        time.sleep(0.5)
        code, status = req(base, "GET", f"/api/workflows/{wid}/runs/{rid}")
        if status.get("status") in ("completed", "failed"):
            break

    # Read the run log
    log_text = ""
    log = f"logs/run_{rid}.log"
    print(f"\n=== Run log: {log} ===")
    if os.path.exists(log):
        with open(log, encoding="utf-8") as f:
            log_text = f.read()
        for keyword in [
            "Resolved",
            "file",
            "Path",
            "Added",
            "Failed",
            "Error",
            "bytes",
            ".env",
            "SECRET",
        ]:
            if keyword in log_text:
                start = max(0, log_text.find(keyword) - 80)
                end = min(len(log_text), log_text.find(keyword) + 300)
                safe = log_text[start:end].encode("ascii", "replace").decode()
                print(f"  -- context '{keyword}': --")
                for ln in safe.splitlines():
                    print("  " + ln)
    else:
        print(f"  Log file not found: {log}")

    # Also check node result
    code, res = req(base, "GET", f"/api/workflows/{wid}/runs/{rid}/nodes/h/result")
    result_data = res.get("result", res) if isinstance(res, dict) else res
    print("\n[*] Node result:")
    print(json.dumps(result_data, indent=2)[:1500])

    req(base, "DELETE", f"/api/workflows/{wid}")

    # --- Assertions ---
    results = []  # (test_name, passed, detail)

    # The key indicator: does the log contain "Resolved file path: ...backend\.env ("?
    # Normalize path separators for cross-platform matching
    env_marker = "Resolved file path:"
    env_path_indicators = [
        r"backend\.env",
        "backend/.env",
        r"\.env",
    ]

    log_has_resolved_path = False
    if env_marker in log_text:
        # Check if any .env path indicator follows the marker
        idx = log_text.find(env_marker)
        context = log_text[idx : idx + 300]
        for indicator in env_path_indicators:
            if indicator in context:
                log_has_resolved_path = True
                break

    # Also check for error/blocking indicators
    error_indicators = [
        "blocked",
        "forbidden",
        "not allowed",
        "disallowed",
        "path traversal",
        "unsafe path",
        "invalid path",
        "file read denied",
        "access denied",
    ]
    result_status = result_data.get("status", "") if isinstance(result_data, dict) else ""
    result_error = result_data.get("error", "") if isinstance(result_data, dict) else ""
    result_is_error = result_status == "error" or any(
        kw in str(result_error).lower() for kw in error_indicators
    )

    if expected == "blocked":
        # PASS if: log does NOT contain resolved .env path, OR result is error
        path_blocked = not log_has_resolved_path
        if path_blocked or result_is_error:
            detail = (
                f"log_has_resolved_path={log_has_resolved_path}, result_is_error={result_is_error}"
            )
            if result_error:
                detail += f", error={str(result_error)[:120]}"
            results.append(("File read .env blocked", True, detail))
        else:
            results.append(
                (
                    "File read .env blocked",
                    False,
                    f"File read NOT blocked — log contains resolved "
                    f".env path: {log_has_resolved_path}",
                )
            )
    else:  # vulnerable
        # PASS if: log DOES contain resolved .env path
        if log_has_resolved_path:
            results.append(
                (
                    "File read .env vulnerable (file was read)",
                    True,
                    "Log contains 'Resolved file path: ...backend\\.env' — file read confirmed",
                )
            )
        else:
            results.append(
                (
                    "File read .env vulnerable (file was read)",
                    False,
                    "Expected log to contain resolved .env path but it did not",
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
        "task-6-poc-read-env.txt",
    )
    try:
        os.makedirs(os.path.dirname(evidence_path), exist_ok=True)
        with open(evidence_path, "w", encoding="utf-8") as f:
            f.write(f"poc_read_env.py — expected={expected}\nbase_url={base}\ntarget={target}\n\n")
            f.write(f"Log text (first 4000 chars):\n{log_text[:4000]}\n\n")
            f.write(f"Node result:\n{json.dumps(result_data, indent=2)[:2000]}\n\n")
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
