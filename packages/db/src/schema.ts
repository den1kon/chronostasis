import {pgTable, primaryKey, text, timestamp, uuid} from 'drizzle-orm/pg-core';

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
