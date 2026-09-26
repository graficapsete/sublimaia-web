'use strict';
(() => {
  window.createComparison = (rootId, options = {}) => {
    const root = document.getElementById(rootId);
    root.innerHTML = `<div class="compare-toolbar"><div class="seg compare-modes"><button data-mode="side" class="on">Lado a lado</button><button data-mode="overlay">Sobreposição</button></div><label class="compare-range">Divisor <input type="range" min="5" max="95" value="50"></label></div><div class="compare-stage"><div class="compare-side"><figure><img class="compare-original"><figcaption>Original</figcaption></figure><figure><img class="compare-result"><figcaption>Resultado</figcaption></figure></div><div class="compare-overlay"><img class="compare-original"><div class="compare-result-clip"><img class="compare-result"></div><div class="compare-divider"></div><span class="compare-overlay-label original-label">Original</span><span class="compare-overlay-label result-label">Resultado</span></div></div>`;
    const stage = root.querySelector('.compare-stage');
    const originals = root.querySelectorAll('.compare-original');
    const results = root.querySelectorAll('.compare-result');
    const clip = root.querySelector('.compare-result-clip');
    const divider = root.querySelector('.compare-divider');
    const range = root.querySelector('input[type="range"]');
    const modeButtons = root.querySelectorAll('[data-mode]');
    let originalUrl = null, resultUrl = null;
    function render() {
      const pct = Number(range.value); clip.style.width = pct + '%'; divider.style.left = pct + '%';
      stage.classList.toggle('overlay-mode', stage.dataset.mode === 'overlay');
      root.querySelector('.compare-range').hidden = stage.dataset.mode !== 'overlay';
    }
    function setMode(mode) { stage.dataset.mode = mode; modeButtons.forEach((b) => b.classList.toggle('on', b.dataset.mode === mode)); render(); }
    modeButtons.forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
    range.addEventListener('input', render);
    return {
      setOriginal(url) { originalUrl = url; originals.forEach((img) => { img.src = url; }); },
      setResult(blob) { if (resultUrl) URL.revokeObjectURL(resultUrl); resultUrl = URL.createObjectURL(blob); results.forEach((img) => { img.src = resultUrl; }); root.hidden = false; },
      show() { root.hidden = false; render(); },
      hide() { root.hidden = true; },
      reset() { if (resultUrl) URL.revokeObjectURL(resultUrl); resultUrl = null; root.hidden = true; },
    };
  };
})();
