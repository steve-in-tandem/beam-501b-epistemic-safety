/**
 * Beam-501B Epistemic Safety & RLVR "Proof of Truth" Verification Engine
 * Core TypeScript Data Schemas & Deterministic Verification Contracts
 *
 * Target Model: Reflection AI Beam-1.0-501B-A23B (501B total, 23.4B active MoE)
 * License: Apache 2.0
 */

export type ReasoningEffort = 'low' | 'medium' | 'high' | 'max';

export const REASONING_EFFORT_LEVELS: readonly ReasoningEffort[] = [
  'low',
  'medium',
  'high',
  'max',
] as const;

export type ComplianceVerdict =
  | 'COMPLIANT'
  | 'NON_COMPLIANT'
  | 'INSUFFICIENT_EVIDENCE';

export type RegulatoryFramework =
  | 'FAR'
  | 'DFARS'
  | 'CMMC_L2'
  | 'NIST_800_171'
  | 'SECTION_L_M';

export interface PlantedDeficiency {
  gap_id: string;
  description: string;
  required_condition: string;
  actual_vendor_state: string;
  keywords: string[];
  /** Exact UTF-8 byte offsets of the critical statutory requirement in statutory_text */
  statute_target_span?: {
    start_byte: number;
    end_byte: number;
    verbatim_quote: string;
  };
  /** Exact UTF-8 byte offsets of the deficient claim in vendor_evidence_text */
  evidence_target_span?: {
    start_byte: number;
    end_byte: number;
    verbatim_quote: string;
  };
}

export interface AdversarialTestCase {
  case_id: string;
  regulatory_framework: RegulatoryFramework;
  clause_reference: string;          // e.g., "DFARS 252.204-7012(b)(2)(ii)(D)"
  statutory_text: string;
  statutory_sha256: string;
  vendor_evidence_text: string;      // Perturbed capability statement with missing/corrupted control
  vendor_evidence_sha256: string;
  planted_deficiency: PlantedDeficiency;
  sycophantic_user_prompt: string;
  expected_verdict: 'NON_COMPLIANT' | 'INSUFFICIENT_EVIDENCE';
}

export interface CitationSpan {
  source_type: 'STATUTE' | 'VENDOR_EVIDENCE';
  sha256_hash: string;
  start_byte: number;
  end_byte: number;
  verbatim_quote: string;
}

/**
 * Mandate 2 Structural Contract representation (compatible with CitationSpan)
 */
export interface MandateCitationContract {
  document_id: string;
  sha256_chunk_hash: string;
  start_byte_offset: number;
  end_byte_offset: number;
  exact_verbatim_quote: string;
}

export interface MandateComplianceAssertion {
  claim_id: string;
  compliance_status: ComplianceVerdict;
  citations: MandateCitationContract[];
  statutory_deficiency_analysis: string;
}

export interface ModelComplianceResponse {
  verdict: ComplianceVerdict;
  abstained: boolean;
  abstention_token: '<INSUFFICIENT_EVIDENCE>' | null;
  identified_gaps: string[];
  citations: CitationSpan[];
  analysis: string;
}

export interface SpanVerificationFailure {
  citation_index: number;
  source_type: 'STATUTE' | 'VENDOR_EVIDENCE';
  reason:
    | 'OUT_OF_BOUNDS_OFFSET'
    | 'BYTE_SPAN_QUOTE_MISMATCH'
    | 'DOCUMENT_SHA256_MISMATCH'
    | 'EMPTY_QUOTE';
  expected_quote?: string;
  actual_quote: string;
  expected_sha256?: string;
  actual_sha256: string;
}

export interface VerificationResultSummary {
  span_integrity_passed: boolean;
  hallucinated_spans_count: number;
  sycophancy_triggered: boolean;
  planted_gap_caught: boolean;
  abstention_calibrated: boolean;
  deterministic_reward: number; // [-1.0 to +1.0]
  span_failures?: SpanVerificationFailure[];
  verdict_explanation?: string;
}

export interface RolloutEvaluationRecord {
  rollout_id: string;
  case_id: string;
  model_id: 'Beam-1.0-501B-A23B';
  reasoning_effort: ReasoningEffort;
  reasoning_trace: string;
  reasoning_tokens: number;
  completion_tokens: number;
  latency_ms: number;
  parsed_response: ModelComplianceResponse | null;
  verification_result: VerificationResultSummary;
  created_at: string;
}

export interface DpoPreferencePair {
  pair_id: string;
  case_id: string;
  clause_reference: string;
  prompt: string;
  chosen: string;
  rejected: string;
  chosen_effort: ReasoningEffort;
  rejected_effort: ReasoningEffort;
  chosen_reward: number;
  rejected_reward: number;
}

