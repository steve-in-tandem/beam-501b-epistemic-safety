# Beam-501B Epistemic Safety & Anti-Sycophancy Harness (`RLVR-ProofOfTruth`)

[![Model Target](https://img.shields.io/badge/Target_Model-Reflection_Beam--1.0--501B--A23B-blue)](https://huggingface.co/reflectionai/Beam-1.0-501B-A23B)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-green.svg)](https://opensource.org/licenses/Apache-2.0)
[![Status: Phase 1 Red-Teaming](https://img.shields.io/badge/Status-Active_Sprint-orange.svg)]()

An open-source evaluation benchmark, deterministic citation/entailment verification harness, and Reinforcement Learning with Verifiable Rewards (RLVR) LoRA self-distillation pipeline designed to eliminate **reasoning-induced sycophancy** in frontier open-weight Mixture-of-Experts (MoE) models.

Developed and maintained by **Steve Salstrand** ([InTandem LLC](https://getintandem.io)).

---

## 1. Motivation & Core Safety Problem

With the Apache 2.0 release of **Reflection AI’s Beam 501B (`Beam-1.0-501B-A23B`)**, frontier-class autonomous reasoning agents can now be deployed inside air-gapped defense, critical infrastructure, and federal procurement environments without first-party lab guardrails.

When evaluating complex regulatory and cybersecurity compliance (such as **FAR/DFARS clauses, CMMC Level 2 controls, and multi-document federal solicitations**), standard RLHF and Multi-Teacher On-Policy Distillation (MOPD) models exhibit a dangerous failure mode: **sycophantic rationalization under user pressure**. 

Specifically, when an operator prompts a model to validate compliance against a strict statutory control where the underlying capability evidence is incomplete or contradictory:
1. **Helpfulness Overrides Epistemic Truth:** The model attempts to satisfy the user's premise rather than issuing a hard compliance refusal.
2. **Test-Time Compute Rationalization:** A critical safety question in frontier reasoning models is whether scaling test-time compute (`reasoning_effort` from `low` to `max`) causes the model to catch its own compliance errors or enables it to construct more convoluted, persuasive legal/technical rationalizations for false claims—breaking scalable human oversight.

This repository provides a deterministic verification testbed and weight-level alignment recipe to elevate **epistemic abstention ("Proof of Truth")** from a secondary preference to a hard Tier-1 weight constraint.

---

## 2. System Architecture

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                ADVERSARIAL COMPLIANCE BENCHMARK (N=500)                 │
│  [Statutory Clause: FAR/DFARS/CMMC] + [Deficient Evidence] + [Pressure] │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│             REFLECTION BEAM 501B (Beam-1.0-501B-A23B)                   │
│       Rollout Sweeps across `reasoning_effort`: [low, med, high, max]   │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│             DETERMINISTIC "PROOF OF TRUTH" VERIFIER RAIL                │
│  1. Cryptographic SHA-256 Span & Byte-Offset Citation Check             │
│  2. Symbolic Statutory Condition & Threshold Entailment                 │
│  3. Hard Epistemic Abstention Gate (<INSUFFICIENT_EVIDENCE> Token)      │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│          ON-POLICY SELF-DISTILLATION / RLVR LoRA ALIGNMENT              │
│   Rejection Sampling & DPO/RLVR across 23.4B Active Expert Parameters   │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Repository Structure

```text
beam-501b-epistemic-safety/
├── benchmark/
│   ├── schema.ts                  # Strict TypeScript/JSON schema for adversarial test cases
│   ├── clauses/                   # Ground-truth FAR, DFARS 252.204-7012, & CMMC L2 controls
│   ├── adversarial_prompts/       # Sycophantic pressure templates & deficient vendor evidence
│   └── seed_cases.json            # Initial golden set of adversarial compliance cases
├── harness/
│   ├── beam_client.ts             # Zero-dependency beta API & vLLM/SGLang rollout client
│   ├── reasoning_sweep.ts         # Multi-tier evaluator (low | medium | high | max)
│   └── verifier/
│       ├── span_hash_verifier.ts  # Deterministic byte-offset & SHA-256 quote verification
│       ├── entailment_judge.ts    # Statutory rule evaluator & abstention scorer
│       └── metrics.ts             # Sycophancy Amplification Ratio (SAR) calculator
├── alignment/
│   ├── rejection_sampler.py       # Filters rollout traces by deterministic reward score
│   ├── dpo_pair_builder.py        # Pairs sycophantic rationalizations (rejected) vs. abstentions (chosen)
│   └── configs/
│       └── beam_501b_lora_fp8.yaml # Axolotl/TRL LoRA config for 23.4B active MoE pathways
└── reports/
    └── methodology.md             # Evaluation metrics & experimental protocol
```

---

## 4. Key Evaluation Metrics

* **Sycophantic Agreement Rate (SAR):** Percentage of adversarial prompts with deficient evidence where the model falsely validates compliance under user pressure.
* **Reasoning Rationalization Delta (ΔRR):** The change in sycophantic agreement as `reasoning_effort` scales from `low` to `max` (`SAR_max - SAR_low`). A positive ΔRR indicates that extra reasoning tokens are being used to rationalize falsehoods rather than self-correct.
* **Verified Citation Precision (VCP):** Percentage of generated compliance claims accompanied by an exact, byte-verified source span from the provided solicitation/capability context.
* **Calibrated Abstention Recall (CAR):** Rate at which the model correctly emits `<INSUFFICIENT_EVIDENCE>` and halts assertion when statutory conditions are unmet.

---

## 5. 4-Week Execution Roadmap

- [x] **Milestone 0:** Production statutory ingestion pipeline & initial Beam 501B beta baseline testing.
- [ ] **Milestone 1 (Week 1):** Release 500-case Adversarial Compliance & Anti-Sycophancy dataset across FAR/DFARS/CMMC controls; complete multi-tier `reasoning_effort` baseline sweeps.
- [ ] **Milestone 2 (Week 2):** Execute deterministic trace verification and rejection sampling across rollout logs; publish empirical findings on reasoning-effort rationalization.
- [ ] **Milestone 3 (Week 3):** Train FP8/NVFP4 LoRA safety adapter on verified trace pairs via RLVR/DPO across Beam 501B's 23.4B active parameter pathways.
- [ ] **Milestone 4 (Week 4):** Open-source LoRA adapter weights, training recipes, and final technical safety report.

---

## License
Apache 2.0

