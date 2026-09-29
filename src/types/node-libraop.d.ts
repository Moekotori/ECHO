// Ambient stub for the optional native AirPlay RAOP module.
// Listed in `optionalDependencies`, so it may be absent from `node_modules`
// during typecheck/CI/Nix builds; the only consumer (AirPlayReceiverSpikeService)
// dynamic-imports it and immediately casts to its own local shape, so a bare
// `declare module` is enough to keep `tsc --noEmit` happy.
declare module '@lox-audioserver/node-libraop';
