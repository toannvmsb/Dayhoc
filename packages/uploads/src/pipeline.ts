import { randomUUID } from 'node:crypto';
import {
  canTransitionUpload,
  UPLOAD_ITEM_AUTOSELECT_MIN_CONFIDENCE,
  type ConfirmedUploadItem,
  type DocumentExtraction,
  type UploadAnalysisRecord,
  type UploadAnalysisState,
  type UploadKind,
  type UploadRecord,
} from '@copilot/domain';
import type { Logger } from '@copilot/observability';
import type { AnalysisPatch, UploadAnalysisStore } from './analysis-store.js';
import type { DocumentVisionAdapter } from './vision.js';
import type { UploadStorageAdapter } from './storage.js';

export class UploadStateError extends Error {
  readonly code = 'UPLOAD_STATE_INVALID';
  constructor(from: UploadAnalysisState, to: UploadAnalysisState) {
    super(`cannot move upload analysis from ${from} to ${to}`);
    this.name = 'UploadStateError';
  }
}

export interface CreateUploadInput {
  readonly childId: string;
  readonly actorUserId: string | null;
  readonly kind: UploadKind;
  readonly filename: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
}

/** One evidence row to append after the parent confirms — a domain draft. */
export interface ConfirmedEvidenceDraft {
  readonly childId: string;
  readonly source:
    | 'notebook_scan'
    | 'school_test'
    | 'school_homework'
    | 'teacher_message_scan';
  readonly occurredAt: string;
  readonly skillId: string;
  readonly problemTypeId: string | null;
  readonly correct: boolean | null;
  readonly confidenceTier: 'B' | 'C';
}

export interface ConfirmResult {
  readonly analysis: UploadAnalysisRecord;
  readonly evidenceDrafts: readonly ConfirmedEvidenceDraft[];
  /** A teacher note on the page, if any — surfaced for the parent, not auto-applied. */
  readonly teacherNote: string | null;
}

/** Parent corrections keyed by extracted-item index. */
export interface ItemCorrection {
  readonly index: number;
  /** true to include this item as evidence; false/absent to drop it. */
  readonly confirm: boolean;
  /** Override the mapped skill (required if the item had no candidates). */
  readonly skillId?: string;
  /** Override the right/wrong mark. */
  readonly correct?: boolean | null;
}

export interface UploadIngestionOptions {
  readonly storage: UploadStorageAdapter;
  readonly vision: DocumentVisionAdapter;
  readonly store: UploadAnalysisStore;
  readonly now?: () => Date;
  readonly newId?: () => string;
  readonly logger?: Logger;
}

/**
 * Orchestrates the M4 lifecycle:
 *   UPLOAD_CREATED → UPLOADED → READING → ANALYZING → MAPPED → NEEDS_CONFIRMATION → CONFIRMED
 * with FAILED reachable from any processing state.
 *
 * It NEVER writes evidence or mutates the Twin — `confirmAnalysis` returns
 * evidence *drafts* for the caller (the API) to append through the normal
 * append-only `EvidenceService`, after which the Twin/gap pipeline recomputes.
 */
export class UploadIngestionService {
  readonly #storage: UploadStorageAdapter;
  readonly #vision: DocumentVisionAdapter;
  readonly #store: UploadAnalysisStore;
  readonly #now: () => Date;
  readonly #newId: () => string;
  readonly #logger: Logger | undefined;

  constructor(opts: UploadIngestionOptions) {
    this.#storage = opts.storage;
    this.#vision = opts.vision;
    this.#store = opts.store;
    this.#now = opts.now ?? (() => new Date());
    this.#newId = opts.newId ?? randomUUID;
    this.#logger = opts.logger;
  }

