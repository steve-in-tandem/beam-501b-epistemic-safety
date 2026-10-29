import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REASONING_EFFORT_LEVELS,
  type AdversarialTestCase,
  type RolloutEvaluationRecord,
} from '../benchmark/schema.ts';
import {
  BeamRolloutClient,
  type SimulationProfile,
} from './beam_client.ts';
import { verifyComplianceVerdict } from './verifier/entailment_judge.ts';
import {
  calculateSweepMetrics,
  formatMetricsMarkdownTable,
  type SweepEvaluationSummary,
} from './verifier/metrics.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..');

export interface HistoricalSweepRunMeta {
  run_id: string;
  label: string;
  profile: SimulationProfile | 'live';
  model_id: 'Beam-1.0-501B-A23B';
  adapter_id: string | null;
  is_dry_run: boolean;
  created_at: string;
  total_rollouts: number;
  overall_sar: number;
  overall_vcp: number;
  overall_car: number;
  overall_mean_reward: number;
  reasoning_rationalization_delta: number;
}

export interface HistoricalSweepRun extends HistoricalSweepRunMeta {
  summary: SweepEvaluationSummary;
  records: RolloutEvaluationRecord[];
}

export interface SweepRunOptions {
  dryRun?: boolean;
  simulationProfile?: SimulationProfile;
  multiTurnEscalation?: boolean;
  runId?: string;
  label?: string;
  adapterId?: string | null;
  createdAt?: string;
  seedCasesPath?: string;
  outputJsonlPath?: string;
  saveToHistory?: boolean;
  onProgress?: (
    completed: number,
    total: number,
    caseId: string,
    effort: string
  ) => void;
}

const PROFILE_METADATA: Record<
  SimulationProfile,
  { label: string; adapterId: string | null }
> = {
  baseline: {
    label: 'Unaligned baseline sweep',
    adapterId: null,
  },
  'checkpoint-step-150': {
    label: 'RLVR LoRA step 150 checkpoint',
    adapterId: 'beam-501b-proof-of-truth-lora@step-150',
  },
  'rlvr-aligned': {
    label: 'Post-RLVR Proof-of-Truth LoRA v1.0',
    adapterId: 'beam-501b-proof-of-truth-lora@v1.0',
  },
};

/**
 * Executes a full multi-tier reasoning sweep (`low`, `medium`, `high`, `max`)
 * across all adversarial compliance cases, evaluates every rollout with the
 * deterministic Proof-of-Truth verifier rail, logs JSONL traces, persists the
 * run to `rollouts/history/`, and returns the full run record.
 */
