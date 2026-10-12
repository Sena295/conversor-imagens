const $ = id => document.getElementById(id);

// Bibliotecas carregadas só quando um formato precisa delas
const CDN = {
  jszip: 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
  jspdf: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  html2canvas: 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  pdfjs: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  pdfjsWorker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  xlsx: 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  mammoth: 'https://cdn.jsdelivr.net/npm/mammoth@1.6.0/mammoth.browser.min.js',
  lame: 'https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js',
};
const loading = {};
function lib(name) {
  return loading[name] ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = CDN[name];
    s.onload = resolve;
    s.onerror = () => { delete loading[name]; reject(new Error('Não foi possível carregar o conversor (sem internet?)')); };
    document.head.append(s);
  });
}

const CATEGORIES = {
  image: { label: 'Imagem', exts: ['png', 'jpg', 'jpeg', 'jfif', 'webp', 'gif', 'bmp', 'svg', 'avif', 'ico'], targets: ['jpg', 'png', 'webp', 'bmp', 'ico', 'pdf'] },
  pdf:   { label: 'PDF', exts: ['pdf'], targets: ['png', 'jpg', 'txt'] },
  sheet: { label: 'Planilha', exts: ['xlsx', 'xls', 'ods', 'csv', 'tsv', 'json'], targets: ['xlsx', 'csv', 'json', 'html'] },
  docx:  { label: 'Word', exts: ['docx'], targets: ['pdf', 'html', 'txt'] },
  text:  { label: 'Texto', exts: ['txt', 'md', 'log'], targets: ['pdf', 'html'] },
  pptx:  { label: 'PowerPoint', exts: ['pptx'], targets: ['txt'] },
  audio: { label: 'Áudio', exts: ['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus', 'weba'], targets: ['mp3', 'wav'] },
  video: { label: 'Vídeo (extrai o áudio)', exts: ['mp4', 'webm', 'mov'], targets: ['mp3', 'wav'] },
};

const UNSUPPORTED = {
  ppt: 'PPT antigo não converte no navegador. Abra no PowerPoint e salve como PPTX ou PDF.',
  doc: 'DOC antigo não converte no navegador. Abra no Word e salve como DOCX.',
  heic: 'HEIC (foto de iPhone) não é suportado pelos navegadores.',
  heif: 'HEIF não é suportado pelos navegadores.',
};

const TARGET_LABELS = { ico: 'ICO (ícone)', txt: 'TXT (texto)' };
const MIME = {
  jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon',
  pdf: 'application/pdf', txt: 'text/plain;charset=utf-8', html: 'text/html;charset=utf-8',
  csv: 'text/csv;charset=utf-8', json: 'application/json',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  mp3: 'audio/mpeg', wav: 'audio/wav', zip: 'application/zip',
};
const USES_QUALITY = new Set(['jpg', 'webp']);
const USES_BG = new Set(['jpg', 'bmp']);

let items = [];
const lastTarget = {};

// ---------- utilidades ----------

function extOf(name) {
  const ext = (name.match(/\.([^.]+)$/) || [])[1]?.toLowerCase() || '';
  return ext === 'jpeg' || ext === 'jfif' ? 'jpg' : ext;
}

function categoryOf(file) {
  const ext = extOf(file.name);
  for (const [key, cat] of Object.entries(CATEGORIES)) {
    if (cat.exts.includes(ext)) return key;
  }
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type.startsWith('video/')) return 'video';
  return null;
}

function targetsFor(cat, ext) {
  return CATEGORIES[cat].targets.filter(t => t !== ext);
}

