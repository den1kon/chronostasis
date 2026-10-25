import type {PublicUser} from '@chronostasis/contracts';
import {eq, sql} from 'drizzle-orm';
import type {Database} from './client';
import {users} from './schema';

function requireIdentity(clerkUserId: string): void {
  if (!clerkUserId.trim()) throw new Error('Clerk user ID is required.');
}

export function createUserRepository(database: Database) {
  const publicFields = {id: users.id, clerkUserId: users.clerkUserId};
  return {
    async ensureUser(clerkUserId: string): Promise<PublicUser> {
      requireIdentity(clerkUserId);
      const [user] = await database.orm
        .insert(users)
        .values({clerkUserId})
        .onConflictDoUpdate({
          target: users.clerkUserId,
          set: {updatedAt: sql`now()`},
        })
        .returning(publicFields);
      if (!user) throw new Error('User initialization returned no row.');
      return user;
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
