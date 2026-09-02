/* eslint-disable */
/**
 * I7 — privacy-safe discovery primitive (additive — doc 21 §10).
 *
 * `relationship_invite_codes` — a guardian mints a short-lived, single-use (by
 * default) code scoped to ONE child; a teacher redeems it to create a PENDING
 * Teacher–Child request. There is NO child-search-by-name/school/class endpoint
 * and no child enumeration anywhere.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('relationship_invite_codes', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    code: { type: 'text', notNull: true, unique: true },
    child_id: { type: 'uuid', notNull: true, references: 'child_profiles', onDelete: 'CASCADE' },
    subject_id: { type: 'uuid', references: 'subjects', onDelete: 'SET NULL' },
    created_by_user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'CASCADE' },
    relationship_type: {
      type: 'text',
      notNull: true,
      default: 'SUBJECT_TEACHER',
      check: "relationship_type IN ('CLASS_TEACHER','SUBJECT_TEACHER','PRIVATE_TUTOR','COACH','MENTOR','OTHER')",
    },
    proposed_permissions: { type: 'jsonb', notNull: true, default: '[]' },
    uses_remaining: { type: 'integer', notNull: true, default: 1 },
    expires_at: { type: 'timestamptz', notNull: true },
    redeemed_by_user_id: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    redeemed_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('relationship_invite_codes', ['child_id', 'created_at']);
};

exports.down = (pgm) => {
  pgm.dropTable('relationship_invite_codes');
};
