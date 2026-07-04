"""PyInstaller entry point for the frozen APIWeave worker sidecar.

`--check` forces the import graph and exits (build-script bundle validation);
otherwise it runs the polling worker loop.
"""

import argparse


def main() -> None:
    parser = argparse.ArgumentParser(prog="apiweave-worker")
    parser.add_argument(
        "--check",
        action="store_true",
        help="Import the worker to validate the frozen bundle, then exit.",
    )
    args = parser.parse_args()

    from app.worker import main as run_worker

    if args.check:
        print("apiweave-worker: import OK")
        return

    run_worker()


if __name__ == "__main__":
    main()
