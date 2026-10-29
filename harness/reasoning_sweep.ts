import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REASONING_EFFORT_LEVELS,
  type AdversarialTestCase,
  type RolloutEvaluationRecord,
} from '../benchmark/schema.ts';
import { BeamRolloutClient } from './beam_client.ts';
import { verifyComplianceVerdict } from './verifier/entailment_judge.ts';
import {
  calculateSweepMetrics,
  formatMetricsMarkdownTable,
  type SweepEvaluationSummary,
} from './verifier/metrics.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..');

export interface SweepRunOptions {
  dryRun?: boolean;
  seedCasesPath?: string;
  outputJsonlPath?: string;
}

/**
 * Executes a full multi-tier reasoning sweep (`low`, `medium`, `high`, `max`)
 * across all adversarial compliance cases, evaluates every rollout with the
 * deterministic Proof-of-Truth verifier rail, logs JSONL traces, and returns
 * the SAR / ΔRR / VCP / CAR summary.
 */
export async function runReasoningSweep(
  options: SweepRunOptions = {}
): Promise<{
  records: RolloutEvaluationRecord[];
  summary: SweepEvaluationSummary;
  outputJsonlPath: string;
}> {
  const seedCasesPath =
    options.seedCasesPath ?? join(ROOT_DIR, 'benchmark', 'seed_cases.json');
  const rawSeedJson = readFileSync(seedCasesPath, 'utf8');
  const testCases = JSON.parse(rawSeedJson) as AdversarialTestCase[];

  const rolloutsDir = join(ROOT_DIR, 'rollouts');
  mkdirSync(rolloutsDir, { recursive: true });

  const outputJsonlPath =
    options.outputJsonlPath ??
    join(
      rolloutsDir,
      options.dryRun ? 'sample_dry_run.jsonl' : 'live_rollouts.jsonl'
    );

  const client = new BeamRolloutClient({ dryRun: options.dryRun });
  const records: RolloutEvaluationRecord[] = [];

  for (let i = 0; i < testCases.length; i++) {
    const testCase = testCases[i]!;
    for (const effort of REASONING_EFFORT_LEVELS) {
      const rollout = await client.executeRollout(testCase, effort, i);
      const verification = verifyComplianceVerdict(
        rollout.parsed_response,
        testCase
      );

      const record: RolloutEvaluationRecord = {
        rollout_id: `rollout-${testCase.case_id}-${effort}`,
        case_id: testCase.case_id,
        model_id: rollout.model_id,
        reasoning_effort: effort,
        reasoning_trace: rollout.raw_reasoning_trace,
        reasoning_tokens: rollout.reasoning_token_count,
        completion_tokens: rollout.completion_token_count,
        latency_ms: rollout.latency_ms,
        parsed_response: rollout.parsed_response,
        verification_result: verification,
        created_at: new Date().toISOString(),
      };

      records.push(record);
    }
  }

  const jsonlContent =
    records.map((r) => JSON.stringify(r)).join('\n') + '\n';
  writeFileSync(outputJsonlPath, jsonlContent, 'utf8');

  const summary = calculateSweepMetrics(records);

  return {
    records,
    summary,
    outputJsonlPath,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const isDryRun =
    process.argv.includes('--dry-run') || !process.env.BEAM_API_KEY;

  console.log(
    `================================================================================`
  );
  console.log(
    `Beam-501B Epistemic Safety & RLVR "Proof of Truth" Multi-Tier Reasoning Sweep`
  );
  console.log(
    `Mode: ${
      isDryRun
        ? 'DETERMINISTIC DRY-RUN SIMULATION (--dry-run, $0 API cost)'
        : 'LIVE BETA ENDPOINT'
    }`
  );
  console.log(
    `================================================================================\n`
  );

  runReasoningSweep({ dryRun: isDryRun })
    .then(({ records, summary, outputJsonlPath }) => {
      console.log(
        `Evaluated ${records.length} rollouts (${
          records.length / REASONING_EFFORT_LEVELS.length
        } adversarial cases × ${REASONING_EFFORT_LEVELS.length} reasoning_effort tiers).\n`
      );
      console.log(formatMetricsMarkdownTable(summary));
      console.log(`\nRollout traces written to: ${outputJsonlPath}`);
    })
    .catch((err: unknown) => {
      console.error('Reasoning sweep failed:', err);
      process.exitCode = 1;
    });
}
