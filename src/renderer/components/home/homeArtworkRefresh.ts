export const homeArtworkRefreshEvent = 'home:refresh-artwork';

/** Existing manual refresh actions also retry remote artwork that previously failed. */
export const refreshHomeArtwork = (): void => {
  window.dispatchEvent(new Event(homeArtworkRefreshEvent));
};
