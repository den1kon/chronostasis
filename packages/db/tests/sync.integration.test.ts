import {randomUUID} from 'node:crypto';
import {UserSnapshotSchema} from '@chronostasis/contracts';
import type {SyncOperation} from '@chronostasis/contracts';
import {and, eq, sql} from 'drizzle-orm';
import {afterAll, beforeAll, expect, it} from 'vitest';
import {createDatabase} from '../src/client';
import {readTestDatabaseUrl} from '../src/env';
import {createSyncRepository} from '../src/index';
import {migrateDatabase} from '../src/migrations';
import {
  chestItems,
  chests,
  focusSessions,
  items,
  userChests,
  users,
} from '../src/schema';
import {seedCatalogue} from '../src/seeding';
import {createUserRepository} from '../src/users';

const database = createDatabase(readTestDatabaseUrl(process.env));
const repository = createUserRepository(database);
const sync = createSyncRepository(database);
const subjects: string[] = [];
const testChests: string[] = [];
const basic = 'basic-chest';
const mythicItemId = randomUUID();
const buy = (chestId = basic) =>
  ({operationId: randomUUID(), type: 'buy_chest', chestId}) as const;
const start = (chestId = basic) =>
  ({
    type: 'start_session',
    operationId: randomUUID(),
    sessionId: randomUUID(),
    chestId,
    plannedDurationSeconds: 900,
  }) as const;
const claim = (sessionId: string) =>
  ({operationId: randomUUID(), type: 'claim_reward', sessionId}) as const;
const cancel = (sessionId: string) =>
  ({operationId: randomUUID(), type: 'cancel_session', sessionId}) as const;
const offline = (chestId = basic) =>
  ({
    ...start(chestId),
    type: 'offline_session_claim',
    itemInstanceId: randomUUID(),
    itemId: 'rusty-key',
    startedAt: '2026-01-01T12:00:00.123Z',
    endedAt: '2026-01-01T12:15:00.123Z',
  }) as const;

async function account() {
  const subject = randomUUID();
  subjects.push(subject);
  const {id} = await repository.ensureUser(subject);
  return {
    id,
    subject,
    apply: (op: SyncOperation) => sync.processOperation(subject, op),
    snapshot: () => sync.getSnapshot(subject),
  };
}

async function chest(price: number) {
  const id = randomUUID();
  testChests.push(id);
  await database.orm
    .insert(chests)
    .values({id, name: 'Test chest', price, spriteX: 0, spriteY: 0});
  return id;
}

beforeAll(async () => {
  await migrateDatabase(database);
  await seedCatalogue(database);
  await database.orm.insert(items).values({
    id: mythicItemId,
    name: 'Mythic test reward',
    rarity: 'mythic',
    spriteX: 0,
    spriteY: 0,
  });
});
afterAll(async () => {
  try {
    for (const subject of subjects)
      await database.orm.delete(users).where(eq(users.clerkUserId, subject));
    for (const id of testChests) {
      await database.orm.delete(chestItems).where(eq(chestItems.chestId, id));
      await database.orm.delete(chests).where(eq(chests.id, id));
    }
    await database.orm.delete(items).where(eq(items.id, mythicItemId));
  } finally {
    await database.close();
  }
});

it('initializes once at revision zero and explicitly unlocks a free chest once at zero balance', async () => {
  const user = await account();
  const before = await user.snapshot();
  expect(UserSnapshotSchema.parse(before)).toEqual(before);
  expect(before).toMatchObject({
    revision: 0,
    user: {id: user.id, coins: 0},
    userChests: [],
    sessions: [],
    items: [{itemId: 'creation-token', isVerified: true}],
  });
  expect(before.catalogue.chests.find(row => row.id === basic)?.price).toBe(0);
  expect(JSON.stringify(before)).not.toContain(user.subject);
  const readUserRow = () =>
    database.orm.select().from(users).where(eq(users.id, user.id));
  const original = await readUserRow();
  await repository.ensureUser(user.subject);
  expect(await readUserRow()).toEqual(original);
  const outcomes = await Promise.all([user.apply(buy()), user.apply(buy())]);
  expect(outcomes.map(row => row.status).sort()).toEqual([
    'accepted',
    'already_processed',
  ]);
  expect(await user.snapshot()).toMatchObject({
    revision: 1,
    user: {coins: 0},
    userChests: [{chestId: basic}],
  });
  await expect(sync.getSnapshot(randomUUID())).rejects.toThrow();
  await expect(sync.processOperation(randomUUID(), buy())).rejects.toThrow();
});

