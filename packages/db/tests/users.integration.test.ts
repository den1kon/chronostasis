import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { PublicUserSchema } from '@chronostasis/contracts';
import { createDatabase } from '../src/client';
import { readTestDatabaseUrl } from '../src/env';
import { migrateDatabase } from '../src/migrations';
import { items, users } from '../src/schema';
import { seedCatalogue } from '../src/seeding';
import { createUserRepository } from '../src/users';

// Validate before creating a connection. No reset, truncate, or database drop.
const database = createDatabase(readTestDatabaseUrl(process.env));
const repository = createUserRepository(database);
const createdSubjects: string[] = [];
function subject() {
  const id = `integration-${randomUUID()}`;
  createdSubjects.push(id);
  return id;
}

beforeAll(async () => { await migrateDatabase(database); });
afterAll(async () => {
  try {
    for (const id of createdSubjects) await database.orm.delete(users).where(eq(users.clerkUserId, id));
  } finally { await database.close(); }
});

describe('real Postgres persistence', () => {
  it('creates a user and returns the same persisted row on retry', async () => {
    const id = subject();
    const first = await repository.ensureUser(id);
    const second = await repository.ensureUser(id);
    expect(PublicUserSchema.safeParse(first).success).toBe(true);
    expect(first.clerkUserId).toBe(id);
    expect(second).toEqual(first);
    expect(await repository.findUser(id)).toEqual(first);
    const rows = await database.orm.select().from(users).where(eq(users.clerkUserId, id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.createdAt).toBeInstanceOf(Date);
    expect(rows[0]?.updatedAt).toBeInstanceOf(Date);
  });
  it('creates exactly one row under concurrent initialization', async () => {
    const id = subject();
    const results = await Promise.all(Array.from({ length: 12 }, () => repository.ensureUser(id)));
    expect(new Set(results.map((user) => user.id)).size).toBe(1);
    expect(await database.orm.select().from(users).where(eq(users.clerkUserId, id))).toHaveLength(1);
  });
  it('keeps different Clerk subjects separate', async () => {
    const first = await repository.ensureUser(subject());
    const second = await repository.ensureUser(subject());
    expect(first.id).not.toBe(second.id);
    expect(await repository.findUser(subject())).toBeNull();
    expect(await repository.findUser(second.clerkUserId)).toEqual(second);
  });
  it('does not duplicate data when migrations and seeds run twice', async () => {
    await migrateDatabase(database);
    await seedCatalogue(database);
    await migrateDatabase(database);
    await seedCatalogue(database);
    expect(await database.orm.select().from(items).orderBy(items.id)).toEqual([
      { id: 'blue-gem', name: 'Blue gem' },
      { id: 'copper-ring', name: 'Copper ring' },
      { id: 'rusty-key', name: 'Rusty key' },
    ]);
  });
  it('rejects an empty identity instead of persisting an unusable user', async () => {
    await expect(repository.ensureUser('   ')).rejects.toThrow('Clerk user ID');
    await expect(repository.findUser('')).rejects.toThrow('Clerk user ID');
  });
  it('reports connectivity through a real query', async () => {
    await expect(database.probe()).resolves.toBeUndefined();
  });
});
