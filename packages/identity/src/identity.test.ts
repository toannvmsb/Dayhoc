import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryAuthAdapter } from './auth-adapter.js';
import { FamilyService } from './family-service.js';
import { guardianAuthority, authorisedGuardian } from './guardian-authority.js';
import { IdentityService } from './identity-service.js';
import { InMemoryIdentityStore } from './store.js';
import { AuthorizationError, ValidationError, WorkspaceNotHeldError } from './errors.js';
import type { UserId } from '@copilot/domain';

/**
 * I1 golden tests (doc 26 §1–5 + management-authority + child_id continuity).
 * Deterministic, in-memory — `InMemoryAuthAdapter` + `InMemoryIdentityStore`,
 * seeded ids for stable assertions.
 */
function makeHarness() {
  const store = new InMemoryIdentityStore();
  const auth = new InMemoryAuthAdapter();
  let seq = 0;
  const newId = () => `id_${(seq += 1).toString().padStart(3, '0')}`;
  const now = () => new Date('2026-09-02T00:00:00.000Z');
  const identity = new IdentityService({ store, auth, newId, now });
  const family = new FamilyService({ store, newId, now });
  return { store, auth, identity, family };
}

async function registerParent(h: ReturnType<typeof makeHarness>, email: string) {
  const res = await h.identity.register({
    email,
    password: 'supersecret',
    intendedRole: 'PARENT',
    displayName: email.split('@')[0]!,
  });
  return res.user.id;
}

