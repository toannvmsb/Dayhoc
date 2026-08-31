/**
 * API view models — the shapes the API returns to each client.
 *
 * Two audiences, two shapes:
 *  - `ParentHomeView` etc. carry the full picture (gap scores, mastery, rationale).
 *  - `ChildTodayView` etc. are a CHILD-SAFE PROJECTION built on the server — the
 *    sensitive fields are never in the object, not merely hidden by the client
 *    (UI/UX Spec §12, §23; Math Core §31).
 *
 * Content tone follows UI/UX Spec §20: "cần củng cố …", not "yếu …"; status in
 * words, never a percentile.
 */

// ---------- shared ----------
export interface ChildSummary {
  readonly childId: string;
  readonly displayName: string;
  readonly schoolGrade: number;
  readonly schoolContext: string; // "Kết nối tri thức"
}

export type StatusWord = 'trên_mức_mục_tiêu' | 'đúng_mức_mục_tiêu' | 'đang_củng_cố' | 'chưa_ổn_định';

// ---------- Parent ----------
export interface ParentHomeView {
  readonly child: ChildSummary;
  readonly learningContext: {
    readonly headline: string; // "Tỉ lệ thức & dãy tỉ số bằng nhau"
    readonly sources: readonly string[]; // ["Ảnh vở 15/8", "Giáo viên xác nhận"]
    readonly needsUpdate: boolean;
  };
  readonly todayPlan: TodayPlanView | { readonly kind: 'no_plan_needed'; readonly reason: string };
  readonly attention: readonly AttentionItem[];
  readonly progressInsights: readonly string[];
  readonly thinkingChallenge: { readonly title: string; readonly available: boolean } | null;
}

export interface TodayPlanView {
  readonly kind: 'plan';
  readonly totalMinutes: number;
  readonly mix: { readonly school: number; readonly gapRepair: number; readonly advanced: number; readonly thinking: number };
  readonly steps: readonly {
    readonly index: number;
    readonly title: string;
    readonly minutes: number;
    readonly bucketLabel: string; // "Bài trên lớp" | "Củng cố" | "Nâng cao" | "Tư duy"
    readonly parentInvolved: boolean;
    readonly whyLabel?: string; // "Vì sao app đề xuất?"
  }[];
}

export interface AttentionItem {
  readonly gapId: string;
  readonly title: string; // "Con đang cần củng cố quy đồng mẫu số"
  readonly urgency: 'cao' | 'trung_bình' | 'thấp';
  readonly note: string;
  readonly kind: 'gap' | 'exam' | 'new_evidence';
}

export interface ParentProgressView {
  readonly child: ChildSummary;
  readonly frontierInsight: string; // "Đại số đang tiếp cận nội dung vượt chuẩn lớp 7"
  readonly axes: {
    readonly knowledge: readonly SkillProgressRow[];
    readonly problemTypes: readonly SkillProgressRow[];
    readonly thinking: readonly SkillProgressRow[];
  };
  readonly recentEvidence: readonly {
    readonly label: string;
    readonly detail: string;
    readonly source: string;
  }[];
}

export interface SkillProgressRow {
  readonly skillId: string;
  readonly name: string;
  readonly currentPercent: number; // bar fill — for layout only, labelled in words
  readonly targetPercent: number;
  readonly status: StatusWord;
}

export interface ParentGapDetailView {
  readonly gapId: string;
  readonly title: string;
  readonly priorityLabel: 'ưu_tiên_cao' | 'ưu_tiên_trung_bình' | 'ưu_tiên_thấp';
  readonly lifecycleLabel: string; // "Đang xử lý"
  readonly whyAppThinks: readonly string[];
  readonly affects: readonly string[];
  readonly lifecycleStep: readonly { readonly label: string; readonly state: 'done' | 'current' | 'todo' }[];
  readonly prescription: ParentPrescriptionView | null;
}

