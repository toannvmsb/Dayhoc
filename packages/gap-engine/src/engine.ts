import {
  type ChildId,
  type ChildLearningTwin,
  type DetectedGap,
  type Evidence,
  type GapId,
  type GradeContext,
  type LearningPrescription,
  type LearningReadiness,
} from '@copilot/domain';
import type { KnowledgeBase } from '@copilot/math-data';
import { DEFAULT_GAP_CONFIG, type GapConfig } from './config.js';
import { detectGaps } from './detect.js';
import { scoreGap } from './score.js';
import { computeReadiness, DEFAULT_READINESS_CONFIG, type ReadinessConfig } from './readiness.js';
import { generatePrescription } from './prescription.js';

export interface GapEngineInput {
  readonly childId: ChildId;
  readonly gradeContext: GradeContext;
  readonly twin: ChildLearningTwin;
  readonly evidence: readonly Evidence[];
  readonly knowledgeBase: KnowledgeBase;
  readonly parentGoal?: string;
  readonly asOf?: Date;
  readonly config?: GapConfig;
  readonly readinessConfig?: ReadinessConfig;
  readonly newId?: () => string;
}

export interface GapEngineResult {
  readonly childId: ChildId;
  readonly computedAt: string;
  /** Gaps, highest gap_score first (Math Core §21). */
  readonly gaps: readonly DetectedGap[];
  readonly prescriptions: readonly LearningPrescription[];
  readonly readiness: readonly LearningReadiness[];
}

/**
 * Deterministic gap & readiness pass over a Child Learning Twin (Phase 4).
 * detect → root-gap trace → gap_score → readiness → prescription. Pure; no I/O,
 * no AI. New gaps start at DETECTED and are never CLOSED here.
 */
export function runGapEngine(input: GapEngineInput): GapEngineResult {
  const asOf = input.asOf ?? new Date();
  const config = input.config ?? DEFAULT_GAP_CONFIG;
  const readinessConfig = input.readinessConfig ?? DEFAULT_READINESS_CONFIG;
  let counter = 0;
  const newId = input.newId ?? (() => `${++counter}`);
  const kb = input.knowledgeBase;

  const findings = detectGaps({ twin: input.twin, evidence: input.evidence, knowledgeBase: kb, config, asOf });

  const scored = findings
    .map((finding) => ({
      finding,
      score: scoreGap(finding, input.twin, kb, config, input.parentGoal),
    }))
    .sort((a, b) => b.score.score - a.score.score);

  const gaps: DetectedGap[] = [];
  const prescriptions: LearningPrescription[] = [];
  const readiness: LearningReadiness[] = [];

  for (const { finding, score } of scored) {
    const gapId = `gap_${newId()}` as GapId;
    const targetReadiness = computeReadiness(
      input.childId,
      finding.targetSkillId,
      input.twin,
      kb,
      config,
      readinessConfig,
    );
    readiness.push(targetReadiness);

    // A substantial concept/method/recognition/application gap in a skill impedes
    // progress in that skill by definition — not only when a prerequisite is weak.
    const IN_SKILL_BLOCKING = new Set([
      'concept_gap',
      'method_gap',
      'recognition_gap',
      'application_gap',
      'procedural_gap',
    ]);
    const blocksCurrentLearning =
      targetReadiness.recommendation !== 'ready' ||
      finding.type === 'prerequisite_gap' ||
      (IN_SKILL_BLOCKING.has(finding.type) && finding.severity >= 0.4);
    const blocksAdvancedLearning = targetReadiness.recommendation === 'repair_first';

    gaps.push({
      id: gapId,
      childId: input.childId,
      type: finding.type,
      targetSkillId: finding.targetSkillId,
      rootSkillId: finding.rootSkillId,
      severity: finding.severity,
      lifecycleState: 'DETECTED',
      evidenceRefs: finding.evidenceRefs,
      detectedAt: asOf.toISOString(),
      score,
      rationale: finding.rationale,
      ruledOut: finding.ruledOut,
      blocksCurrentLearning,
      blocksAdvancedLearning,
    });

    // careless errors don't get a remediation prescription (Math Core §19).
    if (finding.type === 'careless_error') continue;

    prescriptions.push(
      generatePrescription({
        childId: input.childId,
        gapId,
        finding,
        score,
        readiness: targetReadiness,
        knowledgeBase: kb,
        at: asOf.toISOString(),
        newId,
      }),
    );
  }

  return { childId: input.childId, computedAt: asOf.toISOString(), gaps, prescriptions, readiness };
}
