import {
  GUARDIAN_CAPABILITY_TO_FIELD,
  NO_GUARDIAN_AUTHORITY,
  type GuardianAuthority,
  type GuardianCapability,
  type UserId,
} from '@copilot/domain';
import type { IdentityStore } from './store.js';

/**
 * Resolve a user's guardian authority over a child (doc 19 §3.4, doc 22 §5).
 *
 * = the OR-union of the capability flags across every **ACTIVE**
 * `parent_child_relationships` row for `(userId, childId)`. `is_legal_guardian`
 * is deliberately NOT consulted — it is a nullable, verification-aware hint only
 * (ID-Q6 / invariant I-5).
 */
export async function guardianAuthority(
  store: IdentityStore,
  userId: UserId,
  childId: string,
): Promise<GuardianAuthority> {
  const rows = (await store.listRelationshipsForPair(userId, childId)).filter(
    (r) => r.status === 'ACTIVE',
  );
  if (rows.length === 0) return NO_GUARDIAN_AUTHORITY;
  return {
    canManageChild: rows.some((r) => r.canManageChild),
    canManagePrivacy: rows.some((r) => r.canManagePrivacy),
    canApproveTeacherRelationships: rows.some((r) => r.canApproveTeacherRelationships),
    isGuardian: true,
  };
}

/**
 * True iff the user holds a specific guardian capability over the child. Every
 * privacy-critical action names the capability it needs — never a bare
 * "is this person a guardian?" check.
 */
export async function authorisedGuardian(
  store: IdentityStore,
  userId: UserId,
  childId: string,
  capability: GuardianCapability,
): Promise<boolean> {
  const authority = await guardianAuthority(store, userId, childId);
  return authority[GUARDIAN_CAPABILITY_TO_FIELD[capability]] === true;
}
