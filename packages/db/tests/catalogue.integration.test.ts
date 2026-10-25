import {randomUUID} from 'node:crypto';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {sql} from 'drizzle-orm';
import {createDatabase} from '../src/client';
import {readTestDatabaseUrl} from '../src/env';
import {migrateDatabase} from '../src/migrations';
import {seedCatalogue} from '../src/seeding';

const database = createDatabase(readTestDatabaseUrl(process.env));
beforeAll(async () => {
  await migrateDatabase(database);
  await seedCatalogue(database);
});
afterAll(async () => {
  await database.close();
});

describe('normalized chest catalogue', () => {
  it('seeds one chest and three eligible item links without duplicating them', async () => {
    await seedCatalogue(database);
    await seedCatalogue(database);
    expect(
      (await database.orm.execute(sql`select id, name from chests order by id`))
        .rows,
    ).toEqual([{id: 'basic-chest', name: 'Basic chest'}]);
    expect(
      (
        await database.orm.execute(
          sql`select chest_id, item_id from chest_items order by item_id`,
        )
      ).rows,
    ).toEqual([
      {chest_id: 'basic-chest', item_id: 'blue-gem'},
      {chest_id: 'basic-chest', item_id: 'copper-ring'},
      {chest_id: 'basic-chest', item_id: 'rusty-key'},
    ]);
  });
  it('rejects duplicate eligibility pairs', async () => {
    await expect(
      database.orm.execute(
        sql`insert into chest_items (chest_id, item_id) values ('basic-chest', 'rusty-key')`,
      ),
    ).rejects.toMatchObject({cause: {code: '23505'}});
  });
  it('requires a chest definition for every eligibility link', async () => {
    const missing = `missing-${randomUUID()}`;
    await expect(
      database.orm.execute(
        sql`insert into chest_items (chest_id, item_id) values (${missing}, 'rusty-key')`,
      ),
    ).rejects.toMatchObject({cause: {code: '23503'}});
  });
  it('requires an item definition for every eligibility link', async () => {
    const missing = `missing-${randomUUID()}`;
    await expect(
      database.orm.execute(
        sql`insert into chest_items (chest_id, item_id) values ('basic-chest', ${missing})`,
      ),
    ).rejects.toMatchObject({cause: {code: '23503'}});
  });
  it('protects referenced chest and item definitions from deletion', async () => {
    await expect(
      database.orm.execute(sql`delete from chests where id = 'basic-chest'`),
    ).rejects.toMatchObject({cause: {code: '23503'}});
    await expect(
      database.orm.execute(sql`delete from items where id = 'rusty-key'`),
    ).rejects.toMatchObject({cause: {code: '23503'}});
  });
  it('allows shared loot across chest types and preserves later definitions when reseeding', async () => {
    const id = `extra-${randomUUID()}`;
    try {
      await database.orm.execute(
        sql`insert into chests (id, name) values (${id}, 'Another chest')`,
      );
      await database.orm.execute(
        sql`insert into chest_items (chest_id, item_id) values (${id}, 'rusty-key')`,
      );
      await seedCatalogue(database);
      expect(
        (
          await database.orm.execute(
            sql`select chest_id from chest_items where item_id = 'rusty-key' order by chest_id`,
          )
        ).rows,
      ).toEqual([{chest_id: 'basic-chest'}, {chest_id: id}]);
      expect(
        (
          await database.orm.execute(
            sql`select name from chests where id = ${id}`,
          )
        ).rows,
      ).toEqual([{name: 'Another chest'}]);
    } finally {
      await database.orm.execute(
        sql`delete from chest_items where chest_id = ${id}`,
      );
      await database.orm.execute(sql`delete from chests where id = ${id}`);
    }
  });
  it('rolls back item updates if linking loot fails during catalogue seeding', async () => {
    const name = `seed_failure_${randomUUID().replaceAll('-', '')}`;
    const identifier = sql.identifier(name);
    await database.orm.execute(
      sql`create function ${identifier}() returns trigger language plpgsql as $$ begin raise exception 'forced seed failure'; end $$`,
    );
    try {
      await database.orm.execute(
        sql`create trigger ${identifier} before insert on chest_items for each row execute function ${identifier}()`,
      );
      await database.orm.execute(
        sql`update items set name = 'Preserve on rollback' where id = 'rusty-key'`,
      );
      await expect(seedCatalogue(database)).rejects.toThrow();
      expect(
        (
          await database.orm.execute(
            sql`select name from items where id = 'rusty-key'`,
          )
        ).rows,
      ).toEqual([{name: 'Preserve on rollback'}]);
    } finally {
      await database.orm.execute(
        sql`drop trigger if exists ${identifier} on chest_items`,
      );
      await database.orm.execute(sql`drop function ${identifier}()`);
      await seedCatalogue(database);
    }
  });
});
