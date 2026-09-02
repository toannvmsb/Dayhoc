/* eslint-disable */
/**
 * M7 — entitlements + real Child-profile deletion workflow (additive, reversible).
 *
 *   - `family_subscriptions` — the family's current plan. MOCK: there is NO
 *     billing here (no card, no invoice, no gateway). A plan is a feature/quota
 *     gate only; it NEVER selects an AI model.
 *   - `child_deletion_requests` — the MUTABLE state of a deletion request
 *     (REQUESTED → CONFIRMED → COMPLETED / CANCELLED). The actual purge is a
 *     privileged operation that hard-deletes every child-scoped row (including
 *     the append-only ledgers, via session_replication_role=replica) and then
 *     the `child_profiles` row itself. `deletion_jobs` (existing, append-only)
 *     keeps the audit trail.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

const DEL_STATE = "('REQUESTED','CONFIRMED','COMPLETED','CANCELLED')";

exports.up = (pgm) => {
  pgm.createTable('family_subscriptions', {
    family_id: {
      type: 'uuid',
      primaryKey: true,
      references: 'families',
      onDelete: 'CASCADE',
    },
    plan: {
      type: 'text',
      notNull: true,
      default: 'free',
      check: "plan IN ('free','basic','plus','pro')",
    },
    status: {
      type: 'text',
      notNull: true,
      default: 'active',
      check: "status IN ('active','past_due','cancelled')",
    },
    started_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    current_period_end: { type: 'timestamptz' },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createTable('child_deletion_requests', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    child_id: {
      type: 'uuid',
      notNull: true,
      unique: true,
      references: 'child_profiles',
      onDelete: 'CASCADE',
    },
    requested_by_user_id: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    state: { type: 'text', notNull: true, default: 'REQUESTED', check: `state IN ${DEL_STATE}` },
    requested_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    confirmed_at: { type: 'timestamptz' },
    completed_at: { type: 'timestamptz' },
    purge_summary: { type: 'jsonb' },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
};

exports.down = (pgm) => {
  pgm.dropTable('child_deletion_requests');
  pgm.dropTable('family_subscriptions');
};
