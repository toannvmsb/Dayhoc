/* eslint-disable */
/**
 * P7 — notification contacts (productionization phase). Additive, reversible.
 *
 * The domain DB deliberately never stored a user's email (data minimization —
 * it exists only with the auth provider). Real notification delivery needs
 * SOMEWHERE to look up "how do I reach this user" without depending on the
 * auth provider's admin API (decouples notifications from which auth backend
 * is live). `notification_email` is populated once, at registration, from
 * the same email the user already gave to sign up — not a new collection.
 * `expo_push_token` is populated by a device registering itself
 * (`POST /me/push-token`) after the user grants OS notification permission;
 * absent until then.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns('users', {
    notification_email: { type: 'text' },
    expo_push_token: { type: 'text' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('users', ['notification_email', 'expo_push_token']);
};