it('serializes competing purchases at the current price and balance', async () => {
  const user = await account();
  const first = await chest(8);
  const second = await chest(8);
  await database.orm
    .update(users)
    .set({coins: 10})
    .where(eq(users.id, user.id));
  const outcomes = await Promise.all([
    user.apply(buy(first)),
    user.apply(buy(second)),
  ]);
  expect(outcomes.map(row => row.status).sort()).toEqual([
    'accepted',
    'rejected',
  ]);
  expect(await user.snapshot()).toMatchObject({revision: 1, user: {coins: 2}});
  expect((await user.snapshot()).userChests).toHaveLength(1);
  expect(await user.apply(buy('missing'))).toMatchObject({
    status: 'rejected',
    retryable: false,
  });
});

it('serializes online starts, checks immutable inputs and origin, and cancels idempotently', async () => {
  const user = await account();
  const proposed = [start(), start()] as const;
  expect(await user.apply(proposed[0])).toMatchObject({status: 'rejected'});
  await user.apply(buy());
  expect(
    await user.apply({...proposed[0], plannedDurationSeconds: 901}),
  ).toMatchObject({status: 'rejected'});
  const outcomes = await Promise.all(proposed.map(op => user.apply(op)));
  expect(outcomes.map(row => row.status).sort()).toEqual([
    'accepted',
    'rejected',
  ]);
  const winner = outcomes[0]?.status === 'accepted' ? proposed[0] : proposed[1];
  expect(
    await user.apply({...winner, operationId: randomUUID()}),
  ).toMatchObject({status: 'already_processed', sessionId: winner.sessionId});
  expect(
    await user.apply({...winner, plannedDurationSeconds: 1200}),
  ).toMatchObject({status: 'rejected'});
  expect(
    await user.apply({...offline(), sessionId: winner.sessionId}),
  ).toMatchObject({status: 'rejected'});
  expect(await user.apply(claim(winner.sessionId))).toMatchObject({
    status: 'rejected',
    retryable: true,
  });
  expect(await user.apply(cancel(winner.sessionId))).toMatchObject({
    status: 'accepted',
  });
  expect(await user.apply(cancel(winner.sessionId))).toMatchObject({
    status: 'already_processed',
  });
  expect(await user.apply(claim(winner.sessionId))).toMatchObject({
    status: 'rejected',
    retryable: false,
  });
  const state = await user.snapshot();
  expect(state).toMatchObject({
    revision: 3,
    sessions: [{origin: 'online', status: 'cancelled'}],
  });
  expect(Date.parse(state.sessions[0]?.endedAt ?? '')).toBeGreaterThanOrEqual(
    Date.parse(state.sessions[0]?.startedAt ?? ''),
  );
});

it('uses server elapsed time, current chest access and current pool before granting exactly one verified reward', async () => {
  const user = await account();
  const id = await chest(0);
  await database.orm
    .insert(chestItems)
    .values({chestId: id, itemId: 'blue-gem'});
  await user.apply(buy(id));
  const op = start(id);
  expect(await user.apply(op)).toMatchObject({status: 'accepted'});
  await database.orm
    .update(focusSessions)
    .set({startedAt: sql`now() - interval '20 minutes'`})
    .where(eq(focusSessions.id, op.sessionId));
  await database.orm.delete(chestItems).where(eq(chestItems.chestId, id));
  expect(await user.apply(op)).toMatchObject({status: 'already_processed'});
  const request = claim(op.sessionId);
  expect(await user.apply(request)).toMatchObject({
    code: 'empty_reward_pool',
    status: 'rejected',
    retryable: false,
  });
  expect(await user.snapshot()).toMatchObject({
    revision: 2,
    sessions: [{id: op.sessionId, status: 'running', endedAt: null}],
    items: [{itemId: 'creation-token'}],
  });
  await database.orm
    .insert(chestItems)
    .values({chestId: id, itemId: 'blue-gem'});
  await database.orm
    .delete(userChests)
    .where(and(eq(userChests.userId, user.id), eq(userChests.chestId, id)));
  expect(await user.apply(request)).toMatchObject({
    status: 'rejected',
    retryable: false,
  });
  await user.apply(buy(id));
  const outcomes = await Promise.all([
    user.apply(request),
    user.apply(request),
  ]);
  expect(outcomes.map(row => row.status).sort()).toEqual([
    'accepted',
    'already_processed',
  ]);
  expect(outcomes[0].itemInstanceId).toBeTruthy();
  expect(outcomes[0].itemInstanceId).toBe(outcomes[1].itemInstanceId);
  const state = await user.snapshot();
  expect(state).toMatchObject({
    revision: 4,
    sessions: [{id: op.sessionId, status: 'completed'}],
  });
  expect(
    state.items.filter(row => row.sessionId === op.sessionId),
  ).toMatchObject([
    {itemId: 'blue-gem', isVerified: true, acquisitionSource: 'session_reward'},
  ]);
});

