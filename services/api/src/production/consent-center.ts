import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { PILOT_CONSENT, hasPilotConsent } from './pilot.js';

/**
 * Consent management screen + data export (backlog B3-03, spec §1 "quản lý privacy/consent",
 * PRIVACY_ARCHITECTURE: Privacy-by-Design, NĐ 13/2023).
 *
 * `consent_records` is an append-only ledger. A grant and a withdrawal are both new rows (a
 * withdrawal carries `withdrawn_at`), so "current state" is the newest row per (purpose, processor)
 * and the full list is the audit timeline the parent can read.
 */

export interface ConsentKind {
  readonly kind: string;
  readonly purpose: string;
  readonly processor: string;
  readonly title: string;
  readonly summary: string;
  /** What switching it off changes — shown so the parent can decide knowingly. */
  readonly ifOff: string;
  readonly dataCategories: readonly string[];
  readonly crossBorder: boolean;
  readonly destinationRegion: string;
  readonly policyVersion: string;
  readonly consentTextVersion: string;
}

/**
 * Consents the product actually enforces. Add a kind here only when something in the code reads it —
 * a toggle that gates nothing would mislead the parent.
 */
export const CONSENT_CATALOG: readonly ConsentKind[] = [
  {
    kind: 'ai_content',
    purpose: PILOT_CONSENT.purpose,
    processor: PILOT_CONSENT.processor,
    title: 'Dùng AI soạn bài riêng cho con',
    summary:
      'Cho phép DạyZi nhờ AI soạn thêm bài tập phù hợp với con. DạyZi chỉ gửi nội dung học tập đã ẩn danh ' +
      '(không có tên, ngày sinh hay ảnh bài), và nhà cung cấp AI không được dùng dữ liệu này để huấn luyện mô hình.',
    ifOff:
      'Bài hằng ngày vẫn lấy từ thư viện câu hỏi có sẵn (miễn phí). Chỉ phần bài do AI soạn thêm bị tắt cho con.',
    dataCategories: PILOT_CONSENT.dataCategories,
    crossBorder: true,
    destinationRegion: 'us',
    policyVersion: PILOT_CONSENT.policyVersion,
    consentTextVersion: PILOT_CONSENT.consentTextVersion,
  },
  {
    kind: 'document_reading',
    purpose: 'document_photo_reading',
    processor: 'openai',
    title: 'Dùng AI đọc ảnh bài tập của con',
    summary:
      'Khi bố mẹ tải ảnh vở/bài kiểm tra, DạyZi gửi ảnh đó cho dịch vụ AI để đọc đề và đáp án. ' +
      'Ảnh được gửi ra máy chủ ở nước ngoài, chỉ để đọc một lần; nhà cung cấp không được dùng ảnh để huấn luyện mô hình. ' +
      'Bố mẹ luôn xem và xác nhận kết quả trước khi DạyZi ghi vào hồ sơ của con.',
    ifOff:
      'Vẫn tải ảnh lên được, nhưng DạyZi không tự đọc ảnh. Bố mẹ có thể nhập kết quả bài làm bằng tay.',
    dataCategories: ['raw_schoolwork'],
    crossBorder: true,
    destinationRegion: 'us',
    policyVersion: 'doc-reading-2026-11',
    consentTextVersion: 'doc-reading-consent-2026-11',
  },
];

export interface ConsentEvent {
  readonly kind: string;
  readonly action: 'GRANTED' | 'WITHDRAWN';
  readonly at: string;
  readonly policyVersion: string;
  readonly method: string;
}

export interface ConsentState extends ConsentKind {
  readonly active: boolean;
  readonly lastChangedAt: string | null;
}

export interface ConsentCenter {
  readonly consents: readonly ConsentState[];
  readonly history: readonly ConsentEvent[];
  readonly dataNotes: readonly string[];
}

/** Plain-language facts shown under the toggles; each one is enforced elsewhere in the code. */
export const DATA_NOTES: readonly string[] = [
  'Ảnh bài tập tải lên được giữ tối đa 30 ngày, sau khi đọc xong sẽ bị xoá; chỉ thông tin bố mẹ đã xác nhận được lưu lại.',
  'Dữ liệu học tập của con không dùng để huấn luyện mô hình AI.',
  'Giáo viên chỉ thấy phần bố mẹ cho phép, và không thấy hồ sơ năng lực hay điểm cần cải thiện của con.',
  'Bố mẹ có thể tải toàn bộ dữ liệu của con hoặc xoá vĩnh viễn hồ sơ bất cứ lúc nào.',
];

