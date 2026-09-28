'use strict';
(() => {
  window.createImageViewport = (root) => {
    const toolbar = document.createElement('div');
    toolbar.className = 'preview-zoom-toolbar';
    toolbar.hidden = true;
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', 'Zoom da imagem');
    toolbar.innerHTML = '<button type="button" data-zoom="out" aria-label="Diminuir zoom">−</button><output>100%</output><button type="button" data-zoom="in" aria-label="Aumentar zoom">+</button><button type="button" data-zoom="actual">100%</button><button type="button" data-zoom="fit">Ajustar</button>';
    root.append(toolbar);
    const label = toolbar.querySelector('output');
    let zoom = 1, panX = 0, panY = 0, drag = null;
    const surfaces = () => [...root.querySelectorAll('.upscale-preview-wrap img, .compare-stage img')];
    const active = () => {
      const compare = root.querySelector('.compare:not([hidden])');
      if (compare) return compare.querySelector('.compare-stage.overlay-mode .compare-overlay .compare-result') || compare.querySelector('.compare-side .compare-result');
      return root.querySelector('.upscale-preview-wrap:not([hidden]) img');
    };
    function render() {
      for (const img of surfaces()) img.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
      label.textContent = Math.round(zoom * 100) + '%';
    }
    function reset() { zoom = 1; panX = 0; panY = 0; render(); }
    function setEnabled(enabled) { toolbar.hidden = !enabled; root.classList.toggle('viewport-ready', enabled); if (!enabled) reset(); }
    function scaleAt(factor, clientX, clientY, surface) {
      const next = Math.max(0.1, Math.min(32, zoom * factor));
      if (next === zoom) return;
      const rect = surface.getBoundingClientRect();
      const x = clientX - (rect.left + rect.width / 2), y = clientY - (rect.top + rect.height / 2);
      const ratio = next / zoom;
      panX = x - (x - panX) * ratio;
      panY = y - (y - panY) * ratio;
      zoom = next; render();
    }
    function surfaceOf(target) { return target.closest('.compare-side figure, .compare-overlay, .upscale-preview-wrap'); }
    root.addEventListener('wheel', (event) => {
      const surface = surfaceOf(event.target);
      if (!surface || toolbar.hidden) return;
      event.preventDefault();
      scaleAt(Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0015)), event.clientX, event.clientY, surface);
    }, { passive: false });
    root.addEventListener('pointerdown', (event) => {
      const surface = surfaceOf(event.target);
      if (!surface || toolbar.hidden || event.button !== 0) return;
      drag = { x: event.clientX, y: event.clientY, panX, panY, pointerId: event.pointerId };
      surface.setPointerCapture(event.pointerId);
      root.classList.add('viewport-dragging');
      event.preventDefault();
    });
    root.addEventListener('pointermove', (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      panX = drag.panX + event.clientX - drag.x;
      panY = drag.panY + event.clientY - drag.y;
      render();
    });
    const endDrag = () => { drag = null; root.classList.remove('viewport-dragging'); };
    root.addEventListener('pointerup', endDrag);
    root.addEventListener('pointercancel', endDrag);
    root.addEventListener('dblclick', event => { if (surfaceOf(event.target)) reset(); });
    toolbar.addEventListener('click', event => {
      const action = event.target.closest('button')?.dataset.zoom;
      if (!action) return;
      if (action === 'fit') return reset();
      const img = active();
      if (!img) return;
      const surface = surfaceOf(img);
      if (!surface) return;
      const rect = surface.getBoundingClientRect();
      if (action === 'actual') {
        const naturalWidth = img.naturalWidth || 1, naturalHeight = img.naturalHeight || 1;
        const fitted = Math.min(img.offsetWidth / naturalWidth, img.offsetHeight / naturalHeight);
        zoom = Math.max(0.1, Math.min(32, 1 / Math.max(fitted, 0.001)));
        panX = panY = 0; render(); return;
      }
      scaleAt(action === 'in' ? 1.25 : 0.8, rect.left + rect.width / 2, rect.top + rect.height / 2, surface);
    });
    root.querySelectorAll('img').forEach(img => img.addEventListener('load', render));
    return { reset, setEnabled, refresh: render, getState: () => ({ zoom, panX, panY }) };
  };
})();