it('rejects an online start with an empty chest pool without mutation', async () => {
  const user = await account();
  const id = await chest(0);
  await user.apply(buy(id));
  const before = await user.snapshot();
  expect(await user.apply(start(id))).toMatchObject({
    status: 'rejected',
    code: 'empty_reward_pool',
    retryable: false,
  });
  expect(await user.snapshot()).toEqual(before);
});

it('rejects a short Mythic-only online start and accepts the chest at one hour', async () => {
  const user = await account();
  const id = await chest(0);
  await user.apply(buy(id));
  await database.orm
    .insert(chestItems)
    .values({chestId: id, itemId: mythicItemId});
  const short = start(id);
  const before = await user.snapshot();
  expect(await user.apply(short)).toMatchObject({
    status: 'rejected',
    code: 'empty_reward_pool',
    retryable: false,
  });
  expect(await user.snapshot()).toEqual(before);
  expect(
    await user.apply({...short, plannedDurationSeconds: 3600}),
  ).toMatchObject({status: 'accepted', sessionId: short.sessionId});
  expect(await user.snapshot()).toMatchObject({
    revision: 2,
    sessions: [
      {id: short.sessionId, plannedDurationSeconds: 3600, status: 'running'},
    ],
  });
});

it('keeps an elapsed short online session running if only Mythic rewards remain', async () => {
  const user = await account();
  const id = await chest(0);
  await database.orm.insert(chestItems).values([
    {chestId: id, itemId: 'rusty-key'},
    {chestId: id, itemId: mythicItemId},
  ]);
  await user.apply(buy(id));
  const op = start(id);
  expect(await user.apply(op)).toMatchObject({status: 'accepted'});
  await database.orm
    .update(focusSessions)
    .set({startedAt: sql`now() - interval '20 minutes'`})
    .where(eq(focusSessions.id, op.sessionId));
  await database.orm
    .delete(chestItems)
    .where(and(eq(chestItems.chestId, id), eq(chestItems.itemId, 'rusty-key')));
  const before = await user.snapshot();
  expect(await user.apply(claim(op.sessionId))).toMatchObject({
    status: 'rejected',
    code: 'empty_reward_pool',
    retryable: false,
  });
  expect(await user.snapshot()).toEqual(before);
  expect(before.sessions).toMatchObject([
    {id: op.sessionId, status: 'running'},
  ]);
});

it('rejects short offline Mythic claims without trusting claimed elapsed time', async () => {
  const user = await account();
  const id = await chest(0);
  await database.orm
    .insert(chestItems)
    .values({chestId: id, itemId: mythicItemId});
  await user.apply(buy(id));
  const short = {
    ...offline(id),
    itemId: mythicItemId,
    endedAt: '2026-01-01T14:00:00.000Z',
  };
  const before = await user.snapshot();
  expect(await user.apply(short)).toMatchObject({
    status: 'rejected',
    code: 'ineligible_item',
    retryable: false,
  });
  expect(await user.snapshot()).toEqual(before);
});

