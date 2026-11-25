import {createHash} from 'node:crypto';
import {UserSnapshotSchema} from '@chronostasis/contracts';
import type {UserSnapshot} from '@chronostasis/contracts';
import {eq, sql} from 'drizzle-orm';
import type {AnyPgColumn} from 'drizzle-orm/pg-core';
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

// Format in PostgreSQL so JavaScript never ambiguously parses a space-separated first-century date.
function utcTimestamp<T extends AnyPgColumn<{dataType: 'date'}>>(column: T) {
  return sql<
    T['_']['notNull'] extends true ? string : string | null
  >`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
}

export const publicSessionFields = {
  id: focusSessions.id,
  chestId: focusSessions.chestId,
  origin: focusSessions.origin,
  status: focusSessions.status,
  plannedDurationSeconds: focusSessions.plannedDurationSeconds,
  startedAt: utcTimestamp(focusSessions.startedAt),
  endedAt: utcTimestamp(focusSessions.endedAt),
};

// Every query, including the catalogue hash inputs, observes the same committed revision.
export function readUserSnapshot(
  database: Database,
  clerkUserId: string,
): Promise<UserSnapshot> {
  return database.orm.transaction(
    async tx => {
      const [user] = await tx
        .select({id: users.id, coins: users.coins, revision: users.revision})
        .from(users)
        .where(eq(users.clerkUserId, clerkUserId));
      if (!user) throw new Error('User initialization required.');
      const catalogue = UserSnapshotSchema.shape.catalogue.parse({
        items: await tx
          .select({
            id: items.id,
            name: items.name,
            description: items.description,
            stats: items.stats,
            rarity: items.rarity,
            spriteX: items.spriteX,
            spriteY: items.spriteY,
          })
          .from(items)
          .orderBy(items.id),
        chests: await tx
          .select({
            id: chests.id,
            name: chests.name,
            description: chests.description,
            price: chests.price,
            spriteX: chests.spriteX,
            spriteY: chests.spriteY,
          })
          .from(chests)
          .orderBy(chests.id),
        chestItems: await tx
          .select({
            chestId: chestItems.chestId,
            itemId: chestItems.itemId,
            weight: chestItems.weight,
          })
          .from(chestItems)
          .orderBy(chestItems.chestId, chestItems.itemId),
      });
      const unlocks = await tx
        .select({
          chestId: userChests.chestId,
          unlockedAt: utcTimestamp(userChests.unlockedAt),
        })
        .from(userChests)
        .where(eq(userChests.userId, user.id))
        .orderBy(userChests.chestId);
      const inventory = await tx
        .select({
          id: userItems.id,
          itemId: userItems.itemId,
          sessionId: userItems.sessionId,
          acquisitionSource: userItems.acquisitionSource,
          isVerified: userItems.isVerified,
          receivedAt: utcTimestamp(userItems.receivedAt),
        })
        .from(userItems)
        .where(eq(userItems.userId, user.id))
        .orderBy(userItems.id);
      const sessions = await tx
        .select(publicSessionFields)
        .from(focusSessions)
        .where(eq(focusSessions.userId, user.id))
        .orderBy(focusSessions.id);
      return {
        revision: user.revision,
        catalogueVersion: createHash('sha256')
          .update(JSON.stringify(catalogue))
          .digest('hex'),
        user: {id: user.id, coins: user.coins},
        catalogue,
        userChests: unlocks,
        items: inventory,
        sessions,
      };
    },
    {isolationLevel: 'repeatable read', accessMode: 'read only'},
  );
}
