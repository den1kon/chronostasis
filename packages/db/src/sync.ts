import {randomInt} from 'node:crypto';
import {
  isRarityEligibleForDuration,
  selectChestReward,
  SyncOperationSchema,
} from '@chronostasis/contracts';
import type {
  OperationOutcome,
  SyncOperation,
  UserSnapshot,
} from '@chronostasis/contracts';
import {and, eq, sql} from 'drizzle-orm';
import type {Database} from './client.js';
import {
  chestItems,
  chests,
  focusSessions,
  items,
  userChests,
  userItems,
  users,
} from './schema.js';
import {publicSessionFields, readUserSnapshot} from './snapshot.js';

type Transaction = Parameters<Parameters<Database['orm']['transaction']>[0]>[0];
type Session = UserSnapshot['sessions'][number];
type User = Pick<typeof users.$inferSelect, 'id' | 'coins'>;
type Operation<T extends SyncOperation['type']> = Extract<
  SyncOperation,
  {type: T}
>;
type Result = Pick<OperationOutcome, 'status' | 'sessionId' | 'itemInstanceId'>;

// Convert only known business failures to outcomes after the transaction rolls back.
class OperationRejected extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}

function sessionConflict(): never {
  throw new OperationRejected(
    'session_conflict',
    'The session is unavailable for this operation.',
  );
}

async function hasAccess(tx: Transaction, userId: string, chestId: string) {
  const [unlock] = await tx
    .select({id: userChests.chestId})
    .from(userChests)
    .where(and(eq(userChests.userId, userId), eq(userChests.chestId, chestId)))
    .for('share');
  return Boolean(unlock);
}

async function requireAccess(tx: Transaction, userId: string, chestId: string) {
  if (!(await hasAccess(tx, userId, chestId)))
    throw new OperationRejected('chest_locked', 'Unlock this chest first.');
}

// Lock the catalogue rows so the pool used by the operation stays valid until commit.
async function requireRewardPool(
  tx: Transaction,
  chestId: string,
  plannedDurationSeconds: number,
) {
  const candidates = await tx
    .select({
      itemId: chestItems.itemId,
      rarity: items.rarity,
      weight: chestItems.weight,
    })
    .from(chestItems)
    .innerJoin(items, eq(chestItems.itemId, items.id))
    .where(eq(chestItems.chestId, chestId))
    .orderBy(chestItems.itemId)
    .for('share');
  const eligible = candidates.filter(({rarity}) =>
    isRarityEligibleForDuration(rarity, plannedDurationSeconds),
  );
  if (eligible.length === 0)
    throw new OperationRejected(
      'empty_reward_pool',
      'This chest has no eligible rewards for this duration.',
    );
  return eligible;
}

async function buyChest(
  tx: Transaction,
  user: User,
  chestId: string,
): Promise<Result> {
  if (await hasAccess(tx, user.id, chestId))
    return {status: 'already_processed'};
  const [chest] = await tx
    .select({price: chests.price})
    .from(chests)
    .where(eq(chests.id, chestId))
    .for('share');
  if (!chest)
    throw new OperationRejected('unknown_chest', 'This chest is unavailable.');
  if (user.coins < chest.price)
    throw new OperationRejected(
      'insufficient_coins',
      'You need more coins to unlock this chest.',
    );
  if (chest.price > 0)
    await tx
      .update(users)
      .set({coins: user.coins - chest.price})
      .where(eq(users.id, user.id));
  await tx.insert(userChests).values({userId: user.id, chestId});
  return {status: 'accepted'};
}

async function startSession(
  tx: Transaction,
  userId: string,
  op: Operation<'start_session'>,
  session?: Session,
): Promise<Result> {
  if (session) {
    if (
      session.origin !== 'online' ||
      session.chestId !== op.chestId ||
      session.plannedDurationSeconds !== op.plannedDurationSeconds
    )
      sessionConflict();
    return {status: 'already_processed', sessionId: session.id};
  }
  await requireAccess(tx, userId, op.chestId);
  await requireRewardPool(tx, op.chestId, op.plannedDurationSeconds);
  // The partial unique index arbitrates other running online sessions, and the PK protects each proposed ID.
  const [created] = await tx
    .insert(focusSessions)
    .values({
      id: op.sessionId,
      userId,
      chestId: op.chestId,
      plannedDurationSeconds: op.plannedDurationSeconds,
      origin: 'online',
      status: 'running',
      startedAt: sql`clock_timestamp()`,
    })
    .onConflictDoNothing()
    .returning({id: focusSessions.id});
  if (!created) sessionConflict();
  return {status: 'accepted', sessionId: created.id};
}

