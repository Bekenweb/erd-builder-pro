import { describe, expect, it } from 'vitest';
import { normalizeAccessMember } from './ProjectAccessDialog';

describe('Project access members from the API', () => {
  it('reads the snake_case fields the server sends', () => {
    expect(normalizeAccessMember({ user_id: 'u1', name: 'Ana', email: 'a@x.test', team_role: 'manager', role: 'manager', can_change: false }))
      .toEqual({ userId: 'u1', name: 'Ana', email: 'a@x.test', teamRole: 'manager', role: 'manager', canChange: false });
  });

  it('also accepts camelCase, and treats a missing can_change as not changeable', () => {
    expect(normalizeAccessMember({ userId: 'u2', name: null, email: null, teamRole: 'staff', role: 'editor', canChange: true }).canChange).toBe(true);
    expect(normalizeAccessMember({ user_id: 'u3', role: 'viewer' })).toMatchObject({ userId: 'u3', canChange: false, teamRole: 'staff', name: null });
  });
});
