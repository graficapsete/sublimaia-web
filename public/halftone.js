'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const app = $('halftone-app');
  const preview = app.querySelector('.halftone-preview');
  const compare = window.createComparison('halftone-compare');
  const state = { file: null, data: null, url: null, width: 0, height: 0, generation: 0, timer: null, finalBlob: null, working: false };
  const status = $('halftone-status');
  const input = $('halftone-file');
  const controls = ['shirt', 'color', 'width', 'dpi', 'lpi', 'angle', 'shape', 'contrast', 'intensity', 'min-dot'];
  const values = () => ({
    data: state.data, name: state.file.name, shirt: $('halftone-shirt').value, color: $('halftone-color').value,
    widthCm: Number($('halftone-width').value), dpi: Number($('halftone-dpi').value),
    lpi: Number($('halftone-lpi').value), angle: Number($('halftone-angle').value),
    shape: $('halftone-shape').value, contrast: Number($('halftone-contrast').value),
    intensity: Number($('halftone-intensity').value), minDot: Number($('halftone-min-dot').value)
  });
  function garmentColor() {
    const shirt = $('halftone-shirt').value;
    const color = { white: '#ffffff', light: '#e9e2d2', black: '#171717' }[shirt] || $('halftone-color').value;
    preview.style.setProperty('--shirt-color', color);
    $('halftone-color-row').hidden = shirt !== 'colored';
  }
  function dimensions() {
    if (!state.width) return;
    const widthCm = Number($('halftone-width').value), dpi = Number($('halftone-dpi').value);
    const width = Math.round(widthCm / 2.54 * dpi), height = Math.round(width * state.height / state.width);
    const heightCm = widthCm * state.height / state.width;
    $('halftone-size-info').textContent = `${widthCm.toFixed(1)} × ${heightCm.toFixed(1)} cm · ${width} × ${height} px · máximo: 16 MP / 8000 px por lado`;
    return width * height <= 16_000_000 && width <= 8000 && height <= 8000 && widthCm >= 2 && widthCm <= 50;
  }
  function labels() {
    $('halftone-lpi-out').textContent = $('halftone-lpi').value + ' LPI';
    $('halftone-angle-out').textContent = $('halftone-angle').value + '°';
    $('halftone-contrast-out').textContent = Number($('halftone-contrast').value).toFixed(2).replace('.', ',') + '×';
    $('halftone-intensity-out').textContent = Number($('halftone-intensity').value).toFixed(2).replace('.', ',') + '×';
    $('halftone-min-dot-out').textContent = $('halftone-min-dot').value + ' px';
    garmentColor(); dimensions();
  }
  function invalidate() {
    state.generation++;
    clearTimeout(state.timer);
    state.finalBlob = null;
    $('halftone-download').disabled = true;
    labels();
    $('halftone-run').disabled = !state.file || !dimensions() || state.working;
    if (state.file && dimensions()) state.timer = setTimeout(() => makePreview(state.generation), 550);
    else if (state.file) status.textContent = 'A saída excede 16 MP ou 8000 px por lado. Reduza largura ou DPI.';
  }
  async function encode(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
      reader.readAsDataURL(file);
    });
  }
  async function choose(file) {
    if (!file) return;
    if (state.working) { status.textContent = 'Aguarde o processamento atual antes de trocar a arte.'; return; }
    if (!['image/png', 'image/webp'].includes(file.type)) { status.textContent = 'Envie um PNG ou WebP com fundo transparente.'; return; }
    if (file.size > 12 * 1024 * 1024) { status.textContent = 'O arquivo excede 12 MB. Reduza a arte antes de enviar.'; return; }
    const url = URL.createObjectURL(file);
    const image = new Image(); image.src = url;
    try { await image.decode(); } catch (_) { URL.revokeObjectURL(url); status.textContent = 'Não foi possível abrir a imagem.'; return; }
    if (image.naturalWidth * image.naturalHeight > 12_000_000) { URL.revokeObjectURL(url); status.textContent = 'A imagem de origem excede 12 milhões de pixels.'; return; }
    try {
      const data = await encode(file);
      if (state.url) URL.revokeObjectURL(state.url);
      Object.assign(state, { file, data, url, width: image.naturalWidth, height: image.naturalHeight });
      compare.reset(); compare.setOriginal(url);
      $('halftone-original-image').src = url;
      $('halftone-file-info').textContent = `${file.name} · ${state.width} × ${state.height} px`;
      $('halftone-empty').hidden = true; $('halftone-original').hidden = false;
      status.textContent = 'Preparando prévia…'; invalidate();
    } catch (err) { URL.revokeObjectURL(url); status.textContent = err.message; }
  }
  async function send(payload) {
    const response = await fetch('/api/halftone', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: `Erro HTTP ${response.status}` }));
      const e = new Error(error.error || 'Falha no processamento.'); e.code = error.code; throw e;
    }
    return response.blob();
  }
  async function makePreview(generation) {
    if (!state.file || generation !== state.generation || state.working) return;
    status.textContent = 'Atualizando prévia…';
    try {
      const blob = await send({ ...values(), preview: true });
      if (generation !== state.generation) return;
      compare.setResult(blob); $('halftone-original').hidden = true;
      status.textContent = 'Prévia aproximada. Gere o PNG para conferir a resolução final.';
    } catch (err) {
      if (generation !== state.generation) return;
      if (err.code === 'BUSY') { state.timer = setTimeout(() => makePreview(generation), 1200); return; }
      status.textContent = err.message;
    }
  }
  async function generate() {
    if (!state.file || !dimensions() || state.working) return;
    clearTimeout(state.timer); state.generation++;
    state.working = true; $('halftone-run').disabled = true; status.textContent = 'Gerando PNG na resolução final…';
    try {
      let blob;
      for (let attempt = 0; attempt < 20; attempt++) {
        try { blob = await send({ ...values(), preview: false }); break; }
        catch (err) { if (err.code !== 'BUSY' || attempt === 19) throw err; await new Promise(resolve => setTimeout(resolve, 1000)); }
      }
      state.finalBlob = blob; compare.setResult(blob); $('halftone-original').hidden = true;
      $('halftone-download').disabled = false;
      status.textContent = 'PNG transparente pronto. Confira a comparação e baixe o arquivo.';
    } catch (err) { status.textContent = err.message; }
    finally { state.working = false; $('halftone-run').disabled = !dimensions(); }
  }
  function download() {
    if (!state.finalBlob) return;
    const url = URL.createObjectURL(state.finalBlob), a = document.createElement('a');
    a.href = url; a.download = (state.file.name.replace(/\.[^.]+$/, '') || 'arte') + '-halftone-dtf.png';
    a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  $('halftone-open').addEventListener('click', () => input.click());
  $('halftone-open-empty').addEventListener('click', () => input.click());
  input.addEventListener('change', () => choose(input.files[0]));
  controls.forEach(name => $("halftone-" + name).addEventListener(name === 'shirt' || name === 'shape' || name === 'dpi' ? 'change' : 'input', invalidate));
  $('halftone-run').addEventListener('click', generate);
  $('halftone-download').addEventListener('click', download);
  window.addEventListener('dragover', e => { if (!app.hidden) e.preventDefault(); });
  window.addEventListener('drop', e => { if (!app.hidden) { e.preventDefault(); choose(e.dataTransfer.files[0]); } });
  labels();
})();
