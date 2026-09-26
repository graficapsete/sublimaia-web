'use strict';
const express = require('express');
const sharp = require('sharp');
const crypto = require('crypto');
const { runPipeline } = require('./src/lib/pipeline');
const { exportModel } = require('./src/lib/exporters');

const app = express();
const port = Number(process.env.PORT || 3000);
const jobs = new Map();
app.use(express.json({ limit: '70mb' }));
app.use(express.static('public'));

function decodeBase64(s) { return Buffer.from(String(s || ''), 'base64'); }
function remember(model) {
  const id = crypto.randomUUID();
  jobs.set(id, { model, created: Date.now() });
  for (const [key, value] of jobs) if (Date.now() - value.created > 30 * 60 * 1000) jobs.delete(key);
  return id;
}

app.post('/api/vectorize', async (req, res) => {
  try {
    const { width, height, origWidth, origHeight, data, params } = req.body || {};
    const rgba = decodeBase64(data);
    const { data: pixels, info } = await sharp(rgba, { raw: { width, height, channels: 4 } })
      .raw().toBuffer({ resolveWithObject: true });
    const result = runPipeline({ width: info.width, height: info.height, data: new Uint8ClampedArray(pixels), origWidth, origHeight, params });
    const id = remember(result.model);
    res.json({ ok: true, id, svg: exportModel('svg', result.model), stats: result.stats });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || String(err), errorCode: err.code });
  }
});

app.post('/api/upscale', async (req, res) => {
  try {
    const body = req.body || {};
    const input = decodeBase64(body.data);
    const meta = await sharp(input).metadata();
    if (!meta.width || !meta.height) throw new Error('Imagem inválida.');
    const width = Math.max(1, Math.min(12000, Math.round(Number(body.width) || meta.width * 2)));
    const height = Math.max(1, Math.min(12000, Math.round(Number(body.height) || meta.height * 2)));
    if (width * height > 50000000) throw new Error('A imagem final ultrapassa o limite de 50 milhões de pixels.');
    const format = ['png', 'jpg', 'webp'].includes(body.format) ? body.format : 'png';
    let image = sharp(input).resize({ width, height, fit: 'fill', kernel: sharp.kernel.lanczos3 });
    const denoise = Math.max(0, Math.min(2, Number(body.denoise) || 0));
    const sharpen = Math.max(0, Math.min(100, Number(body.sharpen) || 0));
    if (denoise && Math.min(meta.width, meta.height) >= (denoise === 2 ? 5 : 3)) image = image.median(denoise === 2 ? 5 : 3);
    if (sharpen) image = image.sharpen({ sigma: 0.5 + sharpen / 100 * 2 });
    image = image.withMetadata({ density: Math.max(72, Math.min(1200, Number(body.dpi) || 300)) });
    const quality = Math.max(1, Math.min(100, Number(body.quality) || 95));
    if (format === 'jpg') image = image.jpeg({ quality, mozjpeg: true });
    else if (format === 'webp') image = image.webp({ quality });
    else image = image.png({ compressionLevel: 9 });
    const output = await image.toBuffer();
    const base = String(body.name || 'imagem').replace(/[^a-z0-9_-]+/gi, '_').replace(/\.[^.]+$/, '') || 'imagem';
    res.set('Content-Type', format === 'jpg' ? 'image/jpeg' : `image/${format}`).set('Content-Disposition', `attachment; filename="${base}-upscaled.${format}"`).send(output);
  } catch (err) {
    res.status(400).json({ error: err.message || String(err) });
  }
});

function parseHexColor(value) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(value || 'ffffff'));
  if (!m) return [255, 255, 255];
  return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)];
}

app.post('/api/remove-background', async (req, res) => {
  try {
    const body = req.body || {};
    const input = decodeBase64(body.data);
    const { data: pixels, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width, height } = info;
    if (width * height > 30000000) throw new Error('A imagem ultrapassa o limite de 30 milhões de pixels.');
    let bg = parseHexColor(body.color);
    if (body.mode !== 'manual') {
      const side = Math.max(1, Math.min(24, Math.floor(Math.min(width, height) * 0.06)));
      let r = 0, g = 0, b = 0, n = 0;
      for (const [x0, y0] of [[0, 0], [width - side, 0], [0, height - side], [width - side, height - side]]) {
        for (let y = y0; y < Math.min(height, y0 + side); y++) for (let x = x0; x < Math.min(width, x0 + side); x++) {
          const i = (y * width + x) * 4; r += pixels[i]; g += pixels[i + 1]; b += pixels[i + 2]; n++;
        }
      }
      bg = [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
    }
    const tolerance = Math.max(0, Math.min(100, Number(body.tolerance) || 18));
    const cut = tolerance / 100 * 441.67;
    const softness = Math.max(0, Math.min(20, Number(body.softness) || 0));
    const softDistance = softness * 8;
    const alpha = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      const distance = Math.hypot(pixels[p] - bg[0], pixels[p + 1] - bg[1], pixels[p + 2] - bg[2]);
      let a = distance <= cut ? 0 : distance >= cut + softDistance ? 255 : Math.round((distance - cut) / Math.max(1, softDistance) * 255);
      if (body.preserveAlpha !== false) a = Math.round(a * pixels[p + 3] / 255);
      alpha[y * width + x] = a;
    }
    const clean = Math.max(0, Math.min(3, Number(body.clean) || 0));
    if (clean) {
      const minNeighbors = clean * 2;
      const before = new Uint8Array(alpha);
      for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
        const at = y * width + x;
        if (before[at] === 0) continue;
        let neighbors = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) neighbors += before[(y + dy) * width + x + dx] > 32 ? 1 : 0;
        if (neighbors < minNeighbors) alpha[at] = 0;
      }
    }
    for (let i = 0; i < width * height; i++) pixels[i * 4 + 3] = alpha[i];
    const output = await sharp(pixels, { raw: { width, height, channels: 4 } }).png({ compressionLevel: 9 }).withMetadata({ density: 300 }).toBuffer();
    const base = String(body.name || 'imagem').replace(/[^a-z0-9_-]+/gi, '_').replace(/\.[^.]+$/, '') || 'imagem';
    res.set('Content-Type', 'image/png').set('Content-Disposition', `attachment; filename="${base}-sem-fundo.png"`).send(output);
  } catch (err) {
    res.status(400).json({ error: err.message || String(err) });
  }
});

app.get('/api/outline/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Resultado expirado.' });
  res.type('image/svg+xml').send(exportModel('svg', job.model, { outline: true }));
});

app.post('/api/export/:id', express.json({ limit: '20mb' }), (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Resultado expirado.' });
  const format = String(req.body && req.body.format || 'svg');
  const mime = { svg: 'image/svg+xml', pdf: 'application/pdf', eps: 'application/postscript', dxf: 'application/dxf' }[format];
  if (!mime) return res.status(400).json({ error: 'Formato não suportado.' });
  const output = exportModel(format, job.model, req.body.options || {});
  res.set('Content-Type', mime).set('Content-Disposition', `attachment; filename="sublimaia.${format}"`).send(output);
});

app.get('/health', (_req, res) => res.json({ ok: true }));
app.listen(port, '0.0.0.0', () => console.log(`SublimaIa web listening on ${port}`));
