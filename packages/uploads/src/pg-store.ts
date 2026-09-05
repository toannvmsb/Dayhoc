import type { Pool, PoolClient } from 'pg';
import type { DocumentExtraction, UploadAnalysisRecord, UploadRecord } from '@copilot/domain';
import type { AnalysisPatch, UploadAnalysisStore } from './analysis-store.js';

type Queryable = Pool | PoolClient;
/* eslint-disable @typescript-eslint/no-explicit-any */
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));
const isoN = (v: unknown): string | null => (v === null || v === undefined ? null : iso(v));
const numN = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

function rowToUpload(x: any): UploadRecord {
  return {
    id: x.id,
    childId: x.child_id,
    kind: x.kind,
    storageKey: x.storage_key,
    actorUserId: x.actor_user_id ?? null,
    originalFilename: x.original_filename ?? null,
    mimeType: x.mime_type ?? null,
    byteSize: numN(x.byte_size),
    contentHash: x.content_hash ?? null,
    createdAt: iso(x.created_at),
  };
}

function rowToAnalysis(x: any): UploadAnalysisRecord {
  return {
    id: x.id,
    uploadId: x.upload_id,
    childId: x.child_id,
    state: x.state,
    extractionVersion: x.extraction_version ?? null,
    adapterProvider: x.adapter_provider ?? null,
    adapterModel: x.adapter_model ?? null,
    extraction: (x.extraction ?? null) as DocumentExtraction | null,
    confidence: numN(x.confidence),
    errorCode: x.error_code ?? null,
    errorMessage: x.error_message ?? null,
    confirmedByUserId: x.confirmed_by_user_id ?? null,
    confirmedAt: isoN(x.confirmed_at),
    resultingEvidenceIds: (x.resulting_evidence_ids ?? []) as string[],
    dismissedAt: isoN(x.dismissed_at),
    dismissedByUserId: x.dismissed_by_user_id ?? null,
    createdAt: iso(x.created_at),
    updatedAt: iso(x.updated_at),
  };
}

export class PgUploadAnalysisStore implements UploadAnalysisStore {
  constructor(private readonly pool: Queryable) {}

  async insertUpload(rec: UploadRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO uploads (id, child_id, kind, storage_key, status, actor_user_id,
         original_filename, mime_type, byte_size, content_hash, created_at)
       VALUES ($1,$2,$3,$4,'stored',$5,$6,$7,$8,$9,$10)`,
      [
        rec.id, rec.childId, rec.kind, rec.storageKey, rec.actorUserId,
        rec.originalFilename, rec.mimeType, rec.byteSize, rec.contentHash, rec.createdAt,
      ],
    );
  }
  async getUpload(id: string): Promise<UploadRecord | null> {
    const r = await this.pool.query(`SELECT * FROM uploads WHERE id = $1`, [id]);
    return r.rows[0] ? rowToUpload(r.rows[0]) : null;
  }
  async listUploads(childId: string): Promise<readonly UploadRecord[]> {
    const r = await this.pool.query(
      `SELECT * FROM uploads WHERE child_id = $1 ORDER BY created_at DESC`,
      [childId],
    );
    return r.rows.map(rowToUpload);
  }

  async insertAnalysis(rec: UploadAnalysisRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO upload_analysis (id, upload_id, child_id, state, extraction_version,
         adapter_provider, adapter_model, extraction, confidence, error_code, error_message,
         confirmed_by_user_id, confirmed_at, resulting_evidence_ids, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14::jsonb,$15,$16)`,
      [
        rec.id, rec.uploadId, rec.childId, rec.state, rec.extractionVersion,
        rec.adapterProvider, rec.adapterModel,
        rec.extraction ? JSON.stringify(rec.extraction) : null,
        rec.confidence, rec.errorCode, rec.errorMessage, rec.confirmedByUserId, rec.confirmedAt,
        JSON.stringify(rec.resultingEvidenceIds), rec.createdAt, rec.updatedAt,
      ],
    );
  }
  async getAnalysis(id: string): Promise<UploadAnalysisRecord | null> {
    const r = await this.pool.query(`SELECT * FROM upload_analysis WHERE id = $1`, [id]);
    return r.rows[0] ? rowToAnalysis(r.rows[0]) : null;
  }
  async getAnalysisByUpload(uploadId: string): Promise<UploadAnalysisRecord | null> {
    const r = await this.pool.query(`SELECT * FROM upload_analysis WHERE upload_id = $1`, [uploadId]);
    return r.rows[0] ? rowToAnalysis(r.rows[0]) : null;
  }
  async updateAnalysis(id: string, patch: AnalysisPatch): Promise<UploadAnalysisRecord> {
    const sets: string[] = [];
    const vals: unknown[] = [];
    const put = (col: string, val: unknown, cast = '') => {
      vals.push(val);
      sets.push(`${col} = $${vals.length}${cast}`);
    };
    if (patch.state !== undefined) put('state', patch.state);
    if ('extractionVersion' in patch) put('extraction_version', patch.extractionVersion ?? null);
    if ('adapterProvider' in patch) put('adapter_provider', patch.adapterProvider ?? null);
    if ('adapterModel' in patch) put('adapter_model', patch.adapterModel ?? null);
    if ('extraction' in patch) {
      put('extraction', patch.extraction ? JSON.stringify(patch.extraction) : null, '::jsonb');
    }
    if ('confidence' in patch) put('confidence', patch.confidence ?? null);
    if ('errorCode' in patch) put('error_code', patch.errorCode ?? null);
    if ('errorMessage' in patch) put('error_message', patch.errorMessage ?? null);
    if ('confirmedByUserId' in patch) put('confirmed_by_user_id', patch.confirmedByUserId ?? null);
    if ('confirmedAt' in patch) put('confirmed_at', patch.confirmedAt ?? null);
    if (patch.resultingEvidenceIds) {
      put('resulting_evidence_ids', JSON.stringify(patch.resultingEvidenceIds), '::jsonb');
    }
    if ('dismissedAt' in patch) put('dismissed_at', patch.dismissedAt ?? null);
    if ('dismissedByUserId' in patch) put('dismissed_by_user_id', patch.dismissedByUserId ?? null);
    sets.push(`updated_at = now()`);
    vals.push(id);
    const r = await this.pool.query(
      `UPDATE upload_analysis SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`,
      vals,
    );
    if (!r.rows[0]) throw new Error(`analysis ${id} not found`);
    return rowToAnalysis(r.rows[0]);
  }
}
