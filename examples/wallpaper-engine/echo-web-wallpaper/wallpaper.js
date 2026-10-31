const endpoint = 'http://127.0.0.1:47668/events';
const spectrumElement = document.querySelector('#spectrum');
const titleElement = document.querySelector('#title');
const metaElement = document.querySelector('#meta');
const statusElement = document.querySelector('#status');
const bars = Array.from({ length: 32 }, () => {
  const bar = document.createElement('i');
  spectrumElement.append(bar);
  return bar;
});

let source = null;

const setConnectionState = (state, label) => {
  document.documentElement.dataset.echoState = state;
  statusElement.textContent = label;
};

const applySnapshot = (snapshot) => {
  const spectrum = Array.isArray(snapshot?.audio?.visualSpectrum)
    ? snapshot.audio.visualSpectrum
    : [];
  const energy = Number(snapshot?.audio?.visualEnergy) || 0;
  const transient = Number(snapshot?.audio?.visualTransient) || 0;

  document.documentElement.style.setProperty('--echo-energy', String(energy));
  document.documentElement.style.setProperty('--echo-transient', String(transient));
  bars.forEach((bar, index) => {
    const value = Math.max(0, Math.min(1, Number(spectrum[index]) || 0));
    bar.style.height = `${Math.max(2, value * 100)}%`;
    bar.style.opacity = String(0.3 + value * 0.7);
  });

  titleElement.textContent = snapshot?.track?.title || '打开 ECHO 开始播放';
  metaElement.textContent = [snapshot?.track?.artist, snapshot?.track?.album]
    .filter(Boolean)
    .join(' · ') || '本机实时频谱桥';
  setConnectionState('connected', snapshot?.audio?.visualTelemetryState === 'pcm' ? 'ECHO PCM LIVE' : 'ECHO 已连接');
};

const connect = () => {
  source?.close();
  source = new EventSource(endpoint);
  source.addEventListener('open', () => setConnectionState('connected', 'ECHO 已连接'));
  source.addEventListener('snapshot', (event) => {
    try {
      applySnapshot(JSON.parse(event.data));
    } catch {
      setConnectionState('error', '数据格式错误');
    }
  });
  source.addEventListener('error', () => {
    setConnectionState('error', '等待 ECHO 重连');
  });
};

window.addEventListener('beforeunload', () => source?.close(), { once: true });
connect();