function defaultTarget(cat, ext) {
  const options = targetsFor(cat, ext);
  if (options.includes(lastTarget[cat])) return lastTarget[cat];
  const preferred = { image: 'jpg', sheet: 'xlsx', audio: 'mp3' }[cat];
  return options.includes(preferred) ? preferred : options[0];
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

function baseName(name) {
  return name.replace(/\.[^.]+$/, '') || 'arquivo';
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function htmlPage(title, body, css = '') {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>body{font:15px/1.6 Arial,sans-serif;max-width:900px;margin:32px auto;padding:0 16px;color:#222}
table{border-collapse:collapse;margin-bottom:24px}td,th{border:1px solid #bbb;padding:4px 8px}img{max-width:100%}${css}</style>
</head><body>${body}</body></html>`;
}

const textBlob = (text, ext) => new Blob([text], { type: MIME[ext] });
const tick = () => new Promise(r => setTimeout(r));

function canvasToBlob(canvas, type, quality) {
  return new Promise(resolve => canvas.toBlob(resolve, type, quality));
}

async function zipFiles(files) {
  await lib('jszip');
  const zip = new JSZip();
  const used = new Set();
  for (const f of files) {
    let name = f.name, n = 1;
    while (used.has(name)) name = f.name.replace(/(\.[^.]+)$/, `-${n++}$1`);
    used.add(name);
    zip.file(name, f.blob);
  }
  return zip.generateAsync({ type: 'blob' });
}

function quality() { return $('quality').value / 100; }

// ---------- imagens ----------

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Este navegador não consegue abrir essa imagem'));
    img.src = URL.createObjectURL(file);
  });
}

function newCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  return canvas;
}

// Cor mais comum nas bordas da imagem (agrupando tons parecidos)
function borderColor(d, w, h) {
  const groups = new Map();
  const add = p => {
    const i = p * 4;
    if (d[i + 3] < 8) return;
    const key = (d[i] >> 4) << 8 | (d[i + 1] >> 4) << 4 | (d[i + 2] >> 4);
    const g = groups.get(key) || [0, 0, 0, 0];
    g[0]++; g[1] += d[i]; g[2] += d[i + 1]; g[3] += d[i + 2];
    groups.set(key, g);
  };
  for (let x = 0; x < w; x++) { add(x); add((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { add(y * w); add(y * w + w - 1); }
  let best = null;
  for (const g of groups.values()) if (!best || g[0] > best[0]) best = g;
  return best && [best[1] / best[0], best[2] / best[0], best[3] / best[0]];
}

// Apaga o fundo de cor sólida partindo das bordas, então partes internas
// da mesma cor (ex.: o miolo de um logo) são preservadas
function removeBackground(canvas, sensitivity) {
  const w = canvas.width, h = canvas.height, total = w * h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const imageData = ctx.getImageData(0, 0, w, h);
  const d = imageData.data;
  const bg = borderColor(d, w, h);
  if (!bg) return;
  const tol = sensitivity * 2.5;
  const soft = tol * 2;
  const dist = i => Math.hypot(d[i] - bg[0], d[i + 1] - bg[1], d[i + 2] - bg[2]);

  const isBg = new Uint8Array(total);
  const stack = new Int32Array(total);
  let top = 0;
  const visit = p => {
    if (!isBg[p] && (d[p * 4 + 3] < 8 || dist(p * 4) <= tol)) { isBg[p] = 1; stack[top++] = p; }
  };
  for (let x = 0; x < w; x++) { visit(x); visit((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { visit(y * w); visit(y * w + w - 1); }
  while (top) {
    const p = stack[--top], x = p % w;
    if (x > 0) visit(p - 1);
    if (x < w - 1) visit(p + 1);
    if (p >= w) visit(p - w);
    if (p < total - w) visit(p + w);
  }

  for (let p = 0; p < total; p++) {
    const i = p * 4;
    if (isBg[p]) { d[i + 3] = 0; continue; }
    // contorno: pixels encostados no fundo ficam semitransparentes, sem "aura" da cor antiga
    const x = p % w;
    const edge = (x > 0 && isBg[p - 1]) || (x < w - 1 && isBg[p + 1]) || (p >= w && isBg[p - w]) || (p < total - w && isBg[p + w]);
    if (!edge) continue;
    const dd = dist(i);
    if (dd >= soft) continue;
    const a = (dd - tol) / (soft - tol);
    for (let c = 0; c < 3; c++) d[i + c] = Math.min(255, Math.max(0, (d[i + c] - (1 - a) * bg[c]) / a));
    d[i + 3] = Math.round(d[i + 3] * a);
  }
  ctx.putImageData(imageData, 0, 0);
}

// Corta as bordas totalmente transparentes
function trimCanvas(canvas) {
  const w = canvas.width, h = canvas.height;
  const d = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 16) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return canvas;
  const out = newCanvas(x1 - x0 + 1, y1 - y0 + 1);
  out.getContext('2d').drawImage(canvas, -x0, -y0);
  return out;
}

// Ícone quadrado de até 256x256, imagem centralizada
function fitSquare(canvas, max) {
  const size = Math.min(max, Math.max(canvas.width, canvas.height));
  const scale = size / Math.max(canvas.width, canvas.height);
  const w = Math.round(canvas.width * scale), h = Math.round(canvas.height * scale);
  const out = newCanvas(size, size);
  const ctx = out.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, Math.round((size - w) / 2), Math.round((size - h) / 2), w, h);
  return out;
}

function flatten(canvas, color) {
  const out = newCanvas(canvas.width, canvas.height);
  const ctx = out.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(canvas, 0, 0);
  return out;
}

function cutoutOptions() {
  return $('cutout').checked ? { sensitivity: +$('tolerance').value, trim: $('trim').checked } : null;
}

async function imageToCanvas(file, { opaque, square } = {}) {
  const img = await loadImage(file);
  let canvas = newCanvas(img.naturalWidth || 512, img.naturalHeight || 512);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(img.src);
  const cutout = cutoutOptions();
  if (cutout) {
    removeBackground(canvas, cutout.sensitivity);
    if (cutout.trim) canvas = trimCanvas(canvas);
  }
  if (square) canvas = fitSquare(canvas, 256);
  if (opaque) canvas = flatten(canvas, $('bg').value);
  return canvas;
}

// BMP 24 bits, sem compressão
function canvasToBMP(canvas) {
  const w = canvas.width, h = canvas.height;
  const data = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  const rowSize = Math.ceil(w * 3 / 4) * 4;
  const size = 54 + rowSize * h;
  const buf = new ArrayBuffer(size);
  const v = new DataView(buf);
  v.setUint16(0, 0x4d42, true);  // "BM"
  v.setUint32(2, size, true);
  v.setUint32(10, 54, true);
  v.setUint32(14, 40, true);
  v.setInt32(18, w, true);
  v.setInt32(22, h, true);
  v.setUint16(26, 1, true);
  v.setUint16(28, 24, true);
  v.setUint32(34, rowSize * h, true);
  v.setInt32(38, 2835, true);
  v.setInt32(42, 2835, true);
  const px = new Uint8Array(buf, 54);
  for (let y = 0; y < h; y++) {
    const row = (h - 1 - y) * rowSize;  // BMP guarda as linhas de baixo para cima
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, j = row + x * 3;
      px[j] = data[i + 2]; px[j + 1] = data[i + 1]; px[j + 2] = data[i];
    }
  }
  return new Blob([buf], { type: MIME.bmp });
}

// ICO com uma imagem PNG dentro (suportado desde o Windows Vista)
async function canvasToICO(canvas) {
  const png = new Uint8Array(await (await canvasToBlob(canvas, 'image/png')).arrayBuffer());
  const size = canvas.width;
  const v = new DataView(new ArrayBuffer(22));
  v.setUint16(2, 1, true);
  v.setUint16(4, 1, true);
  v.setUint8(6, size >= 256 ? 0 : size);
  v.setUint8(7, size >= 256 ? 0 : size);
  v.setUint16(10, 1, true);
  v.setUint16(12, 32, true);
  v.setUint32(14, png.length, true);
  v.setUint32(18, 22, true);
  return new Blob([v.buffer, png], { type: MIME.ico });
}

// Cada imagem vira uma página do tamanho dela
async function imagesToPdf(files) {
  await lib('jspdf');
  let doc;
  for (const file of files) {
    const canvas = await imageToCanvas(file, { opaque: true });
    const w = canvas.width, h = canvas.height;
    const orientation = w > h ? 'l' : 'p';
    if (!doc) doc = new jspdf.jsPDF({ orientation, unit: 'px', format: [w, h], hotfixes: ['px_scaling'] });
    else doc.addPage([w, h], orientation);
    doc.addImage(canvas.toDataURL('image/jpeg', quality()), 'JPEG', 0, 0, w, h);
  }
  return doc.output('blob');
}

async function convertImage(file, target) {
  if (target === 'pdf') return { blob: await imagesToPdf([file]) };
  const canvas = await imageToCanvas(file, { opaque: USES_BG.has(target), square: target === 'ico' });
  const info = `${canvas.width}×${canvas.height}` + (cutoutOptions() ? (USES_BG.has(target) ? ' · fundo trocado' : ' · fundo transparente') : '');
  if (target === 'bmp') return { blob: canvasToBMP(canvas), info };
  if (target === 'ico') return { blob: await canvasToICO(canvas), info };
  const blob = await canvasToBlob(canvas, MIME[target], quality());
  if (!blob || blob.type !== MIME[target]) throw new Error('Seu navegador não consegue gerar ' + target.toUpperCase());
  return { blob, info };
}

// ---------- PDF ----------

async function convertPdf(file, target, progress) {
  await lib('pdfjs');
  pdfjsLib.GlobalWorkerOptions.workerSrc = CDN.pdfjsWorker;
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const total = pdf.numPages;
  const pages = total === 1 ? '1 página' : `${total} páginas`;

  if (target === 'txt') {
    let text = '';
    for (let n = 1; n <= total; n++) {
      progress(`Lendo página ${n} de ${total}...`);
      const content = await (await pdf.getPage(n)).getTextContent();
      text += content.items.map(i => i.str + (i.hasEOL ? '\n' : '')).join('') + '\n\n';
    }
    if (!text.trim()) throw new Error('Esse PDF não tem texto (é uma imagem escaneada)');
    return { blob: textBlob(text.trim() + '\n', 'txt'), info: pages };
  }

  const files = [];
  for (let n = 1; n <= total; n++) {
    progress(`Convertendo página ${n} de ${total}...`);
    const page = await pdf.getPage(n);
    const viewport = page.getViewport({ scale: 2 });  // ~144 dpi
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width; canvas.height = viewport.height;
    // intent 'print' não depende de requestAnimationFrame, então não trava com a aba em segundo plano
    await page.render({ canvasContext: canvas.getContext('2d'), viewport, intent: 'print' }).promise;
    const blob = await canvasToBlob(canvas, MIME[target], quality());
    files.push({ blob, name: `${baseName(file.name)}-pagina-${n}.${target}` });
  }
  if (files.length === 1) return { blob: files[0].blob, info: pages };
  return { blob: await zipFiles(files), ext: 'zip', info: `${pages} em .zip` };
}

// ---------- planilhas ----------

async function convertSheet(file, target, ext) {
  await lib('xlsx');
  let wb;
  if (ext === 'json') {
    const data = JSON.parse(await file.text());
    wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(Array.isArray(data) ? data : [data]), 'Planilha1');
  } else if (ext === 'csv' || ext === 'tsv') {
    wb = XLSX.read(await file.text(), { type: 'string' });
  } else {
    wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  }
  const names = wb.SheetNames;
  const tabs = names.length === 1 ? '1 aba' : `${names.length} abas`;

  if (target === 'xlsx') {
    return { blob: new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], { type: MIME.xlsx }), info: tabs };
  }
  if (target === 'csv') {
    // BOM para o Excel reconhecer acentos
    const csv = '﻿' + XLSX.utils.sheet_to_csv(wb.Sheets[names[0]]);
    return { blob: textBlob(csv, 'csv'), info: names.length > 1 ? `só a 1ª de ${names.length} abas` : tabs };
  }
  if (target === 'json') {
    const sheets = Object.fromEntries(names.map(n => [n, XLSX.utils.sheet_to_json(wb.Sheets[n])]));
    const data = names.length === 1 ? sheets[names[0]] : sheets;
    return { blob: textBlob(JSON.stringify(data, null, 2), 'json'), info: tabs };
  }
  const body = names.map(n =>
    `<h2>${escapeHtml(n)}</h2>` + XLSX.utils.sheet_to_html(wb.Sheets[n], { header: '', footer: '' })).join('');
  return { blob: textBlob(htmlPage(baseName(file.name), body), 'html'), info: tabs };
}

// ---------- textos ----------

async function textToPdf(text) {
  await lib('jspdf');
  const doc = new jspdf.jsPDF({ unit: 'pt', format: 'a4' });
  doc.setFont('helvetica');
  doc.setFontSize(11);
  const lines = doc.splitTextToSize(text.replace(/\t/g, '    '), 515);
  let y = 56;
  for (const line of lines) {
    if (y > 800) { doc.addPage(); y = 56; }
    doc.text(line, 40, y);
    y += 15;
  }
  return doc.output('blob');
}

async function htmlToPdf(html) {
  await Promise.all([lib('jspdf'), lib('html2canvas')]);
  // o recipiente fica fora da tela; o conteúdo em si não pode ter posição, senão sai em branco
  const stage = document.createElement('div');
  stage.className = 'pdf-stage';
  const box = document.createElement('div');
  box.className = 'pdf-render';
  box.innerHTML = html;
  stage.append(box);
  document.body.append(stage);
  try {
    const doc = new jspdf.jsPDF({ unit: 'pt', format: 'a4' });
    await new Promise(resolve => doc.html(box, {
      callback: resolve, margin: [40, 40, 40, 40], autoPaging: 'text', width: 515, windowWidth: 700,
    }));
    return doc.output('blob');
  } finally {
    stage.remove();
  }
}

async function convertText(file, target) {
  const text = await file.text();
  if (target === 'pdf') return { blob: await textToPdf(text) };
  const body = `<pre style="white-space:pre-wrap;font:14px/1.6 Consolas,monospace">${escapeHtml(text)}</pre>`;
  return { blob: textBlob(htmlPage(baseName(file.name), body), 'html') };
}

async function convertDocx(file, target) {
  await lib('mammoth');
  const arrayBuffer = await file.arrayBuffer();
  if (target === 'txt') return { blob: textBlob((await mammoth.extractRawText({ arrayBuffer })).value, 'txt') };
  const html = (await mammoth.convertToHtml({ arrayBuffer })).value;
  if (target === 'html') return { blob: textBlob(htmlPage(baseName(file.name), html), 'html') };
  return { blob: await htmlToPdf(html) };
}

async function convertPptx(file) {
  await lib('jszip');
  const zip = await JSZip.loadAsync(file);
  const num = n => +n.match(/(\d+)\.xml$/)[1];
  const slides = Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => num(a) - num(b));
  if (!slides.length) throw new Error('Nenhum slide encontrado');
  const parts = [];
  for (const [i, name] of slides.entries()) {
    const xml = new DOMParser().parseFromString(await zip.file(name).async('string'), 'application/xml');
    const lines = [...xml.getElementsByTagName('a:p')]
      .map(p => [...p.getElementsByTagName('a:t')].map(t => t.textContent).join(''))
      .filter(Boolean);
    parts.push(`--- Slide ${i + 1} ---\n${lines.join('\n')}`);
  }
  return { blob: textBlob(parts.join('\n\n') + '\n', 'txt'), info: slides.length === 1 ? '1 slide' : `${slides.length} slides` };
}

// ---------- áudio e vídeo ----------

async function decodeAudio(file) {
  if (file.size > 500 * 1024 * 1024) throw new Error('Arquivo grande demais (máximo 500 MB)');
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  try {
    return await ctx.decodeAudioData(await file.arrayBuffer());
  } catch {
    throw new Error('Este navegador não consegue ler o áudio desse arquivo');
  } finally {
    ctx.close();
  }
}

function audioToWav(buf) {
  const ch = buf.numberOfChannels, len = buf.length, rate = buf.sampleRate;
  const dataSize = len * ch * 2;
  const ab = new ArrayBuffer(44 + dataSize);
  const v = new DataView(ab);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + dataSize, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, dataSize, true);
  const chans = Array.from({ length: ch }, (_, i) => buf.getChannelData(i));
  let o = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return new Blob([ab], { type: MIME.wav });
}

function floatTo16(samples) {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

async function audioToMp3(buf, progress) {
  await lib('lame');
  const ch = Math.min(2, buf.numberOfChannels);
  const encoder = new lamejs.Mp3Encoder(ch, buf.sampleRate, 192);
  const left = floatTo16(buf.getChannelData(0));
  const right = ch > 1 ? floatTo16(buf.getChannelData(1)) : null;
  const parts = [];
  const step = 1152;
  for (let i = 0; i < left.length; i += step) {
    const chunk = ch > 1
      ? encoder.encodeBuffer(left.subarray(i, i + step), right.subarray(i, i + step))
      : encoder.encodeBuffer(left.subarray(i, i + step));
    if (chunk.length) parts.push(chunk);
    if (i % (step * 500) === 0) {
      progress(`Gerando MP3... ${Math.round(i / left.length * 100)}%`);
      await tick();  // deixa a página respirar durante arquivos longos
    }
  }
  parts.push(encoder.flush());
  return new Blob(parts, { type: MIME.mp3 });
}

async function convertAudio(file, target, progress) {
  progress('Lendo áudio...');
  const buf = await decodeAudio(file);
  const secs = Math.round(buf.duration);
  const info = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')} min`;
  if (target === 'wav') return { blob: audioToWav(buf), info };
  return { blob: await audioToMp3(buf, progress), info };
}

// ---------- fila de arquivos ----------

const CONVERTERS = {
  image: (f, t) => convertImage(f, t),
  pdf: (f, t, p) => convertPdf(f, t, p),
  sheet: (f, t, p, ext) => convertSheet(f, t, ext),
  docx: (f, t) => convertDocx(f, t),
  text: (f, t) => convertText(f, t),
  pptx: f => convertPptx(f),
  audio: (f, t, p) => convertAudio(f, t, p),
  video: (f, t, p) => convertAudio(f, t, p),
};

async function runConversion(item) {
  const run = item.run = (item.run || 0) + 1;
  const current = () => run === item.run && items.includes(item);
  const progress = text => { if (current()) item.meta.textContent = text; };
  item.meta.className = 'meta busy';
  item.meta.textContent = 'Convertendo...';
  item.link.classList.add('hidden');
  item.li.classList.remove('done');
  if (item.original) item.thumb.src = item.original;
  if (item.out) { URL.revokeObjectURL(item.link.href); item.out = null; }
  updateButtons();
  try {
    const result = await CONVERTERS[item.cat](item.file, item.target, progress, item.ext);
    if (!current()) return;
    const ext = result.ext || item.target;
    const name = baseName(item.file.name) + '.' + ext;
    item.out = { blob: result.blob, name };
    item.link.href = URL.createObjectURL(result.blob);
    item.link.download = name;
    item.link.textContent = 'Baixar ' + ext.toUpperCase();
    // a miniatura passa a mostrar o arquivo convertido (o quadriculado indica transparência)
    if (item.original && result.blob.type.startsWith('image/')) item.thumb.src = item.link.href;
    item.link.classList.remove('hidden');
    item.meta.className = 'meta ok';
    item.meta.textContent = ['Pronto', `${formatSize(item.file.size)} → ${formatSize(result.blob.size)}`, result.info].filter(Boolean).join(' · ');
  } catch (e) {
    if (!current()) return;
    console.error(e);
    item.meta.className = 'meta err';
    item.meta.textContent = 'Erro: ' + e.message;
  }
  updateButtons();
}

function makeThumb(file, cat, ext) {
  if (cat === 'image') {
    const img = document.createElement('img');
    img.className = 'thumb';
    img.src = URL.createObjectURL(file);
    img.alt = '';
    return img;
  }
  const badge = document.createElement('div');
  badge.className = 'thumb badge';
  badge.dataset.cat = cat || 'none';
  badge.textContent = (ext || '?').toUpperCase().slice(0, 4);
  return badge;
}

function addFiles(files) {
  for (const file of files) {
    const ext = extOf(file.name);
    const cat = categoryOf(file);
    const li = document.createElement('li');
    li.className = 'item';
    const thumb = makeThumb(file, cat, ext);
    const info = document.createElement('div');
    info.className = 'info';
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = file.name;
    name.title = file.name;
    const meta = document.createElement('div');
    meta.className = 'meta';
    info.append(name, meta);
    li.append(thumb, info);
    $('list').append(li);

    if (!cat) {
      meta.className = 'meta err';
      meta.textContent = UNSUPPORTED[ext] || 'Formato não suportado';
      items.push({ file, li, thumb, meta, cat: null });
      continue;
    }

    const target = document.createElement('label');
    target.className = 'target';
    target.append('para');
    const select = document.createElement('select');
    for (const t of targetsFor(cat, ext)) select.add(new Option(TARGET_LABELS[t] || t.toUpperCase(), t));
    target.append(select);
    const link = document.createElement('a');
    link.className = 'dl hidden';
    link.addEventListener('click', () => {
      li.classList.add('done');
      downloadToast(link.download);
    });
    li.append(target, link);

    const item = { file, li, thumb, meta, link, select, cat, ext, target: defaultTarget(cat, ext), original: thumb.src };
    select.value = item.target;
    select.addEventListener('change', () => {
      item.target = lastTarget[cat] = select.value;
      updateOptions();
      runConversion(item);
    });
    items.push(item);
    runConversion(item);
  }
  updateOptions();
  updateButtons();
}

function updateButtons() {
  $('panel').classList.toggle('hidden', items.length === 0);
  $('downloadAll').disabled = !items.some(i => i.out);
  $('mergePdf').classList.toggle('hidden', items.filter(i => i.cat === 'image').length < 2);
}

function updateOptions() {
  const usesQuality = items.some(i => USES_QUALITY.has(i.target) || (i.cat === 'image' && i.target === 'pdf'));
  const usesBg = items.some(i => i.cat === 'image' && (USES_BG.has(i.target) || i.target === 'pdf'));
  const hasImages = items.some(i => i.cat === 'image');
  const cutout = hasImages && $('cutout').checked;
  $('cutoutWrap').classList.toggle('hidden', !hasImages);
  $('toleranceWrap').classList.toggle('hidden', !cutout);
  $('trimWrap').classList.toggle('hidden', !cutout);
  $('qualityWrap').classList.toggle('hidden', !usesQuality);
  $('bgWrap').classList.toggle('hidden', !usesBg);
  $('opts').classList.toggle('hidden', !usesQuality && !usesBg && !hasImages);
}

function reconvert(filter) {
  items.filter(i => i.cat && filter(i)).forEach(runConversion);
}

let toastTimer;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 5000);
}

function downloadToast(name) {
  toast(`Baixando "${name}". Se o navegador perguntar onde salvar, escolha a pasta e clique em Salvar.`);
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  downloadToast(name);
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

function renderFormats() {
  $('formats').innerHTML = Object.values(CATEGORIES).map(c => `
    <div class="fmt">
      <strong>${c.label}</strong>
      <div>${c.exts.filter(e => e !== 'jfif').map(e => e.toUpperCase()).join(', ')}</div>
      <div class="to"><b>→</b> ${c.targets.map(t => t.toUpperCase()).join(', ')}</div>
    </div>`).join('');
}

// ---------- eventos ----------

$('input').addEventListener('change', e => { addFiles(e.target.files); e.target.value = ''; });

const drop = $('drop');
['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => addFiles(e.dataTransfer.files));

document.addEventListener('paste', e => addFiles([...e.clipboardData.files]));

$('quality').addEventListener('input', () => { $('qualityOut').textContent = $('quality').value + '%'; });
$('quality').addEventListener('change', () => reconvert(i => USES_QUALITY.has(i.target) || (i.cat === 'image' && i.target === 'pdf')));
$('bg').addEventListener('change', () => reconvert(i => i.cat === 'image' && (USES_BG.has(i.target) || i.target === 'pdf')));
$('cutout').addEventListener('change', () => { updateOptions(); reconvert(i => i.cat === 'image'); });
$('tolerance').addEventListener('change', () => reconvert(i => i.cat === 'image'));
$('trim').addEventListener('change', () => reconvert(i => i.cat === 'image'));

$('clear').addEventListener('click', () => {
  items.forEach(i => {
    if (i.original) URL.revokeObjectURL(i.original);
    if (i.out) URL.revokeObjectURL(i.link.href);
  });
  items = [];
  $('list').innerHTML = '';
  updateOptions();
  updateButtons();
});

$('downloadAll').addEventListener('click', async () => {
  const btn = $('downloadAll');
  btn.disabled = true;
  try {
    download(await zipFiles(items.filter(i => i.out).map(i => i.out)), 'arquivos-convertidos.zip');
  } finally {
    btn.disabled = false;
  }
});

$('mergePdf').addEventListener('click', async () => {
  const btn = $('mergePdf');
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Gerando PDF...';
  try {
    download(await imagesToPdf(items.filter(i => i.cat === 'image').map(i => i.file)), 'imagens.pdf');
  } catch (e) {
    toast('Não foi possível gerar o PDF: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
});

// ---------- áudio de um link (só no modo local, pelo servidor.js) ----------

function urlStatus(text, kind = '') {
  $('urlStatus').textContent = text;
  $('urlStatus').className = 'url-status ' + kind;
}

function nameFromDisposition(header) {
  const match = /filename\*=UTF-8''([^;]+)/i.exec(header || '');
  return match && decodeURIComponent(match[1]);
}

async function checkLocalServer() {
  let status = null;
  try {
    const r = await fetch('api/status');
    if (r.ok) status = await r.json();
  } catch {}
  const ready = status?.ytdlp && status?.ffmpeg;
  $('urlForm').closest('.url-card').classList.toggle('off', !ready);
  if (!status) urlStatus('Disponível só com o conversor aberto pelo atalho no seu computador (Abrir Conversor.bat).');
  else if (!ready) urlStatus('Falta instalar o yt-dlp e o ffmpeg neste computador: winget install yt-dlp.yt-dlp Gyan.FFmpeg', 'err');
}

$('urlForm').addEventListener('submit', async e => {
  e.preventDefault();
  const format = $('urlFormat').value;
  const btn = $('urlBtn');
  btn.disabled = true;
  urlStatus('Baixando e extraindo o áudio... vídeos longos podem levar alguns minutos.', 'busy');
  try {
    const r = await fetch(`api/extrair?url=${encodeURIComponent($('urlInput').value.trim())}&formato=${format}`);
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).erro || `Erro ${r.status}`);
    const blob = await r.blob();
    const name = nameFromDisposition(r.headers.get('Content-Disposition')) || `audio.${format}`;
    download(blob, name);
    urlStatus(`Pronto: ${name} · ${formatSize(blob.size)}`, 'ok');
  } catch (err) {
    urlStatus(err.message === 'Failed to fetch' ? 'O servidor local foi fechado. Abra o atalho de novo.' : err.message, 'err');
  } finally {
    btn.disabled = false;
  }
});

renderFormats();
checkLocalServer();
