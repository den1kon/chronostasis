import {describe, expect, it} from 'vitest';
import {selectChestReward} from './index';

const candidates = [
  {itemId: 'rusty-key', rarity: 'common', weight: 1},
  {itemId: 'copper-ring', rarity: 'rare', weight: 1},
  {itemId: 'blue-gem', rarity: 'epic', weight: 1},
  {itemId: 'golden-hourglass', rarity: 'legendary', weight: 1},
  {itemId: 'star-fragment', rarity: 'mythic', weight: 1},
] as const;

describe('selectChestReward', () => {
  it.each([
    [0, 'star-fragment'],
    [49, 'star-fragment'],
    [50, 'golden-hourglass'],
    [149, 'golden-hourglass'],
    [150, 'blue-gem'],
    [649, 'blue-gem'],
    [650, 'copper-ring'],
    [2649, 'copper-ring'],
    [2650, 'rusty-key'],
    [9999, 'rusty-key'],
  ])('maps a rarity roll of %i to %s', (roll, expected) => {
    const itemId = selectChestReward(candidates, 3600, maxExclusive => {
      expect(maxExclusive).toBe(10000);
      return roll;
    });
    expect(itemId).toBe(expected);
  });

  it.each([
    [0, 'rusty-key'],
    [49, 'rusty-key'],
    [50, 'golden-hourglass'],
  ])('maps a short-session roll of %i to %s', (roll, expected) => {
    expect(selectChestReward(candidates, 3300, () => roll)).toBe(expected);
  });

  it('falls back to the nearest lower rarity', () => {
    const pool = [candidates[0], candidates[4], candidates[1]];
    expect(selectChestReward(pool, 3600, () => 150)).toBe('copper-ring');
  });

  it('falls back to the lowest available rarity when there is no lower one', () => {
    const pool = [candidates[4], candidates[2]];
    expect(selectChestReward(pool, 3600, () => 9999)).toBe('blue-gem');
  });

  it('uses the short-session Common fallback before looking for another rarity', () => {
    const pool = [candidates[2], candidates[4], candidates[1]];
    expect(selectChestReward(pool, 3300, () => 49)).toBe('copper-ring');
  });

  it.each([900, 3300])(
    'rejects a Mythic-only pool at %i seconds before rolling',
    duration => {
      expect(() =>
        selectChestReward([candidates[4]], duration, () => {
          throw new Error('Unexpected rarity roll');
        }),
      ).toThrow(/empty/i);
    },
  );

  it.each([0, 50, 150, 650, 2650, 9999])(
    'excludes Mythic from short-session selection and fallback at roll %i',
    roll => {
      const pool = [candidates[4], candidates[0]];
      expect(selectChestReward(pool, 900, () => roll)).toBe('rusty-key');
    },
  );

  it.each([
    [0, 'rusty-key'],
    [1, 'silver-key'],
    [3, 'silver-key'],
    [4, 'red-gem'],
    [5, 'red-gem'],
  ])('maps a relative weighted roll of %i to %s', (roll, expected) => {
    const pool = [
      candidates[0],
      candidates[1],
      {itemId: 'silver-key', rarity: 'common', weight: 3},
      {itemId: 'red-gem', rarity: 'common', weight: 2},
    ] as const;
    expect(
      selectChestReward(pool, 3600, maxExclusive => {
        switch (maxExclusive) {
          case 10000:
            return 9999;
          case 6:
            return roll;
          default:
            throw new Error(`Unexpected random bound ${String(maxExclusive)}`);
        }
      }),
    ).toBe(expected);
  });

  it('falls back to a single Mythic item at exactly one hour without rolling its weight', () => {
    let calls = 0;
    const itemId = selectChestReward([candidates[4]], 3600, () => {
      calls++;
      return 9999;
    });
    expect(itemId).toBe('star-fragment');
    expect(calls).toBe(1);
  });

  it('rejects an empty reward pool', () => {
    expect(() => selectChestReward([], 3600, () => 0)).toThrow(/empty/i);
  });

  it.each([600, 901, 1200.5, 11100, NaN])(
    'rejects an invalid duration of %j',
    duration => {
      expect(() => selectChestReward(candidates, duration, () => 0)).toThrow(
        /duration/i,
      );
    },
  );

  it.each([-1, 10000, 0.5, NaN, Infinity])(
    'rejects an invalid rarity roll of %j',
    result => {
      expect(() => selectChestReward(candidates, 3600, () => result)).toThrow(
        /random/i,
      );
    },
  );

  it('rejects an item roll equal to the total weight', () => {
    const pool = [candidates[0], {...candidates[0], itemId: 'silver-key'}];
    expect(() =>
      selectChestReward(pool, 3600, bound => (bound === 10000 ? 9999 : bound)),
    ).toThrow(/random/i);
  });

  it.each([0, -1, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects an invalid candidate weight of %j',
    weight => {
      expect(() =>
        selectChestReward([{...candidates[0], weight}], 3600, () => 0),
      ).toThrow(/weight/i);
    },
  );

  it('rejects a weight total outside the safe integer range', () => {
    const pool = [
      {...candidates[0], weight: Number.MAX_SAFE_INTEGER},
      {...candidates[0], itemId: 'silver-key'},
    ];
    expect(() => selectChestReward(pool, 3600, () => 9999)).toThrow(/weight/i);
  });
});
