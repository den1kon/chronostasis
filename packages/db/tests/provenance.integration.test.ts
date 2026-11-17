import {randomUUID} from 'node:crypto';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {sql} from 'drizzle-orm';
import {createDatabase} from '../src/client';
import {readTestDatabaseUrl} from '../src/env';
import {migrateDatabase} from '../src/migrations';
import {seedCatalogue} from '../src/seeding';

const database = createDatabase(readTestDatabaseUrl(process.env));
const owner = randomUUID();
const otherUser = randomUUID();
const onlineSession = randomUUID();
const offlineSession = randomUUID();
const chest = `provenance-${randomUUID()}`;

beforeAll(async () => {
  await migrateDatabase(database);
  await seedCatalogue(database);
  await database.orm.execute(sql`
    insert into users (id, clerk_user_id)
    values (${owner}, ${owner}), (${otherUser}, ${otherUser})
  `);
  await database.orm.execute(sql`
    insert into chests (id, name, price, sprite_x, sprite_y)
    values (${chest}, 'Provenance chest', 0, 0, 0)
  `);
  await database.orm.execute(sql`
      insert into focus_sessions (id, user_id, chest_id, origin, status, planned_duration_seconds, started_at, ended_at)
      values
        (${onlineSession}, ${owner}, ${chest}, 'online', 'completed', 1500, now(), now()),
        (${offlineSession}, ${owner}, ${chest}, 'offline', 'completed', 1500, now(), now())
    `);
});

afterAll(async () => {
  try {
    await database.orm.execute(
      sql`delete from users where id in (${owner}, ${otherUser})`,
    );
    await database.orm.execute(sql`delete from chests where id = ${chest}`);
  } finally {
    await database.close();
  }
});

describe('focus session provenance', () => {
  it('defaults to online and permits one running online session per user', async () => {
    const insert = (userId: string) =>
      database.orm.execute(sql`
      insert into focus_sessions (user_id, chest_id, status, planned_duration_seconds, started_at)
      values (${userId}, ${chest}, 'running', 1500, now())
      returning origin
    `);

    await expect(insert(owner)).resolves.toMatchObject({
      rows: [{origin: 'online'}],
    });
    await expect(insert(owner)).rejects.toMatchObject({
      cause: {code: '23505', constraint: 'focus_sessions_one_running_online'},
    });
    await expect(
      database.orm.execute(sql`
        insert into focus_sessions (user_id, chest_id, origin, status, planned_duration_seconds, started_at, ended_at)
        values
          (${owner}, ${chest}, 'online', 'completed', 1500, now(), now()),
          (${owner}, ${chest}, 'offline', 'completed', 1500, now(), now())
      `),
    ).resolves.toMatchObject({rowCount: 2});
    await expect(insert(otherUser)).resolves.toMatchObject({
      rows: [{origin: 'online'}],
    });
  });

  it.each(['running', 'cancelled'])(
    'rejects an offline session with %s status',
    async status => {
      await expect(
        database.orm.execute(sql`
      insert into focus_sessions (user_id, chest_id, origin, status, planned_duration_seconds, started_at, ended_at)
      values (${owner}, ${chest}, 'offline', ${status}, 1500, now(), ${status === 'running' ? null : new Date()})
    `),
      ).rejects.toMatchObject({
        cause: {code: '23514', constraint: 'focus_sessions_offline_completed'},
      });
    },
  );

  it('rejects an unknown origin', async () => {
    await expect(
      database.orm.execute(sql`
      insert into focus_sessions (user_id, chest_id, origin, status, planned_duration_seconds, started_at)
      values (${owner}, ${chest}, 'unknown', 'running', 1500, now())
    `),
    ).rejects.toMatchObject({
      cause: {code: '23514', constraint: 'focus_sessions_origin_allowed'},
    });
  });

  it('requires an origin even when explicitly null', async () => {
    await expect(
      database.orm.execute(sql`
      insert into focus_sessions (user_id, chest_id, origin, status, planned_duration_seconds, started_at)
      values (${owner}, ${chest}, null, 'running', 1500, now())
    `),
    ).rejects.toMatchObject({cause: {code: '23502', column: 'origin'}});
  });

  it('requires a chest ID', async () => {
    await expect(
      database.orm.execute(sql`
      insert into focus_sessions (user_id, status, planned_duration_seconds, started_at)
      values (${owner}, 'running', 1500, now())
    `),
    ).rejects.toMatchObject({cause: {code: '23502', column: 'chest_id'}});
  });

  it('requires the referenced chest to exist', async () => {
    await expect(
      database.orm.execute(sql`
      insert into focus_sessions (user_id, chest_id, status, planned_duration_seconds, started_at, ended_at)
      values (${owner}, ${randomUUID()}, 'completed', 1500, now(), now())
    `),
    ).rejects.toMatchObject({
      cause: {
        code: '23503',
        constraint: 'focus_sessions_chest_id_chests_id_fk',
      },
    });
  });

  it('protects a chest referenced only by a session', async () => {
    await expect(
      database.orm.execute(sql`delete from chests where id = ${chest}`),
    ).rejects.toMatchObject({
      cause: {
        code: '23503',
        constraint: 'focus_sessions_chest_id_chests_id_fk',
      },
    });
  });
});