it('accepts an hour-long offline Mythic claim as unverified and retries after eligibility is removed', async () => {
  const user = await account();
  const id = await chest(0);
  await database.orm
    .insert(chestItems)
    .values({chestId: id, itemId: mythicItemId});
  await user.apply(buy(id));
  const op = {
    ...offline(id),
    itemId: mythicItemId,
    plannedDurationSeconds: 3600,
  };
  const result = {sessionId: op.sessionId, itemInstanceId: op.itemInstanceId};
  expect(await user.apply(op)).toMatchObject({
    ...result,
    status: 'accepted_unverified',
  });
  const after = await user.snapshot();
  expect(after).toMatchObject({
    revision: 2,
    sessions: [
      {
        id: op.sessionId,
        origin: 'offline',
        status: 'completed',
        plannedDurationSeconds: 3600,
        startedAt: op.startedAt,
        endedAt: op.endedAt,
      },
    ],
  });
  expect(after.items.find(row => row.id === op.itemInstanceId)).toMatchObject({
    itemId: mythicItemId,
    acquisitionSource: 'offline_claim',
    isVerified: false,
  });
  await database.orm.delete(chestItems).where(eq(chestItems.chestId, id));
  expect(await user.apply(op)).toMatchObject({
    ...result,
    status: 'already_processed',
  });
  expect((await user.snapshot()).revision).toBe(2);
});

it('checks current offline eligibility and exactly deduplicates accepted offline payloads without upgrading trust', async () => {
  const user = await account();
  const op = offline();
  expect(await user.apply(op)).toMatchObject({status: 'rejected'});
  await user.apply(buy());
  expect(await user.apply({...op, itemId: 'red-gem'})).toMatchObject({
    status: 'rejected',
  });
  expect(await user.apply({...op, plannedDurationSeconds: 0})).toMatchObject({
    status: 'rejected',
  });
  expect(
    await user.apply({...op, startedAt: '2026-01-01T12:00:00.123001Z'}),
  ).toMatchObject({status: 'rejected'});
  const outcomes = await Promise.all([user.apply(op), user.apply(op)]);
  expect(outcomes.map(row => row.status).sort()).toEqual([
    'accepted_unverified',
    'already_processed',
  ]);
  for (const conflicting of [
    {...op, chestId: 'other'},
    {...op, plannedDurationSeconds: 1200},
    {...op, itemId: 'copper-ring'},
    {...op, itemInstanceId: randomUUID()},
    {...op, sessionId: randomUUID()},
    {...op, startedAt: '2026-01-01T12:00:00.124Z'},
    {...op, endedAt: '2026-01-01T12:15:00.124Z'},
    {...start(), sessionId: op.sessionId},
    claim(op.sessionId),
    cancel(op.sessionId),
  ])
    expect(await user.apply(conflicting)).toMatchObject({
      status: 'rejected',
      retryable: false,
    });
  const state = await user.snapshot();
  expect(state).toMatchObject({
    revision: 2,
    sessions: [
      {
        id: op.sessionId,
        origin: 'offline',
        status: 'completed',
        startedAt: op.startedAt,
        endedAt: op.endedAt,
      },
    ],
  });
  expect(state.items.filter(row => row.id === op.itemInstanceId)).toMatchObject(
    [
      {
        sessionId: op.sessionId,
        itemId: op.itemId,
        acquisitionSource: 'offline_claim',
        isVerified: false,
      },
    ],
  );
});

it('retains first-century timestamps and rejects retries from a different century', async () => {
  const user = await account();
  await user.apply(buy());
  const early = {
    ...offline(),
    startedAt: '0001-05-01T12:00:00.123Z',
    endedAt: '0001-05-01T12:15:00.123Z',
  };
  expect(await user.apply(early)).toMatchObject({
    status: 'accepted_unverified',
  });
  expect((await user.snapshot()).sessions).toMatchObject([
    {startedAt: early.startedAt, endedAt: early.endedAt},
  ]);
  expect(await user.apply(early)).toMatchObject({status: 'already_processed'});
  expect(
    await user.apply({
      ...early,
      startedAt: '2001-05-01T12:00:00.123Z',
      endedAt: '2001-05-01T12:15:00.123Z',
    }),
  ).toMatchObject({status: 'rejected'});
  expect((await user.snapshot()).revision).toBe(2);
});

it('records a client clock adjustment without treating the offline reward as verified', async () => {
  const user = await account();
  await user.apply(buy());
  const adjusted = {...offline(), endedAt: '2026-01-01T11:59:00.000Z'};
  expect(await user.apply(adjusted)).toMatchObject({
    status: 'accepted_unverified',
  });
  const state = await user.snapshot();
  expect(state.sessions).toMatchObject([
    {startedAt: adjusted.startedAt, endedAt: adjusted.endedAt},
  ]);
  expect(
    state.items.find(row => row.id === adjusted.itemInstanceId),
  ).toMatchObject({acquisitionSource: 'offline_claim', isVerified: false});
});

