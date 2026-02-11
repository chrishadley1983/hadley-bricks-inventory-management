"""
LEGO Investment Prediction Pipeline v2.0 — Orchestrator

Usage:
    python run_pipeline.py              # full pipeline (build → features → train → score)
    python run_pipeline.py --step build # just rebuild training data
    python run_pipeline.py --step features # just re-engineer features
    python run_pipeline.py --step train # just retrain models
    python run_pipeline.py --step score # just re-score active sets
"""

import argparse
import logging
import sys
import time
from datetime import datetime

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger(__name__)

STEPS = ["build", "features", "train", "score"]


def run_step(step: str) -> dict:
    """Run a single pipeline step and return results."""
    if step == "build":
        from build_training_data import run
        return run()
    elif step == "features":
        from engineer_features import run
        return run()
    elif step == "train":
        from train_models import run
        return run()
    elif step == "score":
        from score_sets import run
        return run()
    else:
        raise ValueError(f"Unknown step: {step}")


def main():
    parser = argparse.ArgumentParser(description="LEGO Investment Prediction Pipeline v2.0")
    parser.add_argument(
        "--step",
        choices=STEPS,
        help="Run a single step instead of the full pipeline",
    )
    args = parser.parse_args()

    start_time = time.time()
    log.info("=" * 60)
    log.info("LEGO Investment Prediction Pipeline v2.0")
    log.info(f"Started at: {datetime.now().isoformat()}")
    log.info("=" * 60)

    steps_to_run = [args.step] if args.step else STEPS
    results = {}

    for step in steps_to_run:
        step_start = time.time()
        log.info(f"\n{'=' * 40}")
        log.info(f"Step: {step}")
        log.info(f"{'=' * 40}")

        try:
            result = run_step(step)
            results[step] = {"status": "success", "result": result}
            elapsed = time.time() - step_start
            log.info(f"Step '{step}' completed in {elapsed:.1f}s: {result}")
        except Exception as e:
            elapsed = time.time() - step_start
            log.error(f"Step '{step}' failed after {elapsed:.1f}s: {e}", exc_info=True)
            results[step] = {"status": "error", "error": str(e)}
            if args.step:
                # Single step mode — fail fast
                sys.exit(1)
            else:
                # Full pipeline — stop on failure (downstream steps depend on prior)
                log.error("Pipeline halted due to step failure")
                break

    total_elapsed = time.time() - start_time
    log.info(f"\n{'=' * 60}")
    log.info(f"Pipeline finished in {total_elapsed:.1f}s")
    for step, result in results.items():
        status = result["status"]
        log.info(f"  {step}: {status}")
    log.info("=" * 60)

    return results


if __name__ == "__main__":
    main()
