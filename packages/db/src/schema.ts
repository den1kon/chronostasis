import {
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  clerkUserId: text('clerk_user_id').notNull().unique(),
  createdAt: timestamp('created_at', {withTimezone: true})
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', {withTimezone: true})
    .defaultNow()
    .notNull(),
});

export const focusSessions = pgTable('focus_sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, {onDelete: 'cascade', onUpdate: 'restrict'}),
  status: text('status').notNull(),
  plannedDuration: integer('planned_duration').notNull(),
  pausedAt: timestamp('paused_at', {withTimezone: true}),
  startedAt: timestamp('started_at', {withTimezone: true}).notNull(),
  endedAt: timestamp('ended_at', {withTimezone: true}).notNull(),
  createdAt: timestamp('created_at', {withTimezone: true})
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', {withTimezone: true})
    .defaultNow()
    .notNull(),
});

export const items = pgTable('items', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
});

export const chests = pgTable('chests', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
});

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
  },
  table => [primaryKey({columns: [table.chestId, table.itemId]})],
);
