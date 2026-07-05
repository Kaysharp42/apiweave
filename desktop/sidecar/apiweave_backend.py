"""PyInstaller entry point for the frozen APIWeave backend sidecar.

Runs the FastAPI app under uvicorn on a port chosen by the desktop shell:
    apiweave-backend --port <port> [--host 127.0.0.1]

`--check` forces the full app import graph and exits — used by the build script
to prove the frozen bundle captured every hidden import (pynacl/aiohttp/etc.)
without needing a running MongoDB.
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
    parser = argparse.ArgumentParser(prog="apiweave-backend")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int)
    parser.add_argument(
        "--check",
        action="store_true",
        help="Import the app to validate the frozen bundle, then exit.",
    )
    args = parser.parse_args()

    if args.check:
        for key, value in _CHECK_ENV.items():
            os.environ.setdefault(key, value)

    # Heavy import graph — the PyInstaller hidden-import risk lives here, so keep
    # it inside main() where --check can exercise it.
    from app.main import app

    if args.check:
        print("apiweave-backend: import OK")
        return

    if args.port is None:
        parser.error("--port is required")

    import uvicorn

    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