describe('I1 — identity & family', () => {
  let h: ReturnType<typeof makeHarness>;
  beforeEach(() => {
    h = makeHarness();
  });

  it('§1 — a parent creates a child with NO student account', async () => {
    const parent = await registerParent(h, 'mom@example.com');
    const familyId = await h.family.createFamily(parent);
    const childId = await h.family.createChild({
      familyId,
      creatorUserId: parent,
      displayName: 'Bé An',
      schoolGrade: 4,
    });

    // no users row for the child
    expect(await h.store.getChild(childId)).not.toBeNull();
    expect(await h.store.getUser(childId as unknown as UserId)).toBeNull();
    expect(await h.store.getActiveStudentLinkForChild(childId)).toBeNull();

    // creator is the first guardian with ALL capabilities, SELF_DECLARED
    const rels = await h.family.listGuardians(childId);
    expect(rels).toHaveLength(1);
    expect(rels[0]).toMatchObject({
      parentUserId: parent,
      authoritySource: 'SELF_DECLARED',
      canManageChild: true,
      canManagePrivacy: true,
      canApproveTeacherRelationships: true,
      isLegalGuardian: null,
      status: 'ACTIVE',
    });
    expect(await h.store.countChildren()).toBe(1);
  });

  it('§2/§3 — a student registers later, links to the EXISTING child, no duplicate', async () => {
    const parent = await registerParent(h, 'dad@example.com');
    const familyId = await h.family.createFamily(parent);
    const childId = await h.family.createChild({
      familyId,
      creatorUserId: parent,
      displayName: 'Bé Bình',
      schoolGrade: 7,
    });

    const student = await h.identity.register({
      email: 'binh@example.com',
      password: 'studentpass',
      intendedRole: 'STUDENT',
    });
    const link = await h.identity.linkStudentAccount({
      studentUserId: student.user.id,
      childId,
      linkMethod: 'CLAIM_CODE',
    });
    expect(link.status).toBe('PENDING');

    const active = await h.identity.approveStudentLink(link.id, parent);
    expect(active.status).toBe('ACTIVE');
    expect(active.childId).toBe(childId); // same child_id — never a new profile
    expect(await h.store.countChildren()).toBe(1);
  });

  it('§3 — a non-guardian cannot approve a student link', async () => {
    const parent = await registerParent(h, 'p1@example.com');
    const stranger = await registerParent(h, 'stranger@example.com');
    const familyId = await h.family.createFamily(parent);
    const childId = await h.family.createChild({
      familyId,
      creatorUserId: parent,
      displayName: 'Bé Cường',
      schoolGrade: 4,
    });
    const student = await h.identity.register({
      email: 's@example.com',
      password: 'studentpass',
      intendedRole: 'STUDENT',
    });
    const link = await h.identity.linkStudentAccount({
      studentUserId: student.user.id,
      childId,
      linkMethod: 'CLAIM_CODE',
    });
    await expect(h.identity.approveStudentLink(link.id, stranger)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it('§4 — one identity holds PARENT + TEACHER, with both profiles', async () => {
    const user = await registerParent(h, 'both@example.com');
    await h.identity.addRole(user, 'TEACHER');
    const resolved = await h.identity.getIdentity(user);
    expect([...resolved.roles].sort()).toEqual(['PARENT', 'TEACHER']);
    expect(resolved.parentProfile).not.toBeNull();
    expect(resolved.teacherProfile).not.toBeNull();
  });

  it('§5 — workspace switch validates against held roles', async () => {
    const user = await registerParent(h, 'ws@example.com');
    await expect(h.identity.resolveWorkspace(user, 'PARENT')).resolves.toEqual({
      userId: user,
      workspace: 'PARENT',
    });
    await expect(h.identity.resolveWorkspace(user, 'ADMIN')).rejects.toBeInstanceOf(
      WorkspaceNotHeldError,
    );
  });

  it('multiple guardians (M:N) — capabilities are the OR-union, clamped by the inviter', async () => {
    const owner = await registerParent(h, 'owner@example.com');
    const coParent = await registerParent(h, 'coparent@example.com');
    const familyId = await h.family.createFamily(owner);
    const childId = await h.family.createChild({
      familyId,
      creatorUserId: owner,
      displayName: 'Bé Dung',
      schoolGrade: 7,
    });

    // owner invites coParent, tries to grant everything
    const rel = await h.family.addGuardian({
      childId,
      inviterUserId: owner,
      newGuardianUserId: coParent,
      capabilities: {
        canManageChild: true,
        canManagePrivacy: true,
        canApproveTeacherRelationships: true,
      },
    });
    expect(rel.authoritySource).toBe('INVITED_BY_EXISTING_GUARDIAN');

    const coAuthority = await guardianAuthority(h.store, coParent, childId);
    expect(coAuthority).toEqual({
      canManageChild: true,
      canManagePrivacy: true,
      canApproveTeacherRelationships: true,
      isGuardian: true,
    });

    // a guardian who only has can_manage_child cannot escalate a third party
    await h.family.setGuardianCapabilities(rel.id, owner, {
      canManageChild: true,
      canManagePrivacy: false,
      canApproveTeacherRelationships: false,
    });
    const third = await registerParent(h, 'third@example.com');
    const rel3 = await h.family.addGuardian({
      childId,
      inviterUserId: coParent,
      newGuardianUserId: third,
      capabilities: {
        canManageChild: true,
        canManagePrivacy: true,
        canApproveTeacherRelationships: true,
      },
    });
    expect(rel3.canManageChild).toBe(true);
    expect(rel3.canManagePrivacy).toBe(false); // clamped — inviter lacks it
    expect(rel3.canApproveTeacherRelationships).toBe(false);
  });

  it('management authority — revoke needs can_manage_privacy and stops future authority', async () => {
    const owner = await registerParent(h, 'o2@example.com');
    const coParent = await registerParent(h, 'c2@example.com');
    const familyId = await h.family.createFamily(owner);
    const childId = await h.family.createChild({
      familyId,
      creatorUserId: owner,
      displayName: 'Bé Em',
      schoolGrade: 4,
    });
    const rel = await h.family.addGuardian({
      childId,
      inviterUserId: owner,
      newGuardianUserId: coParent,
      capabilities: {
        canManageChild: true,
        canManagePrivacy: false,
        canApproveTeacherRelationships: false,
      },
    });

    // coParent (no can_manage_privacy) cannot revoke the owner
    const ownerRel = (await h.family.listGuardians(childId)).find(
      (r) => r.parentUserId === owner,
    )!;
    await expect(h.family.revokeGuardian(ownerRel.id, coParent)).rejects.toBeInstanceOf(
      AuthorizationError,
    );

    // owner revokes coParent → coParent loses all authority immediately
    await h.family.revokeGuardian(rel.id, owner);
    expect(await authorisedGuardian(h.store, coParent, childId, 'can_manage_child')).toBe(false);
    expect((await guardianAuthority(h.store, coParent, childId)).isGuardian).toBe(false);
  });

  it('child_id is stable across the student-link migration', async () => {
    const parent = await registerParent(h, 'stable@example.com');
    const familyId = await h.family.createFamily(parent);
    const childId = await h.family.createChild({
      familyId,
      creatorUserId: parent,
      displayName: 'Bé Phúc',
      schoolGrade: 7,
    });
    const before = await h.store.getChild(childId);

    const student = await h.identity.register({
      email: 'phuc@example.com',
      password: 'studentpass',
      intendedRole: 'STUDENT',
    });
    const link = await h.identity.linkStudentAccount({
      studentUserId: student.user.id,
      childId,
      linkMethod: 'PARENT_INVITE',
      linkedByUserId: parent,
    });
    expect(link.status).toBe('ACTIVE'); // capable guardian initiated → no separate approval

    const after = await h.store.getChild(childId);
    expect(after).toEqual(before); // identical — the child profile is untouched
  });

  it('a self-register with neither email nor phone is rejected', async () => {
    await expect(
      h.identity.register({ password: 'supersecret', intendedRole: 'PARENT' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

/**
 * doc 26 §12 tests A–H are I3/I4 acceptance (enrollment_type, class-context vs
 * child-specific writes, LEGACY_MINIMAL migration). They are intentionally
 * out of I1 scope — tracked here so the coverage matrix stays visible.
 */
describe('doc 26 §12 A–H — deferred to I3 / I4', () => {
  it.todo('A (55) — PRIMARY + HSG_TEAM enrollments coexist (I3)');
  it.todo('B (56) — a second ACTIVE PRIMARY enrollment is rejected (I3)');
  it.todo('C (57) — a supplementary class is not a Curriculum Clock context (I3)');
  it.todo('D (58) — PRIMARY change at a year transition keeps ≤1 ACTIVE PRIMARY (I3/I6)');
  it.todo('E (59) — a Teacher–Class op is class-context write only, under all six conditions (I4)');
  it.todo('F (60) — a Teacher–Class assignment cannot submit a child-specific skill assessment (I4)');
  it.todo('G (61) — a classroom assignment never yields a sensitive Twin read (I4)');
  it.todo('H (62) — a legacy teacher_invite migrates to LEGACY_MINIMAL, no over-grant (I4)');
});