async function finishSession(
  tx: Transaction,
  userId: string,
  session: Session,
  status: 'completed' | 'cancelled',
) {
  await tx
    .update(focusSessions)
    .set({
      status,
      endedAt: sql`clock_timestamp()`,
      updatedAt: sql`clock_timestamp()`,
    })
    .where(
      and(eq(focusSessions.id, session.id), eq(focusSessions.userId, userId)),
    );
}

async function cancelSession(
  tx: Transaction,
  userId: string,
  session?: Session,
): Promise<Result> {
  if (session?.origin !== 'online' || session.status === 'completed')
    sessionConflict();
  if (session.status === 'cancelled')
    return {status: 'already_processed', sessionId: session.id};
  await finishSession(tx, userId, session, 'cancelled');
  return {status: 'accepted', sessionId: session.id};
}

async function claimReward(
  tx: Transaction,
  userId: string,
  session?: Session,
): Promise<Result> {
  if (session?.origin !== 'online' || session.status === 'cancelled')
    sessionConflict();
  if (session.status === 'completed') {
    const [copy] = await tx
      .select({id: userItems.id})
      .from(userItems)
      .where(
        and(
          eq(userItems.userId, userId),
          eq(userItems.sessionId, session.id),
          eq(userItems.acquisitionSource, 'session_reward'),
          eq(userItems.isVerified, true),
        ),
      )
      .orderBy(userItems.id)
      .limit(1);
    if (!copy) sessionConflict();
    return {
      status: 'already_processed',
      sessionId: session.id,
      itemInstanceId: copy.id,
    };
  }
  await requireAccess(tx, userId, session.chestId);
  // Compare inside PostgreSQL to preserve the server-recorded start's full precision.
  const [elapsed] = await tx
    .select({
      ready: sql<boolean>`clock_timestamp() >= ${focusSessions.startedAt} + ${focusSessions.plannedDurationSeconds} * interval '1 second'`,
    })
    .from(focusSessions)
    .where(eq(focusSessions.id, session.id));
  if (!elapsed?.ready)
    throw new OperationRejected(
      'session_too_early',
      'The session timer is still running.',
      true,
    );
  const candidates = await requireRewardPool(
    tx,
    session.chestId,
    session.plannedDurationSeconds,
  );
  const itemId = selectChestReward(
    candidates,
    session.plannedDurationSeconds,
    randomInt,
  );
  const [copy] = await tx
    .insert(userItems)
    .values({
      userId,
      sessionId: session.id,
      itemId,
      acquisitionSource: 'session_reward',
      isVerified: true,
    })
    .returning({id: userItems.id});
  if (!copy) throw new Error('Missing reward insert result.');
  await finishSession(tx, userId, session, 'completed');
  return {status: 'accepted', sessionId: session.id, itemInstanceId: copy.id};
}

