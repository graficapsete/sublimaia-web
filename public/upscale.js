'use strict';
(() => {
  const $ = (s) => document.querySelector(s);
  const vectorApp = $('main');
  const upscaleApp = $('#upscale-app');
  const tabVector = $('#btn-tab-vector');
  const tabUpscale = $('#btn-tab-upscale');
  const tabBg = $('#btn-tab-bg');
  const bgApp = $('#bg-app');
  const comparison = window.createComparison('upscale-compare');
  const fileInput = $('#upscale-file');
  const state = { file: null, url: null, width: 0, height: 0 };

  function setTab(mode) {
    const isUpscale = mode === 'upscale';
    const isBg = mode === 'bg';
    vectorApp.hidden = isUpscale || isBg;
    upscaleApp.hidden = !isUpscale;
    bgApp.hidden = !isBg;
    tabVector.classList.toggle('active', mode === 'vector');
    tabUpscale.classList.toggle('active', isUpscale);
    tabBg.classList.toggle('active', isBg);
  }
  tabVector.addEventListener('click', () => setTab('vector'));
  tabUpscale.addEventListener('click', () => setTab('upscale'));
  tabBg.addEventListener('click', () => setTab('bg'));

  function updatePrintSize() {
    const dpi = Number($('#upscale-dpi').value) || 300;
    $('#upscale-dpi-out').textContent = dpi;
    $('#upscale-print-size').textContent = state.width ? `Tamanho de impressão: ${(Number($('#upscale-width').value) / dpi * 2.54).toFixed(1)} × ${(Number($('#upscale-height').value) / dpi * 2.54).toFixed(1)} cm` : 'Tamanho de impressão: —';
  }
  function setDimensions(scale) {
    if (!state.width) return;
    $('#upscale-width').value = Math.min(12000, Math.round(state.width * scale));
    $('#upscale-height').value = Math.min(12000, Math.round(state.height * scale));
    updatePrintSize();
  }
  async function chooseFile(file) {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image(); img.src = url;
    try { await img.decode(); } catch (_) { URL.revokeObjectURL(url); $('#upscale-status').textContent = 'Não foi possível abrir essa imagem.'; return; }
    if (state.url) URL.revokeObjectURL(state.url);
    Object.assign(state, { file, url, width: img.naturalWidth, height: img.naturalHeight });
    comparison.reset(); comparison.setOriginal(url);
    $('#upscale-preview-image').src = url;
    $('#upscale-preview-wrap').hidden = false;
    $('#upscale-empty').hidden = true;
    $('#upscale-original-info').textContent = `${file.name} · ${state.width} × ${state.height} px`;
    setDimensions(Number($('#upscale-scale').value) || 2);
    $('#upscale-run').disabled = false;
    $('#upscale-status').textContent = '';
  }
  $('#upscale-open').addEventListener('click', () => fileInput.click());
  $('#upscale-open-empty').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => chooseFile(fileInput.files[0]));
  $('#upscale-scale').addEventListener('change', (e) => { if (e.target.value !== 'custom') setDimensions(Number(e.target.value)); updatePrintSize(); });
  $('#upscale-width').addEventListener('input', () => { $('#upscale-scale').value = 'custom'; updatePrintSize(); });
  $('#upscale-height').addEventListener('input', () => { $('#upscale-scale').value = 'custom'; updatePrintSize(); });
  $('#upscale-dpi').addEventListener('input', updatePrintSize);
  $('#upscale-sharpen').addEventListener('input', (e) => { $('#upscale-sharpen-out').textContent = e.target.value + '%'; });
  window.addEventListener('dragover', (e) => { if (!upscaleApp.hidden) e.preventDefault(); });
  window.addEventListener('drop', (e) => { if (!upscaleApp.hidden) { e.preventDefault(); chooseFile(e.dataTransfer.files[0]); } });

  $('#upscale-run').addEventListener('click', async () => {
    if (!state.file) return;
    const button = $('#upscale-run'); const status = $('#upscale-status');
    button.disabled = true; status.textContent = 'Processando imagem…';
    try {
      const bytes = new Uint8Array(await state.file.arrayBuffer());
      let binary = ''; for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      const payload = { data: btoa(binary), name: state.file.name, width: Number($('#upscale-width').value), height: Number($('#upscale-height').value), dpi: Number($('#upscale-dpi').value), sharpen: Number($('#upscale-sharpen').value), denoise: Number($('#upscale-denoise').value), format: $('#upscale-format').value, quality: Number($('#upscale-quality').value) };
      const response = await fetch('/api/upscale', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      if (!response.ok) throw new Error(await response.text());
      const blob = await response.blob(); comparison.setResult(blob); $('#upscale-preview-wrap').hidden = true; const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = (state.file.name.replace(/\.[^.]+$/, '') || 'imagem') + '-upscaled.' + payload.format; a.click();
      status.textContent = 'Imagem ampliada pronta para download.'; setTimeout(() => URL.revokeObjectURL(a.href), 1500);
    } catch (err) { status.textContent = 'Não foi possível processar: ' + (err.message || err); }
    finally { button.disabled = false; }
  });
})();
