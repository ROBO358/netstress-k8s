'use strict';

// ── Chart ────────────────────────────────────────────────────────────────────

class SpeedChart {
  constructor(canvasId, color) {
    this.canvas = document.getElementById(canvasId);
    this.color  = color;
    this.samples = []; // [{t, mbps}]
  }

  reset() { this.samples = []; this._draw(); }

  push(t, mbps) { this.samples.push({ t, mbps }); this._draw(); }

  _draw() {
    const { canvas, samples, color } = this;
    const dpr = window.devicePixelRatio || 1;
    const W   = canvas.offsetWidth;
    const H   = canvas.offsetHeight;
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const PAD = { t: 6, r: 6, b: 22, l: 42 };
    const cW = W - PAD.l - PAD.r;
    const cH = H - PAD.t - PAD.b;

    // Axes
    ctx.strokeStyle = '#2e3144';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD.l, PAD.t);
    ctx.lineTo(PAD.l, PAD.t + cH);
    ctx.lineTo(PAD.l + cW, PAD.t + cH);
    ctx.stroke();

    if (samples.length < 2) return;

    const maxT    = samples[samples.length - 1].t;
    const maxMbps = samples.reduce((m, s) => Math.max(m, s.mbps), 0);
    const yMax    = Math.max(Math.ceil(maxMbps / 50) * 50, 50);

    const xOf = t    => PAD.l + (t    / maxT) * cW;
    const yOf = mbps => PAD.t + cH - (mbps / yMax) * cH;

    ctx.font = '9px sans-serif';

    // Horizontal grid lines + Y labels
    for (let i = 0; i <= 4; i++) {
      const y   = PAD.t + (cH / 4) * i;
      const val = Math.round(yMax * (1 - i / 4));
      ctx.strokeStyle = '#2e3144';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(PAD.l + cW, y); ctx.stroke();
      ctx.fillStyle = '#8b90a8';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(val, PAD.l - 4, y);
    }

    // X labels
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const ticks = Math.min(5, samples.length - 1);
    for (let i = 0; i <= ticks; i++) {
      const t = maxT * i / ticks;
      ctx.fillStyle = '#8b90a8';
      ctx.fillText(t.toFixed(1) + 's', xOf(t), PAD.t + cH + 4);
    }

    // Fill area
    ctx.beginPath();
    samples.forEach(({ t, mbps }, i) => {
      i === 0 ? ctx.moveTo(xOf(t), yOf(mbps)) : ctx.lineTo(xOf(t), yOf(mbps));
    });
    ctx.lineTo(xOf(samples[samples.length - 1].t), yOf(0));
    ctx.lineTo(xOf(samples[0].t), yOf(0));
    ctx.closePath();
    ctx.fillStyle = color + '28';
    ctx.fill();

    // Line
    ctx.beginPath();
    samples.forEach(({ t, mbps }, i) => {
      i === 0 ? ctx.moveTo(xOf(t), yOf(mbps)) : ctx.lineTo(xOf(t), yOf(mbps));
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
}

// ── DOM refs ──────────────────────────────────────────────────────────────────

const sizeEl    = document.getElementById('size');
const simEl     = document.getElementById('simultaneous');
const btnAll    = document.getElementById('btn-all');
const btnStop   = document.getElementById('btn-stop');
const btnPing   = document.getElementById('btn-ping');
const btnDl     = document.getElementById('btn-dl');
const btnUl     = document.getElementById('btn-ul');
const valPing   = document.getElementById('val-ping');
const valDl     = document.getElementById('val-dl');
const valUl     = document.getElementById('val-ul');
const progDl    = document.getElementById('prog-dl');
const progUl    = document.getElementById('prog-ul');
const cardPing  = document.getElementById('card-ping');
const cardDl    = document.getElementById('card-dl');
const cardUl    = document.getElementById('card-ul');
const dlChart   = new SpeedChart('chart-dl', '#4f8ef7');
const ulChart   = new SpeedChart('chart-ul', '#4ade80');

// ── State ─────────────────────────────────────────────────────────────────────

let abort = null;

const isUnlimited = () => parseInt(sizeEl.value) === 0;

function lockAll(locked) {
  [btnAll, btnPing, btnDl, btnUl, sizeEl, simEl].forEach(el => el.disabled = locked);
  btnStop.hidden = !(locked && isUnlimited());
}

function setRunning(card, valEl, progEl) {
  card.classList.remove('done');
  card.classList.add('running');
  valEl.textContent = '…';
  if (progEl) {
    if (isUnlimited()) progEl.removeAttribute('value');
    else               progEl.value = 0;
  }
}

function setDone(card, valEl, result) {
  card.classList.remove('running');
  card.classList.add('done');
  valEl.textContent = result;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

async function runPing() {
  setRunning(cardPing, valPing, null);
  const samples = [];
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    await fetch('/ping', { cache: 'no-store' });
    samples.push(performance.now() - t0);
    if (i < 4) await new Promise(r => setTimeout(r, 100));
  }
  const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
  setDone(cardPing, valPing, avg.toFixed(1));
}

async function runDownload(signal) {
  const mb        = parseInt(sizeEl.value);
  const unlimited = mb === 0;
  const total     = unlimited ? Infinity : mb * 1024 * 1024;

  dlChart.reset();
  setRunning(cardDl, valDl, progDl);

  const t0          = performance.now();
  let received      = 0;
  let lastSampleSec = 0;

  try {
    const resp   = await fetch(`/download?size=${mb}`, { cache: 'no-store', signal });
    const reader = resp.body.getReader();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;

      const elapsed = (performance.now() - t0) / 1000;
      const mbps    = (received * 8) / (elapsed * 1e6);

      valDl.textContent = mbps.toFixed(1);
      if (!unlimited) progDl.value = (received / total) * 100;

      if (elapsed - lastSampleSec >= 0.3) {
        dlChart.push(elapsed, mbps);
        lastSampleSec = elapsed;
      }
    }
  } catch (e) {
    if (e.name !== 'AbortError') throw e;
  }

  const elapsed = (performance.now() - t0) / 1000;
  if (received > 0 && elapsed > 0) {
    const mbps = (received * 8) / (elapsed * 1e6);
    dlChart.push(elapsed, mbps);
    if (!unlimited) progDl.value = 100;
    setDone(cardDl, valDl, mbps.toFixed(1));
  }
}

function makeRandomData(size) {
  const data = new Uint8Array(size);
  for (let i = 0; i < data.length; i += 4) {
    const v = Math.random() * 0x100000000;
    data[i]     =  v         & 0xff;
    data[i + 1] = (v >>  8) & 0xff;
    data[i + 2] = (v >> 16) & 0xff;
    data[i + 3] = (v >> 24) & 0xff;
  }
  return data;
}

async function runUpload(signal) {
  const mb        = parseInt(sizeEl.value);
  const unlimited = mb === 0;
  const chunkMB   = unlimited ? 50 : mb;
  const chunkSize = chunkMB * 1024 * 1024;

  ulChart.reset();
  setRunning(cardUl, valUl, progUl);

  const data          = makeRandomData(chunkSize);
  const t0            = performance.now();
  let   prevBytes     = 0; // bytes from already-completed chunks
  let   lastSampleSec = 0;

  // XHR gives us upload.onprogress — fetch() does not
  const sendChunk = () => new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
    }
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/upload');
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');

