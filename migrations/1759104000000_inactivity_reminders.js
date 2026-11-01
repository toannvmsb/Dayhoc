/* eslint-disable */
/**
 * Backlog B2-04 — remind the parent when the child has not practised for 2+ days.
 *
 * `child_profiles.reminders_enabled` is the parent's switch (default on: the reminder only goes to the
 * guardian's own notification email / push token, and nothing is sent unless a delivery channel is
 * configured). `reminder_log` is the dedupe + anti-nag ledger: at most one row per child per Vietnam day,
 * and the sender counts the rows since the child's last activity to stop after a few.
 *
 * Additive and reversible. The child-deletion workflow purges `reminder_log` explicitly (FK checks are
 * suspended there).
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns('child_profiles', {
    reminders_enabled: { type: 'boolean', notNull: true, default: true },
  });

  pgm.createTable('reminder_log', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    child_id: { type: 'uuid', notNull: true, references: 'child_profiles', onDelete: 'CASCADE' },
    kind: { type: 'text', notNull: true, default: 'INACTIVITY' },
    vn_day: { type: 'date', notNull: true },
    inactive_days: { type: 'integer', notNull: true },
    recipients: { type: 'integer', notNull: true, default: 0 },
    delivered: { type: 'integer', notNull: true, default: 0 },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('reminder_log', 'reminder_log_child_kind_day_uq', { unique: ['child_id', 'kind', 'vn_day'] });
  pgm.createIndex('reminder_log', ['child_id', 'created_at']);
};

exports.down = (pgm) => {
  pgm.dropTable('reminder_log');
  pgm.dropColumns('child_profiles', ['reminders_enabled']);
};
