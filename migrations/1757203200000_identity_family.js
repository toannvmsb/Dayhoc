/* eslint-disable */
/**
 * I1 — Identity + Family (additive, no big-bang — docs 19, 22, 23; ID-Q1..Q10).
 *
 * Adds the multi-role identity + capability-based guardian authority model
 * alongside the legacy `users.role` / `families` / `parents` / `teachers` /
 * `child_profiles` tables. NOTHING legacy is dropped or rewritten — legacy rows
 * are backfilled into the new tables and the old tables stay usable for at least
 * one release (doc 27 §3).
 *
 * Key decisions folded in:
 *  - `parent_child_relationships` carries explicit capabilities + `authority_source`
 *    (ID-Q6); `is_legal_guardian` is nullable and NEVER the sole predicate.
 *  - Legacy family owners backfill as `authority_source='MIGRATED_FAMILY_OWNER'`
 *    with all three capabilities and `is_legal_guardian = NULL`.
 *  - Legacy `users.role='child'` rows are NOT auto-migrated (ID-Q2) — audited in
 *    I0, left as-is; no STUDENT role row is created for them here.
 *  - `child_profiles.school_grade` stays (cache, ID-Q9); `date_of_birth` added.
 *
 * The backfill statements are idempotent (guarded by NOT EXISTS / ON CONFLICT).
 * The same logic is mirrored in `@copilot/identity/pg` `backfillIdentityFromLegacy`
 * for re-runs and for scenario-driven integration tests — keep the two in sync.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  // --- users: identity columns (role column kept, no longer authoritative) ---
  pgm.addColumns('users', {
    auth_user_id: { type: 'text', unique: true }, // provider subject id; null = no login yet
    primary_email: { type: 'text' },
    primary_phone: { type: 'text' },
    display_name: { type: 'text' },
    status: {
      type: 'text',
      notNull: true,
      default: 'ACTIVE',
      check: "status IN ('ACTIVE','SUSPENDED','DELETED')",
    },
  });

  // --- user_roles: M:N roles ---
  pgm.createTable('user_roles', {
    user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'CASCADE' },
    role: { type: 'text', notNull: true, check: "role IN ('PARENT','STUDENT','TEACHER','ADMIN')" },
    granted_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    granted_by: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
  });
  pgm.addConstraint('user_roles', 'user_roles_pkey', { primaryKey: ['user_id', 'role'] });

  // --- parent_profiles / teacher_profiles (backfilled from parents/teachers) ---
  pgm.createTable('parent_profiles', {
    user_id: { type: 'uuid', primaryKey: true, references: 'users', onDelete: 'CASCADE' },
    display_name: { type: 'text', notNull: true },
    contact_visibility: {
      type: 'text',
      notNull: true,
      default: 'FAMILY',
      check: "contact_visibility IN ('PRIVATE','FAMILY','CONNECTED')",
    },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createTable('teacher_profiles', {
    user_id: { type: 'uuid', primaryKey: true, references: 'users', onDelete: 'CASCADE' },
    display_name: { type: 'text', notNull: true },
    headline: { type: 'text' },
    subjects_taught: { type: 'jsonb', notNull: true, default: '[]' },
    verification_status: {
      type: 'text',
      notNull: true,
      default: 'UNVERIFIED',
      check: "verification_status IN ('UNVERIFIED','COMMUNITY_VERIFIED','SYSTEM_VERIFIED')",
    },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // --- family_memberships: guardians of a household/billing unit ---
  pgm.createTable('family_memberships', {
    family_id: { type: 'uuid', notNull: true, references: 'families', onDelete: 'CASCADE' },
    user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'CASCADE' },
    member_role: {
      type: 'text',
      notNull: true,
      check: "member_role IN ('OWNER','GUARDIAN','VIEWER')",
    },
    joined_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('family_memberships', 'family_memberships_pkey', {
    primaryKey: ['family_id', 'user_id'],
  });

  // --- parent_child_relationships: typed M:N guardianship, capability model (ID-Q6) ---
  pgm.createTable('parent_child_relationships', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    parent_user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'CASCADE' },
    child_id: { type: 'uuid', notNull: true, references: 'child_profiles', onDelete: 'CASCADE' },
    relationship_type: {
      type: 'text',
      notNull: true,
      default: 'GUARDIAN',
      check: "relationship_type IN ('FATHER','MOTHER','GUARDIAN','OTHER')",
    },
    can_manage_child: { type: 'boolean', notNull: true, default: false },
    can_manage_privacy: { type: 'boolean', notNull: true, default: false },
    can_approve_teacher_relationships: { type: 'boolean', notNull: true, default: false },
    authority_source: {
      type: 'text',
      notNull: true,
      check:
        "authority_source IN ('SELF_DECLARED','INVITED_BY_EXISTING_GUARDIAN','VERIFIED','MIGRATED_FAMILY_OWNER')",
    },
    // nullable, verification-aware — NEVER the sole authorization predicate (ID-Q6)
    is_legal_guardian: { type: 'boolean' },
    status: {
      type: 'text',
      notNull: true,
      default: 'ACTIVE',
      check: "status IN ('ACTIVE','REVOKED')",
    },
    valid_from: { type: 'timestamptz' },
    valid_until: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    revoked_at: { type: 'timestamptz' },
  });
  pgm.createIndex('parent_child_relationships', ['parent_user_id', 'child_id'], {
    unique: true,
    where: "status = 'ACTIVE'",
    name: 'parent_child_relationships_active_uq',
  });
  pgm.createIndex('parent_child_relationships', 'child_id');

  // --- student_account_links (I-1): a Student identity binding to an existing Child ---
  pgm.createTable('student_account_links', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'CASCADE' },
    child_id: { type: 'uuid', notNull: true, references: 'child_profiles', onDelete: 'CASCADE' },
    linked_by_user_id: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    link_method: {
      type: 'text',
      notNull: true,
      check: "link_method IN ('PARENT_INVITE','CLAIM_CODE','GUARDIAN_MANUAL')",
    },
    status: {
      type: 'text',
      notNull: true,
      default: 'PENDING',
      check: "status IN ('PENDING','ACTIVE','REVOKED')",
    },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    revoked_at: { type: 'timestamptz' },
  });
  pgm.createIndex('student_account_links', 'child_id', {
    unique: true,
    where: "status = 'ACTIVE'",
    name: 'student_account_links_active_child_uq',
  });
  pgm.createIndex('student_account_links', 'user_id');

  // --- child_profiles: date_of_birth (guardian-provided) ---
  pgm.addColumns('child_profiles', {
    date_of_birth: { type: 'date' },
  });

  // --- forward-compat VIEW: `children` == `child_profiles` (id = child_id forever) ---
  pgm.sql(`CREATE VIEW children AS SELECT * FROM child_profiles;`);

  // ===================================================================
  // BACKFILL (idempotent) — mirrors @copilot/identity/pg backfillIdentityFromLegacy
  // ===================================================================

  // user_roles: PARENT / TEACHER / ADMIN from the legacy single-role column.
  // 'child' rows are intentionally skipped (ID-Q2).
  pgm.sql(`
    INSERT INTO user_roles (user_id, role, granted_at)
    SELECT u.id,
           CASE u.role WHEN 'parent' THEN 'PARENT'
                       WHEN 'teacher' THEN 'TEACHER'
                       WHEN 'admin' THEN 'ADMIN' END,
           now()
    FROM users u
    WHERE u.role IN ('parent','teacher','admin')
    ON CONFLICT (user_id, role) DO NOTHING;
  `);

  // parent_profiles from the legacy `parents` table (one row per user).
  pgm.sql(`
    INSERT INTO parent_profiles (user_id, display_name, contact_visibility, created_at)
    SELECT DISTINCT ON (p.user_id) p.user_id, p.display_name, 'FAMILY', now()
    FROM parents p
    ORDER BY p.user_id, p.id
    ON CONFLICT (user_id) DO NOTHING;
  `);

  // teacher_profiles from the legacy `teachers` table.
  pgm.sql(`
    INSERT INTO teacher_profiles (user_id, display_name, verification_status, created_at)
    SELECT DISTINCT ON (t.user_id) t.user_id, 'Teacher', 'UNVERIFIED', now()
    FROM teachers t
    ORDER BY t.user_id, t.id
    ON CONFLICT (user_id) DO NOTHING;
  `);

  // family_memberships: OWNER from families.owner_parent_id, GUARDIAN from parents.
  pgm.sql(`
    INSERT INTO family_memberships (family_id, user_id, member_role, joined_at)
    SELECT f.id, f.owner_parent_id, 'OWNER', now()
    FROM families f
    WHERE f.owner_parent_id IS NOT NULL
    ON CONFLICT (family_id, user_id) DO NOTHING;
  `);
  pgm.sql(`
    INSERT INTO family_memberships (family_id, user_id, member_role, joined_at)
    SELECT p.family_id, p.user_id, 'GUARDIAN', now()
    FROM parents p
    WHERE NOT EXISTS (
      SELECT 1 FROM families f WHERE f.id = p.family_id AND f.owner_parent_id = p.user_id
    )
    ON CONFLICT (family_id, user_id) DO NOTHING;
  `);

  // parent_child_relationships: for every (parent in the child's family, child).
  //  - the family owner  -> MIGRATED_FAMILY_OWNER, all caps, is_legal_guardian NULL
  //  - any other parent  -> SELF_DECLARED, can_manage_child only
  pgm.sql(`
    WITH family_parents AS (
      SELECT c.id AS child_id,
             fm.user_id AS parent_user_id,
             (fm.member_role = 'OWNER') AS is_owner
      FROM child_profiles c
      JOIN family_memberships fm ON fm.family_id = c.family_id
      WHERE fm.member_role IN ('OWNER','GUARDIAN')
    )
    INSERT INTO parent_child_relationships (
      parent_user_id, child_id, relationship_type,
      can_manage_child, can_manage_privacy, can_approve_teacher_relationships,
      authority_source, is_legal_guardian, status, created_at
    )
    SELECT fp.parent_user_id, fp.child_id, 'GUARDIAN',
           true,
           fp.is_owner,
           fp.is_owner,
           CASE WHEN fp.is_owner THEN 'MIGRATED_FAMILY_OWNER' ELSE 'SELF_DECLARED' END,
           NULL,
           'ACTIVE',
           now()
    FROM family_parents fp
    WHERE NOT EXISTS (
      SELECT 1 FROM parent_child_relationships r
      WHERE r.parent_user_id = fp.parent_user_id
        AND r.child_id = fp.child_id
        AND r.status = 'ACTIVE'
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP VIEW IF EXISTS children;`);
  pgm.dropColumns('child_profiles', ['date_of_birth']);
  pgm.dropTable('student_account_links');
  pgm.dropTable('parent_child_relationships');
  pgm.dropTable('family_memberships');
  pgm.dropTable('teacher_profiles');
  pgm.dropTable('parent_profiles');
  pgm.dropTable('user_roles');
  pgm.dropColumns('users', [
    'auth_user_id',
    'primary_email',
    'primary_phone',
    'display_name',
    'status',
  ]);
};
