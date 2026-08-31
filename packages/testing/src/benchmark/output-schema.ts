import { z } from 'zod';

/**
 * Unified structured-output contract for all 4 benchmark pipelines (P1–P4).
 * BENCHMARK_PROTOCOL Phase B: "Mỗi case chạy cùng một structured output contract."
 *
 * A pipeline that cannot satisfy this schema fails the `structured_schema_pass`
 * hard gate — regardless of how good its raw text looks.
 */

const K_LEVEL = z.enum(['K0', 'K1', 'K2', 'K3', 'K4', 'K5']);
const T_LEVEL = z.enum(['T1', 'T2', 'T3', 'T4', 'T5']);

export const mathExpressionSchema = z.object({
  latex: z.string().min(1),
  role: z.enum(['question', 'student_work', 'answer']),
  block_index: z.number().int().nonnegative(),
});

export const studentAnswerSchema = z.object({
  item_index: z.number().int().nonnegative(),
  answer_text: z.string(),
  is_correct: z.boolean().nullable(),
  error_location: z.string().nullable(),
});

export const pipelineOutputSchema = z.object({
  schema_version: z.literal('benchmark_extract.v1'),
  case_id: z.string().min(1),
  transcription: z.object({
    full_text: z.string(),
    math_expressions: z.array(mathExpressionSchema),
  }),
  segmentation: z.object({
    question_blocks: z.array(z.number().int().nonnegative()),
    student_work_blocks: z.array(z.number().int().nonnegative()),
  }),
  education_mapping: z.object({
    grade_context: z.union([z.literal(4), z.literal(7)]),
    /** MUST be candidates for review — the model never asserts a production id. */
    candidate_skill_ids: z.array(z.string()),
    problem_types: z.array(z.string()),
    knowledge_level: K_LEVEL,
    thinking_level: T_LEVEL,
  }),
  student_work: z.object({
    question_count: z.number().int().nonnegative(),
    student_answers: z.array(studentAnswerSchema),
  }),
  confidence: z.number().min(0).max(1),
});

export type PipelineOutput = z.infer<typeof pipelineOutputSchema>;

/** A run row = one pipeline × one case, plus measured cost telemetry (Phase C). */
export interface BenchmarkRunRow {
  readonly run_id: string;
  readonly case_id: string;
  readonly pipeline_id: string;
  readonly model_version: string;
  readonly output: unknown; // validated against pipelineOutputSchema by the scorer
  readonly latency_ms: number;
  readonly input_tokens: number | null;
  readonly output_tokens: number | null;
  readonly ocr_pages: number | null;
  readonly cost_usd: number;
  readonly cost_vnd: number;
  readonly retry_count: number;
  readonly escalated: boolean;
}
