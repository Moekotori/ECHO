import type { LucideIcon } from 'lucide-react';

type EmptyStateProps = {
  icon: LucideIcon;
  title: string;
  description: string;
  meta?: string;
};

export const EmptyState = ({ icon: Icon, title, description, meta }: EmptyStateProps): JSX.Element => {
  return (
    <section className="empty-state">
      <div className="empty-icon" aria-hidden="true">
        <Icon size={26} />
      </div>
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
        {meta ? <span>{meta}</span> : null}
      </div>
    </section>
  );
};
