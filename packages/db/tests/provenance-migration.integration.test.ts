import {execFile} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {expect, it} from 'vitest';
import {sql} from 'drizzle-orm';
import {migrate} from 'drizzle-orm/node-postgres/migrator';
import {createDatabase} from '../src/client';
import {readTestDatabaseUrl} from '../src/env';
import {migrateDatabase} from '../src/migrations';
import {prepareDatabase} from '../src/preparation';
import {createUserRepository} from '../src/users';

const run = promisify(execFile);

it('guards the provenance upgrade, backfills welcome copies, and supports legacy account writes', async () => {
  const testUrl = readTestDatabaseUrl(process.env);
  const admin = createDatabase(testUrl);
  const name = `chr24_migration_${randomUUID().replaceAll('-', '')}`;
  const databaseName = sql.identifier(name);
  const isolatedUrl = new URL(testUrl);
  isolatedUrl.pathname = `/${name}`;
  const existingMigrations = await mkdtemp(join(tmpdir(), 'chr24-migrations-'));

  try {
    await admin.orm.execute(sql`create database ${databaseName}`);
    const database = createDatabase(isolatedUrl.toString());

    try {
      const migrations = fileURLToPath(new URL('../drizzle/', import.meta.url));
      const journal = JSON.parse(
        await readFile(join(migrations, 'meta', '_journal.json'), 'utf8'),
      ) as {entries: {idx: number; tag: string}[]};
      journal.entries = journal.entries.filter(entry => entry.idx <= 5);
      await mkdir(join(existingMigrations, 'meta'));
      await writeFile(
        join(existingMigrations, 'meta', '_journal.json'),
        JSON.stringify(journal),
      );
      for (const {tag} of journal.entries) {
        await copyFile(
          join(migrations, `${tag}.sql`),
          join(existingMigrations, `${tag}.sql`),
        );
      }
      await migrate(database.orm, {migrationsFolder: existingMigrations});
      await database.orm.execute(sql`
        insert into items (id, name, rarity, sprite_x, sprite_y)
        values ('red-gem', 'Red gem', 'common', 3, 0),
               ('rusty-key', 'Rusty key', 'common', 0, 0)
      `);

      const userId = randomUUID();
      const itemId = randomUUID();
      await database.orm.execute(sql`
        insert into users (id, clerk_user_id) values (${userId}, ${userId})
      `);
      await database.orm.execute(sql`
        insert into user_items (id, user_id, item_id)
        values (${itemId}, ${userId}, 'red-gem')
      `);
      await database.orm.execute(sql`
        insert into focus_sessions (user_id, status, planned_duration_seconds, started_at)
        values (${userId}, 'running', 1500, now())
      `);

      const blocked = 'CHR-24 requires an empty focus_sessions table.';
      await expect(prepareDatabase(isolatedUrl.toString())).rejects.toThrow(
        blocked,
      );
      await expect(
        run('pnpm', ['--filter', '@chronostasis/db', 'db:migrate'], {
          env: {
            ...process.env,
            DATABASE_URL: isolatedUrl.toString(),
            MIGRATION_DATABASE_URL: isolatedUrl.toString(),
          },
        }),
      ).rejects.toThrow(blocked);
      await expect(
        database.orm.execute(sql`
        select column_name from information_schema.columns
        where table_schema = 'public'
          and table_name in ('focus_sessions', 'user_items')
          and column_name in ('chest_id', 'origin', 'acquisition_source', 'is_verified')
      `),
      ).resolves.toMatchObject({rows: []});
      await expect(
        database.orm.execute(sql`
        select user_id from focus_sessions
      `),
      ).resolves.toMatchObject({rows: [{user_id: userId}]});
      await expect(
        database.orm.execute(sql`
        select id, user_id, item_id, session_id from user_items
      `),
      ).resolves.toMatchObject({
        rows: [
          {id: itemId, user_id: userId, item_id: 'red-gem', session_id: null},
        ],
      });
      await expect(
        database.orm.execute(sql`
        select count(*)::integer as count from drizzle.__drizzle_migrations
      `),
      ).resolves.toMatchObject({rows: [{count: journal.entries.length}]});

      await database.orm.execute(
        sql`delete from focus_sessions where user_id = ${userId}`,
      );
      for (const item of ['rusty-key', 'red-gem']) {
        const unknownCopy = randomUUID();
        await database.orm.execute(sql`
          insert into user_items (id, user_id, item_id)
          values (${unknownCopy}, ${userId}, ${item})
        `);
        await expect(prepareDatabase(isolatedUrl.toString())).rejects.toThrow(
          'CHR-24 found inventory with unrecognized legacy provenance.',
        );
        await expect(
          database.orm.execute(sql`
          select item_id, session_id from user_items where id = ${unknownCopy}
        `),
        ).resolves.toMatchObject({rows: [{item_id: item, session_id: null}]});
        await database.orm.execute(
          sql`delete from user_items where id = ${unknownCopy}`,
        );
      }

      // A previously used catalogue ID must not be repurposed as a creation grant.
      await database.orm.execute(sql`
        insert into items (id, name, rarity, sprite_x, sprite_y)
        values ('creation-token', 'Custom item', 'rare', 0, 1)
      `);
      await database.orm.execute(sql`
        insert into chests (id, name, price, sprite_x, sprite_y)
        values ('custom-chest', 'Custom chest', 0, 0, 1)
      `);
      await database.orm.execute(sql`
        insert into chest_items (chest_id, item_id)
        values ('custom-chest', 'creation-token')
      `);
      await expect(prepareDatabase(isolatedUrl.toString())).rejects.toThrow(
        'CHR-24 requires the creation-token catalogue ID to be unused.',
      );
      await expect(
        database.orm.execute(sql`
        select count(*)::integer as count from drizzle.__drizzle_migrations
      `),
      ).resolves.toMatchObject({rows: [{count: journal.entries.length}]});
      await expect(
        database.orm.execute(sql`
        select items.name from items join chest_items on chest_items.item_id = items.id
        where items.id = 'creation-token' and chest_items.chest_id = 'custom-chest'
      `),
      ).resolves.toMatchObject({rows: [{name: 'Custom item'}]});
      await database.orm.execute(
        sql`delete from chest_items where item_id = 'creation-token'`,
      );
      await database.orm.execute(
        sql`delete from items where id = 'creation-token'`,
      );

      await migrateDatabase(database);
      await migrateDatabase(database);
      await expect(
        createUserRepository(database).ensureUser(userId),
      ).resolves.toEqual({
        id: userId,
        clerkUserId: userId,
      });
      await expect(
        database.orm.execute(sql`
        select id, user_id, item_id, session_id, acquisition_source, is_verified from user_items
      `),
      ).resolves.toMatchObject({
        rows: [
          {
            id: itemId,
            user_id: userId,
            item_id: 'red-gem',
            session_id: null,
            acquisition_source: 'account_creation',
            is_verified: true,
          },
        ],
      });
      const legacyUser = randomUUID();
      // Match CHR-15's account transaction, before the separate catalogue seed runs.
      await database.orm.transaction(async transaction => {
        await transaction.execute(sql`
          insert into users (id, clerk_user_id) values (${legacyUser}, ${legacyUser})
        `);
        await transaction.execute(sql`
          insert into user_items (user_id, item_id) values (${legacyUser}, 'red-gem')
        `);
      });
      await createUserRepository(database).ensureUser(legacyUser);
      await expect(
        database.orm.execute(sql`
        select item_id, session_id, acquisition_source, is_verified
        from user_items where user_id = ${legacyUser}
      `),
      ).resolves.toMatchObject({
        rows: [
          {
            item_id: 'creation-token',
            session_id: null,
            acquisition_source: 'account_creation',
            is_verified: true,
          },
        ],
      });
    } finally {
      await database.close();
      await admin.orm.execute(sql`drop database ${databaseName}`);
    }
  } finally {
    await admin.close();
    await rm(existingMigrations, {recursive: true, force: true});
  }
});
