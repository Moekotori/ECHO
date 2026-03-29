import { useRef, useEffect, useCallback } from "react";

export function MiniWaveform({ analyser, isPlaying }) {
  const canvasRef = useRef(null);
  const animationRef = useRef(null);

  const draw = useCallback(() => {
    if (!canvasRef.current || !analyser) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);

    ctx.clearRect(0, 0, width, height);

    const barWidth = 10;
    const barGap = 6;
    const barCount = Math.floor(width / (barWidth + barGap));

    const gradient = ctx.createLinearGradient(0, 0, width, 0);
    gradient.addColorStop(0, "#ff7eb3");
    gradient.addColorStop(0.5, "#ffb199");
    gradient.addColorStop(1, "#ffc3a0");

    for (let i = 0; i < barCount; i++) {
      const dataIndex = Math.floor((i / barCount) * (bufferLength * 0.4));
      const val = dataArray[dataIndex] || 0;
      const percent = Math.pow(val / 255, 1.2);
      const barHeight = Math.max(8, percent * height * 0.95);

      ctx.fillStyle = gradient;

      const x = i * (barWidth + barGap);
      const y = height - barHeight;

      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(x, y, barWidth, barHeight, [barWidth / 2]);
      } else {
        ctx.rect(x, y, barWidth, barHeight);
      }
      ctx.fill();
    }
  }, [analyser]);

  useEffect(() => {
    const loop = () => {
      draw();
      animationRef.current = requestAnimationFrame(loop);
    };
    if (isPlaying) {
      animationRef.current = requestAnimationFrame(loop);
    } else {
      draw();
    }
    return () => cancelAnimationFrame(animationRef.current);
  }, [isPlaying, draw]);

  return (
    <div className="mini-waveform-container no-drag">
      <canvas
        ref={canvasRef}
        width={800}
        height={120}
        style={{ width: "100%", height: "120px" }}
      />
    </div>
  );
}
