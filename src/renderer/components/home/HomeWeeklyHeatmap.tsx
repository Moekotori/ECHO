import { memo } from 'react';
import type { PlaybackStatsDay } from '../../../shared/types/library';
import { useI18n } from '../../i18n/I18nProvider';
import { formatDuration } from './homeFormatters';
import { addDays, compareDay, formatDateKey, startOfDay, startOfWeek, weeklyHeatmapWeeks } from './homeWeekDates';

const formatMonthLabel = (date: Date, t: ReturnType<typeof useI18n>['t']): string =>
  t('home.month.label', { month: date.getMonth() + 1 });

export const HomeWeeklyHeatmap = memo(function HomeWeeklyHeatmap({ days, todayStartMs }: {
  days: PlaybackStatsDay[];
  todayStartMs: number;
}): JSX.Element {
  const { t } = useI18n();
  const today = new Date(todayStartMs);
  const currentWeekStart = startOfWeek(today);
  const firstWeekStart = addDays(currentWeekStart, -7 * (weeklyHeatmapWeeks - 1));
  const gridEnd = addDays(currentWeekStart, 6);
  const activityByDate = new Map(days.map((day) => [day.date, day]));
  const cells: Array<{
    date: Date;
    dateKey: string;
    isFuture: boolean;
    playCount: number;
    playedSeconds: number;
  }> = [];

  for (let day = firstWeekStart; compareDay(day, gridEnd) <= 0; day = addDays(day, 1)) {
    const date = startOfDay(day);
    const dateKey = formatDateKey(date);
    const activity = activityByDate.get(dateKey);
    cells.push({
      date,
      dateKey,
      isFuture: compareDay(date, today) > 0,
      playCount: activity?.playCount ?? 0,
      playedSeconds: activity?.playedSeconds ?? 0,
    });
  }

  const weeks = Array.from({ length: weeklyHeatmapWeeks }, (_, index) => cells.slice(index * 7, index * 7 + 7));
  const maxCount = Math.max(...cells.map((day) => day.playCount), 1);
  const monthStarts = weeks.reduce<Array<{ label: string; month: number; span: number; week: number; year: number }>>((labels, week, weekIndex) => {
    const firstDay = week[0]?.date;

    if (!firstDay) {
      return labels;
    }

    const lastLabel = labels.at(-1);
    if (!lastLabel || firstDay.getMonth() !== lastLabel.month || firstDay.getFullYear() !== lastLabel.year) {
      labels.push({
        label: formatMonthLabel(firstDay, t),
        month: firstDay.getMonth(),
        span: 1,
        week: weekIndex,
        year: firstDay.getFullYear(),
      });
      return labels;
    }

    lastLabel.span += 1;
    return labels;
  }, []);
  const activeWeeks = weeks.filter((week) => week.some((day) => !day.isFuture && day.playCount > 0)).length;
  const getLevel = (count: number): number => {
    if (count <= 0) {
      return 0;
    }

    const ratio = count / maxCount;
    if (ratio >= 0.8) {
      return 4;
    }
    if (ratio >= 0.55) {
      return 3;
    }
    if (ratio >= 0.25) {
      return 2;
    }
    return 1;
  };

  return (
    <div className="home-week-heatmap">
      <div className="home-week-months" style={{ gridTemplateColumns: `24px repeat(${weeklyHeatmapWeeks}, var(--home-week-cell))` }}>
        {monthStarts.map((month) => (
          <span key={`${month.year}-${month.month}`} title={month.label} data-short-span={month.span === 1 ? 'true' : undefined} style={{ gridColumn: `${month.week + 2} / span ${month.span}` }}>
            {month.label}
          </span>
        ))}
      </div>
      <div className="home-week-grid-shell">
        <div className="home-weekdays" aria-hidden="true">
          <span>{t('home.weekday.mon')}</span>
          <span />
          <span>{t('home.weekday.wed')}</span>
          <span />
          <span>{t('home.weekday.fri')}</span>
          <span />
          <span />
        </div>
        <div
          className="home-week-grid"
          style={{ gridTemplateColumns: `repeat(${weeklyHeatmapWeeks}, var(--home-week-cell))` }}
          aria-label={t('home.weeklyHeatmap.aria', { weeks: weeklyHeatmapWeeks })}
        >
          {cells.map((day) => (
            <span
              className="home-week-cell"
              data-future={day.isFuture ? 'true' : undefined}
              data-level={day.isFuture ? 0 : getLevel(day.playCount)}
              key={day.dateKey}
              title={t('home.weeklyHeatmap.dayTitle', { date: day.dateKey, playCount: day.playCount, duration: formatDuration(day.playedSeconds, t) })}
              aria-label={t('home.weeklyHeatmap.dayAria', { date: day.dateKey, playCount: day.playCount })}
            />
          ))}
        </div>
      </div>
      <div className="home-week-legend" aria-hidden="true">
        <span>{t('home.weeklyHeatmap.activeWeeks', { count: activeWeeks })}</span>
        <i data-level={0} />
        <i data-level={1} />
        <i data-level={2} />
        <i data-level={3} />
        <i data-level={4} />
      </div>
    </div>
  );
});
