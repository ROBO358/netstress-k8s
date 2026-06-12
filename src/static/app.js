'use strict';

// ── Constants ─────────────────────────────────────────────────────────────────

const WARMUP_S  = 2;    // seconds to discard from the beginning when computing final average
const WIN_S     = 1.0;  // sliding window for live mbps display (seconds)
const CHUNK_MB  = 32;   // XHR upload chunk size (MB per request per stream)
const SAMPLE_MS = 100;  // meter tick interval (ms)

// ── Chart ─────────────────────────────────────────────────────────────────────

class SpeedChart {
  constructor(canvasId, color) {
    this.canvas  = document.getElementById(canvasId);
    this.color   = color;
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
    const cW  = W - PAD.l - PAD.r;
    const cH  = H - PAD.t - PAD.b;

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

// ── Meter (sliding window throughput) ────────────────────────────────────────
// Accumulates bytes from parallel streams; ticked by setInterval.

class Meter {
  constructor() {
    this.ring       = []; // [{t, cumBytes}] circular buffer for sliding window
    this.cumBytes   = 0;
    this.warmupBytes = null; // cumBytes when warmup period ends
    this.warmupT     = null;
  }

  add(bytes) {
    this.cumBytes += bytes;
  }

  tick(elapsed) {
    const entry = { t: elapsed, b: this.cumBytes };
    this.ring.push(entry);

    // Track warmup boundary
    if (this.warmupBytes === null && elapsed >= WARMUP_S) {
      // Find the sample closest to WARMUP_S
      const wEntry = this.ring.find(e => e.t >= WARMUP_S);
      if (wEntry) {
        this.warmupBytes = wEntry.b;
        this.warmupT     = wEntry.t;
      }
    }

    // Trim ring to keep only last WIN_S * 3 seconds
    const cutoff = elapsed - WIN_S * 3;
    while (this.ring.length > 2 && this.ring[0].t < cutoff) {
      this.ring.shift();
    }
  }

  // Instantaneous Mbps over the last WIN_S seconds
  liveMbps() {
    if (this.ring.length < 2) return 0;
    const now  = this.ring[this.ring.length - 1];
    // Find oldest sample within WIN_S
    let oldest = this.ring[0];
    for (const e of this.ring) {
      if (now.t - e.t <= WIN_S) { oldest = e; break; }
    }
    const dt = now.t - oldest.t;
    if (dt <= 0) return 0;
    return (now.b - oldest.b) * 8 / (dt * 1e6);
  }

  // Final average Mbps, excluding warmup period
  finalMbps(totalElapsed) {
    if (this.warmupBytes === null) {
      // Test was shorter than warmup — fall back to full average
      if (totalElapsed <= 0 || this.cumBytes === 0) return 0;
      return this.cumBytes * 8 / (totalElapsed * 1e6);
    }
    const bytes = this.cumBytes - this.warmupBytes;
    const dt    = totalElapsed - this.warmupT;
    if (dt <= 0 || bytes <= 0) return 0;
    return bytes * 8 / (dt * 1e6);
  }
}

// ── DOM refs ──────────────────────────────────────────────────────────────────

const durEl     = document.getElementById('duration');
const streamsEl = document.getElementById('streams');
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

const getDuration = () => parseInt(durEl.value);
const getStreams  = () => parseInt(streamsEl.value);
const isUnlimited = () => getDuration() === 0;

function lockAll(locked) {
  [btnAll, btnPing, btnDl, btnUl, durEl, streamsEl, simEl].forEach(el => el.disabled = locked);
  btnStop.hidden = !locked;
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

// ── Random data ───────────────────────────────────────────────────────────────

function makeRandomData(size) {
  const data = new Uint8Array(size);
  for (let i = 0; i < data.length; i += 4) {
    const v    = Math.random() * 0x100000000;
    data[i]     =  v         & 0xff;
    data[i + 1] = (v >>  8)  & 0xff;
    data[i + 2] = (v >> 16)  & 0xff;
    data[i + 3] = (v >> 24)  & 0xff;
  }
  return data;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

async function runPing() {
  setRunning(cardPing, valPing, null);

  // Warmup: one throw-away request to establish connection
  try { await fetch('/ping', { cache: 'no-store' }); } catch (_) {}

  const samples = [];
  for (let i = 0; i < 10; i++) {
    const t0 = performance.now();
    await fetch('/ping', { cache: 'no-store' });
    samples.push(performance.now() - t0);
    if (i < 9) await new Promise(r => setTimeout(r, 50));
  }

  const min    = Math.min(...samples);
  const max    = Math.max(...samples);
  const jitter = max - min;
  setDone(cardPing, valPing, `${min.toFixed(1)} (±${jitter.toFixed(1)})`);
}

async function runDownload(signal) {
  const dur     = getDuration();
  const streams = getStreams();
  const unlim   = dur === 0;

  dlChart.reset();
  setRunning(cardDl, valDl, progDl);

  const meter = new Meter();
  const t0    = performance.now();
  let lastChartSec = 0;
  let abortedByTimer = false;

  // Duration timer
  let timerHandle = null;
  let timerAC     = null;
  if (!unlim) {
    timerAC = new AbortController();
    timerHandle = setTimeout(() => {
      abortedByTimer = true;
      timerAC.abort();
    }, dur * 1000);
  }

  const combinedSignal = unlim ? signal : anyAbort([signal, timerAC.signal]);

  // Ticker: update live display
  let tickHandle = setInterval(() => {
    const elapsed = (performance.now() - t0) / 1000;
    meter.tick(elapsed);
    const mbps = meter.liveMbps();
    valDl.textContent = mbps.toFixed(1);
    if (!unlim) progDl.value = Math.min((elapsed / dur) * 100, 100);
    if (elapsed - lastChartSec >= 0.3) {
      dlChart.push(elapsed, mbps);
      lastChartSec = elapsed;
    }
  }, SAMPLE_MS);

  // Download workers (one fetch per stream)
  const workers = Array.from({ length: streams }, async () => {
    try {
      const resp   = await fetch('/download?size=0', { cache: 'no-store', signal: combinedSignal });
      const reader = resp.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        meter.add(value.length);
      }
    } catch (e) {
      if (e.name !== 'AbortError') throw e;
    }
  });

  try {
    await Promise.all(workers);
  } finally {
    clearInterval(tickHandle);
    if (timerHandle) clearTimeout(timerHandle);
  }

  const elapsed = (performance.now() - t0) / 1000;
  meter.tick(elapsed);
  const mbps = meter.finalMbps(elapsed);
  dlChart.push(elapsed, mbps);
  if (!unlim) progDl.value = 100;
  setDone(cardDl, valDl, mbps.toFixed(1));
}

async function runUpload(signal) {
  const dur     = getDuration();
  const streams = getStreams();
  const unlim   = dur === 0;
  const chunkSize = CHUNK_MB * 1024 * 1024;

  ulChart.reset();
  setRunning(cardUl, valUl, progUl);

  const meter = new Meter();
  const t0    = performance.now();
  let lastChartSec = 0;
  let abortedByTimer = false;

  // Shared data blob — all XHRs read it concurrently (safe, read-only)
  const sharedData = makeRandomData(chunkSize);

  // Duration timer
  let timerHandle = null;
  let timerAC     = null;
  if (!unlim) {
    timerAC = new AbortController();
    timerHandle = setTimeout(() => {
      abortedByTimer = true;
      timerAC.abort();
    }, dur * 1000);
  }

  const stopSignal = unlim ? signal : anyAbort([signal, timerAC.signal]);

  // Ticker: update live display
  let tickHandle = setInterval(() => {
    const elapsed = (performance.now() - t0) / 1000;
    meter.tick(elapsed);
    const mbps = meter.liveMbps();
    valUl.textContent = mbps.toFixed(1);
    if (!unlim) progUl.value = Math.min((elapsed / dur) * 100, 100);
    if (elapsed - lastChartSec >= 0.3) {
      ulChart.push(elapsed, mbps);
      lastChartSec = elapsed;
    }
  }, SAMPLE_MS);

  // Upload worker: keeps sending chunks until aborted
  const uploadWorker = (workerSignal) => new Promise((resolve) => {
    let lastLoaded = 0;

    const sendNext = () => {
      if (workerSignal.aborted) { resolve(); return; }

      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/upload');
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');

      xhr.upload.addEventListener('progress', e => {
        const delta = e.loaded - lastLoaded;
        lastLoaded  = e.loaded;
        if (delta > 0) meter.add(delta);
      });

      xhr.addEventListener('load', () => {
        lastLoaded = 0;
        sendNext(); // loop: send next chunk immediately
      });
      xhr.addEventListener('error', () => resolve());
      xhr.addEventListener('abort', () => resolve());

      workerSignal.addEventListener('abort', () => xhr.abort(), { once: true });
      xhr.send(sharedData);
    };

    sendNext();
  });

  const workers = Array.from({ length: streams }, () => uploadWorker(stopSignal));

  try {
    await Promise.all(workers);
  } finally {
    clearInterval(tickHandle);
    if (timerHandle) clearTimeout(timerHandle);
  }

  const elapsed = (performance.now() - t0) / 1000;
  meter.tick(elapsed);
  const mbps = meter.finalMbps(elapsed);
  ulChart.push(elapsed, mbps);
  if (!unlim) progUl.value = 100;
  setDone(cardUl, valUl, mbps.toFixed(1));
}

// Helper: combine multiple AbortSignals into one
function anyAbort(signals) {
  const ac = new AbortController();
  for (const sig of signals) {
    if (sig.aborted) { ac.abort(); break; }
    sig.addEventListener('abort', () => ac.abort(), { once: true });
  }
  return ac.signal;
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
  }
}

// ── Event listeners ───────────────────────────────────────────────────────────

btnAll.addEventListener('click',  () => runAll());
btnPing.addEventListener('click', () => runSingle(runPing));
btnDl.addEventListener('click',   () => runSingle(runDownload));
btnUl.addEventListener('click',   () => runSingle(runUpload));
btnStop.addEventListener('click', () => abort?.abort());