  async #advance(
    analysis: UploadAnalysisRecord,
    to: UploadAnalysisState,
    patch: Omit<AnalysisPatch, 'state'> = {},
  ): Promise<UploadAnalysisRecord> {
    if (!canTransitionUpload(analysis.state, to)) throw new UploadStateError(analysis.state, to);
    return this.#store.updateAnalysis(analysis.id, { ...patch, state: to });
  }

  async createUpload(input: CreateUploadInput): Promise<{
    upload: UploadRecord;
    analysis: UploadAnalysisRecord;
  }> {
    const ref = await this.#storage.put({
      childId: input.childId,
      filename: input.filename,
      mimeType: input.mimeType,
      bytes: input.bytes,
    });
    const at = this.#now().toISOString();
    const upload: UploadRecord = {
      id: this.#newId(),
      childId: input.childId,
      kind: input.kind,
      storageKey: ref.storageKey,
      actorUserId: input.actorUserId,
      originalFilename: input.filename,
      mimeType: input.mimeType,
      byteSize: ref.byteSize,
      contentHash: ref.contentHash,
      createdAt: at,
    };
    await this.#store.insertUpload(upload);

    const analysis: UploadAnalysisRecord = {
      id: this.#newId(),
      uploadId: upload.id,
      childId: input.childId,
      state: 'UPLOAD_CREATED',
      extractionVersion: null,
      adapterProvider: null,
      adapterModel: null,
      extraction: null,
      confidence: null,
      errorCode: null,
      errorMessage: null,
      confirmedByUserId: null,
      confirmedAt: null,
      resultingEvidenceIds: [],
      createdAt: at,
      updatedAt: at,
    };
    await this.#store.insertAnalysis(analysis);
    const uploaded = await this.#advance(analysis, 'UPLOADED');
    this.#logger?.info('upload.created', { uploadId: upload.id, childId: input.childId, kind: input.kind });
    return { upload, analysis: uploaded };
  }

  /**
   * Run the vision adapter over an UPLOADED artefact. Deterministic mock by
   * default — no paid call unless an operator opted in when wiring the adapter.
   */
  async runAnalysis(input: {
    uploadId: string;
    childGrade: number;
    knownSkillIds: readonly string[];
  }): Promise<UploadAnalysisRecord> {
    const upload = await this.#store.getUpload(input.uploadId);
    if (!upload) throw new Error(`upload ${input.uploadId} not found`);
    let analysis = await this.#store.getAnalysisByUpload(input.uploadId);
    if (!analysis) throw new Error(`analysis for upload ${input.uploadId} not found`);
    if (analysis.state !== 'UPLOADED') throw new UploadStateError(analysis.state, 'READING');

    try {
      analysis = await this.#advance(analysis, 'READING');
      const bytes = await this.#storage.getBytes(upload.storageKey);
      analysis = await this.#advance(analysis, 'ANALYZING', {
        adapterProvider: this.#vision.provider,
        adapterModel: this.#vision.model,
        extractionVersion: this.#vision.extractionVersion,
      });
      const extraction = await this.#vision.analyze({
        bytes,
        mimeType: upload.mimeType ?? 'application/octet-stream',
        childGrade: input.childGrade,
        kindHint: upload.kind,
        knownSkillIds: input.knownSkillIds,
      });
      analysis = await this.#advance(analysis, 'MAPPED', {
        extraction,
        confidence: extraction.overallConfidence,
      });
      analysis = await this.#advance(analysis, 'NEEDS_CONFIRMATION');
      this.#logger?.info('upload.analyzed', {
        uploadId: input.uploadId,
        items: extraction.items.length,
        confidence: extraction.overallConfidence,
      });
      return analysis;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code = (err as { code?: string }).code ?? 'ANALYSIS_FAILED';
      this.#logger?.error('upload.analysis.failed', { uploadId: input.uploadId, code, message });
      return this.#store.updateAnalysis(analysis.id, {
        state: 'FAILED',
        errorCode: code,
        errorMessage: message,
      });
    }
  }

  /**
   * The parent reviews the extraction and confirms/corrects items. Only the
   * items they keep become evidence drafts. A low-confidence item that the
   * parent did not explicitly confirm is dropped — it NEVER becomes evidence.
   */
  async confirmAnalysis(input: {
    uploadId: string;
    confirmedByUserId: string;
    corrections: readonly ItemCorrection[];
  }): Promise<ConfirmResult> {
    const upload = await this.#store.getUpload(input.uploadId);
    if (!upload) throw new Error(`upload ${input.uploadId} not found`);
    let analysis = await this.#store.getAnalysisByUpload(input.uploadId);
    if (!analysis) throw new Error(`analysis for upload ${input.uploadId} not found`);
    if (analysis.state !== 'NEEDS_CONFIRMATION') {
      throw new UploadStateError(analysis.state, 'CONFIRMED');
    }
    const extraction = analysis.extraction;
    if (!extraction) throw new Error('no extraction to confirm');

    const byIndex = new Map(input.corrections.map((c) => [c.index, c]));
    const drafts: ConfirmedEvidenceDraft[] = [];
    const source = draftSource(extraction);
    const tier: 'B' | 'C' = extraction.documentType === 'GRADED_TEST' ? 'B' : 'C';
    const occurredAt = `${extraction.observedOn ?? this.#now().toISOString().slice(0, 10)}T00:00:00.000Z`;

    for (const item of extraction.items) {
      const corr = byIndex.get(item.index);
      const top = item.skillCandidates[0];
      const autoSelected =
        top !== undefined && top.confidence >= UPLOAD_ITEM_AUTOSELECT_MIN_CONFIDENCE;
      const include = corr ? corr.confirm : autoSelected;
      if (!include) continue;
      const skillId = corr?.skillId ?? top?.skillId;
      if (!skillId) continue; // no skill → cannot become evidence
      drafts.push({
        childId: analysis.childId,
        source,
        occurredAt,
        skillId,
        problemTypeId: item.problemTypeId,
        correct: corr && 'correct' in corr ? (corr.correct ?? null) : item.markedCorrect,
        confidenceTier: tier,
      });
    }

    const confirmedAt = this.#now().toISOString();
    analysis = await this.#store.updateAnalysis(analysis.id, {
      state: 'CONFIRMED',
      confirmedByUserId: input.confirmedByUserId,
      confirmedAt,
    });
    this.#logger?.info('upload.confirmed', {
      uploadId: input.uploadId,
      evidenceDrafts: drafts.length,
    });
    return { analysis, evidenceDrafts: drafts, teacherNote: extraction.teacherNote };
  }

  /** Record which evidence rows the confirmation produced (provenance link). */
  async recordResultingEvidence(analysisId: string, evidenceIds: readonly string[]): Promise<void> {
    await this.#store.updateAnalysis(analysisId, { resultingEvidenceIds: evidenceIds });
  }

  markFailed(analysisId: string, code: string, message: string): Promise<UploadAnalysisRecord> {
    return this.#store.updateAnalysis(analysisId, { state: 'FAILED', errorCode: code, errorMessage: message });
  }
}

function draftSource(e: DocumentExtraction): ConfirmedEvidenceDraft['source'] {
  switch (e.documentType) {
    case 'GRADED_TEST':
      return 'school_test';
    case 'HOMEWORK':
      return 'school_homework';
    case 'TEACHER_NOTE':
      return 'teacher_message_scan';
    default:
      return 'notebook_scan';
  }
}

/** Which extracted items a UI should pre-tick for the parent. */
export function autoSelectedIndexes(extraction: DocumentExtraction): readonly number[] {
  return extraction.items
    .filter((it) => (it.skillCandidates[0]?.confidence ?? 0) >= UPLOAD_ITEM_AUTOSELECT_MIN_CONFIDENCE)
    .map((it) => it.index);
}

export type { ConfirmedUploadItem };
