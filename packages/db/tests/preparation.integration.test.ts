import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {sql} from 'drizzle-orm';
import pg from 'pg';
import {createDatabase} from '../src/client';
import {readTestDatabaseUrl} from '../src/env';
import {prepareDatabase} from '../src/preparation';
import {chestItems, chests, items, users} from '../src/schema';

const connectionString = readTestDatabaseUrl(process.env);
const database = createDatabase(connectionString);
const lockKey = [1128813105, 12];

async function lockClient() {
  const client = new pg.Client(connectionString);
  await client.connect();
  await client.query('select pg_advisory_lock($1, $2)', lockKey);
  return client;
}

beforeAll(async () => {
  await prepareDatabase(connectionString);
});

afterAll(async () => {
  await database.close();
});

describe('serialized database preparation on Postgres', () => {
  it('can prepare twice without duplicating catalogue data', async () => {
    await prepareDatabase(connectionString);
    await prepareDatabase(connectionString);

    expect(
      (
        await database.orm.execute(
          sql`select id from chests where id = 'basic-chest'`,
        )
      ).rows,
    ).toEqual([{id: 'basic-chest'}]);
    expect(
      (
        await database.orm.execute(
          sql`select id from items where id in ('blue-gem', 'copper-ring', 'rusty-key') order by id`,
        )
      ).rows,
    ).toEqual([{id: 'blue-gem'}, {id: 'copper-ring'}, {id: 'rusty-key'}]);
    expect(
      (
        await database.orm.execute(
          sql`select item_id from chest_items where chest_id = 'basic-chest' order by item_id`,
        )
      ).rows,
    ).toEqual([
      {item_id: 'blue-gem'},
      {item_id: 'copper-ring'},
      {item_id: 'rusty-key'},
    ]);
  });

  it('preserves existing users and additional catalogue definitions', async () => {
    const userId = `prepare-${randomUUID()}`;
    const chestId = `extra-${randomUUID()}`;
    const itemId = `extra-${randomUUID()}`;
    try {
      await database.orm.insert(users).values({clerkUserId: userId});
      await database.orm
        .insert(chests)
        .values({id: chestId, name: 'Extra chest'});
      await database.orm.insert(items).values({id: itemId, name: 'Extra item'});
      await database.orm.insert(chestItems).values({chestId, itemId});

      await prepareDatabase(connectionString);

      expect(
        (
          await database.orm.execute(
            sql`select clerk_user_id from users where clerk_user_id = ${userId}`,
          )
        ).rows,
      ).toEqual([{clerk_user_id: userId}]);
      expect(
        (
          await database.orm.execute(
            sql`select chests.name as chest_name, items.name as item_name from chest_items join chests on chests.id = chest_items.chest_id join items on items.id = chest_items.item_id where chest_items.chest_id = ${chestId}`,
          )
        ).rows,
      ).toEqual([{chest_name: 'Extra chest', item_name: 'Extra item'}]);
    } finally {
      await database.orm
        .delete(chestItems)
        .where(sql`${chestItems.chestId} = ${chestId}`);
      await database.orm.delete(chests).where(sql`${chests.id} = ${chestId}`);
      await database.orm.delete(items).where(sql`${items.id} = ${itemId}`);
      await database.orm
        .delete(users)
        .where(sql`${users.clerkUserId} = ${userId}`);
    }
  });

  it('waits for another connection to release the preparation lock', async () => {
    const holder = await lockClient();
    const started = Date.now();
    const preparation = prepareDatabase(connectionString);
    try {
      await delay(400);
      await holder.query('select pg_advisory_unlock($1, $2)', lockKey);
      await expect(preparation).resolves.toBeUndefined();
      expect(Date.now() - started).toBeGreaterThanOrEqual(350);
    } finally {
      await holder.end();
    }
  });

  it('fails after the bounded lock wait without retaining the connection', async () => {
    const holder = await lockClient();
    try {
      await expect(
        prepareDatabase(connectionString, {lockWaitMs: 100}),
      ).rejects.toThrow('Database preparation lock failed.');
    } finally {
      await holder.query('select pg_advisory_unlock($1, $2)', lockKey);
      await holder.end();
    }
  });

  it('releases the preparation lock after catalogue seeding fails', async () => {
    const suffix = randomUUID().replaceAll('-', '');
    const functionName = `fail_seed_${suffix}`;
    const triggerName = `fail_seed_trigger_${suffix}`;
    const functionId = sql.identifier(functionName);
    const triggerId = sql.identifier(triggerName);
    await database.orm.execute(
      sql`create function ${functionId}() returns trigger language plpgsql as $$ begin raise exception 'forced seed failure'; end $$`,
    );
    try {
      await database.orm.execute(
        sql`create trigger ${triggerId} before insert on chest_items for each row execute function ${functionId}()`,
      );
      await expect(prepareDatabase(connectionString)).rejects.toThrow(
        'Database seed failed.',
      );

      const verifier = await lockClient();
      await verifier.query('select pg_advisory_unlock($1, $2)', lockKey);
      await verifier.end();
    } finally {
      await database.orm.execute(
        sql`drop trigger if exists ${triggerId} on chest_items`,
      );
      await database.orm.execute(sql`drop function ${functionId}()`);
      await prepareDatabase(connectionString);
    }
  });

  it('releases the advisory lock when the lock-holder connection disconnects', async () => {
    const holder = new pg.Client(connectionString);
    holder.on('error', () => undefined);
    await holder.connect();
    await holder.query('select pg_advisory_lock($1, $2)', lockKey);
    const backendPid = (
      await holder.query<{pid: number}>('select pg_backend_pid() as pid')
    ).rows[0]?.pid;
    if (backendPid === undefined) throw new Error('Missing test backend PID.');

    const terminator = new pg.Client(connectionString);
    await terminator.connect();
    try {
      await terminator.query('select pg_terminate_backend($1)', [backendPid]);
      const verifier = await lockClient();
      await verifier.query('select pg_advisory_unlock($1, $2)', lockKey);
      await verifier.end();
    } finally {
      await terminator.end();
      await holder.end();
    }
  });

  it('serializes concurrent preparation attempts', async () => {
    await expect(
      Promise.all([
        prepareDatabase(connectionString),
        prepareDatabase(connectionString),
      ]),
    ).resolves.toHaveLength(2);
    expect(
      (
        await database.orm.execute(
          sql`select item_id from chest_items where chest_id = 'basic-chest' order by item_id`,
        )
      ).rows,
    ).toEqual([
      {item_id: 'blue-gem'},
      {item_id: 'copper-ring'},
      {item_id: 'rusty-key'},
    ]);
  });

  it('handles loss of its own connection while waiting for the lock', async () => {
    const holder = await lockClient();
    const applicationName = `prepare-disconnect-${randomUUID()}`;
    const preparationUrl = new URL(connectionString);
    preparationUrl.searchParams.set('application_name', applicationName);
    const completion = prepareDatabase(preparationUrl.toString(), {
      lockWaitMs: 2000,
    }).catch((error: unknown) => error);

    try {
      let backendPid: number | undefined;
      for (
        let attempt = 0;
        attempt < 60 && backendPid === undefined;
        attempt++
      ) {
        const result = await database.orm.execute(
          sql`select pid from pg_stat_activity where application_name = ${applicationName} and state = 'idle'`,
        );
        const candidate = result.rows[0]?.['pid'];
        if (typeof candidate === 'number') backendPid = candidate;
        else await delay(25);
      }
      if (backendPid === undefined)
        throw new Error('Missing preparation backend PID.');

      await database.orm.execute(
        sql`select pg_terminate_backend(${backendPid})`,
      );
      const failure = await completion;
      expect(failure).toMatchObject({message: 'Database connection failed.'});
      expect(String(failure)).not.toContain(connectionString);
    } finally {
      await holder.query('select pg_advisory_unlock($1, $2)', lockKey);
      await holder.end();
      await completion;
    }
  });
});
