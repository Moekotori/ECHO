// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Captions, FilePlus2, FolderPlus, Headphones, Music2, Settings } from 'lucide-react';
import { Sidebar } from './Sidebar';
import type { AppRoute } from '../../app/routes';
import { I18nProvider } from '../../i18n/I18nProvider';

const routes: AppRoute[] = [
  {
    id: 'songs',
    label: 'Songs',
    description: 'Songs',
    icon: Music2,
    placement: 'main',
    element: <div>Songs</div>,
  },
  {
    id: 'lyrics',
    label: 'Lyrics',
    description: 'Lyrics',
    icon: Music2,
    placement: 'main',
    hideFromSidebar: true,
    element: <div>Lyrics</div>,
  },
  {
    id: 'import-folder',
    label: 'Import Folder',
    description: 'Import Folder',
    icon: FolderPlus,
    placement: 'utility',
    element: <div>Import Folder</div>,
  },
  {
    id: 'audio-settings',
    label: 'Audio Settings',
    description: 'Audio Settings',
    icon: Headphones,
    placement: 'utility',
    element: <div>Audio Settings</div>,
  },
  {
    id: 'lyrics-settings',
    label: 'Lyrics Settings',
    description: 'Lyrics Settings',
    icon: Captions,
    placement: 'utility',
    element: <div>Lyrics Settings</div>,
  },
  {
    id: 'import-file',
    label: 'Import File',
    description: 'Import File',
    icon: FilePlus2,
    placement: 'utility',
    element: <div>Import File</div>,
  },
  {
    id: 'settings',
    label: 'Settings',
    description: 'Settings',
    icon: Settings,
    placement: 'utility',
    element: <div>Settings</div>,
  },
];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Sidebar direct import actions', () => {
  const renderSidebar = (props: {
    onRouteChange: (routeId: AppRoute['id']) => void;
    onOpenAudioSettings?: () => void;
    onOpenLyricsSettings?: () => void;
    onImportFolder: () => void;
    onImportFile: () => void;
  }): ReturnType<typeof render> => {
    return render(
      <I18nProvider>
        <Sidebar
          routes={routes}
          activeRouteId="songs"
          onRouteChange={props.onRouteChange}
          onOpenAudioSettings={props.onOpenAudioSettings ?? vi.fn()}
          onOpenLyricsSettings={props.onOpenLyricsSettings ?? vi.fn()}
          onImportFolder={props.onImportFolder}
          onImportFile={props.onImportFile}
        />
      </I18nProvider>,
    );
  };

  it('opens the folder picker from Import Folder without navigating', async () => {
    const onRouteChange = vi.fn();
    const onImportFolder = vi.fn();
    const onImportFile = vi.fn();

    renderSidebar({ onRouteChange, onImportFolder, onImportFile });

    fireEvent.click(screen.getByRole('button', { name: 'Import Folder' }));

    await waitFor(() => expect(onImportFolder).toHaveBeenCalledTimes(1));
    expect(onImportFile).not.toHaveBeenCalled();
    expect(onRouteChange).not.toHaveBeenCalled();
  });

  it('opens the audio settings drawer from Audio Settings without navigating', async () => {
    const onRouteChange = vi.fn();
    const onOpenAudioSettings = vi.fn();
    const onOpenLyricsSettings = vi.fn();

    renderSidebar({
      onRouteChange,
      onOpenAudioSettings,
      onOpenLyricsSettings,
      onImportFolder: vi.fn(),
      onImportFile: vi.fn(),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Audio Settings' }));

    await waitFor(() => expect(onOpenAudioSettings).toHaveBeenCalledTimes(1));
    expect(onOpenLyricsSettings).not.toHaveBeenCalled();
    expect(onRouteChange).not.toHaveBeenCalled();
  });

  it('opens the lyrics settings drawer from Lyrics Settings without navigating', async () => {
    const onRouteChange = vi.fn();
    const onOpenAudioSettings = vi.fn();
    const onOpenLyricsSettings = vi.fn();

    renderSidebar({
      onRouteChange,
      onOpenAudioSettings,
      onOpenLyricsSettings,
      onImportFolder: vi.fn(),
      onImportFile: vi.fn(),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Lyrics Settings' }));

    await waitFor(() => expect(onOpenLyricsSettings).toHaveBeenCalledTimes(1));
    expect(onOpenAudioSettings).not.toHaveBeenCalled();
    expect(onRouteChange).not.toHaveBeenCalled();
  });

  it('hides routes marked as hidden from the sidebar', () => {
    renderSidebar({ onRouteChange: vi.fn(), onImportFolder: vi.fn(), onImportFile: vi.fn() });

    expect(screen.queryByRole('button', { name: 'Lyrics' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Songs' })).toBeTruthy();
  });

  it('renders one icon shell for each visible route', () => {
    const { container } = renderSidebar({ onRouteChange: vi.fn(), onImportFolder: vi.fn(), onImportFile: vi.fn() });
    const visibleRouteCount = routes.filter((route) => !route.hideFromSidebar).length;

    expect(container.querySelectorAll('.nav-icon-shell')).toHaveLength(visibleRouteCount);
  });

  it('opens the audio file picker from Import File without navigating', async () => {
    const onRouteChange = vi.fn();
    const onImportFolder = vi.fn();
    const onImportFile = vi.fn();

    renderSidebar({ onRouteChange, onImportFolder, onImportFile });

    fireEvent.click(screen.getByRole('button', { name: 'Import File' }));

    await waitFor(() => expect(onImportFile).toHaveBeenCalledTimes(1));
    expect(onImportFolder).not.toHaveBeenCalled();
    expect(onRouteChange).not.toHaveBeenCalled();
  });
});
