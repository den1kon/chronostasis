import {ItemRaritySchema, PlannedDurationSecondsSchema} from './sync.js';
import type {ItemRarity} from './sync.js';

export type ChestRewardCandidate = {
  itemId: string;
  rarity: ItemRarity;
  weight: number;
};

type RandomInt = (maxExclusive: number) => number;

export function isRarityEligibleForDuration(
  rarity: ItemRarity,
  plannedDurationSeconds: number,
): boolean {
  return rarity !== 'mythic' || plannedDurationSeconds >= 3600;
}

// Reject rolls outside the requested half-open interval before using them as offsets.
function rollInteger(randomInt: RandomInt, maxExclusive: number): number {
  const roll = randomInt(maxExclusive);
  if (!Number.isInteger(roll) || roll < 0 || roll >= maxExclusive) {
    throw new RangeError(
      `Random roll must be an integer from 0 to ${String(maxExclusive - 1)}.`,
    );
  }
  return roll;
}

function rollRarity(roll: number, plannedDurationSeconds: number): ItemRarity {
  if (roll < 50)
    return isRarityEligibleForDuration('mythic', plannedDurationSeconds)
      ? 'mythic'
      : 'common';
  if (roll < 150) return 'legendary';
  if (roll < 650) return 'epic';
  if (roll < 2650) return 'rare';
  return 'common';
}

// Filter by duration before rolling a rarity, falling back to an eligible pool,
// and applying relative weights within that pool.
export function selectChestReward(
  candidates: readonly ChestRewardCandidate[],
  plannedDurationSeconds: number,
  randomInt: RandomInt,
): string {
  if (!PlannedDurationSecondsSchema.safeParse(plannedDurationSeconds).success) {
    throw new RangeError('Invalid planned duration for a chest reward.');
  }
  for (const {weight} of candidates) {
    if (!Number.isSafeInteger(weight) || weight <= 0) {
      throw new RangeError(
        'A chest item weight must be a positive safe integer.',
      );
    }
  }

  const rarityOrder = ItemRaritySchema.options;
  const eligibleCandidates = candidates.filter(item =>
    isRarityEligibleForDuration(item.rarity, plannedDurationSeconds),
  );
  const pools = rarityOrder.map(rarity =>
    eligibleCandidates.filter(item => item.rarity === rarity),
  );
  const lowestPool = pools.find(pool => pool.length > 0);
  if (!lowestPool) {
    throw new Error('Cannot select from an empty chest reward pool.');
  }

  const rarity = rollRarity(
    rollInteger(randomInt, 10000),
    plannedDurationSeconds,
  );
  const rank = rarityOrder.indexOf(rarity);
  const eligible =
    pools.findLast((pool, index) => index <= rank && pool.length > 0) ??
    lowestPool;
  const [first] = eligible;
  if (eligible.length === 1 && first) return first.itemId;

  const totalWeight = eligible.reduce((total, {weight}) => total + weight, 0);
  if (!Number.isSafeInteger(totalWeight)) {
    throw new RangeError('The total chest item weight must be a safe integer.');
  }
  let roll = rollInteger(randomInt, totalWeight);
  for (const {itemId, weight} of eligible) {
    if (roll < weight) return itemId;
    roll -= weight;
  }
  throw new Error('The weighted chest roll did not select an item.');
}
