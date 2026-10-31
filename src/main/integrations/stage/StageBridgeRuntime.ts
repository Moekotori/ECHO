let activeEventStreamClients = 0;

export const incrementStageBridgeClients = (): number => {
  activeEventStreamClients += 1;
  return activeEventStreamClients;
};

export const decrementStageBridgeClients = (): number => {
  activeEventStreamClients = Math.max(0, activeEventStreamClients - 1);
  return activeEventStreamClients;
};

export const getStageBridgeClientCount = (): number => activeEventStreamClients;

export const isStageBridgeVisualTelemetryActive = (): boolean => activeEventStreamClients > 0;

export const resetStageBridgeRuntimeForTests = (): void => {
  activeEventStreamClients = 0;
};
