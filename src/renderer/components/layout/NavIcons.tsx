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
    ({ absoluteStrokeWidth, children, color = 'currentColor', size = 24, strokeWidth = 1.75, ...props }, ref) => (
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
    <path d="M4.8 11.2 12 5.3l7.2 5.9" />
    <path d="M6.6 10.3v7.2c0 .9.7 1.6 1.6 1.6h7.6c.9 0 1.6-.7 1.6-1.6v-7.2" />
    <path d="M9.2 15.5c1.7-1.7 3.9-1.7 5.6 0" />
    <path d="M10.9 17.1c.7-.6 1.5-.6 2.2 0" />
  </>,
);

export const EchoSongsIcon = createNavIcon(
  'EchoSongsIcon',
  <>
    <path d="M9.1 16.8c0 1.1-1 1.9-2.2 1.9s-2.2-.8-2.2-1.9 1-1.9 2.2-1.9 2.2.8 2.2 1.9Z" />
    <path d="M18.2 14.9c0 1.1-1 1.9-2.2 1.9s-2.2-.8-2.2-1.9 1-1.9 2.2-1.9 2.2.8 2.2 1.9Z" />
    <path d="M9.1 16.8V5.3h9.1v9.6" />
    <path d="M9.1 8.9h9.1" />
  </>,
);

export const EchoDownloadsIcon = createNavIcon(
  'EchoDownloadsIcon',
  <>
    <path d="M12 4.8v8.2" />
    <path d="M8.8 10.1 12 13.3l3.2-3.2" />
    <path d="M6.5 16.1v1.4c0 1.1.9 2 2 2h7c1.1 0 2-.9 2-2v-1.4" />
    <path d="M8.4 16.1h7.2" />
  </>,
);

export const EchoAlbumsIcon = createNavIcon(
  'EchoAlbumsIcon',
  <>
    <circle cx="12" cy="12" r="6.4" />
    <circle cx="12" cy="12" r="1.1" />
    <path d="M12 5.6v1.2" />
  </>,
);

export const EchoArtistsIcon = createNavIcon(
  'EchoArtistsIcon',
  <>
    <circle cx="9" cy="9.2" r="2.4" />
    <circle cx="16" cy="10.1" r="2" />
    <path d="M4.8 18.4v-1.1c0-2 1.9-3.6 4.2-3.6s4.2 1.6 4.2 3.6v1.1" />
    <path d="M13.9 14.5c2.1.2 3.7 1.7 3.7 3.4v.5" />
  </>,
);

export const EchoFoldersIcon = createNavIcon(
  'EchoFoldersIcon',
  <>
    <path d="M4.7 8.2c0-1 .8-1.8 1.8-1.8h3.2l1.8 1.9h6c1 0 1.8.8 1.8 1.8v6.3c0 1-.8 1.8-1.8 1.8h-11c-1 0-1.8-.8-1.8-1.8V8.2Z" />
    <path d="M4.9 10h14.2" />
  </>,
);

export const EchoRemoteIcon = createNavIcon(
  'EchoRemoteIcon',
  <>
    <circle cx="12" cy="12" r="7" />
    <path d="M5.4 12h13.2" />
    <path d="M12 5c2 2 3.1 4.3 3.1 7S14 17 12 19" />
    <path d="M12 5c-2 2-3.1 4.3-3.1 7S10 17 12 19" />
  </>,
);

export const EchoConnectIcon = createNavIcon(
  'EchoConnectIcon',
  <>
    <rect x="5" y="6" width="14" height="8.6" rx="2" />
    <path d="M8.5 18h7" />
    <path d="M12 14.6V18" />
    <path d="M9.1 10.2h5.8" />
  </>,
);

export const EchoDspIcon = createNavIcon(
  'EchoDspIcon',
  <>
    <path d="M5.2 7.3h6.2" />
    <circle cx="15.3" cy="7.3" r="1.7" />
    <path d="M17 7.3h1.8" />
    <path d="M5.2 12h2.1" />
    <circle cx="10.6" cy="12" r="1.7" />
    <path d="M12.3 12h6.5" />
    <path d="M5.2 16.7h8.8" />
    <circle cx="17" cy="16.7" r="1.7" />
  </>,
);

export const EchoStreamingIcon = createNavIcon(
  'EchoStreamingIcon',
  <>
    <circle cx="12" cy="13" r="1.35" />
    <path d="M9.1 15.8a4.1 4.1 0 0 1 0-5.6" />
    <path d="M14.9 10.2a4.1 4.1 0 0 1 0 5.6" />
    <path d="M6.8 18a7.3 7.3 0 0 1 0-10" />
    <path d="M17.2 8a7.3 7.3 0 0 1 0 10" />
  </>,
);

