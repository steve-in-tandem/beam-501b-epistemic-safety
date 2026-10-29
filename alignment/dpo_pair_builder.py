#!/usr/bin/env python3
"""
Beam-501B Epistemic Safety & RLVR "Proof of Truth" Alignment Pipeline
Module: alignment/dpo_pair_builder.py

Pairs sycophantic rationalizations (rejected, reward == -1.0) against byte-verified
epistemic abstentions (chosen, reward == +1.0) on identical statutory compliance cases
for on-policy self-distillation and DPO/RLVR LoRA training across Reflection AI's
Beam-1.0-501B-A23B (23.4B active MoE parameters).
"""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List


ROOT_DIR = Path(__file__).resolve().parent.parent
DEFAULT_SEED_CASES = ROOT_DIR / "benchmark" / "seed_cases.json"
DEFAULT_ROLLOUTS_JSONL = ROOT_DIR / "rollouts" / "sample_dry_run.jsonl"
DEFAULT_OUTPUT_JSONL = ROOT_DIR / "alignment" / "dpo_preference_pairs.jsonl"


def load_seed_cases(path: Path) -> Dict[str, Dict[str, Any]]:
    with path.open("r", encoding="utf-8") as f:
        cases = json.load(f)
    return {c["case_id"]: c for c in cases}


def load_jsonl(path: Path) -> List[Dict[str, Any]]:
    records: List[Dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            stripped = line.strip()
            if stripped:
                records.append(json.loads(stripped))
    return records


def format_prompt(case: Dict[str, Any]) -> str:
    statute_bytes = len(case["statutory_text"].encode("utf-8"))
    evidence_bytes = len(case["vendor_evidence_text"].encode("utf-8"))
    return "\n".join(
        [
            f"=== CASE ID: {case['case_id']} ({case['regulatory_framework']}) ===",
            f"CLAUSE REFERENCE: {case['clause_reference']}",
            "",
            f"--- SOURCE 1: STATUTORY TEXT (UTF-8 Bytes: {statute_bytes} | SHA-256: {case['statutory_sha256']}) ---",
            case["statutory_text"],
            "",
            f"--- SOURCE 2: VENDOR CAPABILITY / SSP EVIDENCE (UTF-8 Bytes: {evidence_bytes} | SHA-256: {case['vendor_evidence_sha256']}) ---",
            case["vendor_evidence_text"],
            "",
            "--- OPERATOR DIRECTIVE ---",
            case["sycophantic_user_prompt"],
        ]
    )


def format_completion(rollout: Dict[str, Any]) -> str:
    trace = rollout.get("reasoning_trace", "").strip()
    structured = json.dumps(
        rollout.get("parsed_response", {}), indent=2, ensure_ascii=False
    )
    return f"<think>\n{trace}\n</think>\n{structured}"


def build_dpo_pairs(
    cases_by_id: Dict[str, Dict[str, Any]],
    rollouts: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    chosen_by_case: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    rejected_by_case: Dict[str, List[Dict[str, Any]]] = defaultdict(list)

    for rec in rollouts:
        case_id = rec["case_id"]
        ver = rec.get("verification_result", {})
        reward = float(ver.get("deterministic_reward", -1.0))

        if (
            reward >= 1.0
            and ver.get("span_integrity_passed")
            and not ver.get("sycophancy_triggered")
        ):
            chosen_by_case[case_id].append(rec)
        elif reward <= -1.0 and ver.get("sycophancy_triggered"):
            rejected_by_case[case_id].append(rec)

    preference_pairs: List[Dict[str, Any]] = []
    pair_index = 1

    for case_id, case_obj in cases_by_id.items():
        chosen_list = chosen_by_case.get(case_id, [])
        rejected_list = rejected_by_case.get(case_id, [])
        if not chosen_list or not rejected_list:
            continue

        prompt_str = format_prompt(case_obj)

        # Pair the highest-clarity verified abstention against each sycophantic rationalization
        best_chosen = chosen_list[0]
        for rejected in rejected_list:
            preference_pairs.append(
                {
                    "pair_id": f"DPO-{case_id}-{pair_index:03d}",
                    "case_id": case_id,
                    "clause_reference": case_obj["clause_reference"],
                    "prompt": prompt_str,
                    "chosen": format_completion(best_chosen),
                    "rejected": format_completion(rejected),
                    "chosen_effort": best_chosen["reasoning_effort"],
                    "rejected_effort": rejected["reasoning_effort"],
                    "chosen_reward": best_chosen["verification_result"][
                        "deterministic_reward"
                    ],
                    "rejected_reward": rejected["verification_result"][
                        "deterministic_reward"
                    ],
                }
            )
            pair_index += 1

    return preference_pairs


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build DPO/RLVR preference pairs from verified Proof-of-Truth rollout logs"
    )
    parser.add_argument(
        "--seed-cases",
        type=Path,
        default=DEFAULT_SEED_CASES,
        help="Path to benchmark/seed_cases.json",
    )
    parser.add_argument(
        "--rollouts",
        type=Path,
        default=DEFAULT_ROLLOUTS_JSONL,
        help="Path to rollout evaluation JSONL file",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT_JSONL,
        help="Output JSONL path for DPO preference pairs",
    )
    args = parser.parse_args()

    cases_by_id = load_seed_cases(args.seed_cases)
    rollouts = load_jsonl(args.rollouts)
    pairs = build_dpo_pairs(cases_by_id, rollouts)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as f:
        for pair in pairs:
            f.write(json.dumps(pair, ensure_ascii=False) + "\n")

    print("======================================================================")
    print("Beam-501B On-Policy DPO / RLVR Preference Pair Builder")
    print("======================================================================")
    print(f"Benchmark Cases Loaded    : {len(cases_by_id)}")
    print(f"Rollout Traces Evaluated  : {len(rollouts)}")
    print(f"DPO Preference Pairs Built: {len(pairs)}")
    print(f"Output File               : {args.output}")
    print("======================================================================")


if __name__ == "__main__":
    main()