export interface ParentPrescriptionView {
  readonly summary: string; // "4 phiên × 10 phút trong 8 ngày"
  readonly perSession: readonly { readonly label: string; readonly count: string }[];
  readonly rationale: string;
  readonly options: readonly {
    readonly key: 'follow' | 'lighter' | 'intensify' | 'later';
    readonly label: string;
    readonly detail: string; // "4 phiên × 10′"
  }[];
}

// ---------- Child (SAFE PROJECTION) ----------
export interface ChildTodayView {
  readonly greetingName: string;
  readonly dateLabel: string;
  readonly summary: string; // "Hôm nay có 3 việc, khoảng 25 phút."
  readonly tasks: readonly ChildTask[];
  readonly doneCount: number;
  readonly totalCount: number;
  // NOTE: no gapScore, no mastery, no ranking, no parent analytics — by construction.
}

export interface ChildTask {
  readonly assignmentId: string;
  readonly title: string; // "Bài tập phân số"
  readonly subtitle: string; // "5 câu · khoảng 8 phút"
  readonly kind: 'practice' | 'review' | 'challenge';
  readonly assignedBy: 'app' | 'parent';
}

/** One question at a time (UI/UX Spec §13 — one step per viewport on mobile). */
export interface ChildQuestionView {
  readonly assignmentId: string;
  readonly questionId: string;
  readonly index: number; // 1-based
  readonly total: number;
  readonly prompt: string;
  readonly answerKind: 'exact' | 'fraction' | 'numeric' | 'choice' | 'reasoning';
  readonly choices?: readonly string[];
  /** Only the hint rungs already unlocked for this child on this question. */
  readonly revealedHints: readonly { readonly rung: string; readonly text: string }[];
  readonly canRequestHint: boolean;
  // NOTE: no correct answer, no mastery, no difficulty score.
}

export interface ChildResultView {
  readonly assignmentId: string;
  readonly correctCount: number;
  readonly total: number;
  readonly headline: string; // "Con làm đúng 4/5 câu"
  readonly encouragement: string;
  readonly reviewItems: readonly {
    readonly questionId: string;
    readonly prompt: string;
    readonly steps: readonly string[]; // worked solution, step by step
  }[];
  /** Shown after a reasoning/challenge item (Math Core §35). */
  readonly reasoningPrompt: string | null;
  readonly nextLabel: string; // "Việc tiếp theo" | "Xong rồi"
}

export interface ChildChallengeView {
  readonly assignmentId: string;
  readonly questionId: string;
  readonly badge: string; // "SUY LUẬN"
  readonly prompt: string;
  readonly instruction: string; // "Không cần ra đáp số ngay. Viết cách con nghĩ trước."
  readonly firstHintAvailable: boolean;
}

// ---------- Teacher (MVP lightweight — goal < 60s) ----------
export interface TeacherHomeView {
  readonly teacherName: string;
  readonly subject: string;
  readonly todayUpdated: boolean;
  readonly classes: readonly {
    readonly classRef: string;
    readonly connectedParents: number;
    readonly lastUpdatedLabel: string; // "Đã cập nhật 29/8" | "Chưa cập nhật"
    readonly updatedToday: boolean;
  }[];
  readonly recentHistory: readonly { readonly topic: string; readonly detail: string; readonly dateLabel: string }[];
}

/** The quick-update form (UI/UX Spec §14). Steps 1–4, all optional except a topic. */
export interface TeacherUpdateFormView {
  readonly classRef: string;
  readonly dateLabel: string;
  readonly topicChoices: readonly { readonly skillId: string; readonly name: string }[];
  readonly problemTypeChoices: readonly { readonly problemTypeId: string; readonly name: string }[];
  readonly estimatedSeconds: number; // ~40
}

export interface TeacherUpdateResult {
  readonly contributionId: string;
  readonly recordedForClass: string;
  /** How the parent-facing Learning Context changed as a result. */
  readonly contextHeadlineAfter: string;
  readonly parentsNotified: number;
}
