import { Cast, Download, Radio, Smartphone } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type ConnectWorkspaceMode = 'output' | 'receive' | 'mobile' | 'radio';

type ConnectWorkspaceLabels = Record<ConnectWorkspaceMode, string>;

type ConnectWorkspaceTabsProps = {
  labels: ConnectWorkspaceLabels;
  mode: ConnectWorkspaceMode;
  onModeChange: (mode: ConnectWorkspaceMode) => void;
};

const workspaceModes: Array<{ icon: LucideIcon; id: ConnectWorkspaceMode }> = [
  { id: 'output', icon: Cast },
  { id: 'receive', icon: Download },
  { id: 'mobile', icon: Smartphone },
  { id: 'radio', icon: Radio },
];

export const ConnectWorkspaceTabs = ({
  labels,
  mode,
  onModeChange,
}: ConnectWorkspaceTabsProps): JSX.Element => (
  <nav className="connect-workspace-tabs" aria-label="Connect tasks">
    {workspaceModes.map(({ icon: Icon, id }) => (
      <button
        key={id}
        type="button"
        aria-current={mode === id ? 'page' : undefined}
        data-active={mode === id ? 'true' : undefined}
        onClick={() => onModeChange(id)}
      >
        <Icon size={17} />
        <span>{labels[id]}</span>
      </button>
    ))}
  </nav>
);
