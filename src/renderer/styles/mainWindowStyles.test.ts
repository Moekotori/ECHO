import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('main window style ownership', () => {
  it('loads shared library styles before any lazy route renders', () => {
    const mainWindowStyles = readFileSync('src/renderer/styles/mainWindowStyles.ts', 'utf8');
    const trackList = readFileSync('src/renderer/components/library/TrackList.tsx', 'utf8');

    expect(mainWindowStyles).toContain("import './songs.css';");
    expect(mainWindowStyles).toContain("import './player-transport-polish.css';");
    expect(mainWindowStyles.indexOf("import './player-transport-polish.css';")).toBeGreaterThan(
      mainWindowStyles.indexOf("import './theme-presets.css';"),
    );
    expect(trackList).not.toContain("styles/songs.css");
  });

  it('lets the streaming route own the album detail styles it renders', () => {
    const streamingSearchPage = readFileSync('src/renderer/components/streaming/StreamingSearchPage.tsx', 'utf8');

    expect(streamingSearchPage).toContain("import '../../styles/album-detail.css';");
  });

  it('keeps route-specific liked and history styles out of the startup bundle', () => {
    const mainWindowStyles = readFileSync('src/renderer/styles/mainWindowStyles.ts', 'utf8');
    const likedPage = readFileSync('src/renderer/pages/LikedPage.tsx', 'utf8');
    const historyPage = readFileSync('src/renderer/pages/HistoryPage.tsx', 'utf8');

    expect(mainWindowStyles).not.toContain("import './liked.css';");
    expect(mainWindowStyles).not.toContain("import './history-redesign.css';");
    expect(likedPage).toContain("import '../styles/liked.css';");
    expect(historyPage).toContain("import '../styles/history-redesign.css';");
  });
});
