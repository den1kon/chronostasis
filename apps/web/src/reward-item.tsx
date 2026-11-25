import type {UserSnapshot} from '@chronostasis/contracts';
import type {ProjectedItem} from './sync-model';

export function RewardItem({
  item,
  catalogueItem,
}: {
  item: ProjectedItem;
  catalogueItem: UserSnapshot['catalogue']['items'][number] | undefined;
}) {
  return (
    <div className="space-y-2">
      <div>
        <p className="font-semibold">{catalogueItem?.name ?? 'Unknown item'}</p>
        {catalogueItem && (
          <p className="text-sm text-parchment/75 capitalize">
            {catalogueItem.rarity}
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-2 text-xs font-semibold">
        <span
          className={`rounded-full border border-outline px-2.5 py-1 ${item.isVerified ? 'text-leaf' : 'text-parchment'}`}
        >
          {item.isVerified ? 'Verified' : 'Unverified'}
        </span>
        {item.pending && (
          <span className="rounded-full border border-outline px-2.5 py-1">
            Pending sync
          </span>
        )}
      </div>
    </div>
  );
}
