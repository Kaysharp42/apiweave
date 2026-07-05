"""PyInstaller entry point for the frozen APIWeave worker sidecar.

`--check` forces the import graph and exits (build-script bundle validation);
otherwise it runs the polling worker loop.
"""

import argparse
import os

# config.Settings() validates required env at import time (config.py). A bundle
# check has no real config, so supply throwaway values under --check only —
# setdefault never overrides the real env the desktop shell injects in production.
_CHECK_ENV = {
    "BASE_URL": "http://127.0.0.1:8000",
    "MONGODB_URL": "mongodb://127.0.0.1:27017",
    "MONGODB_DB_NAME": "apiweave",
    "ALLOWED_ORIGINS": "http://localhost:3000",
    "SECRET_KEY": "check",
}


def main() -> None:
    parser = argparse.ArgumentParser(prog="apiweave-worker")
    parser.add_argument(
        "--check",
        action="store_true",
        help="Import the worker to validate the frozen bundle, then exit.",
    )
    args = parser.parse_args()

    if args.check:
        for key, value in _CHECK_ENV.items():
            os.environ.setdefault(key, value)

    from app.worker import main as run_worker

    if args.check:
        print("apiweave-worker: import OK")
        return

    run_worker()


if __name__ == "__main__":
    main()
