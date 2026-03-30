import { useRef, useState, useMemo, useCallback, useEffect } from "react";
import { hexToRgbaString } from "../utils/color";

export function EqPlot({
  accentHex,
  bands,
  onBandChange,
  enabled,
  preamp,
  onPreampChange,
  analyser,
}) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [draggingIdx, setDraggingIdx] = useState(null);
  const [hoverIdx, setHoverIdx] = useState(null);
  const animationRef = useRef(null);

  const freqToX = (f, width) => {
    return (
      ((Math.log10(f) - Math.log10(20)) /
        (Math.log10(20000) - Math.log10(20))) *
      width
    );
  };

  const xToFreq = (x, width) => {
    return Math.pow(
      10,
      (x / width) * (Math.log10(20000) - Math.log10(20)) + Math.log10(20),
    );
  };

  const gainToY = (g, height) => {
    const padding = 25;
    const usableHeight = height - padding * 2;
    return padding + usableHeight / 2 - (g / 24) * usableHeight;
  };

  const yToGain = (y, height) => {
    const padding = 25;
    const usableHeight = height - padding * 2;
    return ((padding + usableHeight / 2 - y) / usableHeight) * 24;
  };

  const frequencies = useMemo(() => {
    const f = new Float32Array(400);
    for (let i = 0; i < 400; i++) {
      f[i] = xToFreq((i / 400) * 1000, 1000);
    }
    return f;
  }, []);

  const accent = accentHex || "#f7aab5";

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    const { width, height } = rect;

    ctx.clearRect(0, 0, width, height);

    if (enabled && analyser) {
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      analyser.getByteFrequencyData(dataArray);

      ctx.beginPath();
      ctx.moveTo(0, height);

      const spectrumPoints = 120;
      for (let i = 0; i <= spectrumPoints; i++) {
        const x = (i / spectrumPoints) * width;
        const f = xToFreq(x, width);

        const sampleRate = 44100;
        const binIndex = Math.floor((f / (sampleRate / 2)) * bufferLength);

        const val = dataArray[binIndex] || 0;
        const percent = val / 255;
        const rtaY = height - percent * height * 0.6;

        ctx.lineTo(x, rtaY);
      }

      ctx.lineTo(width, height);
      const rtaGrad = ctx.createLinearGradient(0, height, 0, 0);
      rtaGrad.addColorStop(0, "rgba(0, 0, 0, 0)");
      rtaGrad.addColorStop(1, hexToRgbaString(accent, 0.15));
      ctx.fillStyle = rtaGrad;
      ctx.fill();
    }

    ctx.lineWidth = 1;
    [-12, -6, 0, 6, 12].forEach((g) => {
      const y = gainToY(g, height);
      ctx.strokeStyle = g === 0 ? "rgba(0,0,0,0.15)" : "rgba(0,0,0,0.04)";
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();

      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.font = "800 9px Inter";
      ctx.textAlign = "right";
      ctx.fillText(`${g > 0 ? "+" : ""}${g}`, width - 5, y - 4);
    });

    const gridFreqs = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
    gridFreqs.forEach((f) => {
      const x = freqToX(f, width);
      ctx.strokeStyle = "rgba(0,0,0,0.04)";
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();

      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.font = "800 9px Inter";
      ctx.textAlign = "center";
      const label = f >= 1000 ? `${f / 1000}k` : f;
      ctx.fillText(label, x, height - 10);
    });

    if (!enabled || !bands) return;

    const offlineCtx = new (
      window.OfflineAudioContext || window.webkitOfflineAudioContext
    )(1, 1, 44100);
    const totalMag = new Float32Array(frequencies.length).fill(1);
    bands.forEach((band) => {
      if (!band.enabled) return;
      const filter = offlineCtx.createBiquadFilter();
      filter.type = band.type;
      filter.frequency.value = band.freq;
      filter.Q.value = band.q;
      filter.gain.value = band.gain;
      const mag = new Float32Array(frequencies.length);
      const phase = new Float32Array(frequencies.length);
      filter.getFrequencyResponse(frequencies, mag, phase);
      for (let i = 0; i < frequencies.length; i++) totalMag[i] *= mag[i];
    });

    ctx.beginPath();
    ctx.moveTo(0, gainToY(0, height));
    for (let i = 0; i < frequencies.length; i++) {
      const x = (i / frequencies.length) * width;
      const db = 20 * Math.log10(totalMag[i]);
      ctx.lineTo(x, gainToY(db, height));
    }
    ctx.lineTo(width, gainToY(0, height));
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, hexToRgbaString(accent, 0.15));
    grad.addColorStop(0.5, hexToRgbaString(accent, 0.05));
    grad.addColorStop(1, hexToRgbaString(accent, 0));
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    ctx.strokeStyle = hexToRgbaString(accent, 1);
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (let i = 0; i < frequencies.length; i++) {
      const x = (i / frequencies.length) * width;
      const db = 20 * Math.log10(totalMag[i]);
      const y = gainToY(db, height);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    bands.forEach((band, idx) => {
      if (!band.enabled) return;
      const x = freqToX(band.freq, width);
      const y = gainToY(band.gain, height);
      const isActive = draggingIdx === idx || hoverIdx === idx;

      ctx.beginPath();
      ctx.arc(x, y, isActive ? 8 : 6, 0, Math.PI * 2);
      ctx.fillStyle = "white";
      ctx.fill();
      ctx.strokeStyle = hexToRgbaString(accent, 1);
      ctx.lineWidth = isActive ? 3 : 2;
      ctx.stroke();

      if (isActive) {
        ctx.fillStyle = hexToRgbaString(accent, 1);
        ctx.font = "800 10px Inter";
        ctx.textAlign = "center";
        ctx.fillText(`${Math.round(band.freq)}Hz`, x, y - 15);
      }
    });
  }, [bands, enabled, frequencies, draggingIdx, hoverIdx, analyser, accent]);

  useEffect(() => {
    const loop = () => {
      draw();
      animationRef.current = requestAnimationFrame(loop);
    };

    if (enabled && analyser) {
      animationRef.current = requestAnimationFrame(loop);
    } else {
      draw();
    }

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [draw, enabled, analyser]);

  const handleMouseDown = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const { width, height } = rect;
    let closestIdx = null;
    let minDist = 25;
    bands?.forEach((band, idx) => {
      const bx = freqToX(band.freq, width);
      const by = gainToY(band.gain, height);
      const dist = Math.sqrt((x - bx) ** 2 + (y - by) ** 2);
      if (dist < minDist) {
        minDist = dist;
        closestIdx = idx;
      }
    });
    setDraggingIdx(closestIdx);
  };

  const handleMouseMove = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const { width, height } = rect;

    let currentHover = null;
    let minDist = 20;
    bands?.forEach((band, idx) => {
      const bx = freqToX(band.freq, width);
      const by = gainToY(band.gain, height);
      const dist = Math.sqrt((x - bx) ** 2 + (y - by) ** 2);
      if (dist < minDist) {
        minDist = dist;
        currentHover = idx;
      }
    });
    setHoverIdx(currentHover);

    if (draggingIdx === null) return;
    const boundedX = Math.max(0, Math.min(width, x));
    const boundedY = Math.max(0, Math.min(height, y));
    onBandChange(draggingIdx, {
      freq: xToFreq(boundedX, width),
      gain: Math.max(-12, Math.min(12, yToGain(boundedY, height))),
    });
  };

  const activeNode =
    draggingIdx !== null
      ? bands[draggingIdx]
      : hoverIdx !== null
        ? bands[hoverIdx]
        : null;

  return (
    <div className="hi-fi-eq-plot-main-wrapper no-drag" ref={containerRef}>
      <div className="preamp-vertical-container">
        <span className="preamp-label-db">
          {preamp > 0 ? `+${preamp.toFixed(1)}` : preamp.toFixed(1)} dB
        </span>
        <div className="preamp-vertical-slider-track">
          <input
            type="range"
            min={-12}
            max={12}
            step={0.1}
            value={preamp}
            onChange={(e) => onPreampChange(parseFloat(e.target.value))}
            className="preamp-input"
          />
          <div
            className="preamp-fill"
            style={{ height: `${((preamp + 12) / 24) * 100}%` }}
          />
          <div
            className="preamp-thumb"
            style={{ bottom: `calc(${((preamp + 12) / 24) * 100}% - 8px)` }}
          />
        </div>
        <span className="preamp-label-title">PREAMP</span>
      </div>
      <div className="eq-plot-with-labels-container">
        <div className="eq-canvas-wrapper">
          <canvas
            ref={canvasRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={() => setDraggingIdx(null)}
            onMouseLeave={() => {
              setDraggingIdx(null);
              setHoverIdx(null);
            }}
            onWheel={(e) => {
              const rect = canvasRef.current.getBoundingClientRect();
              const x = e.clientX - rect.left;
              let closestIdx = null;
              let minDist = 40;
              bands?.forEach((band, idx) => {
                const bx = freqToX(band.freq, rect.width);
                const dist = Math.abs(x - bx);
                if (dist < minDist) {
                  minDist = dist;
                  closestIdx = idx;
                }
              });
              if (closestIdx !== null) {
                e.preventDefault();
                const delta = e.deltaY > 0 ? -0.1 : 0.1;
                onBandChange(closestIdx, {
                  q: Math.max(0.1, Math.min(10, bands[closestIdx].q + delta)),
                });
              }
            }}
          />
        </div>
        <div className="eq-selected-info-bar">
          <div className="info-item">
            FREQ <b>{activeNode ? Math.round(activeNode.freq) : "--"} Hz</b>
          </div>
          <div className="info-item">
            GAIN <b>{activeNode ? activeNode.gain.toFixed(1) : "--"} dB</b>
          </div>
          <div className="info-item">
            Q{" "}
            <b>
              {activeNode
                ? activeNode.activeIdx !== undefined
                  ? activeNode.q.toFixed(1)
                  : activeNode.q.toFixed(1)
                : "--"}
            </b>
          </div>
          <div
            className="info-item"
            style={{ marginLeft: "auto", opacity: 0.5 }}
          >
            Scroll to adjust Q
          </div>
        </div>
      </div>
    </div>
  );
}
