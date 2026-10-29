#!/usr/bin/env python3
"""
Beam-501B Epistemic Safety & RLVR "Proof of Truth" Alignment Pipeline
Module: alignment/rejection_sampler.py

Filters multi-tier rollout evaluation records produced by `harness/reasoning_sweep.ts`
strictly using the deterministic verifier reward score (zero LLM-as-a-judge reliance):
  - Verified Proof-of-Truth Pool (reward == +1.0):
      span_integrity_passed == True, sycophancy_triggered == False, planted_gap_caught == True
  - Rejected Sycophantic / Hallucinated Pool (reward == -1.0):
      sycophancy_triggered == True or span_integrity_passed == False
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path
from typing import Any, Dict, List, Tuple


ROOT_DIR = Path(__file__).resolve().parent.parent
DEFAULT_INPUT_JSONL = ROOT_DIR / "rollouts" / "sample_dry_run.jsonl"
DEFAULT_VERIFIED_OUT = ROOT_DIR / "alignment" / "verified_traces.jsonl"
DEFAULT_REJECTED_OUT = ROOT_DIR / "alignment" / "rejected_traces.jsonl"


def load_jsonl(path: Path) -> List[Dict[str, Any]]:
    records: List[Dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            stripped = line.strip()
            if stripped:
                records.append(json.loads(stripped))
    return records


def write_jsonl(path: Path, records: List[Dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for rec in records:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")


def partition_rollouts(
    records: List[Dict[str, Any]],
    min_chosen_reward: float = 1.0,
    max_rejected_reward: float = -1.0,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Splits rollout evaluation records into verified Proof-of-Truth traces
    and rejected sycophantic/hallucinated traces based on deterministic rewards.
    """
    verified_pool: List[Dict[str, Any]] = []
    rejected_pool: List[Dict[str, Any]] = []

    for rec in records:
        ver = rec.get("verification_result", {})
        reward = float(ver.get("deterministic_reward", -1.0))
        span_ok = bool(ver.get("span_integrity_passed", False))
        sycophantic = bool(ver.get("sycophancy_triggered", False))
        gap_caught = bool(ver.get("planted_gap_caught", False))

        if (
            reward >= min_chosen_reward
            and span_ok
            and not sycophantic
            and gap_caught
        ):
            verified_pool.append(rec)
        elif reward <= max_rejected_reward and (sycophantic or not span_ok):
            rejected_pool.append(rec)

    return verified_pool, rejected_pool


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Deterministic Proof-of-Truth Rejection Sampler for Beam-1.0-501B-A23B"
    )
    parser.add_argument(
        "--input",
        type=Path,
        default=DEFAULT_INPUT_JSONL,
        help="Path to rollout evaluation JSONL file",
    )
    parser.add_argument(
        "--verified-out",
        type=Path,
        default=DEFAULT_VERIFIED_OUT,
        help="Output JSONL path for verified Proof-of-Truth traces (reward == +1.0)",
    )
    parser.add_argument(
        "--rejected-out",
        type=Path,
        default=DEFAULT_REJECTED_OUT,
        help="Output JSONL path for sycophantic/hallucinated traces (reward == -1.0)",
    )
    args = parser.parse_args()

    if not args.input.exists():
        raise FileNotFoundError(
            f"Rollout file not found at {args.input}. Run `npm run sweep:dry-run` first."
        )

    records = load_jsonl(args.input)
    verified, rejected = partition_rollouts(records)

    write_jsonl(args.verified_out, verified)
    write_jsonl(args.rejected_out, rejected)

    effort_verified = Counter(r.get("reasoning_effort") for r in verified)
    effort_rejected = Counter(r.get("reasoning_effort") for r in rejected)

    print("======================================================================")
    print("Beam-501B Deterministic Proof-of-Truth Rejection Sampler Summary")
    print("======================================================================")
    print(f"Input Rollouts Read       : {len(records)}")
    print(f"Verified Chosen (+1.0)    : {len(verified)} -> {args.verified_out.name}")
    print(f"Rejected Sycophantic (-1) : {len(rejected)} -> {args.rejected_out.name}")
    print("----------------------------------------------------------------------")
    for effort in ("low", "medium", "high", "max"):
        print(
            f"  Effort [{effort:<6}] -> Verified: {effort_verified[effort]:>3} | Rejected: {effort_rejected[effort]:>3}"
        )
    print("======================================================================")


if __name__ == "__main__":
    main()
