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
