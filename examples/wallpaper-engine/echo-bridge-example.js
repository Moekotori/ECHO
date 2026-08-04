// Wallpaper Engine Web wallpaper example.
// Paste this into a Web wallpaper script and render `snapshot.audio.visualSpectrum`.
const echoBridge = {
  source: null,
  snapshot: null,
  connect(onSnapshot) {
    if (this.source) {
      this.source.close();
    }

    this.source = new EventSource('http://127.0.0.1:47668/events');
    this.source.addEventListener('snapshot', (event) => {
      const snapshot = JSON.parse(event.data);
      this.snapshot = snapshot;
      onSnapshot(snapshot);
    });
    this.source.addEventListener('error', () => {
      this.snapshot = null;
    });
  },
  disconnect() {
    if (this.source) {
      this.source.close();
      this.source = null;
    }
  },
};

echoBridge.connect((snapshot) => {
  const spectrum = snapshot.audio.visualSpectrum;
  const energy = snapshot.audio.visualEnergy;
  const outputMode = snapshot.outputMode; // "shared", "exclusive", "asio", or "system".

  // Replace this with your canvas / DOM visualizer.
  window.echoWallpaperEngineSnapshot = { spectrum, energy, outputMode, snapshot };
});