    xhr.upload.addEventListener('progress', e => {
      const elapsed = (performance.now() - t0) / 1000;
      if (elapsed <= 0) return;
      const bytes = prevBytes + e.loaded;
      const mbps  = (bytes * 8) / (elapsed * 1e6);
      valUl.textContent = mbps.toFixed(1);
      if (!unlimited) progUl.value = (bytes / chunkSize) * 100;
      if (elapsed - lastSampleSec >= 0.3) {
        ulChart.push(elapsed, mbps);
        lastSampleSec = elapsed;
      }
    });

    xhr.addEventListener('load',  () => resolve());
    xhr.addEventListener('error', () => reject(new Error('XHR upload failed')));
    xhr.addEventListener('abort', () =>
      reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })));
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });

    xhr.send(data);
  });

  try {
    if (unlimited) {
      while (!signal?.aborted) {
        await sendChunk();
        prevBytes += chunkSize;
        const elapsed = (performance.now() - t0) / 1000;
        const mbps    = (prevBytes * 8) / (elapsed * 1e6);
        ulChart.push(elapsed, mbps);
        lastSampleSec = elapsed;
        valUl.textContent = mbps.toFixed(1);
      }
    } else {
      await sendChunk();
      const elapsed = (performance.now() - t0) / 1000;
      const mbps    = (chunkSize * 8) / (elapsed * 1e6);
      ulChart.push(elapsed, mbps);
      progUl.value = 100;
      setDone(cardUl, valUl, mbps.toFixed(1));
      return;
    }
  } catch (e) {
    if (e.name !== 'AbortError') throw e;
  }

  if (prevBytes > 0) {
    const elapsed = (performance.now() - t0) / 1000;
    const mbps    = (prevBytes * 8) / (elapsed * 1e6);
    setDone(cardUl, valUl, mbps.toFixed(1));
  }
}

// ── Orchestration ─────────────────────────────────────────────────────────────

async function runAll() {
  abort = new AbortController();
  lockAll(true);
  try {
    await runPing();
    if (simEl.checked) {
      await Promise.all([runDownload(abort.signal), runUpload(abort.signal)]);
    } else {
      await runDownload(abort.signal);
      await runUpload(abort.signal);
    }
  } finally {
    abort = null;
    lockAll(false);
    btnStop.hidden = true;
  }
}

async function runSingle(fn) {
  abort = new AbortController();
  lockAll(true);
  try {
    await fn(abort.signal);
  } finally {
    abort = null;
    lockAll(false);
    btnStop.hidden = true;
  }
}

// ── Event listeners ───────────────────────────────────────────────────────────

btnAll.addEventListener('click',  () => runAll());
btnPing.addEventListener('click', () => runSingle(runPing));
btnDl.addEventListener('click',   () => runSingle(runDownload));
btnUl.addEventListener('click',   () => runSingle(runUpload));
btnStop.addEventListener('click', () => abort?.abort());