async function offlineClaim(
  tx: Transaction,
  userId: string,
  op: Operation<'offline_session_claim'>,
  session?: Session,
): Promise<Result> {
  const startedAt = new Date(op.startedAt);
  const endedAt = new Date(op.endedAt);
  if (session) {
    if (
      session.origin !== 'offline' ||
      session.status !== 'completed' ||
      session.chestId !== op.chestId ||
      session.plannedDurationSeconds !== op.plannedDurationSeconds ||
      session.startedAt !== startedAt.toISOString() ||
      session.endedAt !== endedAt.toISOString()
    )
      sessionConflict();
    const [copy] = await tx
      .select({id: userItems.id})
      .from(userItems)
      .where(
        and(
          eq(userItems.userId, userId),
          eq(userItems.sessionId, session.id),
          eq(userItems.id, op.itemInstanceId),
          eq(userItems.itemId, op.itemId),
          eq(userItems.acquisitionSource, 'offline_claim'),
          eq(userItems.isVerified, false),
        ),
      );
    if (!copy) sessionConflict();
    return {
      status: 'already_processed',
      sessionId: session.id,
      itemInstanceId: copy.id,
    };
  }
  await requireAccess(tx, userId, op.chestId);
  const [candidate] = await tx
    .select({rarity: items.rarity})
    .from(chestItems)
    .innerJoin(items, eq(chestItems.itemId, items.id))
    .where(
      and(eq(chestItems.chestId, op.chestId), eq(chestItems.itemId, op.itemId)),
    )
    .for('share');
  if (!candidate)
    throw new OperationRejected(
      'ineligible_item',
      'This item is unavailable in this chest.',
    );
  if (!isRarityEligibleForDuration(candidate.rarity, op.plannedDurationSeconds))
    throw new OperationRejected(
      'ineligible_item',
      'Mythic rewards require at least 1 hour.',
    );
  const [created] = await tx
    .insert(focusSessions)
    .values({
      id: op.sessionId,
      userId,
      chestId: op.chestId,
      origin: 'offline',
      status: 'completed',
      plannedDurationSeconds: op.plannedDurationSeconds,
      startedAt,
      endedAt,
    })
    .onConflictDoNothing()
    .returning({id: focusSessions.id});
  if (!created) sessionConflict();
  const [copy] = await tx
    .insert(userItems)
    .values({
      id: op.itemInstanceId,
      userId,
      sessionId: created.id,
      itemId: op.itemId,
      acquisitionSource: 'offline_claim',
      isVerified: false,
    })
    .onConflictDoNothing()
    .returning({id: userItems.id});
  if (!copy)
    throw new OperationRejected(
      'item_conflict',
      'This item copy is unavailable for this claim.',
    );
  return {
    status: 'accepted_unverified',
    sessionId: created.id,
    itemInstanceId: copy.id,
  };
}

async function applyOperation(
  tx: Transaction,
  user: User,
  op: SyncOperation,
): Promise<Result> {
  if (!SyncOperationSchema.safeParse(op).success)
    throw new OperationRejected('invalid_operation', 'Invalid sync operation.');
  if (op.type === 'buy_chest') return buyChest(tx, user, op.chestId);
  const [session] = await tx
    .select(publicSessionFields)
    .from(focusSessions)
    .where(
      and(
        eq(focusSessions.id, op.sessionId),
        eq(focusSessions.userId, user.id),
      ),
    )
    .for('update');
  switch (op.type) {
    case 'start_session':
      return startSession(tx, user.id, op, session);
    case 'claim_reward':
      return claimReward(tx, user.id, session);
    case 'cancel_session':
      return cancelSession(tx, user.id, session);
    case 'offline_session_claim':
      return offlineClaim(tx, user.id, op, session);
  }
}

export function createSyncRepository(database: Database) {
  return {
    getSnapshot: (clerkUserId: string) =>
      readUserSnapshot(database, clerkUserId),
    async processOperation(
      clerkUserId: string,
      op: SyncOperation,
    ): Promise<OperationOutcome> {
      const identity = {operationId: op.operationId, type: op.type};
      try {
        return await database.orm.transaction(async tx => {
          // All devices take this lock before any session lock, balance check or revision update.
          const [user] = await tx
            .select({id: users.id, coins: users.coins})
            .from(users)
            .where(eq(users.clerkUserId, clerkUserId))
            .for('update');
          if (!user) throw new Error('User initialization required.');
          const result = await applyOperation(tx, user, op);
          if (
            result.status === 'accepted' ||
            result.status === 'accepted_unverified'
          ) {
            await tx
              .update(users)
              .set({
                revision: sql`${users.revision} + 1`,
                updatedAt: sql`clock_timestamp()`,
              })
              .where(eq(users.id, user.id));
          }
          return {...identity, ...result, retryable: false};
        });
      } catch (error) {
        if (!(error instanceof OperationRejected)) throw error;
        return {
          ...identity,
          status: 'rejected',
          code: error.code,
          message: error.message,
          retryable: error.retryable,
        };
      }
    },
  };
}