describe('inventory acquisition provenance', () => {
  function insertItem(
    source: string | null,
    sessionId: string | null,
    verified: boolean | null,
    userId = owner,
  ) {
    return database.orm.execute(sql`
      insert into user_items (user_id, item_id, session_id, acquisition_source, is_verified)
      values (${userId}, 'red-gem', ${sessionId}, ${source}, ${verified})
    `);
  }

  it('accepts each valid combination and multiple item copies from one session', async () => {
    await expect(
      insertItem('account_creation', null, true),
    ).resolves.toMatchObject({rowCount: 1});
    await expect(
      insertItem('session_reward', onlineSession, true),
    ).resolves.toMatchObject({rowCount: 1});
    await expect(
      insertItem('session_reward', onlineSession, true),
    ).resolves.toMatchObject({rowCount: 1});
    await expect(
      database.orm.execute(sql`
      insert into user_items (user_id, item_id, session_id, acquisition_source)
      values (${owner}, 'red-gem', ${offlineSession}, 'offline_claim')
      returning is_verified
    `),
    ).resolves.toMatchObject({rows: [{is_verified: false}]});
  });

  it.each([
    ['account_creation', null, false],
    ['account_creation', onlineSession, false],
    ['account_creation', onlineSession, true],
    ['session_reward', null, false],
    ['session_reward', null, true],
    ['session_reward', onlineSession, false],
    ['offline_claim', null, false],
    ['offline_claim', null, true],
    ['offline_claim', offlineSession, true],
    ['unknown', null, true],
  ] as const)(
    'rejects source %s with session %s and verification %s',
    async (source, sessionId, verified) => {
      await expect(
        insertItem(source, sessionId, verified),
      ).rejects.toMatchObject({
        cause: {code: '23514', constraint: 'user_items_acquisition_provenance'},
      });
    },
  );

  it('requires acquisition source and verification', async () => {
    await expect(insertItem(null, null, true)).rejects.toMatchObject({
      cause: {code: '23502', column: 'acquisition_source'},
    });
    await expect(
      insertItem('account_creation', null, null),
    ).rejects.toMatchObject({
      cause: {code: '23502', column: 'is_verified'},
    });
  });

  it('rejects missing provenance outside the legacy welcome write', async () => {
    await expect(
      database.orm.execute(sql`
        insert into user_items (user_id, item_id) values (${owner}, 'rusty-key')
      `),
    ).rejects.toMatchObject({
      cause: {code: '23502', column: 'acquisition_source'},
    });
  });

  it('rejects a reward tied to another user’s session', async () => {
    await expect(
      insertItem('session_reward', onlineSession, true, otherUser),
    ).rejects.toMatchObject({
      cause: {code: '23503', constraint: 'user_items_session_owner_fk'},
    });
  });

  it('retains session history while items reference it', async () => {
    await insertItem('session_reward', onlineSession, true);
    await expect(
      database.orm.execute(
        sql`delete from focus_sessions where id = ${onlineSession}`,
      ),
    ).rejects.toMatchObject({
      cause: {code: '23503', constraint: 'user_items_session_owner_fk'},
    });
  });
});
