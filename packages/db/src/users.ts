import type {PublicUser} from '@chronostasis/contracts';
import {eq, sql} from 'drizzle-orm';
import type {Database} from './client.js';
import {userItems, users} from './schema.js';

function requireIdentity(clerkUserId: string): void {
  if (!clerkUserId.trim()) throw new Error('Clerk user ID is required.');
}

export function createUserRepository(database: Database) {
  const publicFields = {id: users.id, clerkUserId: users.clerkUserId};
  return {
    // Award the welcome copy atomically, only when the application user is new.
    async ensureUser(clerkUserId: string): Promise<PublicUser> {
      requireIdentity(clerkUserId);
      return database.orm.transaction(async transaction => {
        const [newUser] = await transaction
          .insert(users)
          .values({clerkUserId})
          .onConflictDoNothing({target: users.clerkUserId})
          .returning(publicFields);

        if (newUser) {
          await transaction.insert(userItems).values({
            userId: newUser.id,
            itemId: 'red-gem',
          });
          return newUser;
        }

        const [existingUser] = await transaction
          .update(users)
          .set({updatedAt: sql`now()`})
          .where(eq(users.clerkUserId, clerkUserId))
          .returning(publicFields);
        if (!existingUser)
          throw new Error('User initialization returned no row.');
        return existingUser;
      });
    },
    async findUser(clerkUserId: string): Promise<PublicUser | null> {
      requireIdentity(clerkUserId);
      const [user] = await database.orm
        .select(publicFields)
        .from(users)
        .where(eq(users.clerkUserId, clerkUserId))
        .limit(1);
      return user ?? null;
    },
  };
}
