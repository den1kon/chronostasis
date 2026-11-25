import {describe, expect, it} from 'vitest';
import {
  OperationOutcomeSchema,
  SnapshotResponseSchema,
  SyncOperationSchema,
  SyncRequestEnvelopeSchema,
  SyncRequestSchema,
  SyncResponseSchema,
  UserSnapshotSchema,
} from './index';

const operationId = '75109e1c-b3c0-4d6b-9472-c929d8f89032';
const sessionId = '91ce163b-e7af-4881-a13d-d263aadaa69b';
const itemInstanceId = 'f8f1a60a-0c78-4488-9b38-3e1ff898b413';
const chestId = 'basic-chest';
const itemId = 'rusty-key';
const startedAt = '2026-11-09T10:00:00.000Z';
const endedAt = '2026-11-09T10:15:00.000Z';
const buyOperation = {operationId, type: 'buy_chest', chestId};
const startOperation = {
  operationId,
  type: 'start_session',
  sessionId,
  chestId,
  plannedDurationSeconds: 900,
};
const offlineClaim = {
  ...startOperation,
  type: 'offline_session_claim',
  startedAt,
  endedAt,
  itemInstanceId,
  itemId,
};

const snapshot = {
  revision: 0,
  catalogueVersion: 'catalogue-v1',
  user: {id: 'cbb42c70-c36b-4fb6-8c36-86a0e810ff41', coins: 0},
  catalogue: {
    items: [
      {
        id: itemId,
        name: 'Rusty key',
        description: {en: 'An old key', paragraphs: ['Still opens a door.']},
        rarity: 'common',
        stats: {value: 1},
        spriteX: 1,
        spriteY: 2,
      },
    ],
    chests: [
      {
        id: chestId,
        name: 'Basic chest',
        description: null,
        price: 0,
        spriteX: 0,
        spriteY: 0,
      },
    ],
    chestItems: [{chestId, itemId, weight: 1}],
  },
  userChests: [{chestId, unlockedAt: startedAt}],
  items: [
    {
      id: itemInstanceId,
      itemId,
      sessionId,
      acquisitionSource: 'offline_claim',
      isVerified: false,
      receivedAt: endedAt,
    },
  ],
  sessions: [
    {
      id: sessionId,
      chestId,
      origin: 'offline',
      status: 'completed',
      plannedDurationSeconds: 900,
      startedAt,
      endedAt,
    },
  ],
};

describe('sync operation contracts', () => {
  it.each([
    buyOperation,
    startOperation,
    {operationId, type: 'claim_reward', sessionId},
    {operationId, type: 'cancel_session', sessionId},
    offlineClaim,
  ])('accepts the $type operation', operation => {
    expect(SyncOperationSchema.parse(operation)).toEqual(operation);
  });

  it.each([
    {...buyOperation, operationId: 'invalid'},
    {...buyOperation, chestId: ''},
    {...buyOperation, chestId: 'basic\0chest'},
    {...buyOperation, type: 'grant_coins'},
    {...buyOperation, price: 0},
    {...startOperation, sessionId: 'invalid'},
    {...startOperation, startedAt},
    {...offlineClaim, itemInstanceId: 'invalid'},
    {...offlineClaim, itemId: 'rusty\0key'},
    {...offlineClaim, isVerified: true},
    {...offlineClaim, startedAt: '0000-01-01T10:00:00.000Z'},
    {...offlineClaim, endedAt: '0000-01-01T10:15:00.000Z'},
    {...offlineClaim, startedAt: '2026-02-30T10:00:00.000Z'},
    {...offlineClaim, startedAt: '2026-11-09T10:00:00.1230Z'},
    {...offlineClaim, endedAt: '2026-11-09T10:15:00.123000Z'},
    {...offlineClaim, endedAt: '2026-11-09T11:15:00.000+01:00'},
  ])('rejects an invalid operation: %j', operation => {
    expect(SyncOperationSchema.safeParse(operation).success).toBe(false);
  });

  it.each([900, 1200, 10800])('accepts a %i second duration', duration => {
    expect(
      SyncOperationSchema.safeParse({
        ...startOperation,
        plannedDurationSeconds: duration,
      }).success,
    ).toBe(true);
  });

  it.each([600, 901, 1200.5, 11100, '900'])(
    'rejects an invalid duration: %j',
    duration => {
      expect(
        SyncOperationSchema.safeParse({
          ...startOperation,
          plannedDurationSeconds: duration,
        }).success,
      ).toBe(false);
    },
  );
});

