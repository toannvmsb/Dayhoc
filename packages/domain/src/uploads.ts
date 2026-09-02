/**
 * Evidence upload / document-vision ingestion vocabulary (M4).
 *
 * TWO records per upload:
 *  - an IMMUTABLE `UploadRecord` — the ledger row: who, what child, where the
 *    bytes live, original metadata, hash, time. Never mutated.
 *  - a MUTABLE `UploadAnalysisRecord` — the processing state machine: extraction
 *    result, mapping candidates, confidence, error, confirmation.
 *
 * Binary content is NEVER stored in Postgres — only a `storageKey` into an
 * object store behind `UploadStorageAdapter`.
 *
 * A low-confidence extraction is NEVER silently promoted to VERIFIED evidence —
 * the parent reviews and corrects it first, and only the items they confirm
 * become (SUPPORTING/STRONG, never VERIFIED) evidence.
 */

export const UPLOAD_ANALYSIS_STATES = [
  'UPLOAD_CREATED',
  'UPLOADED',
  'READING',
  'ANALYZING',
  'MAPPED',
  'NEEDS_CONFIRMATION',
  'CONFIRMED',
  'FAILED',
] as const;
export type UploadAnalysisState = (typeof UPLOAD_ANALYSIS_STATES)[number];

/** Legal forward transitions. `FAILED` is reachable from any processing state. */
export const UPLOAD_ANALYSIS_TRANSITIONS: Record<
  UploadAnalysisState,
  readonly UploadAnalysisState[]
> = {
  UPLOAD_CREATED: ['UPLOADED', 'FAILED'],
  UPLOADED: ['READING', 'FAILED'],
  READING: ['ANALYZING', 'FAILED'],
  ANALYZING: ['MAPPED', 'FAILED'],
  MAPPED: ['NEEDS_CONFIRMATION', 'FAILED'],
  NEEDS_CONFIRMATION: ['CONFIRMED', 'FAILED'],
  CONFIRMED: [],
  FAILED: [],
};

export function canTransitionUpload(
  from: UploadAnalysisState,
  to: UploadAnalysisState,
): boolean {
  return UPLOAD_ANALYSIS_TRANSITIONS[from].includes(to);
}

export const UPLOAD_KINDS = [
  'NOTEBOOK_PAGE',
  'GRADED_TEST',
  'HOMEWORK',
  'TEACHER_MESSAGE',
  'OTHER',
] as const;
export type UploadKind = (typeof UPLOAD_KINDS)[number];

export const DOCUMENT_TYPES = [
  'WORKSHEET',
  'GRADED_TEST',
  'HOMEWORK',
  'TEACHER_NOTE',
  'UNKNOWN',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** The immutable ledger row for one uploaded artefact. */
export interface UploadRecord {
  readonly id: string;
  readonly childId: string;
  readonly kind: UploadKind;
  /** Reference into the object store — never the bytes themselves. */
  readonly storageKey: string;
  readonly actorUserId: string | null;
  readonly originalFilename: string | null;
  readonly mimeType: string | null;
  readonly byteSize: number | null;
  /** sha256 hex of the stored bytes, when the adapter can produce it. */
  readonly contentHash: string | null;
  readonly createdAt: string;
}

/** One question/answer the vision adapter extracted, with skill-mapping candidates. */
export interface ExtractedItem {
  readonly index: number;
  readonly prompt: string;
  readonly childAnswer: string | null;
  /** From a graded artefact: was this marked right? `null` when not gradeable. */
  readonly markedCorrect: boolean | null;
  /** Ranked skill guesses (highest confidence first). May be empty. */
  readonly skillCandidates: readonly { readonly skillId: string; readonly confidence: number }[];
  readonly problemTypeId: string | null;
}

/** The structured output of a `DocumentVisionAdapter.analyze` call. */
export interface DocumentExtraction {
  readonly documentType: DocumentType;
  /** ISO date the work happened, if legible on the page. */
  readonly observedOn: string | null;
  readonly items: readonly ExtractedItem[];
  readonly teacherNote: string | null;
  /** 0..1 — the adapter's own confidence in the whole extraction. */
  readonly overallConfidence: number;
}

/** The mutable processing-state row for one upload. */
export interface UploadAnalysisRecord {
  readonly id: string;
  readonly uploadId: string;
  readonly childId: string;
  readonly state: UploadAnalysisState;
  readonly extractionVersion: string | null;
  readonly adapterProvider: string | null;
  readonly adapterModel: string | null;
  readonly extraction: DocumentExtraction | null;
  readonly confidence: number | null;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly confirmedByUserId: string | null;
  readonly confirmedAt: string | null;
  readonly resultingEvidenceIds: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Below this the item is NOT pre-selected for confirmation — the parent has to
 * explicitly tick it (and may fix the skill) before it becomes evidence.
 */
export const UPLOAD_ITEM_AUTOSELECT_MIN_CONFIDENCE = 0.6;

/** One parent-confirmed item, ready to become an append-only evidence row. */
export interface ConfirmedUploadItem {
  readonly index: number;
  readonly skillId: string;
  readonly problemTypeId: string | null;
  readonly correct: boolean | null;
  /** SUPPORTING for a plain scan, STRONG for a graded test — NEVER 'A' (verified). */
  readonly confidenceTier: 'B' | 'C';
}
