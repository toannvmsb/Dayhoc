/**
 * Loose shapes for the mobile client. The canonical contract lives in
 * `@copilot/api-contract` (web + server); these are a hand-kept subset so the
 * mobile bundle stays free of any workspace-package resolution. Keep in sync
 * when the DTOs change.
 */

export type Child = { childId: string; displayName: string; schoolGrade: number };

export type ParentHome = {
  child: { childId: string; displayName: string; schoolGrade: number; schoolContext: string };
  learningContext: {
    headline: string;
    statusLabel: string;
    status: string;
    needsUpdate: boolean;
    hasConflict: boolean;
    estimatedLessonName: string | null;
  };
  todayPlan:
    | { kind: 'plan'; totalMinutes: number; steps: { index: number; title: string; minutes: number; bucketLabel: string }[] }
    | { kind: 'no_plan_needed'; reason: string };
  attention: { gapId: string; title: string; note: string; urgency: string; kind: string }[];
  progressInsights: string[];
  thinkingChallenge: { title: string; available: boolean } | null;
};

export type ParentProgress = {
  child: { displayName: string };
  frontierInsight: string;
  axes: {
    knowledge: SkillRow[];
    problemTypes: SkillRow[];
    thinking: SkillRow[];
  };
  recentEvidence: { label: string; detail: string; source: string }[];
};
export type SkillRow = { skillId: string; name: string; currentPercent: number; targetPercent: number; status: string };

export type GapDetail = {
  gapId: string;
  title: string;
  priorityLabel: string;
  lifecycleLabel: string;
  whyAppThinks: string[];
  affects: string[];
  lifecycleStep: { label: string; state: 'done' | 'current' | 'todo' }[];
  prescription: { summary: string; perSession: { label: string; count: string }[]; rationale: string } | null;
};

export type TeachingPlan = {
  forGapId: string | null;
  skillName: string;
  focusLine: string;
  gapMeaning: string;
  minutes: number;
  beforeYouStart: string[];
  steps: { title: string; say: string; why: string }[];
  checkUnderstanding: string[];
  commonMistakes: string[];
  praise: string[];
  workedExample: { prompt: string; walkthrough: string[]; answer: string } | null;
  ifStuck: string;
};

export type Assignment = {
  id: string;
  status: string;
  mode: string;
  targetSkillIds: string[];
  createdAt: string;
  completedAt: string | null;
};

export type AssignmentDetail = {
  id: string;
  status: string;
  mode: string;
  items: {
    id: string;
    orderIndex: number;
    prompt: unknown;
    answerKind: string;
    options: string[] | null;
    hintCount: number;
  }[];
};

export type StudentAccess = {
  loginEmail: string;
  status: string;
  createdAt: string;
} | null;

export type PracticeSubmitResult = {
  attemptId: string;
  results: {
    assignmentItemId: string;
    verificationLevel: string;
    correct: boolean | null;
    expectedAnswer: string | null;
  }[];
};

export type ChildToday = {
  greetingName: string;
  summary: string;
  tasks: { assignmentId: string; title: string; subtitle: string; kind: string }[];
  doneCount: number;
  totalCount: number;
};

export type StudentProgress = {
  streakDone: number;
  solid: string[];
  growing: string[];
  line: string;
};

export type StudentReview = { revisit: { topic: string }[]; unfinished: number; recent: number };

export type UploadListItem = {
  id: string;
  kind: string;
  originalFilename: string | null;
  createdAt: string;
  state: string;
  confidence: number | null;
  itemCount: number;
  errorMessage: string | null;
};

export type UploadAnalysis = {
  uploadId: string;
  state: string;
  documentType: string | null;
  teacherNote: string | null;
  confidence: number | null;
  evidenceRecorded: number;
  items: {
    index: number;
    prompt: string;
    childAnswer: string | null;
    markedCorrect: boolean | null;
    autoSelected: boolean;
    skillCandidates: { skillId: string; skillName: string; confidence: number }[];
  }[];
};

export type ExamListItem = {
  id: string;
  examDate: string;
  subject: string;
  status: string;
  hasResult: boolean;
};

export type RevisionMap = {
  examId: string;
  subject: string;
  examDate: string;
  dayCountdown: number;
  dailyMinutes: number;
  needsScopeConfirm: boolean;
  items: { skillId: string; name: string; band: string; reason: string }[];
};

export type ExamDiagnosis = {
  examId: string;
  totalAwardedPercent: number;
  byCategory: { category: string; categoryLabel: string; lostPoints: number }[];
  lostPoints: { skillName: string; categoryLabel: string; note: string }[];
  remediation: { skillId: string; name: string }[];
};

export type Entitlements = {
  plan: string;
  entitlements: {
    maxChildren: number;
    evidenceAnalysesPerMonth: number;
    examIntelligence: boolean;
    teachingCopilot: boolean;
    aiInterpretation: boolean;
    weeklyReport: boolean;
  };
  options: { plan: string; priceVnd: number | null; recommended: boolean }[];
  usage: { children: number; maxChildren: number };
};

export type TeacherChildRow = { childId: string; displayName: string; subjectId: string | null };
