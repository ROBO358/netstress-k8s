'use strict';

const sizeEl   = document.getElementById('size');
const btnAll   = document.getElementById('btn-all');
const btnPing  = document.getElementById('btn-ping');
const btnDl    = document.getElementById('btn-dl');
const btnUl    = document.getElementById('btn-ul');
const valPing  = document.getElementById('val-ping');
const valDl    = document.getElementById('val-dl');
const valUl    = document.getElementById('val-ul');
const progDl   = document.getElementById('prog-dl');
const progUl   = document.getElementById('prog-ul');
const cardPing = document.getElementById('card-ping');
const cardDl   = document.getElementById('card-dl');
const cardUl   = document.getElementById('card-ul');

function setRunning(card, valueEl, prog) {
  card.classList.remove('done');
  card.classList.add('running');
  valueEl.textContent = '…';
  if (prog) prog.value = 0;
}

function setDone(card, valueEl, result) {
  card.classList.remove('running');
  card.classList.add('done');
  valueEl.textContent = result;
}

function lockAll(locked) {
  [btnAll, btnPing, btnDl, btnUl].forEach(b => b.disabled = locked);
}

async function runPing() {
  setRunning(cardPing, valPing, null);
  const samples = [];
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    await fetch('/ping', { cache: 'no-store' });
    samples.push(performance.now() - t0);
    await new Promise(r => setTimeout(r, 100));
  }
  const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
  setDone(cardPing, valPing, avg.toFixed(1));
}

async function runDownload() {
  const mb = parseInt(sizeEl.value, 10);
  const total = mb * 1024 * 1024;
  setRunning(cardDl, valDl, progDl);

  const t0 = performance.now();
  const resp = await fetch(`/download?size=${mb}`, { cache: 'no-store' });
  const reader = resp.body.getReader();

  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.length;
    progDl.value = (received / total) * 100;
    const elapsed = (performance.now() - t0) / 1000;
    if (elapsed > 0) valDl.textContent = ((received * 8) / (elapsed * 1e6)).toFixed(1);
  }

  const elapsed = (performance.now() - t0) / 1000;
  const mbps = (received * 8) / (elapsed * 1e6);
  progDl.value = 100;
  setDone(cardDl, valDl, mbps.toFixed(1));
}

async function runUpload() {
  const mb = parseInt(sizeEl.value, 10);
  const total = mb * 1024 * 1024;
  setRunning(cardUl, valUl, progUl);

  // Fill buffer with pseudo-random bytes (fast, no need for crypto quality)
  const data = new Uint8Array(total);
  for (let i = 0; i < data.length; i += 4) {
    const v = Math.random() * 0x100000000;
    data[i]     =  v        & 0xff;
    data[i + 1] = (v >>  8) & 0xff;
    data[i + 2] = (v >> 16) & 0xff;
    data[i + 3] = (v >> 24) & 0xff;
  }

  progUl.value = 10; // filling done, now uploading

  const t0 = performance.now();
  await fetch('/upload', {
    method: 'POST',
    body: data,
    headers: { 'Content-Type': 'application/octet-stream' },
    cache: 'no-store',
  });
  const elapsed = (performance.now() - t0) / 1000;
  const mbps = (total * 8) / (elapsed * 1e6);
  progUl.value = 100;
  setDone(cardUl, valUl, mbps.toFixed(1));
}

btnPing.addEventListener('click', async () => {
  lockAll(true);
  try { await runPing(); } finally { lockAll(false); }
});

btnDl.addEventListener('click', async () => {
  lockAll(true);
  try { await runDownload(); } finally { lockAll(false); }
});

btnUl.addEventListener('click', async () => {
  lockAll(true);
  try { await runUpload(); } finally { lockAll(false); }
});

btnAll.addEventListener('click', async () => {
  lockAll(true);
  try {
    await runPing();
    await runDownload();
    await runUpload();
  } finally {
    lockAll(false);
  }
});
