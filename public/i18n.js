'use strict';
/**
 * Idiomas da interface: Português (Brasil), English e Español.
 *
 * - Textos fixos do HTML: atributos data-i18n (texto), data-i18n-title, data-i18n-aria
 *   e data-i18n-alt.
 * - Textos dinâmicos (app.js): I18N.t('chave', { variavel: valor }).
 * - A escolha fica salva (localStorage). Na primeira execução usa o idioma do sistema.
 * - As bandeiras são SVG inline: o Windows não desenha emojis de bandeira.
 *
 * Para adicionar um idioma: acrescente um item em LANGS, uma bandeira em FLAGS e um
 * objeto em DICT com as mesmas chaves (o teste `npm test` confere se nada ficou faltando).
 */
(function (root) {
  const LANGS = [
    { code: 'pt', locale: 'pt-BR', htmlLang: 'pt-BR', name: 'Português (Brasil)' },
    { code: 'en', locale: 'en-US', htmlLang: 'en', name: 'English' },
    { code: 'es', locale: 'es-ES', htmlLang: 'es', name: 'Español' },
  ];

  const FLAGS = {
    // Brasil
    pt:
      '<svg viewBox="0 0 32 22" width="26" height="18" aria-hidden="true">' +
      '<rect width="32" height="22" fill="#009c3b"/>' +
      '<path d="M16 2.2 29.2 11 16 19.8 2.8 11z" fill="#ffdf00"/>' +
      '<circle cx="16" cy="11" r="5.4" fill="#002776"/>' +
      '<path d="M10.9 9.9c3.4-1 7.3-.6 10.3 1.7" fill="none" stroke="#fff" stroke-width="1.15"/>' +
      '</svg>',
    // Reino Unido (inglês)
    en:
      '<svg viewBox="0 0 60 30" width="26" height="18" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' +
      '<clipPath id="uk-s"><path d="M0,0 v30 h60 v-30 z"/></clipPath>' +
      '<clipPath id="uk-t"><path d="M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z"/></clipPath>' +
      '<g clip-path="url(#uk-s)"><path d="M0,0 v30 h60 v-30 z" fill="#012169"/>' +
      '<path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" stroke-width="6"/>' +
      '<path d="M0,0 L60,30 M60,0 L0,30" clip-path="url(#uk-t)" stroke="#c8102e" stroke-width="4"/>' +
      '<path d="M30,0 v30 M0,15 h60" stroke="#fff" stroke-width="10"/>' +
      '<path d="M30,0 v30 M0,15 h60" stroke="#c8102e" stroke-width="6"/></g></svg>',
    // Espanha
    es:
      '<svg viewBox="0 0 24 16" width="26" height="18" preserveAspectRatio="none" aria-hidden="true">' +
      '<rect width="24" height="16" fill="#aa151b"/><rect y="4" width="24" height="8" fill="#f1bf00"/></svg>',
  };

  const DICT = {
    pt: {
      'btn.open': 'Abrir imagem…',
      'btn.exportTop': 'Exportar…',
      'lang.aria': 'Idioma',
      'pane.original': 'Original',
      'pane.vector': 'Vetor',
      'outline.label': 'Contornos',
      'outline.title': 'Mostrar só os contornos das formas',
      'alt.original': 'Imagem original',
      'alt.vector': 'Resultado vetorizado',
      'empty.title': 'Solte uma imagem aqui',
      'empty.text': 'PNG, JPG, WebP, BMP ou GIF. Você também pode colar da área de transferência com Ctrl+V.',
      'empty.button': 'Escolher arquivo…',
      'zoom.outTitle': 'Diminuir zoom (−)',
      'zoom.inTitle': 'Aumentar zoom (+)',
      'zoom.out': 'Diminuir zoom',
      'zoom.in': 'Aumentar zoom',
      'zoom.fit': 'Ajustar',
      'busy.preparing': 'Preparando…',
      'busy.sending': 'Enviando imagem…',
      'busy.working': 'Trabalhando…',
      'busy.cancel': 'Cancelar',
      'drop.veil': 'Solte para abrir',
      'sidebar.aria': 'Ajustes',
      'preset.label': 'Ponto de partida',
      'preset.logo': 'Logotipo, ilustração ou desenho',
      'preset.lowq': 'Imagem de baixa qualidade',
      'preset.lineart': 'Desenho a traço (preto e branco)',
      'preset.gray': 'Tons de cinza',
      'preset.photo': 'Foto, muitas cores',
      'preset.custom': 'Personalizado',
      'group.treat': 'Tratar a imagem',
      'group.vectorize': 'Vetorização',
      'group.export': 'Exportar',
      'p.upscale': 'Ampliar antes de vetorizar',
      'p.upscale.aria': 'Ampliação',
      'p.denoise': 'Remover ruído e artefatos JPEG',
      'p.sharpen': 'Nitidez das bordas',
      'p.autoContrast': 'Corrigir contraste automaticamente',
      'p.colors': 'Cores',
      'p.mode.aria': 'Modo de cor',
      'p.mode.color': 'Coloridas',
      'p.mode.gray': 'Cinza',
      'p.mode.bw': 'P&B',
      'p.maxColors': 'Máximo de cores',
      'p.threshold': 'Limiar de preto',
      'p.autoThreshold': 'Definir automaticamente',
      'p.detail': 'Ignorar manchas menores que',
      'p.smooth': 'Suavidade das curvas',
      'p.removeBg': 'Remover fundo (cor dos cantos)',
      'p.antiGap': 'Evitar frestas entre as cores',
      'run.button': 'Vetorizar',
      'run.auto': 'Atualizar ao mudar os ajustes',
      'stats.time': 'Tempo',
      'stats.colors': 'Cores',
      'stats.paths': 'Contornos',
      'stats.nodes': 'Nós',
      'stats.size': 'Tamanho do SVG',
      'fmt.aria': 'Formato de exportação',
      'fmt.svg.hint': 'Vetor editável em Illustrator, Inkscape, Figma e CorelDRAW.',
      'fmt.pdf.hint': 'Vetor para impressão e gráficas. Escala 96 dpi (1 px = 0,75 pt).',
      'fmt.eps.hint': 'PostScript encapsulado, aceito por softwares de diagramação e gráficas.',
      'fmt.dxf.hint': 'Contornos para CAD, corte a laser e CNC. Uma layer por cor; cores aproximadas.',
      'fmt.png.hint': 'Imagem em alta resolução desenhada a partir do vetor.',
      'png.size': 'Tamanho do PNG',
      'png.scale.aria': 'Escala do PNG',
      'png.transparent': 'Fundo transparente',
      'export.as': 'Exportar como {fmt}…',
      'export.copy': 'Copiar código SVG',
      'denoise.0': 'Desligado',
      'denoise.1': 'Leve',
      'denoise.2': 'Forte',
      'info.reduced': ' (reduzida para processar)',
      'info.color.one': '{n} cor',
      'info.color.other': '{n} cores',
      'name.default': 'imagem',
      'name.pasted': 'imagem-colada',
      'dialog.openTitle': 'Abrir imagem',
      'dialog.filterImages': 'Imagens',
      'dialog.filterAll': 'Todos os arquivos',
      'dialog.saveTitle': 'Exportar como {fmt}',
      'toast.openFail': 'Não foi possível abrir esse arquivo como imagem. Use PNG, JPG, WebP, BMP ou GIF.',
      'toast.emptyImage': 'A imagem está vazia ou sem dimensões.',
      'toast.vectorizeFail': 'Não foi possível vetorizar: {msg}',
      'toast.exportFail': 'Não foi possível exportar: {msg}',
      'toast.pngFail': 'Não foi possível gerar o PNG (imagem grande demais?).',
      'toast.saved': 'Salvo em {path}',
      'toast.reveal': 'Mostrar na pasta',
      'toast.copied': 'Código SVG copiado.',
      'toast.nothingCopy': 'Nada para copiar ainda.',
      'err.unknown': 'erro desconhecido',
      'err.INVALID_IMAGE': 'Imagem inválida.',
      'err.FULLY_TRANSPARENT': 'A imagem é totalmente transparente.',
      'err.NOTHING_TO_EXPORT': 'Nada para exportar. Vetorize uma imagem primeiro.',
      'err.UNKNOWN_FORMAT': 'Formato desconhecido.',
      'stage.alpha': 'Tratando transparência e cores',
      'stage.denoise': 'Removendo ruído e artefatos',
      'stage.contrast': 'Ajustando contraste',
      'stage.resize': 'Redimensionando para {w}×{h}',
      'stage.sharpen': 'Aplicando nitidez',
      'stage.threshold': 'Convertendo para preto e branco',
      'stage.trace': 'Vetorizando contornos e curvas',
      'stage.colors': 'Analisando cores',
      'stage.classify': 'Classificando pixels',
      'stage.despeckle': 'Limpando manchas',
      'stage.smooth': 'Suavizando regiões',
      'stage.curves': 'Ajustando curvas',
      'stage.finalize': 'Finalizando',
    },

    en: {
      'btn.open': 'Open image…',
      'btn.exportTop': 'Export…',
      'lang.aria': 'Language',
      'pane.original': 'Original',
      'pane.vector': 'Vector',
      'outline.label': 'Outlines',
      'outline.title': 'Show shape outlines only',
      'alt.original': 'Original image',
      'alt.vector': 'Vectorized result',
      'empty.title': 'Drop an image here',
      'empty.text': 'PNG, JPG, WebP, BMP or GIF. You can also paste from the clipboard with Ctrl+V.',
      'empty.button': 'Choose file…',
      'zoom.outTitle': 'Zoom out (−)',
      'zoom.inTitle': 'Zoom in (+)',
      'zoom.out': 'Zoom out',
      'zoom.in': 'Zoom in',
      'zoom.fit': 'Fit',
      'busy.preparing': 'Getting ready…',
      'busy.sending': 'Sending image…',
      'busy.working': 'Working…',
      'busy.cancel': 'Cancel',
      'drop.veil': 'Drop to open',
      'sidebar.aria': 'Settings',
      'preset.label': 'Starting point',
      'preset.logo': 'Logo, illustration or drawing',
      'preset.lowq': 'Low-quality image',
      'preset.lineart': 'Line art (black and white)',
      'preset.gray': 'Grayscale',
      'preset.photo': 'Photo, many colors',
      'preset.custom': 'Custom',
      'group.treat': 'Prepare the image',
      'group.vectorize': 'Vectorization',
      'group.export': 'Export',
      'p.upscale': 'Enlarge before vectorizing',
      'p.upscale.aria': 'Enlargement',
      'p.denoise': 'Remove noise and JPEG artifacts',
      'p.sharpen': 'Edge sharpness',
      'p.autoContrast': 'Auto-correct contrast',
      'p.colors': 'Colors',
      'p.mode.aria': 'Color mode',
      'p.mode.color': 'Color',
      'p.mode.gray': 'Gray',
      'p.mode.bw': 'B&W',
      'p.maxColors': 'Maximum colors',
      'p.threshold': 'Black threshold',
      'p.autoThreshold': 'Set automatically',
      'p.detail': 'Ignore specks smaller than',
      'p.smooth': 'Curve smoothness',
      'p.removeBg': 'Remove background (corner color)',
      'p.antiGap': 'Avoid gaps between colors',
      'run.button': 'Vectorize',
      'run.auto': 'Update when settings change',
      'stats.time': 'Time',
      'stats.colors': 'Colors',
      'stats.paths': 'Paths',
      'stats.nodes': 'Nodes',
      'stats.size': 'SVG size',
      'fmt.aria': 'Export format',
      'fmt.svg.hint': 'Editable vector for Illustrator, Inkscape, Figma and CorelDRAW.',
      'fmt.pdf.hint': 'Vector for print shops. 96 dpi scale (1 px = 0.75 pt).',
      'fmt.eps.hint': 'Encapsulated PostScript, accepted by layout software and print shops.',
      'fmt.dxf.hint': 'Outlines for CAD, laser cutting and CNC. One layer per color; approximate colors.',
      'fmt.png.hint': 'High-resolution image drawn from the vector.',
      'png.size': 'PNG size',
      'png.scale.aria': 'PNG scale',
      'png.transparent': 'Transparent background',
      'export.as': 'Export as {fmt}…',
      'export.copy': 'Copy SVG code',
      'denoise.0': 'Off',
      'denoise.1': 'Light',
      'denoise.2': 'Strong',
      'info.reduced': ' (downscaled for processing)',
      'info.color.one': '{n} color',
      'info.color.other': '{n} colors',
      'name.default': 'image',
      'name.pasted': 'pasted-image',
      'dialog.openTitle': 'Open image',
      'dialog.filterImages': 'Images',
      'dialog.filterAll': 'All files',
      'dialog.saveTitle': 'Export as {fmt}',
      'toast.openFail': 'Could not open this file as an image. Use PNG, JPG, WebP, BMP or GIF.',
      'toast.emptyImage': 'The image is empty or has no dimensions.',
      'toast.vectorizeFail': 'Could not vectorize: {msg}',
      'toast.exportFail': 'Could not export: {msg}',
      'toast.pngFail': 'Could not generate the PNG (image too large?).',
      'toast.saved': 'Saved to {path}',
      'toast.reveal': 'Show in folder',
      'toast.copied': 'SVG code copied.',
      'toast.nothingCopy': 'Nothing to copy yet.',
      'err.unknown': 'unknown error',
      'err.INVALID_IMAGE': 'Invalid image.',
      'err.FULLY_TRANSPARENT': 'The image is fully transparent.',
      'err.NOTHING_TO_EXPORT': 'Nothing to export. Vectorize an image first.',
      'err.UNKNOWN_FORMAT': 'Unknown format.',
      'stage.alpha': 'Processing transparency and colors',
      'stage.denoise': 'Removing noise and artifacts',
      'stage.contrast': 'Adjusting contrast',
      'stage.resize': 'Resizing to {w}×{h}',
      'stage.sharpen': 'Sharpening',
      'stage.threshold': 'Converting to black and white',
      'stage.trace': 'Tracing outlines and curves',
      'stage.colors': 'Analyzing colors',
      'stage.classify': 'Classifying pixels',
      'stage.despeckle': 'Cleaning specks',
      'stage.smooth': 'Smoothing regions',
      'stage.curves': 'Fitting curves',
      'stage.finalize': 'Finishing',
    },

    es: {
      'btn.open': 'Abrir imagen…',
      'btn.exportTop': 'Exportar…',
      'lang.aria': 'Idioma',
      'pane.original': 'Original',
      'pane.vector': 'Vector',
      'outline.label': 'Contornos',
      'outline.title': 'Mostrar solo los contornos de las formas',
      'alt.original': 'Imagen original',
      'alt.vector': 'Resultado vectorizado',
      'empty.title': 'Suelta una imagen aquí',
      'empty.text': 'PNG, JPG, WebP, BMP o GIF. También puedes pegar desde el portapapeles con Ctrl+V.',
      'empty.button': 'Elegir archivo…',
      'zoom.outTitle': 'Alejar (−)',
      'zoom.inTitle': 'Acercar (+)',
      'zoom.out': 'Alejar',
      'zoom.in': 'Acercar',
      'zoom.fit': 'Ajustar',
      'busy.preparing': 'Preparando…',
      'busy.sending': 'Enviando imagen…',
      'busy.working': 'Trabajando…',
      'busy.cancel': 'Cancelar',
      'drop.veil': 'Suelta para abrir',
      'sidebar.aria': 'Ajustes',
      'preset.label': 'Punto de partida',
      'preset.logo': 'Logotipo, ilustración o dibujo',
      'preset.lowq': 'Imagen de baja calidad',
      'preset.lineart': 'Dibujo a trazo (blanco y negro)',
      'preset.gray': 'Tonos de gris',
      'preset.photo': 'Foto, muchos colores',
      'preset.custom': 'Personalizado',
      'group.treat': 'Tratar la imagen',
      'group.vectorize': 'Vectorización',
      'group.export': 'Exportar',
      'p.upscale': 'Ampliar antes de vectorizar',
      'p.upscale.aria': 'Ampliación',
      'p.denoise': 'Quitar ruido y artefactos JPEG',
      'p.sharpen': 'Nitidez de los bordes',
      'p.autoContrast': 'Corregir el contraste automáticamente',
      'p.colors': 'Colores',
      'p.mode.aria': 'Modo de color',
      'p.mode.color': 'En color',
      'p.mode.gray': 'Gris',
      'p.mode.bw': 'B/N',
      'p.maxColors': 'Máximo de colores',
      'p.threshold': 'Umbral de negro',
      'p.autoThreshold': 'Definir automáticamente',
      'p.detail': 'Ignorar manchas menores que',
      'p.smooth': 'Suavidad de las curvas',
      'p.removeBg': 'Quitar fondo (color de las esquinas)',
      'p.antiGap': 'Evitar huecos entre los colores',
      'run.button': 'Vectorizar',
      'run.auto': 'Actualizar al cambiar los ajustes',
      'stats.time': 'Tiempo',
      'stats.colors': 'Colores',
      'stats.paths': 'Contornos',
      'stats.nodes': 'Nodos',
      'stats.size': 'Tamaño del SVG',
      'fmt.aria': 'Formato de exportación',
      'fmt.svg.hint': 'Vector editable en Illustrator, Inkscape, Figma y CorelDRAW.',
      'fmt.pdf.hint': 'Vector para impresión e imprentas. Escala de 96 dpi (1 px = 0,75 pt).',
      'fmt.eps.hint': 'PostScript encapsulado, aceptado por software de maquetación e imprentas.',
      'fmt.dxf.hint': 'Contornos para CAD, corte láser y CNC. Una capa por color; colores aproximados.',
      'fmt.png.hint': 'Imagen de alta resolución dibujada a partir del vector.',
      'png.size': 'Tamaño del PNG',
      'png.scale.aria': 'Escala del PNG',
      'png.transparent': 'Fondo transparente',
      'export.as': 'Exportar como {fmt}…',
      'export.copy': 'Copiar código SVG',
      'denoise.0': 'Desactivado',
      'denoise.1': 'Suave',
      'denoise.2': 'Fuerte',
      'info.reduced': ' (reducida para procesarla)',
      'info.color.one': '{n} color',
      'info.color.other': '{n} colores',
      'name.default': 'imagen',
      'name.pasted': 'imagen-pegada',
      'dialog.openTitle': 'Abrir imagen',
      'dialog.filterImages': 'Imágenes',
      'dialog.filterAll': 'Todos los archivos',
      'dialog.saveTitle': 'Exportar como {fmt}',
      'toast.openFail': 'No se pudo abrir este archivo como imagen. Usa PNG, JPG, WebP, BMP o GIF.',
      'toast.emptyImage': 'La imagen está vacía o no tiene dimensiones.',
      'toast.vectorizeFail': 'No se pudo vectorizar: {msg}',
      'toast.exportFail': 'No se pudo exportar: {msg}',
      'toast.pngFail': 'No se pudo generar el PNG (¿imagen demasiado grande?).',
      'toast.saved': 'Guardado en {path}',
      'toast.reveal': 'Mostrar en la carpeta',
      'toast.copied': 'Código SVG copiado.',
      'toast.nothingCopy': 'Aún no hay nada que copiar.',
      'err.unknown': 'error desconocido',
      'err.INVALID_IMAGE': 'Imagen no válida.',
      'err.FULLY_TRANSPARENT': 'La imagen es totalmente transparente.',
      'err.NOTHING_TO_EXPORT': 'No hay nada que exportar. Vectoriza una imagen primero.',
      'err.UNKNOWN_FORMAT': 'Formato desconocido.',
      'stage.alpha': 'Tratando transparencia y colores',
      'stage.denoise': 'Quitando ruido y artefactos',
      'stage.contrast': 'Ajustando el contraste',
      'stage.resize': 'Redimensionando a {w}×{h}',
      'stage.sharpen': 'Aplicando nitidez',
      'stage.threshold': 'Convirtiendo a blanco y negro',
      'stage.trace': 'Vectorizando contornos y curvas',
      'stage.colors': 'Analizando colores',
      'stage.classify': 'Clasificando píxeles',
      'stage.despeckle': 'Limpiando manchas',
      'stage.smooth': 'Suavizando regiones',
      'stage.curves': 'Ajustando curvas',
      'stage.finalize': 'Finalizando',
    },
  };

  // Node (testes): só exporta os dados. Navegador: monta o objeto global I18N.
  if (typeof document === 'undefined') {
    root.exports = { LANGS, DICT, FLAGS };
    return;
  }

  const STORE = 'sublimaia.lang';
  const listeners = [];

  function detect() {
    try {
      const saved = localStorage.getItem(STORE);
      if (saved && DICT[saved]) return saved;
    } catch (_) { /* sem acesso ao armazenamento: segue */ }
    const nav = String(navigator.language || '').toLowerCase();
    if (nav.startsWith('pt')) return 'pt';
    if (nav.startsWith('es')) return 'es';
    return 'en';
  }

  let lang = detect();
  const info = () => LANGS.find((l) => l.code === lang);

  function t(key, vars) {
    let s = DICT[lang][key];
    if (s === undefined) s = DICT.pt[key];
    if (s === undefined) return key;
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
    return s;
  }

  function apply() {
    document.documentElement.lang = info().htmlLang;
    for (const n of document.querySelectorAll('[data-i18n]')) n.textContent = t(n.dataset.i18n);
    for (const n of document.querySelectorAll('[data-i18n-title]')) n.title = t(n.dataset.i18nTitle);
    for (const n of document.querySelectorAll('[data-i18n-aria]')) n.setAttribute('aria-label', t(n.dataset.i18nAria));
    for (const n of document.querySelectorAll('[data-i18n-alt]')) n.alt = t(n.dataset.i18nAlt);
    for (const b of document.querySelectorAll('.lang button')) b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
  }

  function setLang(code) {
    if (!DICT[code] || code === lang) return;
    lang = code;
    try { localStorage.setItem(STORE, code); } catch (_) { /* ignora */ }
    apply();
    for (const fn of listeners) fn(code);
  }

  function buildSwitcher() {
    const box = document.getElementById('lang');
    if (!box) return;
    for (const l of LANGS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.lang = l.code;
      b.title = l.name;
      b.setAttribute('aria-label', l.name);
      b.innerHTML = FLAGS[l.code]; // SVG estático definido acima (não vem do usuário)
      b.addEventListener('click', () => setLang(l.code));
      box.append(b);
    }
  }

  buildSwitcher();
  apply();

  root.I18N = {
    t,
    setLang,
    get lang() { return lang; },
    get locale() { return info().locale; },
    number: (n) => Number(n).toLocaleString(info().locale),
    onChange: (fn) => listeners.push(fn),
  };
})(typeof document === 'undefined' ? module : window);