describe('sync request contracts', () => {
  it('preserves typed operations in request order', () => {
    const request = {
      operations: [buyOperation, offlineClaim],
      knownRevision: 0,
    };
    expect(SyncRequestSchema.parse(request)).toEqual(request);
  });

  it('preserves invalid entries for per-entry server validation', () => {
    const request = {operations: [buyOperation, {...offlineClaim, itemId: 9}]};
    expect(SyncRequestEnvelopeSchema.parse(request)).toEqual(request);
    expect(SyncRequestSchema.safeParse(request).success).toBe(false);
  });

  it('accepts a batch of 100 operations', () => {
    const request = {operations: Array(100).fill(buyOperation)};
    expect(SyncRequestSchema.parse(request)).toEqual(request);
  });

  it.each([
    {},
    {operations: []},
    {operations: Array(101).fill(buyOperation)},
    {operations: [buyOperation], knownRevision: -1},
    {operations: [buyOperation], knownRevision: 0.5},
    {operations: [buyOperation], knownRevision: Number.MAX_SAFE_INTEGER + 1},
    {operations: [buyOperation], known_revision: 0},
  ])('rejects invalid request envelope #%#', request => {
    expect(SyncRequestEnvelopeSchema.safeParse(request).success).toBe(false);
    expect(SyncRequestSchema.safeParse(request).success).toBe(false);
  });
});

describe('sync response contracts', () => {
  it('parses the complete public snapshot', () => {
    expect(UserSnapshotSchema.parse(snapshot)).toEqual(snapshot);
  });

  it('accepts an account-creation item and a running session', () => {
    const initial = {
      ...snapshot,
      items: [
        {
          id: itemInstanceId,
          itemId: 'creation-token',
          sessionId: null,
          acquisitionSource: 'account_creation',
          isVerified: true,
          receivedAt: startedAt,
        },
      ],
      sessions: [
        {
          id: sessionId,
          chestId,
          origin: 'online',
          status: 'running',
          plannedDurationSeconds: 900,
          startedAt,
          endedAt: null,
        },
      ],
    };
    expect(UserSnapshotSchema.parse(initial)).toEqual(initial);
  });

  it.each([
    {...snapshot, user: {...snapshot.user, clerkUserId: 'user_private'}},
    {...snapshot, user: {...snapshot.user, coins: -1}},
    {...snapshot, revision: Number.MAX_SAFE_INTEGER + 1},
    {...snapshot, catalogueVersion: ''},
    {
      ...snapshot,
      catalogue: {
        ...snapshot.catalogue,
        chestItems: [{chestId, itemId, weight: 0}],
      },
    },
  ])('rejects an invalid snapshot #%#', invalid => {
    expect(UserSnapshotSchema.safeParse(invalid).success).toBe(false);
  });

  it.each(['accepted', 'accepted_unverified', 'already_processed', 'rejected'])(
    'defaults the %s outcome to terminal',
    status => {
      const outcome = {operationId, type: 'claim_reward', status};
      expect(OperationOutcomeSchema.parse(outcome)).toEqual({
        ...outcome,
        retryable: false,
      });
    },
  );

  it('retains a retryable rejection in a sync response', () => {
    const response = {
      outcomes: [
        {
          operationId,
          type: 'claim_reward',
          status: 'rejected',
          code: 'SESSION_TOO_EARLY',
          message: 'Try again when your session ends.',
          sessionId,
          retryable: true,
        },
      ],
      snapshot,
    };
    expect(SyncResponseSchema.parse(response)).toEqual(response);
  });

  it('rejects private error fields on an outcome', () => {
    expect(
      OperationOutcomeSchema.safeParse({
        operationId,
        type: 'claim_reward',
        status: 'rejected',
        stack: 'private data',
      }).success,
    ).toBe(false);
  });

  it.each([
    {unchanged: false, snapshot},
    {unchanged: true, revision: 0, catalogueVersion: 'catalogue-v1'},
  ])('accepts a snapshot response with unchanged=$unchanged', response => {
    expect(SnapshotResponseSchema.parse(response)).toEqual(response);
  });

  it.each([
    {unchanged: true, revision: 0},
    {unchanged: true, revision: 0, catalogueVersion: 'catalogue-v1', snapshot},
    {unchanged: false, revision: 0, catalogueVersion: 'catalogue-v1'},
  ])('rejects invalid snapshot response #%#', response => {
    expect(SnapshotResponseSchema.safeParse(response).success).toBe(false);
  });
});
