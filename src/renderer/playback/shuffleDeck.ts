export const shuffleDeckRefillWatermark = 8;

export type ShuffleDeck<T> = {
  sourceKey: string | null;
  items: T[];
  /** True when the last page looked full, so another page is worth fetching. */
  canRefill: boolean;
};

export const emptyShuffleDeck = <T,>(): ShuffleDeck<T> => ({
  sourceKey: null,
  items: [],
  canRefill: false,
});

export const takeEligibleShuffleDeckItem = <T>(
  deck: ShuffleDeck<T>,
  isExcluded: (item: T) => boolean,
): { deck: ShuffleDeck<T>; item: T | null } => {
  const index = deck.items.findIndex((item) => !isExcluded(item));
  if (index < 0) {
    return { deck, item: null };
  }

  const item = deck.items[index] ?? null;
  const items = deck.items.slice();
  items.splice(index, 1);
  return {
    deck: { sourceKey: deck.sourceKey, items, canRefill: deck.canRefill },
    item,
  };
};

export const appendUniqueShuffleDeckItems = <T>(
  deck: ShuffleDeck<T>,
  incoming: readonly T[],
  idOf: (item: T) => string,
  canRefill: boolean,
): ShuffleDeck<T> => {
  if (incoming.length === 0) {
    return { ...deck, canRefill };
  }

  const seen = new Set(deck.items.map(idOf));
  const items = deck.items.slice();
  for (const item of incoming) {
    const id = idOf(item);
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    items.push(item);
  }
  return { sourceKey: deck.sourceKey, items, canRefill };
};

export const shouldRefillShuffleDeck = (deck: ShuffleDeck<unknown>): boolean =>
  deck.canRefill && deck.items.length > 0 && deck.items.length < shuffleDeckRefillWatermark;

/** Recent-window ids only. A full history set makes the cached shuffle next expire after every play. */
export const recentShuffleQueueIds = (
  history: readonly { queueId: string }[],
  avoidRecentCount: number,
): Set<string> => {
  const recent = avoidRecentCount > 0 ? history.slice(-avoidRecentCount) : [];
  return new Set(recent.map((item) => item.queueId));
};
