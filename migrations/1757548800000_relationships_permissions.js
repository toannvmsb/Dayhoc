/* eslint-disable */
/**
 * I4 — Learning relationships + scoped permissions + authorization audit
 * (additive — doc 21; ID-Q3, ID-Q5, ID-Q6).
 *
 *   relationship_requests   — both-direction workflow object (Parent↔Teacher)
 *   teacher_child_links     — replaces teacher_invites (ZERO access while PENDING)
 *   teacher_parent_links    — communication only, NO child-data access
 *   permission_sets         — a named snapshot of the codes a link carries
 *   permission_grants       — the ACTIVE (link → code → access source) tuples
 *   privacy_preferences     — per-child toggles that sit ABOVE the grants
 *   audit_events            — append-only; every accept/reject/revoke/grant/deny
 *
 * There is NO `teacher_can_view_child` boolean anywhere — every check is
 * `can(teacher, child, CODE, subject, asOf)`.
 *
 * Legacy `teacher_invites` migration (ID-Q3): `accepted` (with a resolvable
 * teacher + child) → an ACCEPTED `teacher_child_links` (`PARENT_DIRECT`,
 * `needs_guardian_review = true`) + the frozen `LEGACY_MINIMAL` grants
 * (`{VIEW_CLASS_CONTEXT, SUBMIT_CURRENT_LESSON}` — NEVER a sensitive Twin/gap
 * or child-specific code). `pending` → `relationship_requests`. `revoked` →
 * `teacher_child_links` REVOKED (history only). The pilot DB has 0
 * `teacher_invites`, so this is a no-op here but is written correctly for a
 * populated DB.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

const PERM_CODES =
  "('VIEW_CLASS_CONTEXT','SUBMIT_CURRENT_LESSON','SUBMIT_CURRICULUM_PROGRESS'," +
  "'SUBMIT_HOMEWORK','SUBMIT_TEST_RESULT','SUBMIT_EXAM_NOTICE','SUBMIT_EXAM_SCOPE'," +
  "'SUBMIT_SKILL_ASSESSMENT','SUBMIT_LEARNING_OBSERVATION','CREATE_ASSIGNMENT'," +
  "'VIEW_ASSIGNMENT_COMPLETION','VIEW_SELECTED_MASTERY','VIEW_SELECTED_GAPS'," +
  "'VIEW_LEARNING_TWIN_SUMMARY','MESSAGE_PARENT')";

const LINK_STATUS = "('PENDING','ACCEPTED','REJECTED','REVOKED','EXPIRED')";
const ACCESS_SRC = "('PARENT_DIRECT','CLASS_ASSIGNMENT','SCHOOL_AUTHORIZATION')";

exports.up = (pgm) => {
  // --- relationship_requests ---
  pgm.createTable('relationship_requests', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    requester_user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'CASCADE' },
    requester_role: { type: 'text', notNull: true, check: "requester_role IN ('PARENT','TEACHER')" },
    target_type: { type: 'text', notNull: true, check: "target_type IN ('PARENT','CHILD','TEACHER')" },
    target_user_id: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    target_child_id: { type: 'uuid', references: 'child_profiles', onDelete: 'CASCADE' },
    relationship_kind: { type: 'text', notNull: true, check: "relationship_kind IN ('TEACHER_CHILD','TEACHER_PARENT')" },
    relationship_type: {
      type: 'text',
      notNull: true,
      default: 'SUBJECT_TEACHER',
      check: "relationship_type IN ('CLASS_TEACHER','SUBJECT_TEACHER','PRIVATE_TUTOR','COACH','MENTOR','OTHER')",
    },
    subject_id: { type: 'uuid', references: 'subjects', onDelete: 'SET NULL' },
    access_source: { type: 'text', notNull: true, default: 'PARENT_DIRECT', check: `access_source IN ${ACCESS_SRC}` },
    proposed_permissions: { type: 'jsonb', notNull: true, default: '[]' },
    message: { type: 'text' },
    discovery_method: {
      type: 'text',
      notNull: true,
      default: 'PARENT_LINK',
      check: "discovery_method IN ('INVITE_CODE','PARENT_LINK','CLASS_JOIN','EMAIL_LOOKUP','QR')",
    },
    status: {
      type: 'text',
      notNull: true,
      default: 'PENDING',
      check: "status IN ('PENDING','ACCEPTED','REJECTED','EXPIRED','CANCELLED')",
    },
    expires_at: { type: 'timestamptz', notNull: true },
    responded_by_user_id: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    responded_at: { type: 'timestamptz' },
    approved_permissions: { type: 'jsonb' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('relationship_requests', ['target_child_id', 'status']);
  pgm.createIndex('relationship_requests', ['target_user_id', 'status']);
  // idempotency — one PENDING request per (requester, child, kind, subject)
  pgm.sql(`
    CREATE UNIQUE INDEX relationship_requests_pending_uq ON relationship_requests
      (requester_user_id, target_child_id, relationship_kind, coalesce(subject_id, '00000000-0000-0000-0000-000000000000'::uuid))
      WHERE status = 'PENDING' AND target_child_id IS NOT NULL;
  `);

  // --- teacher_child_links (replaces teacher_invites) ---
  pgm.createTable('teacher_child_links', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    teacher_user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'CASCADE' },
    child_id: { type: 'uuid', notNull: true, references: 'child_profiles', onDelete: 'CASCADE' },
    subject_id: { type: 'uuid', references: 'subjects', onDelete: 'SET NULL' },
    relationship_type: {
      type: 'text',
      notNull: true,
      default: 'SUBJECT_TEACHER',
      check: "relationship_type IN ('CLASS_TEACHER','SUBJECT_TEACHER','PRIVATE_TUTOR','COACH','MENTOR','OTHER')",
    },
    access_source: { type: 'text', notNull: true, default: 'PARENT_DIRECT', check: `access_source IN ${ACCESS_SRC}` },
    access_source_id: { type: 'uuid' }, // → teacher_class_assignments.id when CLASS_ASSIGNMENT
    initiated_by_role: { type: 'text', notNull: true, check: "initiated_by_role IN ('PARENT','TEACHER')" },
    initiated_by_user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'CASCADE' },
    origin_request_id: { type: 'uuid', references: 'relationship_requests', onDelete: 'SET NULL' },
    status: { type: 'text', notNull: true, default: 'PENDING', check: `status IN ${LINK_STATUS}` },
    accepted_by_parent_user_id: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    needs_guardian_review: { type: 'boolean', notNull: true, default: false },
    valid_from: { type: 'timestamptz' },
    valid_until: { type: 'timestamptz' },
    accepted_at: { type: 'timestamptz' },
    rejected_at: { type: 'timestamptz' },
    revoked_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('teacher_child_links', ['child_id', 'status']);
  pgm.createIndex('teacher_child_links', ['teacher_user_id', 'status']);
  pgm.sql(`
    CREATE UNIQUE INDEX teacher_child_links_active_uq ON teacher_child_links
      (teacher_user_id, child_id, coalesce(subject_id, '00000000-0000-0000-0000-000000000000'::uuid), access_source)
      WHERE status IN ('PENDING','ACCEPTED');
  `);
  // R-2 — an ACCEPTED teacher_child_links row MUST name the accepting guardian.
  pgm.addConstraint('teacher_child_links', 'teacher_child_links_r2_accept_ck', {
    check: "status <> 'ACCEPTED' OR accepted_by_parent_user_id IS NOT NULL",
  });

  // --- teacher_parent_links (communication only — R-3) ---
  pgm.createTable('teacher_parent_links', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    teacher_user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'CASCADE' },
    parent_user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'CASCADE' },
    child_id: { type: 'uuid', references: 'child_profiles', onDelete: 'SET NULL' },
    subject_id: { type: 'uuid', references: 'subjects', onDelete: 'SET NULL' },
    purpose: {
      type: 'text',
      notNull: true,
      default: 'COMMUNICATION',
      check:
        "purpose IN ('COMMUNICATION','LEARNING_UPDATE','ASSIGNMENT_COORDINATION','EXAM_COMMUNICATION','PARENT_GUIDANCE')",
    },
    initiated_by_role: { type: 'text', notNull: true, check: "initiated_by_role IN ('PARENT','TEACHER')" },
    initiated_by_user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'CASCADE' },
    origin_request_id: { type: 'uuid', references: 'relationship_requests', onDelete: 'SET NULL' },
    status: { type: 'text', notNull: true, default: 'PENDING', check: `status IN ${LINK_STATUS}` },
    accepted_by_user_id: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    accepted_at: { type: 'timestamptz' },
    revoked_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('teacher_parent_links', ['parent_user_id', 'status']);
  pgm.createIndex('teacher_parent_links', ['teacher_user_id', 'status']);

  // --- permission_sets (snapshot) / permission_grants (the live tuples) ---
  pgm.createTable('permission_sets', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    name: { type: 'text', notNull: true },
    kind: { type: 'text', notNull: true, default: 'ACTIVE', check: "kind IN ('PROPOSED_TEMPLATE','ACTIVE')" },
    owner_scope: { type: 'text', notNull: true, check: "owner_scope IN ('TEACHER_CHILD','TEACHER_PARENT')" },
    owner_link_id: { type: 'uuid' },
    codes: { type: 'jsonb', notNull: true, default: '[]' },
    created_by: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createTable('permission_grants', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    subject_link_type: { type: 'text', notNull: true, check: "subject_link_type IN ('TEACHER_CHILD','TEACHER_PARENT')" },
    subject_link_id: { type: 'uuid', notNull: true },
    permission_code: { type: 'text', notNull: true, check: `permission_code IN ${PERM_CODES}` },
    subject_id: { type: 'uuid', references: 'subjects', onDelete: 'SET NULL' },
    access_source: { type: 'text', notNull: true, check: `access_source IN ${ACCESS_SRC}` },
    granted_by_user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'CASCADE' },
    status: { type: 'text', notNull: true, default: 'ACTIVE', check: "status IN ('ACTIVE','REVOKED')" },
    granted_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    revoked_at: { type: 'timestamptz' },
  });
  pgm.createIndex('permission_grants', ['subject_link_id', 'status']);
  pgm.sql(`
    CREATE UNIQUE INDEX permission_grants_active_uq ON permission_grants
      (subject_link_id, permission_code,
       coalesce(subject_id, '00000000-0000-0000-0000-000000000000'::uuid), access_source)
      WHERE status = 'ACTIVE';
  `);

  // --- privacy_preferences (sits above the grants — R-9) ---
  pgm.createTable('privacy_preferences', {
    child_id: { type: 'uuid', primaryKey: true, references: 'child_profiles', onDelete: 'CASCADE' },
    default_class_privacy_mode: {
      type: 'text',
      notNull: true,
      default: 'PRIVATE_LEARNING',
      check: "default_class_privacy_mode IN ('PRIVATE_LEARNING','LINKED_PRIVATE','LINKED_SHARED')",
    },
    allow_teacher_discovery_by_email: { type: 'boolean', notNull: true, default: false },
    allow_teacher_discovery_by_class_join: { type: 'boolean', notNull: true, default: true },
    share_behaviour_observations_with_child: { type: 'boolean', notNull: true, default: false },
    updated_by: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // --- audit_events (append-only) ---
  pgm.createTable('audit_events', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    actor_user_id: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    actor_workspace: { type: 'text' },
    event_type: { type: 'text', notNull: true },
    subject_type: { type: 'text' },
    subject_id: { type: 'uuid' },
    child_id: { type: 'uuid', references: 'child_profiles', onDelete: 'SET NULL' },
    payload: { type: 'jsonb', notNull: true, default: '{}' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('audit_events', ['child_id', 'created_at']);
  pgm.createIndex('audit_events', ['event_type', 'created_at']);
  pgm.sql(`
    CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit_events
      FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
    CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON audit_events
      FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
  `);

  // ===================================================================
  // Legacy teacher_invites migration (ID-Q3). Mirrored in
  // @copilot/identity/pg `migrateTeacherInvitesFromLegacy`.
  // ===================================================================

  // accepted (resolvable teacher + child) → ACCEPTED teacher_child_links
  pgm.sql(`
    INSERT INTO teacher_child_links (
      teacher_user_id, child_id, subject_id, relationship_type, access_source,
      initiated_by_role, initiated_by_user_id, status, accepted_by_parent_user_id,
      needs_guardian_review, accepted_at, created_at
    )
    SELECT t.user_id,
           ti.child_id,
           (SELECT id FROM subjects WHERE code = 'MATH'),
           'SUBJECT_TEACHER',
           'PARENT_DIRECT',
           'PARENT',
           f.owner_parent_id,
           'ACCEPTED',
           f.owner_parent_id,
           true,
           now(),
           ti.created_at
    FROM teacher_invites ti
    JOIN teachers t ON t.id = ti.teacher_id
    JOIN families f ON f.id = ti.family_id
    WHERE ti.status = 'accepted'
      AND ti.teacher_id IS NOT NULL
      AND f.owner_parent_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM teacher_child_links x
        WHERE x.teacher_user_id = t.user_id AND x.child_id = ti.child_id
          AND x.status IN ('PENDING','ACCEPTED')
      );
  `);

  // LEGACY_MINIMAL grants for the links just created
  pgm.sql(`
    INSERT INTO permission_grants (subject_link_type, subject_link_id, permission_code, subject_id,
      access_source, granted_by_user_id, status, granted_at)
    SELECT 'TEACHER_CHILD', l.id, code.c, l.subject_id, 'PARENT_DIRECT',
           l.accepted_by_parent_user_id, 'ACTIVE', now()
    FROM teacher_child_links l
    CROSS JOIN (VALUES ('VIEW_CLASS_CONTEXT'), ('SUBMIT_CURRENT_LESSON')) AS code(c)
    WHERE l.needs_guardian_review = true
      AND l.created_at IN (SELECT created_at FROM teacher_invites WHERE status = 'accepted')
      AND NOT EXISTS (
        SELECT 1 FROM permission_grants g
        WHERE g.subject_link_id = l.id AND g.permission_code = code.c AND g.status = 'ACTIVE'
      );
  `);

  // audit RELATIONSHIP_MIGRATED
  pgm.sql(`
    INSERT INTO audit_events (actor_user_id, event_type, subject_type, subject_id, child_id, payload)
    SELECT l.accepted_by_parent_user_id, 'RELATIONSHIP_MIGRATED', 'teacher_child_links', l.id, l.child_id,
           jsonb_build_object('source', 'teacher_invites', 'permission_set', 'LEGACY_MINIMAL')
    FROM teacher_child_links l
    WHERE l.needs_guardian_review = true;
  `);

  // pending → relationship_requests
  pgm.sql(`
    INSERT INTO relationship_requests (
      requester_user_id, requester_role, target_type, target_child_id, relationship_kind,
      relationship_type, subject_id, access_source, proposed_permissions, discovery_method,
      status, expires_at, created_at
    )
    SELECT coalesce(ti.invited_by, f.owner_parent_id),
           'PARENT', 'CHILD', ti.child_id, 'TEACHER_CHILD', 'SUBJECT_TEACHER',
           (SELECT id FROM subjects WHERE code = 'MATH'),
           'PARENT_DIRECT',
           '["VIEW_CLASS_CONTEXT","SUBMIT_CURRENT_LESSON"]'::jsonb,
           'PARENT_LINK', 'PENDING', now() + interval '14 days', ti.created_at
    FROM teacher_invites ti
    JOIN families f ON f.id = ti.family_id
    WHERE ti.status = 'pending' AND f.owner_parent_id IS NOT NULL;
  `);

  // revoked → teacher_child_links REVOKED (history only)
  pgm.sql(`
    INSERT INTO teacher_child_links (
      teacher_user_id, child_id, subject_id, relationship_type, access_source,
      initiated_by_role, initiated_by_user_id, status, revoked_at, created_at
    )
    SELECT t.user_id, ti.child_id, (SELECT id FROM subjects WHERE code = 'MATH'),
           'SUBJECT_TEACHER', 'PARENT_DIRECT', 'PARENT', f.owner_parent_id,
           'REVOKED', now(), ti.created_at
    FROM teacher_invites ti
    JOIN teachers t ON t.id = ti.teacher_id
    JOIN families f ON f.id = ti.family_id
    WHERE ti.status = 'revoked' AND ti.teacher_id IS NOT NULL AND f.owner_parent_id IS NOT NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TRIGGER IF EXISTS audit_events_no_update ON audit_events;`);
  pgm.sql(`DROP TRIGGER IF EXISTS audit_events_no_delete ON audit_events;`);
  pgm.dropTable('audit_events');
  pgm.dropTable('privacy_preferences');
  pgm.dropTable('permission_grants');
  pgm.dropTable('permission_sets');
  pgm.dropTable('teacher_parent_links');
  pgm.dropTable('teacher_child_links');
  pgm.dropTable('relationship_requests');
};
