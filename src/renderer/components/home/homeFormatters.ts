import type { useI18n } from '../../i18n/I18nProvider';

type Translate = ReturnType<typeof useI18n>['t'];

export const formatCompactNumber = (value: number): string => {
  if (!Number.isFinite(value)) {
    return '0';
  }

  return new Intl.NumberFormat(undefined, { maximumFractionDigits: value >= 1000 ? 1 : 0, notation: value >= 10000 ? 'compact' : 'standard' }).format(value);
};

export const formatDuration = (seconds: number, t: Translate): string => {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return t('home.duration.zeroMinutes');
  }

  const totalMinutes = Math.round(seconds / 60);
  if (totalMinutes < 60) {
    return t('home.duration.minutes', { count: totalMinutes });
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? t('home.duration.hoursMinutes', { hours, minutes }) : t('home.duration.hoursOnly', { hours });
};

export const formatShortDate = (value: string | null, t: Translate, locale: string): string => {
  if (!value) {
    return t('home.date.none');
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return t('home.date.unknown');
  }

  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(date);
};