export const EchoQueueIcon = createNavIcon(
  'EchoQueueIcon',
  <>
    <path d="M5.2 7.2h8.8" />
    <path d="M5.2 12h8.8" />
    <path d="M5.2 16.8h6.2" />
    <path d="M16.3 14.7v4.2" />
    <path d="M14.2 16.8h4.2" />
  </>,
);

export const EchoHistoryIcon = createNavIcon(
  'EchoHistoryIcon',
  <>
    <path d="M7.7 7.2A7 7 0 1 1 5 12.7" />
    <path d="M5 7.2h2.7V4.6" />
    <path d="M12 8.3v4.1l2.8 1.7" />
  </>,
);

export const EchoPlaylistsIcon = createNavIcon(
  'EchoPlaylistsIcon',
  <>
    <path d="M5.2 7.2h9.4" />
    <path d="M5.2 12h8.2" />
    <path d="M5.2 16.8h6.5" />
    <path d="M17.4 6.8v7.7" />
    <path d="M17.4 6.8l2.3.7" />
    <path d="M17.4 14.5c0 .9-.8 1.6-1.8 1.6s-1.8-.7-1.8-1.6.8-1.6 1.8-1.6 1.8.7 1.8 1.6Z" />
  </>,
);

export const EchoLikedIcon = createNavIcon(
  'EchoLikedIcon',
  <>
    <path d="M12 18.9s-6.7-4-6.7-8.7A3.7 3.7 0 0 1 12 8a3.7 3.7 0 0 1 6.7 2.2c0 4.7-6.7 8.7-6.7 8.7Z" />
  </>,
);

export const EchoAudioSettingsIcon = createNavIcon(
  'EchoAudioSettingsIcon',
  <>
    <path d="M5.3 13.5v-1.4a6.7 6.7 0 0 1 13.4 0v1.4" />
    <path d="M7.4 13.1h1.2c.6 0 1 .4 1 1v2.5c0 .6-.4 1-1 1H7.4c-.6 0-1-.4-1-1v-2.5c0-.6.4-1 1-1Z" />
    <path d="M16.6 13.1h1.2c.6 0 1 .4 1 1v2.5c0 .6-.4 1-1 1h-1.2c-.6 0-1-.4-1-1v-2.5c0-.6.4-1 1-1Z" />
    <circle cx="12" cy="17" r="1.45" />
  </>,
);

export const EchoLyricsSettingsIcon = createNavIcon(
  'EchoLyricsSettingsIcon',
  <>
    <rect x="4.8" y="6" width="14.4" height="11.8" rx="2.4" />
    <path d="M8.1 10.1h7.8" />
    <path d="M8.1 13.8h4.1" />
    <circle cx="16" cy="13.8" r="1.25" />
  </>,
);

export const EchoImportFolderIcon = createNavIcon(
  'EchoImportFolderIcon',
  <>
    <path d="M4.6 8.1c0-1.2.9-2.1 2.1-2.1h3l1.8 2h5.8c1.2 0 2.1.9 2.1 2.1v6.2c0 1.2-.9 2.1-2.1 2.1H6.7c-1.2 0-2.1-.9-2.1-2.1V8.1Z" />
    <path d="M12 11.3v4.6" />
    <path d="M9.7 13.6h4.6" />
  </>,
);

export const EchoImportFileIcon = createNavIcon(
  'EchoImportFileIcon',
  <>
    <path d="M7.2 4.9h6.1l3.5 3.6v10.6H7.2V4.9Z" />
    <path d="M13.2 4.9v3.7h3.6" />
    <path d="M12 11.6v4.8" />
    <path d="M9.6 14h4.8" />
  </>,
);

export const EchoSettingsIcon = createNavIcon(
  'EchoSettingsIcon',
  <>
    <path d="M5.2 7.4h5" />
    <circle cx="13" cy="7.4" r="1.6" />
    <path d="M14.6 7.4h4.2" />
    <path d="M5.2 12h8.2" />
    <circle cx="16.2" cy="12" r="1.6" />
    <path d="M17.8 12h1" />
    <path d="M5.2 16.6h2.6" />
    <circle cx="10.6" cy="16.6" r="1.6" />
    <path d="M12.2 16.6h6.6" />
  </>,
);

export const EchoPluginsIcon = createNavIcon(
  'EchoPluginsIcon',
  <>
    <path d="M8.1 4.8h3.6v4.1H7.6a2.4 2.4 0 0 1-2.4-2.4V5.3" />
    <path d="M12.3 4.8h3.6l2.9 2.9v10.1c0 1-.8 1.8-1.8 1.8H7c-1 0-1.8-.8-1.8-1.8V9.7" />
    <path d="M15.9 4.8v3h3" />
    <path d="m9 13.1 1.8 1.8L9 16.7" />
    <path d="M15 13.1h-2.5" />
    <path d="M15 16.7h-2.5" />
  </>,
);
