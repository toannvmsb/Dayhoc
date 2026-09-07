/* eslint-disable */
/**
 * SAFE DEGRADED WORKSHEET COMPLETION (doc 68).
 *
 * `worksheet_generation_runs.worksheet_state` gains the degraded-but-delivered
 * states and drops `READY_WITH_PENDING_CROSSCHECK` (a pending crosscheck is no
 * longer a child-serving state). Runs + slots gain the safe-substitute /
 * optional-omission bookkeeping. Additive columns with constant defaults — no
 * table rewrite, and the append-only triggers do not fire on DDL.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  // --- worksheet_generation_runs -----------------------------------------
  // drop whatever CHECK currently constrains worksheet_state (name is
  // node-pg-migrate-generated and not worth guessing).
  pgm.sql(`DO $$
    DECLARE c text;
    BEGIN
      FOR c IN
        SELECT con.conname FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        WHERE rel.relname = 'worksheet_generation_runs' AND con.contype = 'c'
          AND pg_get_constraintdef(con.oid) ILIKE '%worksheet_state%'
      LOOP EXECUTE format('ALTER TABLE worksheet_generation_runs DROP CONSTRAINT %I', c);
      END LOOP;
    END $$`);
  pgm.sql(`UPDATE worksheet_generation_runs
             SET worksheet_state = 'READY'
             WHERE worksheet_state = 'READY_WITH_PENDING_CROSSCHECK'`);
  pgm.sql(`ALTER TABLE worksheet_generation_runs
             ADD CONSTRAINT worksheet_generation_runs_worksheet_state_check
             CHECK (worksheet_state IN
               ('READY','READY_WITH_SAFE_SUBSTITUTION','READY_WITH_OPTIONAL_OMISSIONS','FAILED'))`);
  pgm.addColumns('worksheet_generation_runs', {
    substituted_slots: { type: 'integer', notNull: true, default: 0 },
    omitted_slots: { type: 'integer', notNull: true, default: 0 },
  });

  // --- worksheet_slots --------------------------------------------------
  pgm.addColumns('worksheet_slots', {
    criticality: { type: 'text', notNull: true, default: 'REQUIRED_CORE' },
    substituted: { type: 'boolean', notNull: true, default: false },
    omitted: { type: 'boolean', notNull: true, default: false },
    degrade_reason: { type: 'text' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('worksheet_slots', ['criticality', 'substituted', 'omitted', 'degrade_reason']);
  pgm.dropColumns('worksheet_generation_runs', ['substituted_slots', 'omitted_slots']);
  pgm.sql(`ALTER TABLE worksheet_generation_runs
             DROP CONSTRAINT IF EXISTS worksheet_generation_runs_worksheet_state_check`);
  pgm.sql(`UPDATE worksheet_generation_runs
             SET worksheet_state = 'READY'
             WHERE worksheet_state IN ('READY_WITH_SAFE_SUBSTITUTION','READY_WITH_OPTIONAL_OMISSIONS')`);
  pgm.sql(`ALTER TABLE worksheet_generation_runs
             ADD CONSTRAINT worksheet_generation_runs_worksheet_state_check
             CHECK (worksheet_state IN ('READY','READY_WITH_PENDING_CROSSCHECK','FAILED'))`);
};
