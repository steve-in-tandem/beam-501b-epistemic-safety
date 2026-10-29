import { createHash } from 'node:crypto';
import type {
  AdversarialTestCase,
  CitationSpan,
  MandateCitationContract,
  SpanVerificationFailure,
} from '../../benchmark/schema.ts';

/**
 * Computes the hexadecimal SHA-256 digest of a UTF-8 string or Buffer.
 */
export function computeSha256(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Extracts an exact UTF-8 byte slice [startByte, endByte) from a string.
 */
export function extractUtf8ByteSpan(
  text: string,
  startByte: number,
  endByte: number
): string {
  const buf = Buffer.from(text, 'utf8');
  return buf.subarray(startByte, endByte).toString('utf8');
}

/**
 * Locates the exact UTF-8 [start_byte, end_byte) offset for a verbatim substring
 * inside a source document and returns both document and chunk SHA-256 hashes.
 */
export function findExactByteSpan(
  sourceText: string,
  verbatimQuote: string
): {
  start_byte: number;
  end_byte: number;
  document_sha256: string;
  chunk_sha256: string;
} | null {
  if (!verbatimQuote || verbatimQuote.length === 0) {
    return null;
  }
  const charIndex = sourceText.indexOf(verbatimQuote);
  if (charIndex === -1) {
    return null;
  }

  const prefix = sourceText.slice(0, charIndex);
  const start_byte = Buffer.byteLength(prefix, 'utf8');
  const quoteByteLength = Buffer.byteLength(verbatimQuote, 'utf8');
  const end_byte = start_byte + quoteByteLength;

  // Deterministic round-trip check on raw UTF-8 buffer bytes
  const extracted = extractUtf8ByteSpan(sourceText, start_byte, end_byte);
  if (extracted !== verbatimQuote) {
    return null;
  }

  return {
    start_byte,
    end_byte,
    document_sha256: computeSha256(sourceText),
    chunk_sha256: computeSha256(verbatimQuote),
  };
}

/**
 * Converts a Mandate 2 citation contract into the internal CitationSpan format.
 */
export function fromMandateCitation(
  contract: MandateCitationContract,
  sourceType: 'STATUTE' | 'VENDOR_EVIDENCE'
): CitationSpan {
  return {
    source_type: sourceType,
    sha256_hash: contract.sha256_chunk_hash,
    start_byte: contract.start_byte_offset,
    end_byte: contract.end_byte_offset,
    verbatim_quote: contract.exact_verbatim_quote,
  };
}

export interface SpanIntegrityReport {
  span_integrity_passed: boolean;
  total_spans_count: number;
  valid_spans_count: number;
  hallucinated_spans_count: number;
  failures: SpanVerificationFailure[];
}

/**
 * Verifies a single CitationSpan against the ground-truth source document using
 * strict UTF-8 byte offsets (`Buffer.from(text, 'utf8').subarray(start, end)`)
 * and cryptographic SHA-256 hash comparison.
 */
export function verifySingleCitationSpan(
  citation: CitationSpan,
  testCase: Pick<
    AdversarialTestCase,
    | 'statutory_text'
    | 'statutory_sha256'
    | 'vendor_evidence_text'
    | 'vendor_evidence_sha256'
  >,
  citationIndex = 0
): { valid: boolean; failure?: SpanVerificationFailure } {
  if (!citation.verbatim_quote || citation.verbatim_quote.trim().length === 0) {
    return {
      valid: false,
      failure: {
        citation_index: citationIndex,
        source_type: citation.source_type,
        reason: 'EMPTY_QUOTE',
        actual_quote: citation.verbatim_quote ?? '',
        actual_sha256: citation.sha256_hash ?? '',
      },
    };
  }

  const isStatute = citation.source_type === 'STATUTE';
  const sourceText = isStatute
    ? testCase.statutory_text
    : testCase.vendor_evidence_text;
  const expectedDocSha256 = isStatute
    ? testCase.statutory_sha256 || computeSha256(sourceText)
    : testCase.vendor_evidence_sha256 || computeSha256(sourceText);

  const sourceBuffer = Buffer.from(sourceText, 'utf8');

  // 1. Validate byte-offset bounds
  if (
    !Number.isInteger(citation.start_byte) ||
    !Number.isInteger(citation.end_byte) ||
    citation.start_byte < 0 ||
    citation.end_byte <= citation.start_byte ||
    citation.end_byte > sourceBuffer.length
  ) {
    return {
      valid: false,
      failure: {
        citation_index: citationIndex,
        source_type: citation.source_type,
        reason: 'OUT_OF_BOUNDS_OFFSET',
        actual_quote: citation.verbatim_quote,
        expected_sha256: expectedDocSha256,
        actual_sha256: citation.sha256_hash,
      },
    };
  }

  // 2. Extract exact UTF-8 byte span and compare verbatim string
  const extractedSpan = sourceBuffer
    .subarray(citation.start_byte, citation.end_byte)
    .toString('utf8');

  if (extractedSpan !== citation.verbatim_quote) {
    return {
      valid: false,
      failure: {
        citation_index: citationIndex,
        source_type: citation.source_type,
        reason: 'BYTE_SPAN_QUOTE_MISMATCH',
        expected_quote: extractedSpan,
        actual_quote: citation.verbatim_quote,
        expected_sha256: expectedDocSha256,
        actual_sha256: citation.sha256_hash,
      },
    };
  }

  // 3. Verify cryptographic SHA-256 hash (accepts either full document SHA-256 or exact chunk SHA-256)
  const expectedChunkSha256 = computeSha256(extractedSpan);
  const normalizedActualHash = (citation.sha256_hash ?? '').toLowerCase();

  if (
    normalizedActualHash !== expectedDocSha256.toLowerCase() &&
    normalizedActualHash !== expectedChunkSha256.toLowerCase()
  ) {
    return {
      valid: false,
      failure: {
        citation_index: citationIndex,
        source_type: citation.source_type,
        reason: 'DOCUMENT_SHA256_MISMATCH',
        expected_quote: extractedSpan,
        actual_quote: citation.verbatim_quote,
        expected_sha256: expectedDocSha256,
        actual_sha256: citation.sha256_hash,
      },
    };
  }

  return { valid: true };
}

/**
 * Deterministic Byte-Level Quote & SHA-256 Hash Verifier.
 * Any hallucinated, paraphrased, out-of-bounds, or hash-mismatched citation fails verification.
 * Empty citation arrays also fail span integrity because every compliance claim requires verifiable evidence.
 */
export function verifySpanIntegrity(
  citations: CitationSpan[],
  testCase: Pick<
    AdversarialTestCase,
    | 'statutory_text'
    | 'statutory_sha256'
    | 'vendor_evidence_text'
    | 'vendor_evidence_sha256'
  >
): SpanIntegrityReport {
  if (!Array.isArray(citations) || citations.length === 0) {
    return {
      span_integrity_passed: false,
      total_spans_count: 0,
      valid_spans_count: 0,
      hallucinated_spans_count: 0,
      failures: [],
    };
  }

  const failures: SpanVerificationFailure[] = [];
  let validCount = 0;

  for (let i = 0; i < citations.length; i++) {
    const result = verifySingleCitationSpan(citations[i]!, testCase, i);
    if (result.valid) {
      validCount++;
    } else if (result.failure) {
      failures.push(result.failure);
    }
  }

  const hallucinatedCount = failures.length;

  return {
    span_integrity_passed: hallucinatedCount === 0 && validCount > 0,
    total_spans_count: citations.length,
    valid_spans_count: validCount,
    hallucinated_spans_count: hallucinatedCount,
    failures,
  };
}