it('resolves cross-user session and item collisions without disclosing or partially inserting foreign records', async () => {
  const first = await account();
  const second = await account();
  await Promise.all([first.apply(buy()), second.apply(buy())]);
  const op = offline();
  const results = await Promise.all([first.apply(op), second.apply(op)]);
  expect(results.map(row => row.status).sort()).toEqual([
    'accepted_unverified',
    'rejected',
  ]);
  const other = results[0].status === 'rejected' ? first : second;
  for (const conflict of [
    claim(op.sessionId),
    cancel(op.sessionId),
    {...start(), sessionId: op.sessionId},
    {...op, sessionId: randomUUID()},
  ]) {
    const outcome = await other.apply(conflict);
    expect(outcome).toMatchObject({status: 'rejected', retryable: false});
    expect(outcome.itemInstanceId).toBeUndefined();
  }
  expect(await other.snapshot()).toMatchObject({
    revision: 1,
    sessions: [],
    items: [{acquisitionSource: 'account_creation'}],
  });
});

it('rolls back an entire operation on revision overflow and accepts a clean retry', async () => {
  const user = await account();
  await database.orm
    .update(users)
    .set({revision: Number.MAX_SAFE_INTEGER, coins: 10})
    .where(eq(users.id, user.id));
  const id = await chest(3);
  await expect(user.apply(buy(id))).rejects.toThrow();
  expect(await user.snapshot()).toMatchObject({
    revision: Number.MAX_SAFE_INTEGER,
    user: {coins: 10},
    userChests: [],
  });
  await expect(
    database.orm.update(users).set({revision: -1}).where(eq(users.id, user.id)),
  ).rejects.toThrow();
  await database.orm
    .update(users)
    .set({revision: 0})
    .where(eq(users.id, user.id));
  expect(await user.apply(buy(id))).toMatchObject({status: 'accepted'});
  expect(await user.snapshot()).toMatchObject({
    revision: 1,
    user: {coins: 7},
    userChests: [{chestId: id}],
  });
});

it('keeps the old revision and unlocks when a purchase commits in the middle of a snapshot', async () => {
  const user = await account();
  const {pending} = await database.orm.transaction(async writer => {
    // Pause the snapshot on its unlock query after it has already read the revision.
    await writer.execute(sql`lock table user_chests in access exclusive mode`);
    const pending = user.snapshot();
    await expect
      .poll(async () => {
        const {rows} = await writer.execute(sql`
        select exists (select from pg_locks where not granted
          and relation = 'user_chests'::regclass and mode = 'AccessShareLock') as waiting
      `);
        return rows[0]?.['waiting'];
      })
      .toBe(true);
    await writer.insert(userChests).values({userId: user.id, chestId: basic});
    await writer.update(users).set({revision: 1}).where(eq(users.id, user.id));
    return {pending};
  });
  expect(await pending).toMatchObject({revision: 0, userChests: []});
  expect(await user.snapshot()).toMatchObject({
    revision: 1,
    userChests: [{chestId: basic}],
  });
});

it('hashes public catalogue prices, eligibility and weights deterministically, independently of user revisions', async () => {
  const user = await account();
  const id = await chest(2);
  const version = async () => (await user.snapshot()).catalogueVersion;
  const initial = await version();
  expect(initial).toMatch(/^[a-f0-9]{64}$/);
  await database.orm
    .update(chests)
    .set({updatedAt: new Date()})
    .where(eq(chests.id, id));
  expect(await version()).toBe(initial);
  await database.orm.update(chests).set({price: 3}).where(eq(chests.id, id));
  const repriced = await version();
  expect(repriced).not.toBe(initial);
  await database.orm
    .insert(chestItems)
    .values({chestId: id, itemId: 'blue-gem', weight: 1});
  const eligible = await version();
  expect(eligible).not.toBe(repriced);
  await database.orm
    .update(chestItems)
    .set({weight: 2})
    .where(eq(chestItems.chestId, id));
  expect(await version()).not.toBe(eligible);
  expect((await user.snapshot()).revision).toBe(0);
});
