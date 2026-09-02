import type { UploadAnalysisRecord, UploadAnalysisState, UploadRecord } from '@copilot/domain';

export interface AnalysisPatch {
  readonly state?: UploadAnalysisState;
  readonly extractionVersion?: string | null;
  readonly adapterProvider?: string | null;
  readonly adapterModel?: string | null;
  readonly extraction?: UploadAnalysisRecord['extraction'];
  readonly confidence?: number | null;
  readonly errorCode?: string | null;
  readonly errorMessage?: string | null;
  readonly confirmedByUserId?: string | null;
  readonly confirmedAt?: string | null;
  readonly resultingEvidenceIds?: readonly string[];
}

/**
 * Persistence port for M4. `uploads` rows are INSERT-only (the immutable
 * ledger); `upload_analysis` rows are mutated as the state machine advances.
 */
export interface UploadAnalysisStore {
  insertUpload(rec: UploadRecord): Promise<void>;
  getUpload(id: string): Promise<UploadRecord | null>;
  listUploads(childId: string): Promise<readonly UploadRecord[]>;

  insertAnalysis(rec: UploadAnalysisRecord): Promise<void>;
  getAnalysis(id: string): Promise<UploadAnalysisRecord | null>;
  getAnalysisByUpload(uploadId: string): Promise<UploadAnalysisRecord | null>;
  updateAnalysis(id: string, patch: AnalysisPatch): Promise<UploadAnalysisRecord>;
}

const clone = <T>(v: T): T => structuredClone(v);

export class InMemoryUploadAnalysisStore implements UploadAnalysisStore {
  readonly #uploads = new Map<string, UploadRecord>();
  readonly #analyses = new Map<string, UploadAnalysisRecord>();

  insertUpload(rec: UploadRecord): Promise<void> {
    if (this.#uploads.has(rec.id)) return Promise.reject(new Error('upload exists'));
    this.#uploads.set(rec.id, clone(rec));
    return Promise.resolve();
  }
  getUpload(id: string): Promise<UploadRecord | null> {
    const u = this.#uploads.get(id);
    return Promise.resolve(u ? clone(u) : null);
  }
  listUploads(childId: string): Promise<readonly UploadRecord[]> {
    return Promise.resolve(
      [...this.#uploads.values()]
        .filter((u) => u.childId === childId)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        .map(clone),
    );
  }

  insertAnalysis(rec: UploadAnalysisRecord): Promise<void> {
    if (this.#analyses.has(rec.id)) return Promise.reject(new Error('analysis exists'));
    this.#analyses.set(rec.id, clone(rec));
    return Promise.resolve();
  }
  getAnalysis(id: string): Promise<UploadAnalysisRecord | null> {
    const a = this.#analyses.get(id);
    return Promise.resolve(a ? clone(a) : null);
  }
  getAnalysisByUpload(uploadId: string): Promise<UploadAnalysisRecord | null> {
    const a = [...this.#analyses.values()].find((x) => x.uploadId === uploadId);
    return Promise.resolve(a ? clone(a) : null);
  }
  updateAnalysis(id: string, patch: AnalysisPatch): Promise<UploadAnalysisRecord> {
    const a = this.#analyses.get(id);
    if (!a) return Promise.reject(new Error(`analysis ${id} not found`));
    const next: UploadAnalysisRecord = {
      ...a,
      ...('state' in patch && patch.state !== undefined ? { state: patch.state } : {}),
      ...('extractionVersion' in patch ? { extractionVersion: patch.extractionVersion ?? null } : {}),
      ...('adapterProvider' in patch ? { adapterProvider: patch.adapterProvider ?? null } : {}),
      ...('adapterModel' in patch ? { adapterModel: patch.adapterModel ?? null } : {}),
      ...('extraction' in patch ? { extraction: patch.extraction ?? null } : {}),
      ...('confidence' in patch ? { confidence: patch.confidence ?? null } : {}),
      ...('errorCode' in patch ? { errorCode: patch.errorCode ?? null } : {}),
      ...('errorMessage' in patch ? { errorMessage: patch.errorMessage ?? null } : {}),
      ...('confirmedByUserId' in patch ? { confirmedByUserId: patch.confirmedByUserId ?? null } : {}),
      ...('confirmedAt' in patch ? { confirmedAt: patch.confirmedAt ?? null } : {}),
      ...('resultingEvidenceIds' in patch && patch.resultingEvidenceIds
        ? { resultingEvidenceIds: [...patch.resultingEvidenceIds] }
        : {}),
      updatedAt: new Date().toISOString(),
    };
    this.#analyses.set(id, next);
    return Promise.resolve(clone(next));
  }
}
