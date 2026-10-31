import { forwardRef, type ReactNode } from 'react';
import type { LucideIcon, LucideProps } from 'lucide-react';

const getStrokeWidth = (strokeWidth: LucideProps['strokeWidth'], size: LucideProps['size'], absoluteStrokeWidth?: boolean) => {
  if (!absoluteStrokeWidth || typeof size !== 'number') {
    return strokeWidth;
  }

  return (Number(strokeWidth) * 24) / size;
};

const createNavIcon = (displayName: string, paths: ReactNode): LucideIcon => {
  const Icon = forwardRef<SVGSVGElement, LucideProps>(
    ({ absoluteStrokeWidth, children, color = 'currentColor', size = 24, strokeWidth = 1.65, ...props }, ref) => (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={getStrokeWidth(strokeWidth, size, absoluteStrokeWidth)}
        {...props}
      >
        {paths}
        {children}
      </svg>
    ),
  );

  Icon.displayName = displayName;
  return Icon as LucideIcon;
};

export const EchoHomeIcon = createNavIcon(
  'EchoHomeIcon',
  <>
    <path d="M4.7 10.3 12 4.8l7.3 5.5" />
    <path d="M6.4 9.5v8c0 1 .8 1.8 1.8 1.8h7.6c1 0 1.8-.8 1.8-1.8v-8" />
    <rect x="9.2" y="12.5" width="5.6" height="5" rx="1.3" fill="currentColor" stroke="none" />
  </>,
);

export const EchoSongsIcon = createNavIcon(
  'EchoSongsIcon',
  <>
    <path d="M9.2 16.9V6.4l8.5-1.5v10.3" />
    <path d="m9.2 9 8.5-1.5" />
    <ellipse cx="6.8" cy="17" rx="2.4" ry="1.8" />
    <ellipse cx="15.3" cy="15.3" rx="2.4" ry="1.8" />
  </>,
);

export const EchoDownloadsIcon = createNavIcon(
  'EchoDownloadsIcon',
  <>
    <path d="M12 4.6v9" />
    <path d="m8.6 10.5 3.4 3.4 3.4-3.4" />
    <path d="M5.4 16.1v1.3c0 1.1.9 2 2 2h9.2c1.1 0 2-.9 2-2v-1.3" />
  </>,
);

export const EchoAlbumsIcon = createNavIcon(
  'EchoAlbumsIcon',
  <>
    <circle cx="12" cy="12" r="7" />
    <circle cx="12" cy="12" r="1.4" />
    <path d="M12 5v1.2" />
  </>,
);

export const EchoArtistsIcon = createNavIcon(
  'EchoArtistsIcon',
  <>
    <circle cx="8.6" cy="8.7" r="2.4" />
    <circle cx="15.8" cy="9.5" r="2.1" />
    <path d="M4.5 18.7v-1c0-2.4 1.8-4.2 4.1-4.2s4.1 1.8 4.1 4.2v1" />
    <path d="M13.8 14.2c.6-.3 1.3-.5 2-.5 2.1 0 3.7 1.6 3.7 3.6v.7" />
  </>,
);

export const EchoFoldersIcon = createNavIcon(
  'EchoFoldersIcon',
  <>
    <path d="M4.6 7.4c0-1 .8-1.8 1.8-1.8h3.2l1.8 2h6.2c1 0 1.8.8 1.8 1.8v7.8c0 1-.8 1.8-1.8 1.8H6.4c-1 0-1.8-.8-1.8-1.8V7.4Z" />
    <path d="M4.8 9.8h14.4" />
  </>,
);

export const EchoRemoteIcon = createNavIcon(
  'EchoRemoteIcon',
  <>
    <circle cx="12" cy="12" r="7.2" />
    <path d="M4.8 12h14.4" />
    <path d="M12 4.8c2.1 2 3.2 4.4 3.2 7.2S14.1 17.2 12 19.2" />
    <path d="M12 4.8C9.9 6.8 8.8 9.2 8.8 12s1.1 5.2 3.2 7.2" />
  </>,
);

export const EchoConnectIcon = createNavIcon(
  'EchoConnectIcon',
  <>
    <rect x="4.7" y="5.6" width="14.6" height="9.7" rx="1.8" />
    <path d="M8.7 19h6.6" />
    <path d="M12 15.3V19" />
  </>,
);

export const EchoDspIcon = createNavIcon(
  'EchoDspIcon',
  <>
    <path d="M7 4.8v3.1M7 11.5v7.7" />
    <circle cx="7" cy="9.7" r="1.8" />
    <path d="M12 4.8v7.4M12 15.8v3.4" />
    <circle cx="12" cy="14" r="1.8" />
    <path d="M17 4.8v1.8M17 10.2v9" />
    <circle cx="17" cy="8.4" r="1.8" />
  </>,
);

