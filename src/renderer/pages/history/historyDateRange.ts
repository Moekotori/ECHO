import type { PlaybackHistoryQuery } from '../../../shared/types/library';

export type HistoryFilter = 'all' | 'today' | 'week' | 'month' | 'year' | 'custom' | 'completed';
export type HistoryDates = { from: string; to: string };

export const localHistoryDate = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export const parseHistoryDate = (value: string): Date | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1000) return null;
  const date = new Date(year, month - 1, day);
  return localHistoryDate(date) === value ? date : null;
};

export const validHistoryDates = (dates: HistoryDates): boolean =>
  Boolean(parseHistoryDate(dates.from) && parseHistoryDate(dates.to) && dates.from <= dates.to);

export const defaultHistoryDates = (): HistoryDates => {
  const now = new Date();
  return { from: localHistoryDate(new Date(now.getFullYear(), now.getMonth(), 1)), to: localHistoryDate(now) };
};

/** Local calendar days, with an exclusive upper bound just like the existing history queries. */
export const historyDateRange = (filter: HistoryFilter, dates: HistoryDates, completedOnly: boolean, now = new Date()): PlaybackHistoryQuery => {
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const to = new Date(from);
  let range: Pick<PlaybackHistoryQuery, 'from' | 'to'> = {};
  if (filter === 'custom') {
    const start = parseHistoryDate(dates.from);
    const end = parseHistoryDate(dates.to);
    if (!start || !end || start > end) throw new Error('Invalid history date range');
    end.setDate(end.getDate() + 1);
    range = { from: start.toISOString(), to: end.toISOString() };
  } else if (filter !== 'all' && filter !== 'completed') {
    if (filter === 'week') from.setDate(from.getDate() - (from.getDay() || 7) + 1);
    if (filter === 'month') from.setDate(1);
    if (filter === 'year') from.setMonth(0, 1);
    to.setTime(from.getTime());
    if (filter === 'today') to.setDate(to.getDate() + 1);
    if (filter === 'week') to.setDate(to.getDate() + 7);
    if (filter === 'month') to.setMonth(to.getMonth() + 1);
    if (filter === 'year') to.setFullYear(to.getFullYear() + 1);
    range = { from: from.toISOString(), to: to.toISOString() };
  }
  return { ...range, ...(filter === 'completed' || completedOnly ? { completedOnly: true } : {}) };
};
