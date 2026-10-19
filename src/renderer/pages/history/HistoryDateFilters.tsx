import { useState } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import type { TranslationKey } from '../../i18n/locales';
import { validHistoryDates, type HistoryDates, type HistoryFilter } from './historyDateRange';
import './history-date-filters.css';

const labels: Record<HistoryFilter, TranslationKey> = {
  all: 'historyPage.filter.all', today: 'historyPage.filter.today', week: 'historyPage.filter.week', month: 'historyPage.filter.month',
  year: 'communityLibrary.history.year', custom: 'communityLibrary.history.custom', completed: 'historyPage.filter.completed',
};

export const HistoryDateFilters = ({ filter, dates, completedOnly, onFilter, onDates, onCompleted }: {
  filter: HistoryFilter; dates: HistoryDates; completedOnly: boolean;
  onFilter: (value: HistoryFilter) => void; onDates: (value: HistoryDates) => void; onCompleted: (value: boolean) => void;
}): JSX.Element => {
  const { t } = useI18n();
  return <div className="history-date-filters">
    <div className="history-filter-tabs">{(Object.keys(labels) as HistoryFilter[]).map((value) =>
      <button key={value} type="button" className={filter === value ? 'active' : ''} aria-pressed={filter === value} onClick={() => onFilter(value)}>{t(labels[value])}</button>)}</div>
    {filter !== 'completed' ? <label className="history-completed-filter"><input type="checkbox" checked={completedOnly}
      onChange={(event) => onCompleted(event.target.checked)} />{t('communityLibrary.history.completed')}</label> : null}
    {filter === 'custom' ? <CustomDates key={`${dates.from}:${dates.to}`} dates={dates} onApply={onDates} /> : null}
  </div>;
};

const CustomDates = ({ dates, onApply }: { dates: HistoryDates; onApply: (value: HistoryDates) => void }): JSX.Element => {
  const { t } = useI18n();
  const [draft, setDraft] = useState(dates);
  const [invalid, setInvalid] = useState(false);
  return <form className="history-custom-dates" onSubmit={(event) => {
    event.preventDefault();
    if (!validHistoryDates(draft)) { setInvalid(true); return; }
    setInvalid(false); onApply(draft);
  }}>
    <label>{t('communityLibrary.history.from')}<input type="date" value={draft.from} required max={draft.to || undefined}
      onChange={(event) => { setDraft({ ...draft, from: event.target.value }); setInvalid(false); }} /></label>
    <label>{t('communityLibrary.history.to')}<input type="date" value={draft.to} required min={draft.from || undefined}
      onChange={(event) => { setDraft({ ...draft, to: event.target.value }); setInvalid(false); }} /></label>
    <button className="history-action-button" type="submit">{t('communityLibrary.history.apply')}</button>
    {invalid ? <span role="alert">{t('communityLibrary.history.invalid')}</span> : null}
  </form>;
};