export const EchoStreamingIcon = createNavIcon(
  'EchoStreamingIcon',
  <>
    <circle cx="12" cy="13" r="1.3" fill="currentColor" stroke="none" />
    <path d="M9.2 15.8a4 4 0 0 1 0-5.6" />
    <path d="M14.8 10.2a4 4 0 0 1 0 5.6" />
    <path d="M6.8 18.1a7.2 7.2 0 0 1 0-10.2" />
    <path d="M17.2 7.9a7.2 7.2 0 0 1 0 10.2" />
  </>,
);

export const EchoQueueIcon = createNavIcon(
  'EchoQueueIcon',
  <>
    <path d="M5 6.8h9" />
    <path d="M5 11.5h9" />
    <path d="M5 16.2h6.2" />
    <path d="M17.4 13.8v5" />
    <path d="M14.9 16.3h5" />
  </>,
);

export const EchoHistoryIcon = createNavIcon(
  'EchoHistoryIcon',
  <>
    <path d="M7.4 7.1A7.2 7.2 0 1 1 4.8 13" />
    <path d="M4.8 7.1h2.9V4.4" />
    <path d="M12 8.2v4.4l-3 1.8" />
  </>,
);

export const EchoPlaylistsIcon = createNavIcon(
  'EchoPlaylistsIcon',
  <>
    <path d="M5 6.8h9" />
    <path d="M5 11.5h7.6" />
    <path d="M5 16.2h5.6" />
    <path d="M16.7 6.4v8.7" />
    <path d="m16.7 6.4 2.6.8" />
    <ellipse cx="14.4" cy="16.1" rx="2.3" ry="1.7" />
  </>,
);

export const EchoLikedIcon = createNavIcon(
  'EchoLikedIcon',
  <path d="M12 19.1s-6.8-4.1-6.8-8.8A3.8 3.8 0 0 1 12 8a3.8 3.8 0 0 1 6.8 2.3c0 4.7-6.8 8.8-6.8 8.8Z" />,
);

export const EchoAudioSettingsIcon = createNavIcon(
  'EchoAudioSettingsIcon',
  <>
    <path d="M5.1 13.5v-1.6a6.9 6.9 0 0 1 13.8 0v1.6" />
    <rect x="5.5" y="12.8" width="3.3" height="5.2" rx="1.3" />
    <rect x="15.2" y="12.8" width="3.3" height="5.2" rx="1.3" />
  </>,
);

export const EchoLyricsSettingsIcon = createNavIcon(
  'EchoLyricsSettingsIcon',
  <>
    <rect x="4.6" y="6" width="14.8" height="12" rx="2.4" />
    <path d="M8 10.2h8" />
    <path d="M8 13.8h4.2" />
    <circle cx="16" cy="13.8" r="1.3" />
  </>,
);

export const EchoImportFolderIcon = createNavIcon(
  'EchoImportFolderIcon',
  <>
    <path d="M4.6 7.4c0-1 .8-1.8 1.8-1.8h3.2l1.8 2h6.2c1 0 1.8.8 1.8 1.8v7.8c0 1-.8 1.8-1.8 1.8H6.4c-1 0-1.8-.8-1.8-1.8V7.4Z" />
    <path d="M12 11.5v4.5" />
    <path d="M9.8 13.8h4.4" />
  </>,
);

export const EchoImportFileIcon = createNavIcon(
  'EchoImportFileIcon',
  <>
    <path d="M7.2 4.8h6.2l3.5 3.6v10.8H7.2V4.8Z" />
    <path d="M13.4 4.8v3.7h3.5" />
    <path d="M12 11.5V16" />
    <path d="M9.8 13.8h4.4" />
  </>,
);

export const EchoSettingsIcon = createNavIcon(
  'EchoSettingsIcon',
  <>
    <path d="M4.8 7h6.1M14.5 7h4.7" />
    <circle cx="12.7" cy="7" r="1.8" />
    <path d="M4.8 12h2.7M11.1 12h8.1" />
    <circle cx="9.3" cy="12" r="1.8" />
    <path d="M4.8 17h8.1M16.5 17h2.7" />
    <circle cx="14.7" cy="17" r="1.8" />
  </>,
);

export const EchoPluginsIcon = createNavIcon(
  'EchoPluginsIcon',
  <path d="M9.4 5.3h1.1a2.5 2.5 0 1 1 5 0h2.8c.8 0 1.4.6 1.4 1.4v2.8h-1.1a2.5 2.5 0 1 0 0 5h1.1v2.8c0 .8-.6 1.4-1.4 1.4h-3.9v-1.1a2.5 2.5 0 1 0-5 0v1.1H5.6c-.8 0-1.4-.6-1.4-1.4v-3.9h1.1a2.5 2.5 0 1 0 0-5H4.2V6.7c0-.8.6-1.4 1.4-1.4h3.8Z" />,
);