export function consentKindOf(kind: string): ConsentKind | undefined {
  return CONSENT_CATALOG.find((c) => c.kind === kind);
}

export async function getConsentCenter(pool: Pool, childId: string): Promise<ConsentCenter> {
  const { rows } = await pool.query<{
    purpose: string;
    processor: string;
    policy_version: string;
    method: string;
    accepted_at: Date;
    withdrawn_at: Date | null;
  }>(
    `SELECT purpose, processor, policy_version, method, accepted_at, withdrawn_at
       FROM consent_records WHERE child_id = $1 ORDER BY accepted_at DESC, id DESC`,
    [childId],
  );

  const consents: ConsentState[] = [];
  for (const k of CONSENT_CATALOG) {
    const latest = rows.find((r) => r.purpose === k.purpose && r.processor === k.processor);
    consents.push({
      ...k,
      active: latest !== undefined && latest.withdrawn_at === null,
      lastChangedAt: latest ? latest.accepted_at.toISOString() : null,
    });
  }

  const history: ConsentEvent[] = [];
  for (const r of rows) {
    const k = CONSENT_CATALOG.find((c) => c.purpose === r.purpose && c.processor === r.processor);
    if (!k) continue;
    history.push({
      kind: k.kind,
      action: r.withdrawn_at === null ? 'GRANTED' : 'WITHDRAWN',
      at: (r.withdrawn_at ?? r.accepted_at).toISOString(),
      policyVersion: r.policy_version,
      method: r.method,
    });
  }
  return { consents, history, dataNotes: DATA_NOTES };
}

/** True iff the newest ledger row for this consent kind is a grant (a withdrawal is a newer row). */
export async function hasConsent(pool: Pool, childId: string, kind: ConsentKind): Promise<boolean> {
  const { rows } = await pool.query<{ withdrawn_at: Date | null }>(
    `SELECT withdrawn_at FROM consent_records
      WHERE child_id = $1 AND purpose = $2 AND processor = $3
      ORDER BY accepted_at DESC, id DESC LIMIT 1`,
    [childId, kind.purpose, kind.processor],
  );
  return rows.length > 0 && rows[0]!.withdrawn_at === null;
}

/** Append a grant or a withdrawal. Callers check `hasConsent` first so repeats write nothing. */
export async function writeConsent(
  pool: Pool,
  input: { childId: string; userId: string; kind: ConsentKind; granted: boolean; method: string },
): Promise<void> {
  const k = input.kind;
  await pool.query(
    `INSERT INTO consent_records
       (id, child_id, granted_by, relationship, data_categories, purpose, processor,
        cross_border, destination_region, policy_version, consent_text_version, method, accepted_at, withdrawn_at)
     VALUES ($1,$2,$3,'parent',$4::jsonb,$5,$6,$7,$8,$9,$10,$11, now(), $12)`,
    [
      randomUUID(), input.childId, input.userId, JSON.stringify(k.dataCategories), k.purpose, k.processor,
      k.crossBorder, k.destinationRegion, k.policyVersion, k.consentTextVersion,
      input.granted ? input.method : `${input.method}_withdrawal`,
      input.granted ? null : new Date(),
    ],
  );
}

export { hasPilotConsent };

// ---------------------------------------------------------------------------
// data export (data-subject right of access)
// ---------------------------------------------------------------------------

/** Never leave the server: credential material and opaque internal secrets. */
const SECRET_KEYS = ['password_hash', 'pin_hash', 'storage_key', 'storage_path'];
const MAX_ROWS_PER_TABLE = 20_000;

interface ExportSpec {
  readonly key: string;
  readonly sql: string;
}

/**
 * Child-scoped tables included in the export. Mirrors the deletion workflow's table list on purpose —
 * what we can erase is what we must be able to hand over. Tables keyed by a pseudonymous child_ref
 * (worksheet runs, pilot telemetry) are internal operations data and are not part of the export.
 */
