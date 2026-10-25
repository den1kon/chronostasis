import {sql} from 'drizzle-orm';
import type {Database} from './client';
import {chestItems, chests, items} from './schema';

export async function seedCatalogue(database: Database): Promise<void> {
  await database.orm.transaction(async transaction => {
    await transaction
      .insert(items)
      .values([
        {id: 'rusty-key', name: 'Rusty key'},
        {id: 'copper-ring', name: 'Copper ring'},
        {id: 'blue-gem', name: 'Blue gem'},
      ])
      .onConflictDoUpdate({target: items.id, set: {name: sql`excluded.name`}});
    await transaction
      .insert(chests)
      .values({id: 'basic-chest', name: 'Basic chest'})
      .onConflictDoUpdate({target: chests.id, set: {name: sql`excluded.name`}});
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
