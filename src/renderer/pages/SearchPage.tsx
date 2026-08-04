import { Search } from 'lucide-react';
import { EmptyState } from '../components/ui/EmptyState';

export const SearchPage = (): JSX.Element => {
  return (
    <div className="page-stack">
      <div className="search-preview" aria-hidden="true">
        <span>Search title, artist, album</span>
      </div>
      <EmptyState
        icon={Search}
        title="Search will be backed by indexed library data."
        description="Phase 1 should route this through SearchService with SQLite FTS or an equivalent paged index."
        meta="The UI never filters an entire library array in memory."
      />
    </div>
  );
};
