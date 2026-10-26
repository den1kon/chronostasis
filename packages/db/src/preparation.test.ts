import {beforeEach, describe, expect, it, vi} from 'vitest';

const state = vi.hoisted(() => ({
  events: [] as string[],
  clients: [] as Array<{
    connect: ReturnType<typeof vi.fn>;
    query: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
  }>,
  migrate: vi.fn(),
  seed: vi.fn(),
}));

vi.mock('pg', () => ({
  default: {
    Client: class {
      connect = vi.fn(() => {
        state.events.push('connect');
        return Promise.resolve();
      });
      query = vi.fn((query: string) => {
        if (query.includes('pg_try_advisory_lock')) {
          state.events.push('lock');
          return Promise.resolve({rows: [{acquired: true}]});
        }
        state.events.push('unlock');
        return Promise.resolve({rows: [{unlocked: true}]});
      });
      end = vi.fn(() => {
        state.events.push('end');
        return Promise.resolve();
      });

      constructor() {
        state.clients.push(this);
      }
    },
  },
}));

vi.mock('./migrations.js', () => ({
  migrateDatabase: state.migrate,
}));

vi.mock('./seeding.js', () => ({
  seedCatalogue: state.seed,
}));

import {migrateDatabase} from './migrations.js';
import {prepareDatabase} from './preparation.js';
import {seedCatalogue} from './seeding.js';

const connectionString =
  'postgresql://app:private-password@database.example/chronostasis';

describe('database preparation', () => {
  beforeEach(() => {
    state.events.length = 0;
    state.clients.length = 0;
    vi.mocked(migrateDatabase)
      .mockReset()
      .mockImplementation(() => {
        state.events.push('migrate');
        return Promise.resolve();
      });
    vi.mocked(seedCatalogue)
      .mockReset()
      .mockImplementation(() => {
        state.events.push('seed');
        return Promise.resolve();
      });
  });

  it('runs migrations before catalogue seeding and releases its connection lock', async () => {
    await prepareDatabase(connectionString);

    expect(state.events).toEqual([
      'connect',
      'lock',
      'migrate',
      'seed',
      'unlock',
      'end',
    ]);
    expect(state.clients).toHaveLength(1);
    expect(state.clients[0]?.end).toHaveBeenCalledOnce();
  });

  it('does not seed after migration failure and does not expose the connection string', async () => {
    vi.mocked(migrateDatabase).mockImplementationOnce(() => {
      state.events.push('migrate');
      return Promise.reject(
        new Error(`migration failed for ${connectionString}`),
      );
    });

    await expect(prepareDatabase(connectionString)).rejects.toThrow(
      'Database migration failed.',
    );
    expect(state.events).toEqual([
      'connect',
      'lock',
      'migrate',
      'unlock',
      'end',
    ]);
    expect(state.seed).not.toHaveBeenCalled();
    expect(state.clients[0]?.end).toHaveBeenCalledOnce();
  });

  it('reports seed failure without exposing SQL or credential details', async () => {
    vi.mocked(seedCatalogue).mockImplementationOnce(() => {
      state.events.push('seed');
      return Promise.reject(new Error(`SQL failed for ${connectionString}`));
    });

    const error = await prepareDatabase(connectionString).catch(
      (failure: unknown) => failure,
    );
    expect(error).toMatchObject({message: 'Database seed failed.'});
    expect(String(error)).not.toContain('private-password');
    expect(String(error)).not.toContain('database.example');
    expect(state.events).toEqual([
      'connect',
      'lock',
      'migrate',
      'seed',
      'unlock',
      'end',
    ]);
  });
});
