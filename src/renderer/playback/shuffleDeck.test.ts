import { describe, expect, it } from 'vitest';
import {
  appendUniqueShuffleDeckItems,
  recentShuffleQueueIds,
  shouldRefillShuffleDeck,
  takeEligibleShuffleDeckItem,
  type ShuffleDeck,
} from './shuffleDeck';

const deck = (ids: string[], canRefill = true): ShuffleDeck<{ id: string }> => ({
  sourceKey: 'songs',
  items: ids.map((id) => ({ id })),
  canRefill,
});

describe('shuffle deck', () => {
  it('removes only the chosen item and keeps later cards in order', () => {
    const excluded = new Set(['a']);
    const result = takeEligibleShuffleDeckItem(deck(['a', 'b', 'c']), (item) => excluded.has(item.id));
    expect(result.item).toEqual({ id: 'b' });
    expect(result.deck.items.map((item) => item.id)).toEqual(['a', 'c']);
  });

  it('refills only a non-empty deck that still has more library pages', () => {
    expect(shouldRefillShuffleDeck(deck(['a', 'b', 'c', 'd', 'e', 'f', 'g']))).toBe(true);
    expect(shouldRefillShuffleDeck(deck(['a'], false))).toBe(false);
    expect(shouldRefillShuffleDeck({ sourceKey: 'songs', items: [], canRefill: true })).toBe(false);
  });

  it('appends unseen cards without duplicating ids already in the deck', () => {
    const next = appendUniqueShuffleDeckItems(deck(['a']), [{ id: 'a' }, { id: 'b' }], (item) => item.id, true);
    expect(next.items.map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('limits shuffle memory to the avoid-recent window', () => {
    const history = Array.from({ length: 6 }, (_, index) => ({ queueId: `q${index}` }));
    expect([...recentShuffleQueueIds(history, 2)]).toEqual(['q4', 'q5']);
    expect(recentShuffleQueueIds(history, 0).size).toBe(0);
  });
});
