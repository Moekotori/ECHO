let activeEventStreamClients = 0;

export const incrementWallpaperEngineBridgeClients = (): number => {
  activeEventStreamClients += 1;
  return activeEventStreamClients;
};

export const decrementWallpaperEngineBridgeClients = (): number => {
  activeEventStreamClients = Math.max(0, activeEventStreamClients - 1);
  return activeEventStreamClients;
};

export const getWallpaperEngineBridgeClientCount = (): number => activeEventStreamClients;

export const isWallpaperEngineBridgeVisualTelemetryActive = (): boolean => activeEventStreamClients > 0;

export const resetWallpaperEngineBridgeRuntimeForTests = (): void => {
  activeEventStreamClients = 0;
};
