import type {SyncOperation, UserSnapshot} from '@chronostasis/contracts';
import {describe, expect, it} from 'vitest';
import {batchOperations, projectSnapshot} from './sync-model';

const chest = {
  id: 'basic',
  price: 2,
  name: 'Chest',
  spriteX: 0,
  spriteY: 0,
  description: '',
};
const snapshot: UserSnapshot = {
  user: {id: crypto.randomUUID(), coins: 2},
  revision: 0,
  catalogueVersion: 'z',
  catalogue: {items: [], chests: [chest], chestItems: []},
  userChests: [],
  items: [],
  sessions: [],
};
const buy: SyncOperation = {
  type: 'buy_chest',
  operationId: crypto.randomUUID(),
  chestId: 'basic',
};
const claim: SyncOperation = {
  type: 'offline_session_claim',
  operationId: crypto.randomUUID(),
  sessionId: crypto.randomUUID(),
  chestId: 'basic',
  plannedDurationSeconds: 900,
  startedAt: '2026-01-01T00:00:00Z',
  endedAt: '2026-01-01T00:15:00Z',
  itemInstanceId: crypto.randomUUID(),
  itemId: 'gem',
};

describe('durable outbox projection', () => {
  it('replays purchases once, computes pending unverified inventory and leaves canonical state intact', () => {
    const view = projectSnapshot(snapshot, [
      buy,
      {...buy, operationId: crypto.randomUUID()},
      claim,
    ]);
    expect(view).toMatchObject({
      coins: 0,
      unlockedChestIds: ['basic'],
      items: [
        {
          id: claim.itemInstanceId,
          isVerified: false,
          pending: true,
          acquisitionSource: 'offline_claim',
        },
      ],
    });
    expect(snapshot.user.coins).toBe(2);
    expect(snapshot.items).toHaveLength(0);
    const confirmed = {
      ...snapshot,
      items: [
        {
          id: claim.itemInstanceId,
          itemId: 'gem',
          sessionId: claim.sessionId,
          acquisitionSource: 'offline_claim' as const,
          isVerified: false,
          receivedAt: claim.endedAt,
        },
      ],
    };
    expect(projectSnapshot(confirmed, [claim]).items).toEqual([
      {...confirmed.items[0], pending: false},
    ]);
  });
  it('leaves online session starts and claims pending without manufacturing server rewards', () => {
    const start: SyncOperation = {
      type: 'start_session',
      operationId: crypto.randomUUID(),
      sessionId: crypto.randomUUID(),
      chestId: 'basic',
      plannedDurationSeconds: 900,
    };
    expect(
      projectSnapshot(snapshot, [
        start,
        {
          type: 'claim_reward',
          operationId: crypto.randomUUID(),
          sessionId: start.sessionId,
        },
      ]).items,
    ).toEqual([]);
    expect(
      projectSnapshot({...snapshot, user: {...snapshot.user, coins: 1}}, [buy])
        .unlockedChestIds,
    ).toEqual([]);
  });
});
describe('outbox batches', () => {
  it('preserves order across count and UTF-8 byte boundaries', () => {
    const ops = [
      ...Array.from({length: 101}, () => ({
        ...buy,
        operationId: crypto.randomUUID(),
      })),
      ...Array.from({length: 3}, () => ({
        ...buy,
        operationId: crypto.randomUUID(),
        chestId: '🐝'.repeat(11000),
      })),
    ];
    const batches = batchOperations(ops);
    expect(batches[0]).toHaveLength(100);
    expect(batches.flat()).toEqual(ops);
    for (const operations of batches)
      expect(
        new TextEncoder().encode(JSON.stringify({operations})).length,
      ).toBeLessThan(65536);
  });
  it('rejects even a single operation exactly at the body limit', () => {
    const length = JSON.stringify({operations: [{...buy, chestId: ''}]}).length;
    expect(() =>
      batchOperations([{...buy, chestId: 'a'.repeat(65536 - length)}]),
    ).toThrow();
  });
});
