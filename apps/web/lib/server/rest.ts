import { getApi } from './api';

/**
 * The mobile HTTP surface (M9). Thin JSON dispatch over the same
 * `createProductionApi` the web uses in-process — no second backend to run.
 * Auth: `Authorization: Bearer <token>` + optional `X-DZ-Workspace`
 * (PARENT | STUDENT | TEACHER, default PARENT). The bearer is exactly what the
 * web stores in its httpOnly cookie.
 */

type Workspace = 'PARENT' | 'STUDENT' | 'TEACHER' | 'ADMIN';
export type RestJson = unknown;

export class RestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

interface Ctx {
  readonly bearer: string | null;
  readonly workspace: Workspace;
  readonly params: string[];
  readonly query: URLSearchParams;
  readonly body: Record<string, unknown>;
}

function auth(c: Ctx, ws?: Workspace) {
  if (!c.bearer) throw new RestError(401, 'missing bearer token');
  return { bearer: c.bearer, workspace: ws ?? c.workspace };
}

/** Server-derived ADMIN context — throws 401/403 unless the caller holds ADMIN. */
async function adminCtx(c: Ctx) {
  if (!c.bearer) throw new RestError(401, 'missing bearer token');
  try {
    return await getApi()._deriveContext({ bearer: c.bearer, workspace: 'ADMIN' });
  } catch {
    throw new RestError(403, 'ADMIN role required');
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Guard path params that hit uuid columns — a bad id is a 404, not a 500 with a raw PG error. */
function uuid(v: string | undefined, what = 'mục này'): string {
  if (!v || !UUID_RE.test(v)) throw new RestError(404, `Không tìm thấy ${what}.`);
  return v;
}

type Handler = (c: Ctx) => Promise<RestJson>;

/**
 * Route table. Key: `METHOD /segment/...` with `:x` placeholders bound in order
 * to `c.params`. Longest-prefix wins is not needed — exact segment count + method.
 */
const ROUTES: Record<string, Handler> = {
  // ---- auth ----
  'POST /auth/register': async (c) => {
    const email = String(c.body.email ?? '').trim();
    const password = String(c.body.password ?? '');
    const displayName = String(c.body.displayName ?? '').trim() || undefined;
    const intendedRole = String(c.body.role ?? 'PARENT') === 'TEACHER' ? 'TEACHER' : 'PARENT';
    if (!email || !email.includes('@')) throw new RestError(400, 'Nhập email hợp lệ.');
    if (password.length < 8) throw new RestError(400, 'Mật khẩu cần tối thiểu 8 ký tự.');
    try {
      await getApi().register({ email, password, intendedRole, displayName });
      const { bearer } = await getApi().signIn({ email, password });
      return { bearer, viewer: await getApi().whoami(bearer) };
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (/already exists|duplicate/i.test(m)) throw new RestError(409, 'Email này đã được đăng ký. Hãy đăng nhập.');
      throw e;
    }
  },
  // `password` is optional here — required for real Supabase Auth (kind
  // 'supabase'; `signIn` throws its own 4xx if missing), still not required
  // for dev/in-memory (unchanged, matches the pilot-testing shortcut those
  // adapters have always used — see `signIn`'s own doc comment).
  'POST /auth/login': async (c) => {
    const email = String(c.body.email ?? '').trim().toLowerCase();
    const password = c.body.password !== undefined ? String(c.body.password) : undefined;
    if (!email || !email.includes('@')) throw new RestError(400, 'Nhập email đã đăng ký.');
    if (process.env.NODE_ENV === 'production' && !process.env.SUPABASE_URL) {
      throw new RestError(400, 'Đăng nhập cần cấu hình Supabase (ENV_REQUIRED).');
    }
    const { bearer } = await getApi().signIn({ email, ...(password !== undefined ? { password } : {}) });
    return { bearer, viewer: await getApi().whoami(bearer) };
  },
  'GET /me': async (c) => getApi().whoami(auth(c).bearer),
  'GET /me/entitlements': async (c) => getApi().getEntitlements(auth(c)),
  'POST /me/plan': async (c) => getApi().setPlan(auth(c, 'PARENT'), String(c.body.plan ?? 'free')),
  'POST /me/push-token': async (c) => getApi().registerPushToken(auth(c), String(c.body.expoPushToken ?? '')),

  // ---- parent: children + learning ----
  'GET /children': async (c) => getApi().listChildren(auth(c, 'PARENT')),
  'POST /children': async (c) =>
    getApi().createChild(auth(c, 'PARENT'), {
      displayName: String(c.body.displayName ?? ''),
      schoolGrade: Number(c.body.schoolGrade),
    }),
  'GET /children/:id': async (c) => getApi().getChild(auth(c), c.params[0]!),
  'GET /children/:id/home': async (c) => getApi().getParentHome(auth(c, 'PARENT'), c.params[0]!),
  'GET /children/:id/progress': async (c) => getApi().getParentProgress(auth(c, 'PARENT'), c.params[0]!),
  'GET /children/:id/weekly-report': async (c) => getApi().getWeeklyReport(auth(c, 'PARENT'), c.params[0]!),
  'GET /children/:id/gaps/:gapId': async (c) =>
    getApi().getParentGapDetail(auth(c, 'PARENT'), c.params[0]!, c.params[1]!),
  'GET /children/:id/teaching-plan': async (c) =>
    getApi().getParentTeachingPlan(auth(c, 'PARENT'), c.params[0]!, c.query.get('gapId') ?? undefined),
  'GET /children/:id/enrollments': async (c) => getApi().listEnrollments(auth(c, 'PARENT'), c.params[0]!),

  // ---- school / class directory (M3) ----
  'GET /schools': async (c) =>
    getApi().searchSchools(auth(c, 'PARENT'), {
      nameFragment: c.query.get('q') ?? undefined,
      province: c.query.get('province') ?? undefined,
      district: c.query.get('district') ?? undefined,
    }),
  'POST /schools': async (c) =>
    getApi().proposeSchool(auth(c, 'PARENT'), {
      officialName: String(c.body.officialName ?? '').trim(),
      province: c.body.province ? String(c.body.province) : undefined,
      district: c.body.district ? String(c.body.district) : undefined,
      schoolType: (c.body.schoolType as never) ?? undefined,
    }),
  'GET /academic-years': async (c) => getApi().listAcademicYears(auth(c, 'PARENT')),
  'GET /schools/:id/classes': async (c) =>
    getApi().listClasses(auth(c, 'PARENT'), c.params[0]!, c.query.get('academicYearId') ?? ''),
  'POST /schools/:id/classes': async (c) =>
    getApi().proposeClass(auth(c, 'PARENT'), c.params[0]!, {
      academicYearId: String(c.body.academicYearId ?? ''),
      grade: Number(c.body.grade),
      className: String(c.body.className ?? '').trim(),
    }),
  'POST /children/:id/enrollments/school': async (c) => {
    try {
      return await getApi().createSchoolEnrollment(auth(c, 'PARENT'), c.params[0]!, {
        schoolId: String(c.body.schoolId ?? ''),
        academicYearId: String(c.body.academicYearId ?? ''),
        grade: Number(c.body.grade),
      });
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (/already has an ACTIVE school enrollment/i.test(m)) {
        throw new RestError(409, 'Con đã được ghi nhận học ở một trường trong năm học này.');
      }
      throw e;
    }
  },
  'POST /children/:id/enrollments/class': async (c) => {
    try {
      return await getApi().createClassEnrollment(auth(c, 'PARENT'), c.params[0]!, {
        classroomId: String(c.body.classroomId ?? ''),
        academicYearId: String(c.body.academicYearId ?? ''),
        enrollmentType: (c.body.enrollmentType as never) ?? 'PRIMARY',
        privacyMode: (c.body.privacyMode as never) ?? 'LINKED_PRIVATE',
      });
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (/PRIMARY class enrollment|PRIMARY_ENROLLMENT_EXISTS/i.test(m)) {
        throw new RestError(
          409,
          'Con đã có một lớp chính trong năm học này. Chọn loại lớp khác (học thêm, đội tuyển…) hoặc bỏ gán lớp chính cũ trước.',
        );
      }
      if (/already has an ACTIVE school enrollment/i.test(m)) {
        throw new RestError(409, 'Con đã được ghi nhận học ở một trường trong năm học này.');
      }
      throw e;
    }
  },
  'PATCH /children/:id/class-enrollments/:eid/privacy': async (c) =>
    getApi().setClassPrivacy(
      auth(c, 'PARENT'),
      c.params[0]!,
      c.params[1]!,
      String(c.body.privacyMode ?? 'LINKED_PRIVATE') as never,
    ),

  // ---- practice ----
  'GET /children/:id/assignments': async (c) => getApi().getChildAssignments(auth(c), c.params[0]!),
  'POST /children/:id/practice': async (c) =>
    getApi().createPracticeAssignment(auth(c), c.params[0]!, { minutes: Number(c.body.minutes ?? 15) }),
  'GET /assignments/:id': async (c) =>
    getApi().getAssignmentDetail(auth(c), uuid(c.params[0], 'bài tập')),
  'GET /assignments/:id/items/:itemId/solution': async (c) =>
    getApi().getAssignmentItemSolution(auth(c), uuid(c.params[0], 'bài tập'), c.params[1]!),
  'POST /assignments/:id/submit': async (c) =>
    getApi().submitPractice(
      auth(c),
      uuid(c.params[0], 'bài tập'),
      (c.body.answers as { assignmentItemId: string; answer: string; hintsUsed?: number }[]) ?? [],
    ),

  // ---- uploads (M4) ----
  'GET /children/:id/uploads': async (c) => getApi().listUploads(auth(c, 'PARENT'), c.params[0]!),
  'POST /children/:id/uploads': async (c) =>
    getApi().createUpload(auth(c, 'PARENT'), c.params[0]!, {
      kind: String(c.body.kind ?? 'NOTEBOOK_PAGE') as 'NOTEBOOK_PAGE',
      filename: String(c.body.filename ?? 'upload'),
      mimeType: String(c.body.mimeType ?? 'application/octet-stream'),
      contentBase64: String(c.body.contentBase64 ?? ''),
    }),
  'POST /children/:id/uploads/:uploadId/analyze': async (c) =>
    getApi().runUploadAnalysis(auth(c, 'PARENT'), c.params[0]!, c.params[1]!),
  'GET /children/:id/uploads/:uploadId': async (c) =>
    getApi().getUploadAnalysis(auth(c, 'PARENT'), c.params[0]!, c.params[1]!),
  'POST /children/:id/uploads/:uploadId/confirm': async (c) =>
    getApi().confirmUploadAnalysis(
      auth(c, 'PARENT'),
      c.params[0]!,
      c.params[1]!,
      (c.body.corrections as { index: number; confirm: boolean; skillId?: string }[]) ?? [],
    ),
  'DELETE /children/:id/uploads/:uploadId': async (c) =>
    getApi().deleteUpload(auth(c, 'PARENT'), c.params[0]!, c.params[1]!),

  // ---- exams (M6) ----
  'GET /children/:id/exams': async (c) => getApi().listExams(auth(c, 'PARENT'), c.params[0]!),
  'POST /children/:id/exams': async (c) =>
    getApi().createExam(auth(c, 'PARENT'), c.params[0]!, {
      examDate: String(c.body.examDate ?? ''),
      subject: String(c.body.subject ?? 'Toán'),
      notes: c.body.notes ? String(c.body.notes) : undefined,
    }),
  'GET /children/:id/exams/:examId/revision-map': async (c) =>
    getApi().getRevisionMap(auth(c, 'PARENT'), c.params[0]!, c.params[1]!),
  'POST /children/:id/exams/:examId/scope': async (c) =>
    getApi().confirmExamScope(auth(c, 'PARENT'), c.params[0]!, c.params[1]!, (c.body.skillIds as string[]) ?? []),
  'POST /children/:id/exams/:examId/result': async (c) =>
    getApi().recordExamResult(
      auth(c, 'PARENT'),
      c.params[0]!,
      c.params[1]!,
      (c.body.outcomes as { questionRef: string; skillId: string; awardedScore: number }[]) ?? [],
    ),
  'GET /children/:id/exams/:examId/diagnosis': async (c) =>
    getApi().getExamDiagnosis(auth(c, 'PARENT'), c.params[0]!, c.params[1]!),

  // ---- relationships / student access (M1/M3) ----
  'GET /children/:id/teacher-links': async (c) => getApi().listTeacherLinks(auth(c, 'PARENT'), c.params[0]!),
  'GET /children/:id/teacher-links/:linkId/permissions': async (c) =>
    getApi().getTeacherLinkPermissions(auth(c, 'PARENT'), c.params[0]!, c.params[1]!),
  'POST /children/:id/teacher-links/:linkId/permissions': async (c) =>
    getApi().updateTeacherLinkPermissions(auth(c, 'PARENT'), c.params[0]!, c.params[1]!, {
      grant: (c.body.grant as string[]) as never,
      revoke: (c.body.revoke as string[]) as never,
    }),
  'GET /relationship-requests': async (c) => getApi().listRelationshipRequests(auth(c)),
  'POST /relationship-requests/:reqId/accept': async (c) =>
    getApi().acceptRelationshipRequest(auth(c), c.params[0]!),
  'POST /relationship-requests/:reqId/reject': async (c) =>
    getApi().rejectRelationshipRequest(auth(c), c.params[0]!),
  'POST /children/:id/invite-code': async (c) =>
    getApi().createInviteCode(auth(c, 'PARENT'), { childId: c.params[0]! }),
  'GET /children/:id/student-access': async (c) => getApi().getStudentAccess(auth(c, 'PARENT'), c.params[0]!),
  'POST /children/:id/student-access': async (c) =>
    getApi().createStudentAccess(auth(c, 'PARENT'), c.params[0]!, { password: String(c.body.password ?? '') }),
  'POST /children/:id/student-access/revoke': async (c) =>
    getApi().revokeStudentAccess(auth(c, 'PARENT'), c.params[0]!),

  // ---- child-profile deletion (M7) ----
  'GET /children/:id/deletion': async (c) => getApi().getChildDeletionStatus(auth(c, 'PARENT'), c.params[0]!),
  'POST /children/:id/deletion/request': async (c) =>
    getApi().requestChildDeletion(auth(c, 'PARENT'), c.params[0]!),
  'POST /children/:id/deletion/cancel': async (c) =>
    getApi().cancelChildDeletion(auth(c, 'PARENT'), c.params[0]!),
  'POST /children/:id/deletion/confirm': async (c) =>
    getApi().confirmChildDeletion(auth(c, 'PARENT'), c.params[0]!, String(c.body.confirmName ?? '')),

  // ---- student ----
  'GET /student/me': async (c) => getApi().studentGetMe(auth(c, 'STUDENT')),
  'GET /student/today': async (c) => getApi().studentGetToday(auth(c, 'STUDENT')),
  'GET /student/assignments': async (c) => getApi().studentGetAssignments(auth(c, 'STUDENT')),
  'GET /student/review': async (c) => getApi().studentGetReview(auth(c, 'STUDENT')),
  'GET /student/progress': async (c) => getApi().studentGetProgress(auth(c, 'STUDENT')),

  // ---- teacher ----
  'GET /teacher/children': async (c) => getApi().teacherListChildren(auth(c, 'TEACHER')),
  'GET /teacher/children/:id/permissions': async (c) =>
    getApi().teacherGetPermissions(auth(c, 'TEACHER'), c.params[0]!, c.query.get('subjectId') ?? undefined),
  'GET /teacher/children/:id/twin': async (c) =>
    getApi().teacherGetTwinSummary(auth(c, 'TEACHER'), c.params[0]!, c.query.get('subjectId') ?? undefined),
  'GET /teacher/children/:id/gaps': async (c) =>
    getApi().teacherGetGaps(auth(c, 'TEACHER'), c.params[0]!, c.query.get('subjectId') ?? undefined),
  'POST /teacher/redeem-code': async (c) =>
    getApi().redeemInviteCode(auth(c, 'TEACHER'), String(c.body.code ?? '')),
  'GET /teacher/curriculum-program': async (c) =>
    getApi().teacherGetCurriculumProgram(auth(c, 'TEACHER'), Number(c.query.get('grade') ?? 4)),
  'POST /teacher/children/:id/ocr-homework': async (c) =>
    getApi().teacherOcrHomework(auth(c, 'TEACHER'), c.params[0]!, {
      mimeType: String(c.body.mimeType ?? 'image/jpeg'),
      contentBase64: String(c.body.contentBase64 ?? ''),
    }),
  'POST /teacher/children/:id/contributions': async (c) => {
    const contributionType = String(c.body.contributionType ?? 'CURRENT_LESSON') as
      | 'CURRENT_LESSON'
      | 'CURRICULUM_PROGRESS'
      | 'HOMEWORK'
      | 'EXAM_NOTICE';
    const note = String(c.body.note ?? '').trim();
    const examDate = String(c.body.examDate ?? '').trim();
    const taughtSkillIds = Array.isArray(c.body.taughtSkillIds)
      ? (c.body.taughtSkillIds as unknown[]).map((s) => String(s)).filter(Boolean)
      : [];
    return getApi().teacherSubmitContribution(auth(c, 'TEACHER'), c.params[0]!, {
      subjectId: String(c.body.subjectId ?? ''),
      contributionType,
      observedAt: new Date().toISOString(),
      ...((contributionType === 'CURRENT_LESSON' || contributionType === 'CURRICULUM_PROGRESS') &&
      taughtSkillIds.length > 0
        ? { taughtSkillIds }
        : {}),
      ...(contributionType === 'HOMEWORK' && note
        ? { homeworkRefs: note.split(',').map((s) => s.trim()).filter(Boolean) }
        : {}),
      ...(contributionType === 'EXAM_NOTICE' && examDate
        ? { examRef: { date: examDate, ...(note ? { scopeNote: note } : {}) } }
        : {}),
    });
  },
  'GET /subjects': async (c) => getApi().listSubjects(auth(c)),

  // ---- ADMIN reviewer path (doc 67 §D4) ----
  'GET /admin/review-queue': async (c) => getApi().reviewQueueListPending(await adminCtx(c)),
  'POST /admin/review-queue/:id/resolve': async (c) => {
    const decision = String(c.body.decision ?? '').toUpperCase();
    if (!['APPROVED', 'REJECTED', 'REGENERATE_REQUESTED'].includes(decision)) {
      throw new RestError(400, 'decision phải là APPROVED | REJECTED | REGENERATE_REQUESTED');
    }
    return getApi().reviewQueueResolve(await adminCtx(c), c.params[0]!, decision as never);
  },
  'GET /admin/worksheet-shadow': async (c) =>
    getApi().worksheetShadowObservability(await adminCtx(c), {
      ...(c.query.get('sinceIso') ? { sinceIso: c.query.get('sinceIso')! } : {}),
    }),

  // ---- ADMIN Controlled Internal LIVE (doc 69) ----
  'GET /admin/internal-live/dashboard': async (c) =>
    getApi().internalLiveDashboard(await adminCtx(c), {
      ...(c.query.get('sinceIso') ? { sinceIso: c.query.get('sinceIso')! } : {}),
    }),
  'GET /admin/internal-live/review-ops': async (c) =>
    getApi().internalLiveReviewOps(await adminCtx(c), {
      ...(c.query.get('sinceIso') ? { sinceIso: c.query.get('sinceIso')! } : {}),
    }),
  'GET /admin/internal-live/cohort': async (c) => getApi().internalLiveCohortList(await adminCtx(c)),
  'POST /admin/internal-live/cohort': async (c) => {
    const familyId = String(c.body.familyId ?? '');
    if (!familyId) throw new RestError(400, 'familyId là bắt buộc');
    return getApi().internalLiveCohortAdd(await adminCtx(c), familyId, {
      ...(c.body.wave !== undefined ? { wave: Number(c.body.wave) } : {}),
      ...(c.body.note ? { note: String(c.body.note) } : {}),
    });
  },
  'DELETE /admin/internal-live/cohort/:familyId': async (c) =>
    getApi().internalLiveCohortRemove(await adminCtx(c), c.params[0]!),
  'GET /admin/internal-live/kill-switch': async (c) => getApi().internalLiveKillSwitchStatus(await adminCtx(c)),
  'POST /admin/internal-live/kill-switch': async (c) => {
    const on = c.body.on === true || String(c.body.on).toLowerCase() === 'true';
    return getApi().internalLiveKillSwitch(await adminCtx(c), on, c.body.reason ? String(c.body.reason) : undefined);
  },
  'POST /admin/internal-live/safety-scan': async (c) =>
    getApi().internalLiveSafetyScan(await adminCtx(c), {
      ...(c.query.get('sinceIso') ? { sinceIso: c.query.get('sinceIso')! } : {}),
      ...(c.body.enforce === false ? { enforce: false } : {}),
    }),
  'GET /admin/internal-live/qa': async (c) =>
    getApi().internalLiveQaList(await adminCtx(c), c.query.get('limit') ? Number(c.query.get('limit')) : undefined),
  'GET /admin/internal-live/qa/:id': async (c) => getApi().internalLiveQaRead(await adminCtx(c), c.params[0]!),
  'POST /admin/internal-live/maintenance': async (c) => getApi().internalLiveMaintenance(await adminCtx(c)),

  // ---- doc 70: SMALL FAMILY PILOT ----
  // ADMIN — pilot cohort + funnel + feedback
  'GET /admin/pilot/dashboard': async (c) =>
    getApi().pilotDashboard(await adminCtx(c), {
      ...(c.query.get('sinceIso') ? { sinceIso: c.query.get('sinceIso')! } : {}),
    }),
  'GET /admin/pilot/cohort': async (c) => getApi().pilotFamilyList(await adminCtx(c)),
  'POST /admin/pilot/cohort': async (c) => {
    const familyId = String(c.body.familyId ?? '');
    if (!familyId) throw new RestError(400, 'familyId là bắt buộc');
    return getApi().pilotFamilyAdd(await adminCtx(c), familyId, c.body.note ? String(c.body.note) : undefined);
  },
  'GET /admin/pilot/feedback': async (c) =>
    getApi().pilotFeedbackRollup(await adminCtx(c), {
      ...(c.query.get('sinceIso') ? { sinceIso: c.query.get('sinceIso')! } : {}),
    }),

  // PARENT — guardian consent + today's-content feedback
  'GET /children/:id/pilot/consent': async (c) => getApi().pilotConsentStatus(auth(c), c.params[0]!),
  'POST /children/:id/pilot/consent': async (c) => getApi().recordPilotConsent(auth(c), c.params[0]!),
  'DELETE /children/:id/pilot/consent': async (c) => getApi().withdrawPilotConsent(auth(c), c.params[0]!),
  'POST /children/:id/pilot/feedback': async (c) => {
    const verdict = String(c.body.verdict ?? '').toUpperCase();
    return getApi().submitParentFeedback(auth(c), c.params[0]!, {
      verdict: verdict as never,
      ...(c.body.note ? { note: String(c.body.note) } : {}),
      ...(c.body.assignmentId ? { assignmentId: String(c.body.assignmentId) } : {}),
    });
  },
};

const COMPILED = Object.entries(ROUTES).map(([key, handler]) => {
  const [method, path] = key.split(' ') as [string, string];
  const segs = path.split('/').filter(Boolean);
  return { method, segs, handler };
});

export async function dispatchRest(
  method: string,
  pathSegs: string[],
  query: URLSearchParams,
  headers: Headers,
  body: Record<string, unknown>,
): Promise<RestJson> {
  for (const r of COMPILED) {
    if (r.method !== method || r.segs.length !== pathSegs.length) continue;
    const params: string[] = [];
    let ok = true;
    for (let i = 0; i < r.segs.length; i += 1) {
      const s = r.segs[i]!;
      if (s.startsWith(':')) params.push(pathSegs[i]!);
      else if (s !== pathSegs[i]) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    const wsHeader = headers.get('x-dz-workspace')?.toUpperCase();
    const workspace: Workspace =
      wsHeader === 'STUDENT' || wsHeader === 'TEACHER' || wsHeader === 'ADMIN' ? wsHeader : 'PARENT';
    return r.handler({
      bearer: headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null,
      workspace,
      params,
      query,
      body,
    });
  }
  throw new RestError(404, `no route: ${method} /${pathSegs.join('/')}`);
}
