import { describe, expect, it } from 'vitest';
import { historyDateRange, localHistoryDate, validHistoryDates } from './historyDateRange';

describe('history date range', () => {
  it('includes the entire selected final day and composes completed-play filtering', () => {
    const query = historyDateRange('custom', { from: '2026-10-01', to: '2026-10-19' }, true);
    expect(new Date(query.from!).getHours()).toBe(0);
    expect(localHistoryDate(new Date(query.to!))).toBe('2026-10-20');
    expect(query.completedOnly).toBe(true);
  });
  it('rejects invalid calendar dates and reverse ranges', () => {
    expect(validHistoryDates({ from: '2026-02-29', to: '2026-03-01' })).toBe(false);
    expect(validHistoryDates({ from: '2026-10-19', to: '2026-10-01' })).toBe(false);
  });
  it('bounds a year locally without changing the legacy all/completed presets', () => {
    const dates = { from: '2026-01-01', to: '2026-10-19' };
    const query = historyDateRange('year', dates, false, new Date(2026, 9, 19));
    expect(localHistoryDate(new Date(query.from!))).toBe('2026-01-01');
    expect(localHistoryDate(new Date(query.to!))).toBe('2027-01-01');
    expect(historyDateRange('all', dates, false)).toEqual({});
    expect(historyDateRange('completed', dates, false)).toEqual({ completedOnly: true });
  });
});
