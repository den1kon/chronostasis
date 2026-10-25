import {describe, expect, it} from 'vitest';
import {
  ApiErrorSchema,
  HealthResponseSchema,
  PublicUserSchema,
  UserResponseSchema,
} from './index';

const user = {
  id: 'cbb42c70-c36b-4fb6-8c36-86a0e810ff41',
  clerkUserId: 'user_alice',
};

describe('public API contracts', () => {
  it('accepts the persisted user representation', () => {
    expect(UserResponseSchema.parse({user})).toEqual({user});
  });
  it.each([
    {...user, id: 'not-a-uuid'},
    {...user, clerkUserId: ''},
    {...user, clerkUserId: '   '},
    {id: user.id},
  ])('rejects malformed user identity: %j', value => {
    expect(PublicUserSchema.safeParse(value).success).toBe(false);
  });
  it('does not expose extra database fields in the public representation', () => {
    expect(PublicUserSchema.parse({...user, internal: 'private'})).toEqual(
      user,
    );
  });
  it('distinguishes successful health data from an error response', () => {
    expect(HealthResponseSchema.parse({status: 'ok'})).toEqual({status: 'ok'});
    expect(
      HealthResponseSchema.safeParse({status: 'unavailable'}).success,
    ).toBe(false);
  });
  it('validates structured errors instead of allowing arbitrary payloads', () => {
    expect(
      ApiErrorSchema.parse({
        error: {code: 'UNAUTHORIZED', message: 'Unauthorized'},
      }),
    ).toEqual({error: {code: 'UNAUTHORIZED', message: 'Unauthorized'}});
    expect(ApiErrorSchema.safeParse({error: 'Unauthorized'}).success).toBe(
      false,
    );
    expect(
      ApiErrorSchema.safeParse({error: {code: '', message: ''}}).success,
    ).toBe(false);
  });
});
