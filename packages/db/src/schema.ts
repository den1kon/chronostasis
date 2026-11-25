import {
  bigint,
  boolean,
  check,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import {sql} from 'drizzle-orm';

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clerkUserId: text('clerk_user_id').notNull().unique(),
    revision: bigint('revision', {mode: 'number'}).default(0).notNull(),
    coins: integer('coins').default(0).notNull(),
    createdAt: timestamp('created_at', {withTimezone: true})
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', {withTimezone: true})
      .defaultNow()
      .notNull(),
  },
  table => [
    check('users_coins_nonnegative', sql`${table.coins} >= 0`),
    check(
      'users_revision_safe',
      sql`${table.revision} between 0 and 9007199254740991`,
    ),
  ],
);

export const items = pgTable(
  'items',
  {
    id: text('id').primaryKey(),
    name: varchar('name', {length: 100}).notNull(),
    description: jsonb('description'),
    rarity: text('rarity', {
      enum: ['common', 'rare', 'epic', 'legendary', 'mythic'],
    }).notNull(),
    stats: jsonb('stats').default({}).notNull(),
    spriteX: integer('sprite_x').notNull(),
    spriteY: integer('sprite_y').notNull(),
    createdAt: timestamp('created_at', {withTimezone: true})
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', {withTimezone: true})
      .defaultNow()
      .notNull(),
  },
  table => [
    check(
      'items_rarity_allowed',
      sql`${table.rarity} in ('common', 'rare', 'epic', 'legendary', 'mythic')`,
    ),
    check('items_sprite_x_nonnegative', sql`${table.spriteX} >= 0`),
    check('items_sprite_y_nonnegative', sql`${table.spriteY} >= 0`),
  ],
);

export const chests = pgTable(
  'chests',
  {
    id: text('id').primaryKey(),
    name: varchar('name', {length: 100}).notNull(),
    description: jsonb('description'),
    price: integer('price').notNull(),
    spriteX: integer('sprite_x').notNull(),
    spriteY: integer('sprite_y').notNull(),
    createdAt: timestamp('created_at', {withTimezone: true})
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', {withTimezone: true})
      .defaultNow()
      .notNull(),
  },
  table => [
    check('chests_price_nonnegative', sql`${table.price} >= 0`),
    check('chests_sprite_x_nonnegative', sql`${table.spriteX} >= 0`),
    check('chests_sprite_y_nonnegative', sql`${table.spriteY} >= 0`),
  ],
);

export const chestItems = pgTable(
  'chest_items',
  {
    chestId: text('chest_id')
      .notNull()
      .references(() => chests.id, {
        onDelete: 'restrict',
        onUpdate: 'restrict',
      }),
    itemId: text('item_id')
      .notNull()
      .references(() => items.id, {onDelete: 'restrict', onUpdate: 'restrict'}),
    weight: integer('weight').default(1).notNull(),
    createdAt: timestamp('created_at', {withTimezone: true})
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', {withTimezone: true})
      .defaultNow()
      .notNull(),
  },
  table => [
    primaryKey({columns: [table.chestId, table.itemId]}),
    check('chest_items_weight_positive', sql`${table.weight} > 0`),
  ],
);

export const userChests = pgTable(
  'user_chests',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, {onDelete: 'cascade', onUpdate: 'restrict'}),
    chestId: text('chest_id')
      .notNull()
      .references(() => chests.id, {
        onDelete: 'restrict',
        onUpdate: 'restrict',
      }),
    unlockedAt: timestamp('unlocked_at', {withTimezone: true})
      .defaultNow()
      .notNull(),
    createdAt: timestamp('created_at', {withTimezone: true})
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', {withTimezone: true})
      .defaultNow()
      .notNull(),
  },
  table => [primaryKey({columns: [table.userId, table.chestId]})],
);

export const focusSessions = pgTable(
  'focus_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, {onDelete: 'cascade', onUpdate: 'restrict'}),
    chestId: text('chest_id')
      .notNull()
      .references(() => chests.id, {
        onDelete: 'restrict',
        onUpdate: 'restrict',
      }),
    origin: text('origin', {enum: ['online', 'offline']})
      .default('online')
      .notNull(),
    status: text('status', {
      enum: ['running', 'cancelled', 'completed'],
    }).notNull(),
    plannedDurationSeconds: integer('planned_duration_seconds').notNull(),
    startedAt: timestamp('started_at', {withTimezone: true}).notNull(),
    endedAt: timestamp('ended_at', {withTimezone: true}),
    createdAt: timestamp('created_at', {withTimezone: true})
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', {withTimezone: true})
      .defaultNow()
      .notNull(),
  },
  table => [
    unique('focus_sessions_id_user_id_unique').on(table.id, table.userId),
    uniqueIndex('focus_sessions_one_running_online')
      .on(table.userId)
      .where(sql`${table.origin} = 'online' and ${table.status} = 'running'`),
    check(
      'focus_sessions_origin_allowed',
      sql`${table.origin} in ('online', 'offline')`,
    ),
    check(
      'focus_sessions_offline_completed',
      sql`${table.origin} <> 'offline' or ${table.status} = 'completed'`,
    ),
    check(
      'focus_sessions_status_allowed',
      sql`${table.status} in ('running', 'cancelled', 'completed')`,
    ),
    check(
      'focus_sessions_duration_valid',
      sql`${table.plannedDurationSeconds} between 900 and 10800 and ${table.plannedDurationSeconds} % 300 = 0`,
    ),
    check(
      'focus_sessions_end_matches_status',
      sql`(${table.status} = 'running' and ${table.endedAt} is null) or (${table.status} in ('cancelled', 'completed') and ${table.endedAt} is not null)`,
    ),
  ],
);

export const userItems = pgTable(
  'user_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, {onDelete: 'cascade', onUpdate: 'restrict'}),
    itemId: text('item_id')
      .notNull()
      .references(() => items.id, {onDelete: 'restrict', onUpdate: 'restrict'}),
    sessionId: uuid('session_id'),
    acquisitionSource: text('acquisition_source', {
      enum: ['account_creation', 'session_reward', 'offline_claim'],
    }).notNull(),
    isVerified: boolean('is_verified').default(false).notNull(),
    receivedAt: timestamp('received_at', {withTimezone: true})
      .defaultNow()
      .notNull(),
    createdAt: timestamp('created_at', {withTimezone: true})
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', {withTimezone: true})
      .defaultNow()
      .notNull(),
  },
  table => [
    // Block deletion of a referenced session while allowing the user's cascades to remove both rows.
    foreignKey({
      name: 'user_items_session_owner_fk',
      columns: [table.sessionId, table.userId],
      foreignColumns: [focusSessions.id, focusSessions.userId],
    })
      .onDelete('no action')
      .onUpdate('restrict'),
    check(
      'user_items_acquisition_provenance',
      sql`(${table.acquisitionSource} = 'account_creation' and ${table.sessionId} is null and ${table.isVerified})
        or (${table.acquisitionSource} = 'session_reward' and ${table.sessionId} is not null and ${table.isVerified})
        or (${table.acquisitionSource} = 'offline_claim' and ${table.sessionId} is not null and not ${table.isVerified})`,
    ),
  ],
);
