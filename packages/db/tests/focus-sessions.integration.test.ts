import {randomUUID} from 'node:crypto';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {sql} from 'drizzle-orm';
import {createDatabase} from '../src/client';
import {readTestDatabaseUrl} from '../src/env';
import {migrateDatabase} from '../src/migrations';

const database = createDatabase(readTestDatabaseUrl(process.env));
const userId = randomUUID();

beforeAll(async () => {
  await migrateDatabase(database);
  await database.orm.execute(
    sql`insert into users (id, clerk_user_id) values (${userId}, ${`focus-session-${userId}`})`,
  );
});
afterAll(async () => {
  try {
    await database.orm.execute(
      sql`delete from focus_sessions where user_id = ${userId}`,
    );
    await database.orm.execute(sql`delete from users where id = ${userId}`);
  } finally {
    await database.close();
  }
});

describe('focus sessions migration', () => {
  it('creates all required columns with the requested nullability', async () => {
    const result = await database.orm.execute(sql`
      select column_name, data_type, is_nullable
      from information_schema.columns
      where table_schema = 'public' and table_name = 'focus_sessions'
      order by ordinal_position
    `);
    expect(result.rows).toEqual([
      {column_name: 'id', data_type: 'uuid', is_nullable: 'NO'},
      {column_name: 'user_id', data_type: 'uuid', is_nullable: 'NO'},
      {column_name: 'status', data_type: 'text', is_nullable: 'NO'},
      {
        column_name: 'planned_duration',
        data_type: 'integer',
        is_nullable: 'NO',
      },
      {
        column_name: 'paused_at',
        data_type: 'timestamp with time zone',
        is_nullable: 'YES',
      },
      {
        column_name: 'started_at',
        data_type: 'timestamp with time zone',
        is_nullable: 'NO',
      },
      {
        column_name: 'ended_at',
        data_type: 'timestamp with time zone',
        is_nullable: 'NO',
      },
      {
        column_name: 'created_at',
        data_type: 'timestamp with time zone',
        is_nullable: 'NO',
      },
      {
        column_name: 'updated_at',
        data_type: 'timestamp with time zone',
        is_nullable: 'NO',
      },
    ]);
  });

  it('references an existing user and records a session', async () => {
    const sessionId = randomUUID();
    const timestamp = new Date();
    await database.orm.execute(sql`
      insert into focus_sessions (
        id, user_id, status, planned_duration, started_at, ended_at
      ) values (
        ${sessionId}, ${userId}, 'completed', 1500, ${timestamp}, ${timestamp}
      )
    `);
    expect(
      (
        await database.orm.execute(
          sql`select user_id, status, planned_duration from focus_sessions where id = ${sessionId}`,
        )
      ).rows,
    ).toEqual([{user_id: userId, status: 'completed', planned_duration: 1500}]);
    await database.orm.execute(
      sql`delete from focus_sessions where id = ${sessionId}`,
    );
  });

  it('rejects a session for an unknown user', async () => {
    await expect(
      database.orm.execute(sql`
        insert into focus_sessions (
          id, user_id, status, planned_duration, started_at, ended_at
        ) values (
          ${randomUUID()}, ${randomUUID()}, 'running', 1500, now(), now()
        )
      `),
    ).rejects.toMatchObject({cause: {code: '23503'}});
  });
});