const EXPORT_SPECS: readonly ExportSpec[] = [
  { key: 'child_profile', sql: `SELECT * FROM child_profiles WHERE id = $1` },
  { key: 'evidence', sql: `SELECT * FROM evidence WHERE child_id = $1 ORDER BY 1` },
  { key: 'skill_states', sql: `SELECT * FROM skill_states WHERE child_id = $1` },
  { key: 'problem_type_mastery', sql: `SELECT * FROM problem_type_mastery WHERE child_id = $1` },
  { key: 'thinking_state', sql: `SELECT * FROM thinking_state WHERE child_id = $1` },
  { key: 'knowledge_gaps', sql: `SELECT * FROM knowledge_gaps WHERE child_id = $1` },
  { key: 'gap_prescriptions', sql: `SELECT * FROM gap_prescriptions WHERE child_id = $1` },
  { key: 'learning_plans', sql: `SELECT * FROM learning_plans WHERE child_id = $1` },
  {
    key: 'plan_items',
    sql: `SELECT * FROM plan_items WHERE learning_plan_id IN (SELECT id FROM learning_plans WHERE child_id = $1)`,
  },
  { key: 'assignments', sql: `SELECT * FROM assignments WHERE child_id = $1` },
  {
    key: 'assignment_items',
    sql: `SELECT * FROM assignment_items WHERE assignment_id IN (SELECT id FROM assignments WHERE child_id = $1)`,
  },
  { key: 'attempts', sql: `SELECT * FROM attempts WHERE child_id = $1` },
  {
    key: 'attempt_answers',
    sql: `SELECT * FROM attempt_answers WHERE attempt_id IN (SELECT id FROM attempts WHERE child_id = $1)`,
  },
  { key: 'exams', sql: `SELECT * FROM exams WHERE child_id = $1` },
  { key: 'exam_results', sql: `SELECT * FROM exam_results WHERE child_id = $1` },
  // upload bytes are not exported (raw files are purged after 30 days); the ledger + what was read is.
  { key: 'uploads', sql: `SELECT * FROM uploads WHERE child_id = $1` },
  { key: 'upload_analysis', sql: `SELECT * FROM upload_analysis WHERE child_id = $1` },
  { key: 'teacher_contributions', sql: `SELECT * FROM teacher_contributions WHERE child_id = $1` },
  { key: 'teacher_child_links', sql: `SELECT * FROM teacher_child_links WHERE child_id = $1` },
  { key: 'student_class_enrollments', sql: `SELECT * FROM student_class_enrollments WHERE child_id = $1` },
  { key: 'student_school_enrollments', sql: `SELECT * FROM student_school_enrollments WHERE child_id = $1` },
  { key: 'consent_records', sql: `SELECT * FROM consent_records WHERE child_id = $1` },
  { key: 'privacy_preferences', sql: `SELECT * FROM privacy_preferences WHERE child_id = $1` },
  {
    key: 'student_account',
    sql: `SELECT l.status, l.created_at, u.primary_email AS login
            FROM student_account_links l JOIN users u ON u.id = l.user_id WHERE l.child_id = $1`,
  },
];

export interface ChildDataExport {
  readonly format: 'dayzi.child-data-export.v1';
  readonly exportedAt: string;
  readonly childId: string;
  readonly note: string;
  readonly tables: Readonly<Record<string, readonly Record<string, unknown>[]>>;
  /** Tables that could not be read (e.g. not present in this environment) — never silent. */
  readonly unavailable: readonly string[];
  readonly truncated: readonly string[];
}

function stripSecrets(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (SECRET_KEYS.includes(k)) continue;
    out[k] = v;
  }
  return out;
}

export async function exportChildData(pool: Pool, childId: string, now: Date): Promise<ChildDataExport> {
  const tables: Record<string, Record<string, unknown>[]> = {};
  const unavailable: string[] = [];
  const truncated: string[] = [];
  for (const spec of EXPORT_SPECS) {
    try {
      const { rows } = await pool.query(`${spec.sql} LIMIT ${MAX_ROWS_PER_TABLE + 1}`, [childId]);
      if (rows.length > MAX_ROWS_PER_TABLE) {
        truncated.push(spec.key);
        rows.length = MAX_ROWS_PER_TABLE;
      }
      tables[spec.key] = (rows as Record<string, unknown>[]).map(stripSecrets);
    } catch {
      unavailable.push(spec.key);
    }
  }
  return {
    format: 'dayzi.child-data-export.v1',
    exportedAt: now.toISOString(),
    childId,
    note:
      'Bản sao dữ liệu DạyZi đang lưu về con. Không gồm mật khẩu, mã PIN hay khoá lưu trữ nội bộ; ' +
      'ảnh bài tập gốc đã bị xoá sau 30 ngày nên chỉ còn thông tin đã đọc và xác nhận.',
    tables,
    unavailable,
    truncated,
  };
}
