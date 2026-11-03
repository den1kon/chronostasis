import {sql} from 'drizzle-orm';
import type {DatabaseOperations} from './client';
import {chestItems, chests, items} from './schema';

export async function seedCatalogue(
  database: DatabaseOperations,
): Promise<void> {
  await database.orm.transaction(async transaction => {
    await transaction
      .insert(items)
      .values([
        {
          id: 'rusty-key',
          name: 'Rusty key',
          rarity: 'common',
          spriteX: 0,
          spriteY: 0,
        },
        {
          id: 'copper-ring',
          name: 'Copper ring',
          rarity: 'rare',
          spriteX: 1,
          spriteY: 0,
        },
        {
          id: 'blue-gem',
          name: 'Blue gem',
          rarity: 'epic',
          spriteX: 2,
          spriteY: 0,
        },
        {
          id: 'red-gem',
          name: 'Red gem',
          rarity: 'common',
          spriteX: 3,
          spriteY: 0,
        },
      ])
      .onConflictDoUpdate({
        target: items.id,
        set: {
          name: sql`excluded.name`,
          rarity: sql`excluded.rarity`,
          spriteX: sql`excluded.sprite_x`,
          spriteY: sql`excluded.sprite_y`,
        },
      });
    await transaction
      .insert(chests)
      .values({
        id: 'basic-chest',
        name: 'Basic chest',
        price: 100,
        spriteX: 0,
        spriteY: 0,
      })
      .onConflictDoUpdate({
        target: chests.id,
        set: {
          name: sql`excluded.name`,
          price: sql`excluded.price`,
          spriteX: sql`excluded.sprite_x`,
          spriteY: sql`excluded.sprite_y`,
        },
      });
    await transaction
      .insert(chestItems)
      .values([
        {chestId: 'basic-chest', itemId: 'rusty-key'},
        {chestId: 'basic-chest', itemId: 'copper-ring'},
        {chestId: 'basic-chest', itemId: 'blue-gem'},
      ])
      .onConflictDoNothing();
  });
}