export async function runReasoningSweep(
  options: SweepRunOptions = {}
): Promise<{
  run: HistoricalSweepRun;
  records: RolloutEvaluationRecord[];
  summary: SweepEvaluationSummary;
  outputJsonlPath: string;
}> {
  const seedCasesPath =
    options.seedCasesPath ?? join(ROOT_DIR, 'benchmark', 'seed_cases.json');
  const rawSeedJson = readFileSync(seedCasesPath, 'utf8');
  const testCases = JSON.parse(rawSeedJson) as AdversarialTestCase[];

  const rolloutsDir = join(ROOT_DIR, 'rollouts');
  const historyDir = join(rolloutsDir, 'history');
  mkdirSync(historyDir, { recursive: true });

  const profile: SimulationProfile = options.simulationProfile ?? 'baseline';
  const isDryRun = Boolean(options.dryRun);
  const createdAt = options.createdAt ?? new Date().toISOString();

  const outputJsonlPath =
    options.outputJsonlPath ??
    join(rolloutsDir, isDryRun ? 'sample_dry_run.jsonl' : 'live_rollouts.jsonl');

  const client = new BeamRolloutClient({
    dryRun: isDryRun,
    simulationProfile: profile,
    multiTurnEscalation: Boolean(options.multiTurnEscalation),
  });

  const records: RolloutEvaluationRecord[] = [];
  const totalRollouts = testCases.length * REASONING_EFFORT_LEVELS.length;
  let completedRollouts = 0;

  for (let i = 0; i < testCases.length; i++) {
    const testCase = testCases[i]!;

    const tierResults = await Promise.all(
      REASONING_EFFORT_LEVELS.map(async (effort) => {
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
          created_at: createdAt,
        };

        completedRollouts++;
        options.onProgress?.(
          completedRollouts,
          totalRollouts,
          testCase.case_id,
          effort
        );
        if (!isDryRun) {
          const rSign = verification.deterministic_reward >= 0 ? '+' : '';
          console.log(
            `  [${String(completedRollouts).padStart(2, ' ')}/${totalRollouts}] ${
              testCase.case_id
            } | effort=${effort.padEnd(6, ' ')} -> ${
              rollout.parsed_response?.verdict ?? 'PARSE_ERR'
            } | reward=${rSign}${verification.deterministic_reward.toFixed(
              2
            )} | ${rollout.reasoning_token_count} reasoning tokens (${
              rollout.latency_ms
            } ms)`
          );
        }

        return record;
      })
    );

    records.push(...tierResults);
  }

  // Only overwrite default sample_dry_run.jsonl when running the baseline profile or explicit path
  if (options.outputJsonlPath || profile === 'baseline') {
    const jsonlContent =
      records.map((r) => JSON.stringify(r)).join('\n') + '\n';
    writeFileSync(outputJsonlPath, jsonlContent, 'utf8');
  }

  const summary = calculateSweepMetrics(records);
  const compactTimestamp = createdAt
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .slice(0, 19);

  const runId =
    options.runId ??
    `run-${compactTimestamp}-${isDryRun ? profile : 'live'}`;
  const defaultMeta = PROFILE_METADATA[profile];

  const run: HistoricalSweepRun = {
    run_id: runId,
    label:
      options.label ??
      (isDryRun ? defaultMeta.label : 'Live beta endpoint sweep'),
    profile: isDryRun ? profile : 'live',
    model_id: 'Beam-1.0-501B-A23B',
    adapter_id:
      options.adapterId !== undefined
        ? options.adapterId
        : isDryRun
        ? defaultMeta.adapterId
        : null,
    is_dry_run: isDryRun,
    created_at: createdAt,
    total_rollouts: summary.total_rollouts,
    overall_sar: summary.overall_sar,
    overall_vcp: summary.overall_vcp,
    overall_car: summary.overall_car,
    overall_mean_reward: summary.overall_mean_reward,
    reasoning_rationalization_delta: summary.reasoning_rationalization_delta,
    summary,
    records,
  };

  if (options.saveToHistory !== false) {
    saveHistoricalRun(run);
  }

  return {
    run,
    records,
    summary,
    outputJsonlPath,
  };
}

/**
 * Writes a HistoricalSweepRun to `rollouts/history/<run_id>.json` and rebuilds `rollouts/history/index.json`.
 */
export function saveHistoricalRun(run: HistoricalSweepRun): void {
  const historyDir = join(ROOT_DIR, 'rollouts', 'history');
  mkdirSync(historyDir, { recursive: true });

  const filePath = join(historyDir, `${run.run_id}.json`);
  writeFileSync(filePath, JSON.stringify(run, null, 2) + '\n', 'utf8');
  rebuildHistoryIndex();

  try {
    const runs = loadAllHistoricalRuns();
    const seedCasesRaw = readFileSync(
      join(ROOT_DIR, 'benchmark', 'seed_cases.json'),
      'utf8'
    );
    const seedCases = JSON.parse(seedCasesRaw) as AdversarialTestCase[];
    const samCasesPath = join(ROOT_DIR, 'benchmark', 'sam_gov_cases.json');
    const samCases = existsSync(samCasesPath)
      ? (JSON.parse(readFileSync(samCasesPath, 'utf8')) as AdversarialTestCase[])
      : [];
    const dashboardDataPath = join(ROOT_DIR, 'reports', 'dashboard_data.js');
    const jsPayload = [
      '// Auto-generated by harness/reasoning_sweep.ts — Do not edit manually',
      `window.__BEAM_DASHBOARD_BOOTSTRAP__ = ${JSON.stringify(
        { runs, seedCases: [...seedCases, ...samCases] },
        null,
        2
      )};`,
      '',
    ].join('\n');
    writeFileSync(dashboardDataPath, jsPayload, 'utf8');
  } catch {
    // Ignore if reports dir not yet initialized
  }
}

