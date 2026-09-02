import { randomUUID } from 'node:crypto';
import {
  asAcademicYearId,
  asClassroomId,
  asSchoolId,
  asSubjectId,
  type AcademicYearId,
  type AcademicYearRecord,
  type ClassroomId,
  type ClassroomRecord,
  type DirectoryVerificationStatus,
  type SchoolId,
  type SchoolRecord,
  type SchoolType,
  type SubjectCode,
  type SubjectId,
  type SubjectRecord,
} from '@copilot/domain';
import type { Logger } from '@copilot/observability';
import { ConflictError, NotFoundError, ValidationError } from './errors.js';
import type { EducationStore, SchoolSearchQuery } from './store.js';

export interface DirectoryServiceOptions {
  readonly store: EducationStore;
  readonly logger?: Logger;
  readonly now?: () => Date;
  readonly newId?: () => string;
}

export interface ProposeSchoolInput {
  readonly officialName: string;
  readonly shortName?: string;
  readonly schoolType?: SchoolType;
  readonly officialSchoolCode?: string;
  readonly province?: string;
  readonly district?: string;
  readonly ward?: string;
  readonly address?: string;
  readonly latitude?: number;
  readonly longitude?: number;
  readonly createdBy?: string;
}

export interface ProposeSchoolResult {
  readonly school: SchoolRecord;
  /** true when an existing row with the same identity key was returned as-is. */
  readonly deduplicated: boolean;
  /** Fuzzy near-matches the caller should double-check before creating a new row. */
  readonly similarCandidates: readonly SchoolRecord[];
}

export interface ProposeClassroomInput {
  readonly schoolId: string;
  readonly academicYearId: string;
  readonly grade: number;
  readonly className: string;
  readonly displayName?: string;
  readonly createdBy?: string;
}

/**
 * School / academic-year / subject / classroom directory (docs 20, 25 §3).
 *
 * De-dup is **conservative**: a proposal is merged only on an EXACT identity-key
 * match (`officialName` + `province` + `district` + `ward` + `address`,
 * case-insensitive). Fuzzy near-matches are *surfaced* as `similarCandidates` for
 * the user to pick, never auto-merged — two real schools with the same name at
 * different addresses must stay distinct (E-1).
 */
export class SchoolDirectoryService {
  readonly #store: EducationStore;
  readonly #logger: Logger | undefined;
  readonly #now: () => Date;
  readonly #newId: () => string;

  constructor(opts: DirectoryServiceOptions) {
    this.#store = opts.store;
    this.#logger = opts.logger;
    this.#now = opts.now ?? (() => new Date());
    this.#newId = opts.newId ?? randomUUID;
  }

  async searchSchools(query: SchoolSearchQuery): Promise<readonly SchoolRecord[]> {
    return this.#store.searchSchools(query);
  }

