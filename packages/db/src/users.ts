import type {PublicUser} from '@chronostasis/contracts';
import {eq} from 'drizzle-orm';
import type {Database} from './client.js';
import {userItems, users} from './schema.js';
import {creationTokenId} from './seeding.js';

function requireIdentity(clerkUserId: string): void {
  if (!clerkUserId.trim()) throw new Error('Clerk user ID is required.');
}

export function createUserRepository(database: Database) {
  const publicFields = {id: users.id, clerkUserId: users.clerkUserId};
  async function findUser(clerkUserId: string): Promise<PublicUser | null> {
    requireIdentity(clerkUserId);
    const [user] = await database.orm
      .select(publicFields)
      .from(users)
      .where(eq(users.clerkUserId, clerkUserId));
    return user ?? null;
  }
  return {
    findUser,
    // Grant the creation token in the same transaction as the new application user.
    async ensureUser(clerkUserId: string): Promise<PublicUser> {
      const initialized = await findUser(clerkUserId);
      if (initialized) return initialized;
      return database.orm.transaction(async transaction => {
        const [newUser] = await transaction
          .insert(users)
          .values({clerkUserId})
          .onConflictDoNothing({target: users.clerkUserId})
          .returning(publicFields);

        if (newUser) {
          await transaction.insert(userItems).values({
            userId: newUser.id,
            itemId: creationTokenId,
            sessionId: null,
            acquisitionSource: 'account_creation',
            isVerified: true,
          });
          return newUser;
        }

        const [existingUser] = await transaction
          .select(publicFields)
          .from(users)
          .where(eq(users.clerkUserId, clerkUserId));
        if (!existingUser)
          throw new Error('User initialization returned no row.');
        return existingUser;
      });
    },
  };
}