/**
 * Scans `rollouts/history/*.json` and writes a lightweight sorted manifest to `rollouts/history/index.json`.
 */
export function rebuildHistoryIndex(): HistoricalSweepRunMeta[] {
  const historyDir = join(ROOT_DIR, 'rollouts', 'history');
  mkdirSync(historyDir, { recursive: true });

  const files = readdirSync(historyDir).filter(
    (f) => f.endsWith('.json') && f !== 'index.json'
  );

  const metas: HistoricalSweepRunMeta[] = [];
  for (const file of files) {
    try {
      const raw = readFileSync(join(historyDir, file), 'utf8');
      const parsed = JSON.parse(raw) as HistoricalSweepRun;
      if (parsed && parsed.run_id && parsed.summary) {
        metas.push({
          run_id: parsed.run_id,
          label: parsed.label,
          profile: parsed.profile,
          model_id: parsed.model_id,
          adapter_id: parsed.adapter_id,
          is_dry_run: parsed.is_dry_run,
          created_at: parsed.created_at,
          total_rollouts: parsed.total_rollouts,
          overall_sar: parsed.overall_sar,
          overall_vcp: parsed.overall_vcp,
          overall_car: parsed.overall_car,
          overall_mean_reward: parsed.overall_mean_reward,
          reasoning_rationalization_delta:
            parsed.reasoning_rationalization_delta,
        });
      }
    } catch {
      // Ignore malformed files
    }
  }

  metas.sort((a, b) => b.created_at.localeCompare(a.created_at));
  writeFileSync(
    join(historyDir, 'index.json'),
    JSON.stringify(metas, null, 2) + '\n',
    'utf8'
  );
  return metas;
}

/**
 * Loads all full HistoricalSweepRun objects sorted newest-first.
 */
export function loadAllHistoricalRuns(): HistoricalSweepRun[] {
  const historyDir = join(ROOT_DIR, 'rollouts', 'history');
  if (!existsSync(historyDir)) {
    return [];
  }
  const files = readdirSync(historyDir).filter(
    (f) => f.endsWith('.json') && f !== 'index.json'
  );
  const runs: HistoricalSweepRun[] = [];
  for (const file of files) {
    try {
      const raw = readFileSync(join(historyDir, file), 'utf8');
      const parsed = JSON.parse(raw) as HistoricalSweepRun;
      if (parsed && parsed.run_id && Array.isArray(parsed.records)) {
        runs.push(parsed);
      }
    } catch {
      // Ignore invalid JSON
    }
  }
  runs.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return runs;
}

/**
 * Seeds the 3 canonical progression runs (Baseline -> Step 150 Checkpoint -> Post-RLVR Aligned v1.0)
 * if `rollouts/history/` does not yet have them, so the Report Dashboard has rich historical comparison data.
 */
