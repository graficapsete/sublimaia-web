'use strict';
(() => {
  let currentJobId = null;
  const bytesToBase64 = (bytes) => {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    return btoa(binary);
  };
  const download = (blob, name) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const api = {
    onProgress: () => () => {},
    cancel: async () => true,
    openImage: () => new Promise((resolve) => {
      const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*';
      input.onchange = async () => { const file = input.files[0]; resolve(file ? { bytes: new Uint8Array(await file.arrayBuffer()), mime: file.type, name: file.name } : null); };
      input.click();
    }),
    vectorize: async (payload) => {
      const r = await fetch('/api/vectorize', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...payload, data: bytesToBase64(payload.data) }) });
      const result = await r.json(); currentJobId = result.id || null; return result;
    },
    outlineSvg: async () => currentJobId ? await (await fetch('/api/outline/' + currentJobId)).text() : null,
    exportAs: async ({ format, name, pngBytes }) => {
      if (format === 'png') { download(new Blob([pngBytes], { type: 'image/png' }), name + '.png'); return { ok: true, filePath: name + '.png' }; }
      const r = await fetch('/api/export/' + currentJobId, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ format }) });
      if (!r.ok) return { ok: false, error: await r.text() };
      download(await r.blob(), name + '.' + format); return { ok: true, filePath: name + '.' + format };
    },
    reveal: async () => true,
    copySvg: async () => { try { await navigator.clipboard.writeText(state.svg); return true; } catch (_) { return false; } },
  };
  const { t } = window.I18N;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  // Imagens maiores que isso são reduzidas ao carregar (protege memória/tempo).
  const MAX_INPUT_PIXELS = 8000000;
  const AUTO_DELAY_MS = 450;

  // ---------------------------------------------------------------- presets ---
  const DEFAULT_PRESET = 'logo'; // logotipo / ilustração / desenho: o caso mais comum

  const PRESETS = {
    lowq: {
      mode: 'color', colors: 10, upscale: 4, denoise: 2, sharpen: 30, autoContrast: true,
      threshold: -1, detail: 8, smooth: 60, removeBg: false, antiGap: true,
    },
    logo: {
      mode: 'color', colors: 12, upscale: 4, denoise: 1, sharpen: 20, autoContrast: false,
      threshold: -1, detail: 6, smooth: 55, removeBg: false, antiGap: true,
    },
    lineart: {
      mode: 'bw', colors: 2, upscale: 3, denoise: 1, sharpen: 0, autoContrast: true,
      threshold: -1, detail: 6, smooth: 50, removeBg: true, antiGap: false,
    },
    gray: {
      mode: 'gray', colors: 8, upscale: 2, denoise: 1, sharpen: 10, autoContrast: true,
      threshold: -1, detail: 6, smooth: 40, removeBg: false, antiGap: true,
    },
    photo: {
      mode: 'color', colors: 32, upscale: 1, denoise: 1, sharpen: 0, autoContrast: false,
      threshold: -1, detail: 10, smooth: 30, removeBg: false, antiGap: true,
    },
  };

  const PARAM_KEYS = [
    'upscale', 'denoise', 'sharpen', 'autoContrast', 'mode', 'colors',
    'autoThreshold', 'threshold', 'detail', 'smooth', 'removeBg', 'antiGap',
  ];

  const FORMAT_LABEL = { svg: 'SVG', pdf: 'PDF', eps: 'EPS', dxf: 'DXF', png: 'PNG' };


  // ------------------------------------------------------------------ estado ---
  const state = {
    image: null, // { name, baseName, width, height, imageData, url }
    svg: null,
    svgUrl: null,
    outlineUrl: null,
    outline: false,
    stats: null,
    busy: false,
    token: 0,
    autoTimer: null,
    format: 'svg',
    zoom: 1,
    fitMode: true,
  };

  const el = {
    viewer: $('#viewer'), paneO: $('#pane-orig'), paneV: $('#pane-vec'),
    contentO: $('#content-orig'), contentV: $('#content-vec'),
    imgO: $('#img-orig'), imgV: $('#img-vec'),
    zoombar: $('#zoombar'), zLabel: $('#z-label'),
    busy: $('#busy'), busyStage: $('#busy-stage'), busyBar: $('#busy-bar'),
    run: $('#btn-run'), exportBtn: $('#btn-export'), exportTop: $('#btn-export-top'),
    copy: $('#btn-copy'), outlineBtn: $('#btn-outline'),
    preset: $('#preset'), auto: $('#p-auto'),
    toast: $('#toast'), veil: $('#dropveil'),
  };
  const panes = [el.paneO, el.paneV];

  // --------------------------------------------------------------- controles ---
  const ctl = (key) => document.getElementById('p-' + key);
  const isSeg = (node) => node.classList.contains('seg');

  function fmtOut(key, v) {
    switch (key) {
      case 'denoise': return t('denoise.' + v) === 'denoise.' + v ? String(v) : t('denoise.' + v);
      case 'sharpen': return v + '%';
      case 'detail': return v + ' px';
      case 'threshold': return String(v);
      default: return String(v);
    }
  }

  function getValue(key) {
    const node = ctl(key);
    if (isSeg(node)) {
      const b = $('button.on', node);
      return b ? b.dataset.value : undefined;
    }
    if (node.type === 'checkbox') return node.checked;
    return Number(node.value);
  }

  function setValue(key, v) {
    const node = ctl(key);
    if (isSeg(node)) {
      $$('button', node).forEach((b) => b.classList.toggle('on', b.dataset.value === String(v)));
    } else if (node.type === 'checkbox') {
      node.checked = !!v;
    } else {
      node.value = v;
      const out = document.getElementById('o-' + key);
      if (out) out.textContent = fmtOut(key, Number(v));
    }
  }

  function readParams() {
    return {
      mode: getValue('mode'),
      colors: getValue('colors'),
      upscale: Number(getValue('upscale')),
      denoise: getValue('denoise'),
      sharpen: getValue('sharpen'),
      autoContrast: getValue('autoContrast'),
      threshold: getValue('autoThreshold') ? -1 : getValue('threshold'),
      detail: getValue('detail'),
      smooth: getValue('smooth'),
      removeBg: getValue('removeBg'),
      antiGap: getValue('antiGap'),
    };
  }

  function applyParams(p) {
    for (const key of PARAM_KEYS) {
      if (key === 'autoThreshold') setValue('autoThreshold', p.threshold < 0);
      else if (key === 'threshold') setValue('threshold', p.threshold < 0 ? 128 : p.threshold);
      else setValue(key, p[key]);
    }
    updateVisibility();
  }

  function updateVisibility() {
    const bw = getValue('mode') === 'bw';
    $('#row-colors').hidden = bw;
    $('#row-threshold').hidden = !bw;
    ctl('threshold').disabled = getValue('autoThreshold');
  }

  function onParamChange() {
    el.preset.value = 'custom';
    updateVisibility();
    scheduleAuto();
  }

  function scheduleAuto() {
    if (!state.image) return;
    clearTimeout(state.autoTimer);
    if (el.auto.checked) {
      state.autoTimer = setTimeout(runVectorize, AUTO_DELAY_MS);
    } else {
      el.run.classList.add('dirty');
    }
  }

  for (const key of PARAM_KEYS) {
    const node = ctl(key);
    if (isSeg(node)) {
      node.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        setValue(key, b.dataset.value);
        onParamChange();
      });
    } else {
      node.addEventListener('input', () => {
        if (node.type !== 'checkbox') {
          const out = document.getElementById('o-' + key);
          if (out) out.textContent = fmtOut(key, Number(node.value));
        }
        onParamChange();
      });
    }
  }

  el.preset.addEventListener('change', () => {
    const p = PRESETS[el.preset.value];
    if (!p) return;
    applyParams(p);
    scheduleAuto();
  });
  el.auto.addEventListener('change', () => {
    if (el.auto.checked && el.run.classList.contains('dirty')) runVectorize();
  });

  // --------------------------------------------------------------- toast/ui ---
  let toastTimer = null;
  function toast(msg, kind = '', action = null) {
    el.toast.className = 'toast ' + kind;
    el.toast.textContent = '';
    const span = document.createElement('span');
    span.textContent = msg;
    el.toast.append(span);
    if (action) {
      const b = document.createElement('button');
      b.textContent = action.label;
      b.addEventListener('click', () => {
        action.fn();
        el.toast.hidden = true;
      });
      el.toast.append(b);
    }
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.toast.hidden = true), kind === 'error' ? 9000 : 6000);
  }

  function setBusy(on, stage, pct) {
    state.busy = on;
    el.busy.hidden = !on;
    el.contentV.classList.toggle('pending', on && !!state.svg);
    if (on) {
      el.busyStage.textContent = stage || t('busy.working');
      el.busyBar.style.width = (pct || 0) + '%';
    }
  }

  const stageText = (stage, args) => {
    const txt = t('stage.' + stage, args);
    return txt === 'stage.' + stage ? stage : txt;
  };
  api.onProgress(({ stage, pct, args }) => {
    if (!state.busy) return;
    el.busyStage.textContent = stageText(stage, args);
    el.busyBar.style.width = pct + '%';
  });
  $('#btn-cancel').addEventListener('click', async () => {
    await api.cancel();
  });

  function updateExportState() {
    const has = !!state.svg;
    el.exportBtn.disabled = !has;
    el.exportTop.disabled = !has;
    el.copy.disabled = !has;
    el.outlineBtn.disabled = !has;
  }

  // ------------------------------------------------------- carregar imagem ---
  const guessMime = (name) => {
    const ext = (name.split('.').pop() || '').toLowerCase();
    return { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', bmp: 'image/bmp', gif: 'image/gif', avif: 'image/avif' }[ext] || '';
  };

  async function loadImageBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.src = url;
    try {
      await img.decode();
    } catch (_) {
      URL.revokeObjectURL(url);
      toast(t('toast.openFail'), 'error');
      return;
    }
    const ow = img.naturalWidth, oh = img.naturalHeight;
    if (!ow || !oh) {
      URL.revokeObjectURL(url);
      toast(t('toast.emptyImage'), 'error');
      return;
    }

    let scale = 1;
    if (ow * oh > MAX_INPUT_PIXELS) scale = Math.sqrt(MAX_INPUT_PIXELS / (ow * oh));
    const cw = Math.max(1, Math.round(ow * scale)), ch = Math.max(1, Math.round(oh * scale));
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, cw, ch);
    const imageData = ctx.getImageData(0, 0, cw, ch);

    if (state.image) URL.revokeObjectURL(state.image.url);
    clearResult();
    state.image = {
      name,
      baseName: name.replace(/\.[^.]+$/, '') || t('name.default'),
      width: ow,
      height: oh,
      reduced: scale < 1,
      imageData,
      url,
    };

    el.imgO.src = url;
    $('#file-name').textContent = name;
    renderInfo();
    el.viewer.classList.add('has-image');
    el.zoombar.hidden = false;
    el.run.disabled = false;
    state.fitMode = true;
    layout();
    runVectorize();
  }

  function clearResult() {
    if (state.svgUrl) URL.revokeObjectURL(state.svgUrl);
    if (state.outlineUrl) URL.revokeObjectURL(state.outlineUrl);
    state.svg = state.svgUrl = state.outlineUrl = null;
    state.stats = null;
    el.imgV.removeAttribute('src');
    renderInfo();
    $('#stats').hidden = true;
    updateExportState();
  }

  async function openDialog() {
    const res = await api.openImage({
      title: t('dialog.openTitle'),
      filterImages: t('dialog.filterImages'),
      filterAll: t('dialog.filterAll'),
    });
    if (!res) return;
    await loadImageBlob(new Blob([res.bytes], { type: res.mime }), res.name);
  }

  async function loadFile(file) {
    if (!file) return;
    await loadImageBlob(file, file.name || t('name.default') + '.png');
  }

  $('#btn-open').addEventListener('click', openDialog);
  $('#btn-open-empty').addEventListener('click', openDialog);

  // arrastar e soltar
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragDepth++;
    el.veil.hidden = false;
  });
  window.addEventListener('dragleave', (e) => {
    e.preventDefault();
    if (--dragDepth <= 0) {
      dragDepth = 0;
      el.veil.hidden = true;
    }
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    el.veil.hidden = true;
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) loadFile(f);
  });

  // colar da área de transferência
  window.addEventListener('paste', (e) => {
    const items = (e.clipboardData && e.clipboardData.items) || [];
    for (const it of items) {
      if (it.type.startsWith('image/')) {
        const f = it.getAsFile();
        if (f) {
          loadFile(new File([f], t('name.pasted') + '.png', { type: f.type }));
          e.preventDefault();
          return;
        }
      }
    }
  });

  // -------------------------------------------------------------- vetorizar ---
  async function runVectorize() {
    const img = state.image;
    if (!img) return;
    clearTimeout(state.autoTimer);
    el.run.classList.remove('dirty');
    const token = ++state.token;
    setBusy(true, t('busy.sending'), 2);

    let res;
    try {
      res = await api.vectorize({
        width: img.imageData.width,
        height: img.imageData.height,
        data: img.imageData.data,
        origWidth: img.width,
        origHeight: img.height,
        params: readParams(),
      });
    } catch (err) {
      res = { ok: false, error: (err && err.message) || String(err) };
    }
    if (token !== state.token) return; // já existe um trabalho mais novo
    setBusy(false);
    if (res.cancelled) return;
    if (!res.ok) {
      toast(t('toast.vectorizeFail', { msg: errText(res) }), 'error');
      return;
    }
    await showResult(res);
  }

  el.run.addEventListener('click', runVectorize);

  // Texto de erro traduzido: usa o código quando existe (idioma da interface).
  function errText(res) {
    if (res && res.errorCode) {
      const txt = t('err.' + res.errorCode);
      if (txt !== 'err.' + res.errorCode) return txt;
    }
    return (res && res.error) || t('err.unknown');
  }

  function renderInfo() {
    const img = state.image;
    $('#orig-info').textContent = img ? `${img.width}×${img.height} px` + (img.reduced ? t('info.reduced') : '') : '';
    const st = state.stats;
    $('#vec-info').textContent = st ? t(st.shapes === 1 ? 'info.color.one' : 'info.color.other', { n: st.shapes }) : '';
  }

  function renderStats() {
    const stats = state.stats;
    if (!stats) return;
    const kb = state.svgKb || 0;
    $('#s-time').textContent = (stats.ms / 1000).toFixed(1) + ' s';
    $('#s-shapes').textContent = window.I18N.number(stats.shapes);
    $('#s-paths').textContent = window.I18N.number(stats.paths);
    $('#s-nodes').textContent = window.I18N.number(stats.nodes);
    $('#s-size').textContent = kb >= 1024 ? (kb / 1024).toFixed(1) + ' MB' : (kb < 10 ? kb.toFixed(1) : Math.round(kb)) + ' KB';
    $('#stats').hidden = false;
    renderInfo();
  }

  async function showResult({ svg, stats }) {
    if (state.svgUrl) URL.revokeObjectURL(state.svgUrl);
    if (state.outlineUrl) URL.revokeObjectURL(state.outlineUrl);
    state.outlineUrl = null;
    state.svg = svg;
    state.stats = stats;
    state.svgUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    await refreshVectorImage();

    state.svgKb = new Blob([svg]).size / 1024;
    renderStats();
    updateExportState();
  }

  async function refreshVectorImage() {
    if (state.outline) {
      if (!state.outlineUrl) {
        const outline = await api.outlineSvg();
        if (outline) state.outlineUrl = URL.createObjectURL(new Blob([outline], { type: 'image/svg+xml' }));
      }
      el.imgV.src = state.outlineUrl || state.svgUrl;
    } else {
      el.imgV.src = state.svgUrl;
    }
    el.contentV.classList.remove('pending');
  }

  el.outlineBtn.addEventListener('click', async () => {
    state.outline = !state.outline;
    el.outlineBtn.setAttribute('aria-pressed', String(state.outline));
    await refreshVectorImage();
  });

  // ----------------------------------------------------------- zoom e pan ---
  const MIN_ZOOM = 0.02, MAX_ZOOM = 64;

  function fitZoom() {
    if (!state.image) return 1;
    const availW = el.paneO.clientWidth - 48;
    const availH = el.paneO.clientHeight - 48;
    return Math.max(MIN_ZOOM, Math.min(availW / state.image.width, availH / state.image.height));
  }

  function applyZoomSize() {
    if (!state.image) return;
    const w = Math.max(1, Math.round(state.image.width * state.zoom));
    const h = Math.max(1, Math.round(state.image.height * state.zoom));
    for (const c of [el.contentO, el.contentV]) {
      c.style.width = w + 'px';
      c.style.height = h + 'px';
    }
    el.contentO.classList.toggle('pixelated', state.zoom >= 3);
    el.zLabel.textContent = Math.round(state.zoom * 100) + '%';
  }

  function layout() {
    if (state.fitMode) state.zoom = fitZoom();
    applyZoomSize();
  }

  function zoomAt(pane, cx, cy, z) {
    z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
    if (!state.image || z === state.zoom) return;
    const content = pane === el.paneO ? el.contentO : el.contentV;
    const before = content.getBoundingClientRect();
    const ix = (cx - before.left) / state.zoom; // ponto da imagem sob o cursor
    const iy = (cy - before.top) / state.zoom;
    state.fitMode = false;
    state.zoom = z;
    applyZoomSize();
    const after = content.getBoundingClientRect();
    pane.scrollLeft += after.left + ix * z - cx;
    pane.scrollTop += after.top + iy * z - cy;
    syncScroll(pane);
  }

  function zoomCenter(factor) {
    const r = el.paneO.getBoundingClientRect();
    zoomAt(el.paneO, r.left + r.width / 2, r.top + r.height / 2, state.zoom * factor);
  }

  function setActualSize() {
    const r = el.paneO.getBoundingClientRect();
    zoomAt(el.paneO, r.left + r.width / 2, r.top + r.height / 2, 1);
  }

  function fit() {
    state.fitMode = true;
    layout();
    for (const p of panes) {
      p.scrollLeft = 0;
      p.scrollTop = 0;
    }
  }

  function syncScroll(from) {
    const to = from === el.paneO ? el.paneV : el.paneO;
    if (Math.abs(to.scrollLeft - from.scrollLeft) > 0.5) to.scrollLeft = from.scrollLeft;
    if (Math.abs(to.scrollTop - from.scrollTop) > 0.5) to.scrollTop = from.scrollTop;
  }

  for (const pane of panes) {
    pane.addEventListener('scroll', () => syncScroll(pane));
    pane.addEventListener(
      'wheel',
      (e) => {
        if (!state.image) return;
        e.preventDefault();
        const k = e.ctrlKey ? 0.01 : 0.0015;
        zoomAt(pane, e.clientX, e.clientY, state.zoom * Math.exp(-e.deltaY * k));
      },
      { passive: false }
    );

    let drag = null;
    pane.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      drag = { x: e.clientX, y: e.clientY, sl: pane.scrollLeft, st: pane.scrollTop };
      pane.setPointerCapture(e.pointerId);
      pane.classList.add('grabbing');
    });
    pane.addEventListener('pointermove', (e) => {
      if (!drag) return;
      pane.scrollLeft = drag.sl - (e.clientX - drag.x);
      pane.scrollTop = drag.st - (e.clientY - drag.y);
    });
    const end = () => {
      drag = null;
      pane.classList.remove('grabbing');
    };
    pane.addEventListener('pointerup', end);
    pane.addEventListener('pointercancel', end);
    pane.addEventListener('dblclick', fit);
  }

  new ResizeObserver(() => {
    if (state.image && state.fitMode) layout();
  }).observe(el.paneO);

  $('#z-in').addEventListener('click', () => zoomCenter(1.25));
  $('#z-out').addEventListener('click', () => zoomCenter(1 / 1.25));
  $('#z-fit').addEventListener('click', fit);
  $('#z-100').addEventListener('click', setActualSize);

  // --------------------------------------------------------------- exportar ---
  const segFormat = $('#fmt');
  const segPng = $('#png-scale');

  function setFormat(f) {
    state.format = f;
    $$('button', segFormat).forEach((b) => b.classList.toggle('on', b.dataset.value === f));
    $('#png-opts').hidden = f !== 'png';
    $('#fmt-hint').textContent = t('fmt.' + f + '.hint');
    el.exportBtn.textContent = t('export.as', { fmt: FORMAT_LABEL[f] });
  }
  segFormat.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) setFormat(b.dataset.value);
  });
  segPng.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    $$('button', segPng).forEach((x) => x.classList.toggle('on', x === b));
  });

  async function renderPng(scale, transparent) {
    const img = new Image();
    img.src = state.svgUrl;
    await img.decode();
    const W = state.image.width, H = state.image.height;
    const s = Math.min(scale, 16000 / Math.max(W, H));
    const cw = Math.max(1, Math.round(W * s)), ch = Math.max(1, Math.round(H * s));
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    if (!transparent) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, cw, ch);
    }
    ctx.drawImage(img, 0, 0, cw, ch);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error(t('toast.pngFail'));
    return new Uint8Array(await blob.arrayBuffer());
  }

  async function doExport() {
    if (!state.svg || !state.image) return;
    const format = state.format;
    try {
      let pngBytes = null;
      if (format === 'png') {
        const active = $('button.on', segPng);
        pngBytes = await renderPng(Number(active ? active.dataset.value : 2), $('#png-transparent').checked);
      }
      const r = await api.exportAs({
        format,
        name: state.image.baseName,
        pngBytes,
        saveTitle: t('dialog.saveTitle', { fmt: FORMAT_LABEL[format] }),
      });
      if (r.ok) toast(t('toast.saved', { path: r.filePath }), 'ok', { label: t('toast.reveal'), fn: () => api.reveal(r.filePath) });
      else if (!r.canceled) toast(t('toast.exportFail', { msg: errText(r) }), 'error');
    } catch (err) {
      toast(t('toast.exportFail', { msg: (err && err.message) || String(err) }), 'error');
    }
  }
  el.exportBtn.addEventListener('click', doExport);
  el.exportTop.addEventListener('click', doExport);
  el.copy.addEventListener('click', async () => {
    const ok = await api.copySvg();
    toast(ok ? t('toast.copied') : t('toast.nothingCopy'), ok ? 'ok' : 'error');
  });

  // ---------------------------------------------------------------- atalhos ---
  window.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); openDialog(); }
    else if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); doExport(); }
    else if (mod && e.key === '0') { e.preventDefault(); fit(); }
    else if (!mod && (e.key === '+' || e.key === '=') && e.target.tagName !== 'INPUT') zoomCenter(1.25);
    else if (!mod && e.key === '-' && e.target.tagName !== 'INPUT') zoomCenter(1 / 1.25);
  });

  // -------------------------------------------------------------- idioma ---
  // O HTML fixo é traduzido pelo i18n.js; aqui refazemos o que o app.js escreve sozinho.
  function refreshLanguage() {
    for (const key of PARAM_KEYS) {
      const node = ctl(key);
      const out = document.getElementById('o-' + key);
      if (out && node && !isSeg(node) && node.type !== 'checkbox') out.textContent = fmtOut(key, Number(node.value));
    }
    setFormat(state.format);
    renderStats();
    renderInfo();
  }
  window.I18N.onChange(refreshLanguage);

  // -------------------------------------------------------------- iniciar ---
  el.preset.value = DEFAULT_PRESET;
  applyParams(PRESETS[DEFAULT_PRESET]);
  setFormat('svg');
  updateExportState();
})();
