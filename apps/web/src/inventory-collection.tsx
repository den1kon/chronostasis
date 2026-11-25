import {panelStyle} from './gameplay-styles';
import {RewardItem} from './reward-item';
import {useAccountSync} from './sync-context';

export function InventoryCollection() {
  const {state} = useAccountSync();
  const {snapshot, view} = state;
  const catalogue = new Map(
    snapshot.catalogue.items.map(item => [item.id, item]),
  );
  return (
    <section aria-labelledby="collection-heading" className={panelStyle}>
      <h2 id="collection-heading" className="text-2xl font-semibold">
        Your collection
      </h2>
      {view.items.length > 0 ? (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {view.items.map(item => (
            <li
              key={item.id}
              className="rounded-xl border border-outline/70 p-4"
            >
              <RewardItem
                item={item}
                catalogueItem={catalogue.get(item.itemId)}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-parchment/75">Your rewards will appear here.</p>
      )}
    </section>
  );
}