export async function ensureSeedHistoricalRuns(): Promise<HistoricalSweepRun[]> {
  const existing = loadAllHistoricalRuns();
  const existingIds = new Set(existing.map((r) => r.run_id));

  const canonicalSeeds: Array<{
    runId: string;
    profile: SimulationProfile;
    label: string;
    createdAt: string;
  }> = [
    {
      runId: 'run-2026-10-26_14-15-00-baseline',
      profile: 'baseline',
      label: 'Unaligned baseline sweep',
      createdAt: '2026-10-26T14:15:00.000Z',
    },
    {
      runId: 'run-2026-10-27_18-40-00-checkpoint-step-150',
      profile: 'checkpoint-step-150',
      label: 'RLVR LoRA step 150 checkpoint',
      createdAt: '2026-10-27T18:40:00.000Z',
    },
    {
      runId: 'run-2026-10-28_21-30-00-rlvr-aligned',
      profile: 'rlvr-aligned',
      label: 'Post-RLVR Proof-of-Truth LoRA v1.0',
      createdAt: '2026-10-28T21:30:00.000Z',
    },
  ];

  for (const seed of canonicalSeeds) {
    if (!existingIds.has(seed.runId)) {
      await runReasoningSweep({
        dryRun: true,
        simulationProfile: seed.profile,
        runId: seed.runId,
        label: seed.label,
        createdAt: seed.createdAt,
        saveToHistory: true,
      });
    }
  }

  return loadAllHistoricalRuns();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const isDryRun =
    process.argv.includes('--dry-run') || !process.env.BEAM_API_KEY;
  const isSamDataset = process.argv.includes('--sam');
  const isMultiTurn = process.argv.includes('--multi-turn');
  const profileArg = process.argv
    .find((a) => a.startsWith('--profile='))
    ?.split('=')[1] as SimulationProfile | undefined;

  const datasetPath = isSamDataset
    ? join(ROOT_DIR, 'benchmark', 'sam_gov_cases.json')
    : join(ROOT_DIR, 'benchmark', 'seed_cases.json');

  const customLabel = isSamDataset
    ? `SAM.gov Full-Stack (10 Solicitations / 67 Attachments) — ${
        isDryRun
          ? `Dry-Run (${profileArg ?? 'baseline'})`
          : isMultiTurn
          ? 'Live Beam 501B (2-Turn Executive Escalation)'
          : 'Live Beam 501B (Subtle Camouflage v2)'
      }`
    : isMultiTurn
    ? 'Live Beam 501B (2-Turn Executive Escalation)'
    : undefined;

  console.log(
    `================================================================================`
  );
  console.log(
    `Beam-501B Epistemic Safety & RLVR "Proof of Truth" Multi-Tier Reasoning Sweep`
  );
  console.log(
    `Dataset: ${
      isSamDataset
        ? 'SAM.GOV FULL-STACK SOLICITATIONS (benchmark/sam_gov_cases.json)'
        : 'SYNTHETIC SEED BENCHMARK (benchmark/seed_cases.json)'
    }`
  );
  console.log(
    `Mode   : ${
      isDryRun
        ? `DETERMINISTIC DRY-RUN SIMULATION (--dry-run, profile=${
            profileArg ?? 'baseline'
          }, $0 API cost)`
        : isMultiTurn
        ? 'LIVE BETA ENDPOINT (2-TURN EXECUTIVE OVERRIDE ESCALATION)'
        : 'LIVE BETA ENDPOINT'
    }`
  );
  console.log(
    `================================================================================\n`
  );

  ensureSeedHistoricalRuns()
    .then(() =>
      runReasoningSweep({
        dryRun: isDryRun,
        simulationProfile: profileArg ?? 'baseline',
        multiTurnEscalation: isMultiTurn,
        seedCasesPath: datasetPath,
        label: customLabel,
      })
    )
    .then(({ run, records, summary, outputJsonlPath }) => {
      console.log(
        `Evaluated ${records.length} rollouts (${
          records.length / REASONING_EFFORT_LEVELS.length
        } adversarial cases × ${REASONING_EFFORT_LEVELS.length} reasoning_effort tiers).\n`
      );
      console.log(formatMetricsMarkdownTable(summary));
      console.log(`\nRollout traces written to : ${outputJsonlPath}`);
      console.log(`Historical run saved as  : rollouts/history/${run.run_id}.json`);
    })
    .catch((err: unknown) => {
      console.error('Reasoning sweep failed:', err);
      process.exitCode = 1;
    });
}
