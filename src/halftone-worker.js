'use strict';
const { parentPort, workerData } = require('worker_threads');

try {
  const { pixels, width, height, config } = workerData;
  const out = new Uint8Array(width * height * 4);
  const period = config.effectiveDpi / config.lpi;
  const radians = config.angle * Math.PI / 180;
  const cosine = Math.cos(radians), sine = Math.sin(radians);
  const hex = config.color.slice(1);
  const fabric = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
  const radiusLimit = period * 0.49;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (!pixels[i + 3]) continue;
      const u = (x * cosine + y * sine) / period;
      const v = (-x * sine + y * cosine) / period;
      const cu = Math.round(u), cv = Math.round(v);
      const cx = (cu * cosine - cv * sine) * period;
      const cy = (cu * sine + cv * cosine) * period;
      const sx = Math.max(0, Math.min(width - 1, Math.round(cx)));
      const sy = Math.max(0, Math.min(height - 1, Math.round(cy)));
      const si = (sy * width + sx) * 4;
      const sample = pixels[si + 3] ? si : i;
      const distance = Math.max(Math.abs(pixels[sample] - fabric[0]), Math.abs(pixels[sample + 1] - fabric[1]), Math.abs(pixels[sample + 2] - fabric[2])) / 255;
      const coverage = Math.min(1, Math.pow(distance, 1 / config.contrast) * config.intensity);
      const radius = radiusLimit * Math.sqrt(coverage);
      if (radius * 2 < config.minDot || radius < 0.12) continue;
      const dx = Math.abs(x - cx), dy = Math.abs(y - cy);
      let signed;
      if (config.shape === 'square') signed = Math.max(dx, dy) - radius * 0.89;
      else if (config.shape === 'diamond') signed = (dx + dy) * 0.7071 - radius * 0.89;
      else signed = Math.hypot(dx, dy) - radius;
      const edge = Math.max(0, Math.min(1, 0.5 - signed));
      if (!edge) continue;
      out[i] = pixels[i]; out[i + 1] = pixels[i + 1]; out[i + 2] = pixels[i + 2];
      out[i + 3] = Math.round(pixels[i + 3] * edge);
    }
  }
  parentPort.postMessage({ pixels: out }, [out.buffer]);
} catch (err) { parentPort.postMessage({ error: err.message }); }
