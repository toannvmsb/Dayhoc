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
