'use strict';
// Local before/after audit. Private artwork is written only to ignored artifacts/.
const sharp = require('sharp');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const current = require('../src/lib/pipeline');
const { exportModel } = require('../src/lib/exporters');
const { errorMetrics } = require('../test/fixtures/vector-quality');

function loadRevision(revision) {
  const root = path.resolve(__dirname, '..');
  const commit = execFileSync('git', ['rev-parse', '--verify', `${revision}^{commit}`], { cwd: root, encoding: 'utf8' }).trim();
  const cache = new Map();
  const load = file => {
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} }; cache.set(file, module);
    const source = execFileSync('git', ['show', `${commit}:${file}`], { cwd: root, encoding: 'utf8' });
    const localRequire = name => name.startsWith('.') ? load(path.posix.normalize(path.posix.join(path.posix.dirname(file), name + '.js'))) : require(name);
    // Only local repository code from the explicitly selected Git revision.
    new Function('require', 'module', 'exports', source)(localRequire, module, module.exports);
    return module.exports;
  };
  return { commit, pipeline: load('src/lib/pipeline.js') };
}

async function main() {
  const [filename, revision, output = 'artifacts/vector-quality', cropArg] = process.argv.slice(2);
  if (!filename || !revision) throw new Error('Uso: node scripts/compare-vector.js imagem revisão [pasta] [x,y,largura,altura]');
  const before = loadRevision(revision);
  const { data, info } = await sharp(filename).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width * info.height > 8000000) throw new Error('Limite: 8 milhões de pixels.');
  const params = { mode: 'color', colors: 12, upscale: 4, denoise: 1, sharpen: 10,
    detail: 2, smooth: 15, strokeBalance: 0, removeBg: false, antiGap: true };
  const job = { width: info.width, height: info.height, data, params };
  const old = before.pipeline.runPipeline(job), next = current.runPipeline(job);
  const previousSVG = exportModel('svg', old.model), currentSVG = exportModel('svg', next.model);
  const previousPixels = await sharp(Buffer.from(previousSVG)).ensureAlpha().raw().toBuffer();
  const currentPixels = await sharp(Buffer.from(currentSVG)).ensureAlpha().raw().toBuffer();
  const report = { baseline: before.commit, width: info.width, height: info.height, params,
    before: { ...errorMetrics(data, previousPixels, info.width, info.height), ...old.stats },
    after: { ...errorMetrics(data, currentPixels, info.width, info.height), ...next.stats } };
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'comparison.json'), JSON.stringify(report, null, 2) + '\n');
  fs.writeFileSync(path.join(output, 'previous.svg'), previousSVG);
  fs.writeFileSync(path.join(output, 'current.svg'), currentSVG);
  const [left, top, width, height] = cropArg ? cropArg.split(',').map(Number) : [0, 0, info.width, info.height];
  const crop = { left, top, width, height };
  const resize = Math.min(2, 1800 / width), pw = Math.round(width * resize), ph = Math.round(height * resize);
  const panels = await Promise.all([data, previousPixels, currentPixels].map(pixels => sharp(pixels,
    { raw: { width: info.width, height: info.height, channels: 4 } }).extract(crop).resize(pw, ph).png().toBuffer()));
  const header = label => Buffer.from(`<svg width="${pw}" height="40"><rect width="100%" height="100%" fill="#182029"/><text x="12" y="27" fill="white" font-family="sans-serif" font-size="20">${label}</text></svg>`);
  const composite = [];
  ['Original JPEG', 'Motor anterior', 'Motor corrigido'].forEach((label, i) => {
    composite.push({ input: header(label), left: 0, top: i * (ph + 40) });
    composite.push({ input: panels[i], left: 0, top: i * (ph + 40) + 40 });
  });
  await sharp({ create: { width: pw, height: (ph + 40) * 3, channels: 4, background: '#ffffff' } })
    .composite(composite).png().toFile(path.join(output, 'comparison.png'));
  console.log(JSON.stringify(report, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
