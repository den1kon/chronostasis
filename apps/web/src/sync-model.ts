import {
  MAX_SYNC_OPERATIONS,
  type SyncOperation,
  type UserSnapshot,
} from '@chronostasis/contracts';

export type ProjectedItem = UserSnapshot['items'][number] & {pending: boolean};

// Both the display and offline completion count device sleep against this saved wall-clock deadline.
export function sessionDeadlineMs(
  session: Pick<
    UserSnapshot['sessions'][number],
    'startedAt' | 'plannedDurationSeconds'
  >,
) {
  return Date.parse(session.startedAt) + session.plannedDurationSeconds * 1000;
}

// Count the exact UTF-8 envelope and separators used by postSyncOperations.
export function batchOperations(
  operations: readonly SyncOperation[],
): SyncOperation[][] {
  const encoder = new TextEncoder();
  const limit = 64 * 1024;
  const overhead = encoder.encode(JSON.stringify({operations: []})).length;
  const batches: SyncOperation[][] = [];
  let batch: SyncOperation[] = [];
  let bytes = overhead;
  for (const operation of operations) {
    const size = encoder.encode(JSON.stringify(operation)).length;
    if (overhead + size >= limit)
      throw new Error('This operation exceeds the sync request size limit.');
    if (
      batch.length === MAX_SYNC_OPERATIONS ||
      bytes + size + Number(batch.length > 0) >= limit
    ) {
      batches.push(batch);
      batch = [];
      bytes = overhead;
    }
    bytes += size + Number(batch.length > 0);
    batch.push(operation);
  }
  if (batch.length) batches.push(batch);
  return batches;
}

// Replay only client-owned provisional effects, skipping purchases and copies already present in a newer snapshot.
export function projectSnapshot(
  snapshot: UserSnapshot,
  pending: readonly SyncOperation[],
) {
  let coins = snapshot.user.coins;
  const unlocked = new Set(snapshot.userChests.map(entry => entry.chestId));
  const items: ProjectedItem[] = snapshot.items.map(item => ({
    ...item,
    pending: false,
  }));
  const owned = new Set(items.map(item => item.id));
  for (const op of pending) {
    if (op.type === 'buy_chest' && !unlocked.has(op.chestId)) {
      const chest = snapshot.catalogue.chests.find(
        entry => entry.id === op.chestId,
      );
      if (chest && chest.price <= coins) {
        coins -= chest.price;
        unlocked.add(chest.id);
      }
    }
    if (op.type === 'offline_session_claim' && !owned.has(op.itemInstanceId)) {
      items.push({
        id: op.itemInstanceId,
        itemId: op.itemId,
        sessionId: op.sessionId,
        acquisitionSource: 'offline_claim',
        isVerified: false,
        receivedAt: op.endedAt,
        pending: true,
      });
      owned.add(op.itemInstanceId);
    }
  }
  return {coins, unlockedChestIds: [...unlocked], items};
}
