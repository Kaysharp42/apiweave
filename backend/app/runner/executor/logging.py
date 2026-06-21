"""Logging setup for workflow runs."""

import logging
from pathlib import Path

# Setup logging
LOGS_DIR = Path(__file__).parent.parent.parent.parent / "logs"
LOGS_DIR.mkdir(exist_ok=True)


def setup_run_logger(run_id: str):
    """Create a logger for a specific workflow run"""
    logger = logging.getLogger(f"run_{run_id}")
    logger.setLevel(logging.DEBUG)

    # Remove existing handlers
    logger.handlers = []

    # File handler for this run
    log_file = LOGS_DIR / f"run_{run_id}.log"
    file_handler = logging.FileHandler(log_file, mode="w", encoding="utf-8")
    file_handler.setLevel(logging.DEBUG)

    # Formatter
    formatter = logging.Formatter(
        "%(asctime)s [%(levelname)s] %(message)s", datefmt="%Y-%m-%d %H:%M:%S"
    )
    file_handler.setFormatter(formatter)

    logger.addHandler(file_handler)
    logger.info("=" * 80)
    logger.info(f"Workflow Run Started: {run_id}")
    logger.info("=" * 80)

    return logger