  async proposeSchool(input: ProposeSchoolInput): Promise<ProposeSchoolResult> {
    const name = input.officialName.trim();
    if (name.length < 2) throw new ValidationError('officialName is too short');

    const identity = {
      officialName: name,
      province: input.province?.trim() ?? null,
      district: input.district?.trim() ?? null,
      ward: input.ward?.trim() ?? null,
      address: input.address?.trim() ?? null,
    };
    const exact = await this.#store.findSchoolByIdentity(identity);
    if (exact) {
      return { school: exact, deduplicated: true, similarCandidates: [] };
    }

    // fuzzy near-matches — surfaced, NOT merged. Same name in a different
    // district IS a near-match worth showing, so do NOT filter by district here.
    const similar = (
      await this.#store.searchSchools({
        nameFragment: firstWords(name, 2),
        ...(identity.province ? { province: identity.province } : {}),
      })
    ).filter((s) => tokenOverlap(s.officialName, name) >= 0.6);

    const nowIso = this.#now().toISOString();
    const record: SchoolRecord = {
      id: asSchoolId(this.#newId()),
      officialName: name,
      shortName: input.shortName?.trim() ?? null,
      schoolType: input.schoolType ?? 'OTHER',
      officialSchoolCode: input.officialSchoolCode?.trim() ?? null,
      province: identity.province,
      district: identity.district,
      ward: identity.ward,
      address: identity.address,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      verificationStatus: 'UNVERIFIED',
      createdBy: input.createdBy ?? null,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    await this.#store.insertSchool(record);
    this.#logger?.info('directory.school.proposed', { schoolId: record.id, similar: similar.length });
    return { school: record, deduplicated: false, similarCandidates: similar };
  }

  async getSchool(id: string): Promise<SchoolRecord> {
    const s = await this.#store.getSchool(asSchoolId(id));
    if (!s) throw new NotFoundError(`school ${id}`);
    return s;
  }

  // --- academic years ---
  async listAcademicYears(): Promise<readonly AcademicYearRecord[]> {
    return this.#store.listAcademicYears();
  }
  async getAcademicYearByLabel(label: string): Promise<AcademicYearRecord> {
    const y = await this.#store.findAcademicYearByLabel(label);
    if (!y) throw new NotFoundError(`academic year ${label}`);
    return y;
  }
  async ensureAcademicYear(input: {
    label: string;
    startDate: string;
    endDate: string;
    region?: string;
  }): Promise<AcademicYearRecord> {
    const existing = await this.#store.findAcademicYearByLabel(input.label);
    if (existing) return existing;
    const record: AcademicYearRecord = {
      id: asAcademicYearId(this.#newId()),
      label: input.label,
      startDate: input.startDate,
      endDate: input.endDate,
      region: input.region ?? null,
      status: 'PLANNED',
    };
    await this.#store.insertAcademicYear(record);
    return record;
  }

  // --- subjects ---
  async listSubjects(): Promise<readonly SubjectRecord[]> {
    return this.#store.listSubjects();
  }
  async getSubjectByCode(code: SubjectCode): Promise<SubjectRecord> {
    const s = await this.#store.findSubjectByCode(code);
    if (!s) throw new NotFoundError(`subject ${code}`);
    return s;
  }
  async ensureSubject(code: SubjectCode, name: string, status: SubjectRecord['status']): Promise<SubjectRecord> {
    const existing = await this.#store.findSubjectByCode(code);
    if (existing) return existing;
    const record: SubjectRecord = { id: asSubjectId(this.#newId()), code, name, status };
    await this.#store.insertSubject(record);
    return record;
  }

  // --- classrooms ---
  async listClassrooms(schoolId: string, academicYearId: string): Promise<readonly ClassroomRecord[]> {
    return this.#store.listClassrooms(asSchoolId(schoolId), asAcademicYearId(academicYearId));
  }

  async proposeClassroom(input: ProposeClassroomInput): Promise<{ classroom: ClassroomRecord; deduplicated: boolean }> {
    if (!Number.isInteger(input.grade) || input.grade < 1 || input.grade > 12) {
      throw new ValidationError('grade must be an integer 1..12');
    }
    const className = input.className.trim();
    if (!className) throw new ValidationError('className is required');

    const schoolId = asSchoolId(input.schoolId);
    const academicYearId = asAcademicYearId(input.academicYearId);
    if (!(await this.#store.getSchool(schoolId))) throw new NotFoundError(`school ${input.schoolId}`);
    if (!(await this.#store.getAcademicYear(academicYearId))) {
      throw new NotFoundError(`academic year ${input.academicYearId}`);
    }

    const key = { schoolId, academicYearId, grade: input.grade, className };
    const existing = await this.#store.findClassroomByIdentity(key);
    if (existing) return { classroom: existing, deduplicated: true };

    const record: ClassroomRecord = {
      id: asClassroomId(this.#newId()),
      schoolId,
      academicYearId,
      grade: input.grade,
      className,
      displayName: input.displayName?.trim() ?? null,
      verificationStatus: 'UNVERIFIED',
      status: 'ACTIVE',
      createdBy: input.createdBy ?? null,
      createdAt: this.#now().toISOString(),
      archivedAt: null,
    };
    await this.#store.insertClassroom(record);
    return { classroom: record, deduplicated: false };
  }

  async getClassroom(id: string): Promise<ClassroomRecord> {
    const c = await this.#store.getClassroom(asClassroomId(id));
    if (!c) throw new NotFoundError(`classroom ${id}`);
    return c;
  }

  /** Get-or-create a classroom by its identity key (used by the progression engine). */
  async resolveClassroom(input: ProposeClassroomInput): Promise<ClassroomRecord> {
    const { classroom } = await this.proposeClassroom(input);
    return classroom;
  }
}

function firstWords(s: string, n: number): string {
  return s.split(/\s+/).slice(0, n).join(' ');
}
function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter(Boolean),
  );
}
function tokenOverlap(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  return shared / Math.min(ta.size, tb.size);
}

// re-export narrow types callers use
export type { SchoolId, AcademicYearId, ClassroomId, SubjectId, DirectoryVerificationStatus };
export { ConflictError };
