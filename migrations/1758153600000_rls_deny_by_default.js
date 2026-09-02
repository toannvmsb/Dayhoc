/* eslint-disable */
/**
 * Pilot hardening §8 — defence-in-depth Row Level Security.
 *
 * ARCHITECTURE (see docs/implementation/RLS_DECISION.md): ALL production data
 * access is server-mediated. No client (web or mobile) ever connects to
 * Postgres — they only reach the application API, which enforces
 * `authorize()` / `can()`. The API connects with a privileged role
 * (`postgres` locally; Supabase's direct-connection `postgres` role has
 * `BYPASSRLS`), so enabling RLS does NOT change application behaviour.
 *
 * This migration turns RLS ON with NO policies (= deny-all) for every
 * child-scoped / personal-data / consent table. If a NON-privileged credential
 * ever leaks (a PostgREST `anon` / `authenticated` role, a read replica user,
 * a misconfigured BI tool), it reads nothing.
 *
 * `NO FORCE` — the table owner and BYPASSRLS roles are unaffected, so the app
 * and migrations keep working. Reversible: `down` disables RLS again.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

const DENY_ALL = [
  // identity / family / personal
  'users', 'user_roles', 'parents', 'parent_profiles', 'teachers', 'teacher_profiles',
  'families', 'family_memberships', 'family_subscriptions',
  'child_profiles', 'child_credentials', 'child_quick_access', 'child_deletion_requests',
  'parent_child_relationships',
  // relationships / permissions
  'teacher_child_links', 'teacher_parent_links', 'teacher_class_assignments',
  'teacher_school_memberships', 'teacher_invites', 'relationship_requests',
  'relationship_invite_codes', 'permission_grants', 'permission_sets',
  'student_account_links',
  // learning content + derived state (child data)
  'evidence', 'ai_inferences', 'teacher_contributions', 'lesson_confirmations',
  'skill_states', 'problem_type_mastery', 'thinking_state', 'knowledge_gaps',
  'gap_prescriptions', 'learning_plans', 'plan_items',
  'learning_state_snapshots', 'learning_context_snapshots',
  'assignments', 'assignment_items', 'attempts', 'attempt_answers',
  'generation_specs', 'generated_exercise_sets',
  'exams', 'exam_results',
  'uploads', 'upload_analysis',
  // enrolment
  'child_school_enrollment', 'student_school_enrollments', 'student_class_enrollments',
  'enrollment_transitions',
  // privacy / consent / rights / audit
  'consent_records', 'privacy_preferences', 'rights_requests', 'deletion_jobs',
  'audit_events', 'data_processing_inventory',
  // cost telemetry that references a child
  'ai_usage_events', 'ai_operation_cost_rollup',
];

exports.up = (pgm) => {
  for (const t of DENY_ALL) {
    pgm.sql(`ALTER TABLE IF EXISTS "${t}" ENABLE ROW LEVEL SECURITY;`);
  }
};

exports.down = (pgm) => {
  for (const t of DENY_ALL) {
    pgm.sql(`ALTER TABLE IF EXISTS "${t}" DISABLE ROW LEVEL SECURITY;`);
  }
};
