// Jawabat: one question per screen; answer by voice, screenshot or text.
// Every answer is sent the moment it exists (insert-only, gated by the
// secret code in the link). Without config.js values it runs as a demo and
// keeps everything on this device.
(() => {
  'use strict';

  const CFG = window.ZQ_CONFIG || {};
  const QS = window.ZQ_QUESTIONS || [];
  const GROUPS = window.ZQ_GROUPS || {};
  const N = QS.length;
  const params = new URLSearchParams(location.search);
  const TOKEN = (params.get('k') || '').trim();
  const LIVE = Boolean(CFG.url && CFG.key) && params.get('demo') !== '1';
  const SELFTEST = LIVE && params.get('selftest') === '1';
  const OWNER = LIVE ? TOKEN : 'demo';
  const STORE = 'zq1:' + (LIVE ? TOKEN.slice(0, 8) : 'demo');
  const API = String(CFG.url || '').replace(/\/+$/, '');
  const CLIENT = String(navigator.userAgent || '').slice(0, 200);
  const MAX_REC = 15 * 60;
  const MAX_FILE = 25 * 1024 * 1024;
  const app = document.getElementById('app');

  // ---------- helpers ----------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const pad = (n) => String(n).padStart(2, '0');
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const mmss = (s) => Math.floor(s / 60) + ':' + pad(Math.floor(s % 60));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const baseMime = (m) => String(m || '').split(';')[0].trim().toLowerCase();
  const $ = (sel) => document.querySelector(sel);

  const EXT = {
    'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/m4a': 'm4a',
    'audio/aac': 'aac', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
    'audio/3gpp': '3gp', 'audio/amr': 'amr', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp',
    'image/gif': 'gif', 'image/heic': 'heic', 'image/heif': 'heif',
  };
  const MIME_BY_EXT = {
    m4a: 'audio/mp4', mp4: 'audio/mp4', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', opus: 'audio/ogg',
    aac: 'audio/aac', amr: 'audio/amr', webm: 'audio/webm', '3gp': 'audio/3gpp', png: 'image/png', jpg: 'image/jpeg',
    jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic', heif: 'image/heif',
  };

  const ICONS = {
    mic: '<path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Z"/><path d="M19 11a7 7 0 0 1-14 0M12 18v3"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="m21 16-5-5-9 9"/>',
    pen: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    left: '<path d="M15 5l-7 7 7 7"/>',
    right: '<path d="m9 5 7 7-7 7"/>',
    chev: '<path d="m6 9 6 6 6-6"/>',
    audio: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
  };
  const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;

  let toastTimer = 0;
  function toast(msg) {
    let t = $('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
  }

  // ---------- local state (resume on the same device) ----------
  const blank = () => ({ screen: 'intro', idx: 0, texts: {}, sent: {}, items: [], opened: false });
  let S = load();
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE));
      if (s && Array.isArray(s.items)) {
        const st = Object.assign(blank(), s);
        st.idx = Math.min(Math.max(0, st.idx | 0), N - 1);
        st.items.forEach((i) => { delete i.busy; if (i.status === 'up') i.status = 'wait'; });
        return st;
      }
    } catch (e) { /* storage blocked or corrupt: start fresh */ }
    return blank();
  }
  function save() {
    try { localStorage.setItem(STORE, JSON.stringify(S, (k, v) => (k === 'busy' ? undefined : v))); } catch (e) { /* ignore */ }
  }

  // Recorded clips and pictures are kept in IndexedDB until they are sent,
  // so a dropped connection or a reload does not lose them.
  let dbp = null;
  function idb() {
    if (!dbp) {
      dbp = new Promise((res, rej) => {
        try {
          const r = indexedDB.open('zq-files', 1);
          r.onupgradeneeded = () => r.result.createObjectStore('f');
          r.onsuccess = () => res(r.result);
          r.onerror = () => rej(r.error);
        } catch (e) { rej(e); }
      });
    }
    return dbp;
  }
  async function idbPut(id, blob) {
    const db = await idb();
    return new Promise((res, rej) => {
      const tx = db.transaction('f', 'readwrite');
      tx.objectStore('f').put(blob, id);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  }
  async function idbGet(id) {
    const db = await idb();
    return new Promise((res, rej) => {
      const r = db.transaction('f').objectStore('f').get(id);
      r.onsuccess = () => res(r.result || null);
      r.onerror = () => rej(r.error);
    });
  }
  const mem = new Map();
  const urls = new Map();
  async function getBlob(id) {
    if (mem.has(id)) return mem.get(id);
    try {
      const b = await idbGet(id);
      if (b) mem.set(id, b);
      return b;
    } catch (e) { return null; }
  }

  // ---------- Supabase (raw REST, insert only) ----------
  function hdrs(extra) {
    const h = Object.assign({ apikey: CFG.key }, extra || {});
    if (/^eyJ/.test(CFG.key)) h.Authorization = 'Bearer ' + CFG.key; // legacy JWT keys only
    return h;
  }
  async function insertRow(row, token) {
    if (!LIVE) { await sleep(250); return; }
    const res = await fetch(API + '/rest/v1/answers', {
      method: 'POST',
      headers: hdrs({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
      body: JSON.stringify(Object.assign({ token: token || TOKEN, client: CLIENT }, row)),
    });
    if (!res.ok) throw new Error('db ' + res.status + ' ' + (await res.text()).slice(0, 160));
  }
  const objUrl = (path) => API + '/storage/v1/object/answers/' + path.split('/').map(encodeURIComponent).join('/');
  async function putFile(path, blob, mime) {
    if (!LIVE) { await sleep(450); return; }
    const res = await fetch(objUrl(path), {
      method: 'POST',
      headers: hdrs({ 'Content-Type': mime, 'x-upsert': 'false' }),
      body: blob,
    });
    if (res.ok) return;
    const txt = await res.text();
    if (res.status === 409 || /duplicate|already exists/i.test(txt)) return; // an earlier try got through
    throw new Error('file ' + res.status + ' ' + txt.slice(0, 160));
  }

  // ---------- answers ----------
  const cur = () => QS[S.idx];
  const itemsFor = (q) => S.items.filter((i) => i.q === q && !i.gone);
  const hasAnswer = (q) => Boolean((S.texts[q] || '').trim()) || itemsFor(q).length > 0;

  async function addItem(q, kind, blob, seconds, name) {
    const nameExt = ((/\.([a-z0-9]{2,5})$/i.exec(name || '') || [])[1] || '').toLowerCase();
    let mime = baseMime(blob.type);
    if (!mime.startsWith(kind === 'audio' ? 'audio/' : 'image/')) {
      mime = MIME_BY_EXT[nameExt] || (kind === 'audio' ? 'audio/webm' : 'image/jpeg');
    }
    const id = uid();
    const ext = EXT[mime] || nameExt || 'bin';
    const it = {
      id, q, kind, mime, ext, name: name || '', size: blob.size,
      seconds: seconds || null,
      path: OWNER + '/q' + pad(q) + '/' + id + '.' + ext,
      up: false, row: false, status: 'wait', at: Date.now(),
    };
    mem.set(id, blob);
    try { await idbPut(id, blob); } catch (e) { /* memory copy still works this session */ }
    S.items.push(it);
    save();
    renderItems();
    send(it);
  }

  async function send(it) {
    if (it.busy || it.row || it.gone) return;
    it.busy = true;
    it.status = 'up';
    paintItem(it);
    try {
      if (!it.up) {
        const blob = await getBlob(it.id);
        if (!blob) throw new Error('lost');
        await putFile(it.path, blob, it.mime);
        it.up = true;
        save();
      }
      await insertRow({ q: it.q, kind: it.kind, file_path: it.path, mime: it.mime, seconds: it.seconds, body: it.name || null });
      it.row = true;
      it.status = 'done';
    } catch (e) {
      it.status = e && e.message === 'lost' ? 'lost' : 'fail';
      it.err = String((e && e.message) || e).slice(0, 200);
    }
    it.busy = false;
    save();
    paintItem(it);
    if (S.screen === 'end') renderEnd();
  }

  async function removeItem(it) {
    if (!it || it.busy) return;
    const what = it.kind === 'audio' ? 'had l vocal' : 'had screenshot';
    if (!window.confirm('Bghiti tmse7 ' + what + '?')) return;
    if (it.row) {
      try { await insertRow({ q: it.q, kind: 'discard', body: it.path }); } catch (e) { toast('Ma tmse7ch, 3awd mn b3d.'); return; }
    }
    it.gone = true;
    save();
    renderItems();
  }

  function addFiles(q, files, only) {
    for (const f of Array.from(files || [])) {
      const n = f.name || '';
      const isImg = /^image\//.test(f.type) || /\.(png|jpe?g|webp|gif|heic|heif)$/i.test(n);
      const isAud = /^audio\//.test(f.type) || /\.(m4a|mp3|wav|ogg|opus|aac|amr|webm|3gp)$/i.test(n);
      if ((only === 'image' && !isImg) || (only === 'audio' && !isAud) || (!isImg && !isAud)) { toast('Ghir images wla audio.'); continue; }
      if (f.size > MAX_FILE) { toast('Fichier kbir bzaf (max 25 MB).'); continue; }
      addItem(q, isImg ? 'image' : 'audio', f, null, n);
    }
  }

  // Text answers: saved a moment after typing stops, and on every move.
  // Each save is a new row; the newest row per question is the answer.
  const textTimer = {};
  const textChain = {};
  const textState = {};
  function onType(q, val) {
    S.texts[q] = val;
    save();
    paintText(q, 'typing');
    clearTimeout(textTimer[q]);
    textTimer[q] = setTimeout(() => flushText(q), 1800);
  }
  function flushText(q) {
    clearTimeout(textTimer[q]);
    textChain[q] = (textChain[q] || Promise.resolve()).then(async () => {
      const val = S.texts[q] || '';
      if (val === (S.sent[q] || '')) { paintText(q, val.trim() ? 'saved' : ''); return; }
      paintText(q, 'saving');
      try {
        await insertRow({ q, kind: 'text', body: val });
        S.sent[q] = val;
        save();
        paintText(q, (S.texts[q] || '') === val ? 'saved' : 'typing');
      } catch (e) {
        paintText(q, 'fail');
      }
    });
    return textChain[q];
  }
  const flushAllTexts = () => Promise.all(QS.map((x) => flushText(x.n)));
  const unsentTexts = () => QS.filter((x) => (S.texts[x.n] || '') !== (S.sent[x.n] || ''));

  // ---------- voice recording ----------
  let REC = null;
  const canRecord = () => Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  function pickMime() {
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return '';
    for (const m of ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus']) {
      if (MediaRecorder.isTypeSupported(m)) return m;
    }
    return '';
  }
  async function startRec(q) {
    if (REC) return;
    if (!canRecord()) { showMicHelp('nosupport'); return; }
    REC = { q, starting: true };
    paintRec();
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) {
      REC = null;
      paintRec();
      showMicHelp('denied');
      return;
    }
    if (S.screen !== 'q' || cur().n !== q) { // moved on while the permission prompt was open
      stream.getTracks().forEach((t) => t.stop());
      REC = null;
      paintRec();
      return;
    }
    const mime = pickMime();
    let rec;
    try { rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 64000 } : undefined); } catch (e) { rec = new MediaRecorder(stream); }
    const chunks = [];
    const t0 = Date.now();
    rec.addEventListener('dataavailable', (e) => { if (e.data && e.data.size) chunks.push(e.data); });
    const stopped = new Promise((res) => rec.addEventListener('stop', res));
    REC = { q, rec, stream, t0, stopped, timer: setInterval(tickRec, 250) };
    stopped.then(() => {
      stream.getTracks().forEach((t) => t.stop());
      const secs = Math.round((Date.now() - t0) / 100) / 10;
      const blob = new Blob(chunks, { type: baseMime(rec.mimeType || mime) || 'audio/webm' });
      if (REC && REC.rec === rec) { clearInterval(REC.timer); REC = null; }
      paintRec();
      if (blob.size > 0 && secs >= 0.6) addItem(q, 'audio', blob, secs);
      else toast('Vocal 9sir bzaf.');
    });
    rec.start(1000);
    paintRec();
  }
  async function stopRec() {
    const r = REC;
    if (!r || !r.rec) return;
    try { if (r.rec.state !== 'inactive') r.rec.stop(); } catch (e) { /* already stopped */ }
    await r.stopped;
  }
  function tickRec() {
    if (!REC || !REC.rec) return;
    const s = (Date.now() - REC.t0) / 1000;
    const t = $('#rec .time');
    if (t) t.textContent = mmss(s);
    if (s >= MAX_REC) stopRec();
  }
  function paintRec() {
    const b = $('#rec');
    if (!b) return;
    const q = cur().n;
    if (REC && REC.q === q && REC.starting) {
      b.className = 'btn btn-primary btn-block btn-big btn-rec';
      b.disabled = true;
      b.innerHTML = `${icon('mic')} Kanftah l micro…`;
    } else if (REC && REC.q === q) {
      b.className = 'btn btn-block btn-big btn-rec is-rec';
      b.disabled = false;
      b.innerHTML = `<span class="recdot"></span><span class="time">${mmss((Date.now() - REC.t0) / 1000)}</span> · W9ef`;
      b.setAttribute('aria-label', 'W9ef t-sajjel');
    } else {
      b.className = 'btn btn-primary btn-block btn-big btn-rec';
      b.disabled = false;
      b.innerHTML = `${icon('mic')} Sajjel vocal`;
      b.setAttribute('aria-label', 'Sajjel vocal');
    }
  }
  function showMicHelp(why) {
    const p = $('#micHelp');
    if (!p) return;
    p.hidden = false;
    p.innerHTML = (why === 'denied'
      ? 'Ma9dertch nftah l micro. 3ti l permission l micro f navigateur, wla sajjel b l app dyal telephone w sift l fichier: '
      : 'Had navigateur ma kaysajjelch vocal. Sajjel b l app dyal telephone w sift l fichier: ')
      + '<button class="link" data-act="pickAudio">Sift fichier audio</button>';
  }

  // ---------- painting ----------
  function banner() {
    return LIVE ? '' : '<div class="banner"><b>Mode démo:</b> had l jawabat kaybqaw ghir f had l appareil, ma kaytsifto l 7ta wa7d.</div>';
  }

  function renderItems() {
    const ul = $('#items');
    if (!ul || S.screen !== 'q') return;
    const list = itemsFor(cur().n);
    let a = 0;
    let m = 0;
    ul.innerHTML = list.map((it) => {
      const label = it.kind === 'audio'
        ? 'Vocal ' + (++a) + (it.seconds ? ' · ' + mmss(it.seconds) : '')
        : 'Screenshot ' + (++m);
      const lead = it.kind === 'image'
        ? `<img class="thumb" alt="" data-src="${it.id}">`
        : `<span class="ico">${icon(it.name ? 'audio' : 'mic')}</span>`;
      const media = it.kind === 'audio' ? `<audio controls preload="metadata" data-src="${it.id}"></audio>` : '';
      return `<li class="item" data-id="${it.id}">${lead}<div class="item-main"><div class="item-top"><span class="item-name">${esc(label)}</span><span class="st" data-st></span></div>${media}</div><button class="x" data-act="remove" data-id="${it.id}" aria-label="Msa7">${icon('x')}</button></li>`;
    }).join('');
    ul.hidden = list.length === 0;
    list.forEach((it) => { paintItem(it); attachMedia(it); });
  }
  async function attachMedia(it) {
    let url = urls.get(it.id);
    if (!url) {
      const b = await getBlob(it.id);
      if (!b) return;
      url = URL.createObjectURL(b);
      urls.set(it.id, url);
    }
    const el = document.querySelector(`[data-src="${it.id}"]`);
    if (el) el.src = url;
  }
  function paintItem(it) {
    const li = document.querySelector(`.item[data-id="${it.id}"]`);
    if (!li) return;
    const st = li.querySelector('[data-st]');
    const look = {
      wait: ['up', 'Kaytsifet…'], up: ['up', 'Kaytsifet…'], done: ['ok', 'Wsel'],
      fail: ['bad', 'Ma wselch'], lost: ['bad', 'Ma bqach, 3awd sajjel'],
    }[it.status] || ['up', 'Kaytsifet…'];
    st.className = 'st st-' + look[0];
    st.innerHTML = (look[0] === 'up' ? '<i class="spin"></i>' : look[0] === 'ok' ? icon('check') : '')
      + esc(look[1])
      + (it.status === 'fail' ? ` · <button class="link" data-act="retry" data-id="${it.id}">3awd</button>` : '');
    if (it.status === 'fail' && it.err) st.title = it.err;
    const x = li.querySelector('.x');
    if (x) x.disabled = Boolean(it.busy);
  }
  function paintText(q, state) {
    textState[q] = state;
    const el = $('#tstatus');
    if (!el || S.screen !== 'q' || cur().n !== q) return;
    const look = {
      typing: '<span class="muted">Ghadi ytsajjel…</span>',
      saving: '<span class="st st-up"><i class="spin"></i>Kaytsajjel…</span>',
      saved: `<span class="st st-ok">${icon('check')}Tsajjel</span>`,
      fail: '<span class="st st-bad">Ma tsajjelch · <button class="link" data-act="textRetry">3awd</button></span>',
    }[state] || '';
    el.innerHTML = look;
  }

  function renderIntro() {
    const started = QS.some((x) => hasAnswer(x.n));
    app.innerHTML = `${banner()}
      <main class="wrap hello">
        <section class="card">
          <span class="chip">Bootcamp · ${N} so2al</span>
          <h1 class="h-xl" style="margin-top:16px">Salam Zayed</h1>
          <p class="lead">Chft l bootcamp kamel b tafasil, w bghit ntbe3 système kima katchr7o nta b dabt. Ba9in ${N} no9ta ma fhemthomch mzyan.</p>
          <p class="lead">Kol so2al f page bo7do. Jawb kifma bghiti:</p>
          <ul class="ways">
            <li><span class="ico">${icon('mic')}</span><div><b>Vocal</b><span>Wrek 3la "Sajjel vocal" w hder.</span></div></li>
            <li><span class="ico">${icon('image')}</span><div><b>Screenshot</b><span>Wrini kifach katmarki 3la chart.</span></div></li>
            <li><span class="ico">${icon('pen')}</span><div><b>Kteb</b><span>Ila bghiti tkteb jawab dyalek.</span></div></li>
          </ul>
          <p class="note">Jawab 9sir kafi, w t9der tkhlet: vocal + screenshot + ktaba f nefs so2al. Kolchi kaywsel automatiquement, ma khassek tsift walo. T9der tw9ef w tkemmel mn b3d mn nefs l appareil.</p>
          <button class="btn btn-primary btn-block btn-big" data-act="start">${started ? 'Kemmel (so2al ' + cur().n + ')' : 'Bda'} ${icon('right')}</button>
        </section>
      </main>`;
  }

  function renderQ() {
    const Q = cur();
    const last = S.idx === N - 1;
    app.innerHTML = `${banner()}
      <header class="top">
        <div class="top-row">
          <span class="brand"><span class="dot"></span>Jawabat</span>
          <button class="jump" data-act="jump" aria-haspopup="dialog">So2al <b>${Q.n}</b> / ${N} ${icon('chev')}</button>
        </div>
        <div class="track"><span style="width:${((S.idx + 1) / N) * 100}%"></span></div>
      </header>
      <main class="wrap has-nav">
        <article class="card">
          <span class="chip">${esc(Q.g)} · ${esc(GROUPS[Q.g] || '')}</span>
          <h1 class="qtitle"><span class="qn">${Q.n}.</span> ${esc(Q.t)}</h1>
          <p class="qtext">${esc(Q.q)}</p>
        </article>
        <section class="card answer" id="answer">
          <h2 class="label">Jawab dyalek</h2>
          <div class="tools">
            <button class="btn btn-primary btn-block btn-big btn-rec" id="rec" data-act="rec"></button>
            <button class="btn btn-soft btn-block btn-big" data-act="pick">${icon('image')} Zid screenshot</button>
          </div>
          <p class="mic-help" id="micHelp" hidden></p>
          <p class="hint">T9der tzid bzaf dyal vocals w screenshots. F PC t9der dir Ctrl+V bach tlsse9 screenshot.
            <button class="link" data-act="pickAudio">Sift fichier audio</button></p>
          <input type="file" id="pick" accept="image/*" multiple hidden>
          <input type="file" id="pickAudio" accept="audio/*" multiple hidden>
          <ul class="items" id="items" hidden></ul>
          <hr class="divider">
          <label class="label" for="txt">Wla kteb</label>
          <textarea id="txt" rows="5" maxlength="15000" placeholder="Kteb jawab dyalek hna…">${esc(S.texts[Q.n] || '')}</textarea>
          <div class="tstatus" id="tstatus" aria-live="polite"></div>
        </section>
      </main>
      <nav class="nav">
        <div class="nav-in">
          <button class="btn btn-ghost" data-act="prev">${icon('left')} Lli 9bel</button>
          <button class="btn btn-ink" data-act="${last ? 'finish' : 'next'}">${last ? 'Salit ' + icon('check') : 'Lli mn b3d ' + icon('right')}</button>
        </div>
      </nav>
      <div class="sheet" id="sheet" hidden role="dialog" aria-modal="true" aria-label="Kol l as2ila"></div>`;
    paintRec();
    renderItems();
    const st = textState[Q.n] || ((S.texts[Q.n] || '').trim() && S.texts[Q.n] === S.sent[Q.n] ? 'saved' : '');
    paintText(Q.n, st);
  }

  function openSheet() {
    const sh = $('#sheet');
    if (!sh) return;
    sh.innerHTML = `<div class="sheet-in">
        <div class="sheet-head"><h2>Kol l as2ila</h2><button class="x" data-act="closeSheet" aria-label="Sedd">${icon('x')}</button></div>
        <div class="grid">${QS.map((x, i) => `<button data-act="goto" data-i="${i}" class="${hasAnswer(x.n) ? 'done' : ''} ${i === S.idx ? 'cur' : ''}" aria-label="So2al ${x.n}${hasAnswer(x.n) ? ', fih jawab' : ''}">${x.n}</button>`).join('')}</div>
        <div class="legend"><span><i style="background:var(--primary-pale)"></i>Fih jawab</span><span><i style="border:1.5px solid var(--ink)"></i>Hna</span></div>
      </div>`;
    sh.hidden = false;
  }

  function renderEnd() {
    const live = S.items.filter((i) => !i.gone);
    const pending = live.some((i) => !i.row && (i.busy || i.status === 'wait' || i.status === 'up'));
    const failed = live.filter((i) => !i.row && (i.status === 'fail' || i.status === 'lost'));
    const textFail = unsentTexts();
    const empty = QS.filter((x) => !hasAnswer(x.n));
    const answered = N - empty.length;
    let state;
    if (pending) state = '<p class="lead"><span class="st st-up"><i class="spin"></i>Kantsenna ljawabat ywslo…</span></p>';
    else if (failed.length || textFail.length) state = '<p class="lead">Chi 7wayej ma wslouch ba9i. Wrek 3la "3awd".</p>';
    else state = '<p class="lead">Ljawabat dyalek wslo. Allah y7fdek!</p>';
    app.innerHTML = `${banner()}
      <main class="wrap">
        <section class="card">
          <div class="done-mark">${icon('check')}</div>
          <h1 class="h-xl">Chokran bzaf!</h1>
          ${state}
          <p class="muted">Jawbti 3la ${answered} mn ${N}.</p>
          ${failed.length || textFail.length ? `<ul class="fails">
            ${failed.map((i) => `<li><span>So2al ${i.q} · ${i.kind === 'audio' ? 'vocal' : 'screenshot'}</span>${i.status === 'fail' ? `<button class="link" data-act="retry" data-id="${i.id}">3awd</button>` : '<span class="small">ma bqach</span>'}</li>`).join('')}
            ${textFail.map((x) => `<li><span>So2al ${x.n} · ktaba</span><button class="link" data-act="textRetryAll">3awd</button></li>`).join('')}
          </ul>` : ''}
          ${empty.length ? `<p class="muted" style="margin:18px 0 0">Ba9in bla jawab:</p><div class="chips">${empty.map((x) => `<button data-act="goto" data-i="${x.n - 1}">${x.n}</button>`).join('')}</div>` : ''}
          <p class="note" style="margin-top:22px">Ila bghiti tzid chi 7aja, rje3 l ay so2al.</p>
          <button class="btn btn-soft btn-block" data-act="goto" data-i="${S.idx}">${icon('left')} Rje3 l as2ila</button>
        </section>
      </main>`;
  }

  function renderNoLink() {
    app.innerHTML = `<main class="wrap"><section class="card">
        <h1 class="h-xl">Had lien na9es</h1>
        <p class="lead">7el lien kamel li wslek (fih <b>?k=</b> f lekher).</p>
      </section></main>`;
  }

  function render() {
    if (LIVE && !TOKEN) return renderNoLink();
    if (S.screen === 'q') renderQ();
    else if (S.screen === 'end') renderEnd();
    else renderIntro();
  }

  // ---------- navigation ----------
  async function go(screen, idx) {
    if (REC) await stopRec();
    if (S.screen === 'q') flushText(cur().n);
    S.screen = screen;
    if (idx != null) S.idx = Math.min(Math.max(0, idx), N - 1);
    save();
    render();
    window.scrollTo(0, 0);
  }
  async function finish() {
    await go('end');
    await flushAllTexts();
    const t0 = Date.now();
    while (S.items.some((i) => !i.gone && !i.row && (i.busy || i.status === 'wait')) && Date.now() - t0 < 180000) await sleep(400);
    const answered = QS.filter((x) => hasAnswer(x.n)).length;
    try { await insertRow({ q: 0, kind: 'done', body: JSON.stringify({ answered, items: S.items.filter((i) => !i.gone).length }) }); } catch (e) { /* the answers themselves are what matters */ }
    if (S.screen === 'end') renderEnd();
  }
  async function begin() {
    if (LIVE && !S.opened) {
      try {
        await insertRow({ q: 0, kind: 'open' });
        S.opened = true;
        save();
      } catch (e) {
        toast('Lien ma khdamch (' + String(e.message).slice(0, 40) + '). Sift l message l li sift lik lien.');
      }
    }
    go('q');
  }
  function retryAll() {
    S.items.filter((i) => !i.gone && !i.row && (i.status === 'fail' || i.status === 'wait')).forEach((i) => send(i));
    unsentTexts().forEach((x) => flushText(x.n));
  }

  // ---------- events ----------
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) {
      if (e.target.id === 'sheet') e.target.hidden = true;
      return;
    }
    const act = b.dataset.act;
    const find = () => S.items.find((i) => i.id === b.dataset.id);
    if (act === 'start') begin();
    else if (act === 'next') go('q', S.idx + 1);
    else if (act === 'prev') { if (S.idx === 0) go('intro'); else go('q', S.idx - 1); }
    else if (act === 'finish') finish();
    else if (act === 'goto') go('q', Number(b.dataset.i));
    else if (act === 'jump') openSheet();
    else if (act === 'closeSheet') $('#sheet').hidden = true;
    else if (act === 'rec') { if (REC && REC.rec) stopRec(); else startRec(cur().n); }
    else if (act === 'pick') $('#pick').click();
    else if (act === 'pickAudio') $('#pickAudio').click();
    else if (act === 'remove') removeItem(find());
    else if (act === 'retry') { const it = find(); if (it) send(it); }
    else if (act === 'textRetry') flushText(cur().n);
    else if (act === 'textRetryAll') { unsentTexts().forEach((x) => flushText(x.n)); setTimeout(() => S.screen === 'end' && renderEnd(), 1500); }
  });
  document.addEventListener('change', (e) => {
    if (S.screen !== 'q') return;
    if (e.target.id === 'pick') addFiles(cur().n, e.target.files, 'image');
    if (e.target.id === 'pickAudio') addFiles(cur().n, e.target.files, 'audio');
    if (e.target.type === 'file') e.target.value = '';
  });
  document.addEventListener('input', (e) => {
    if (e.target.id === 'txt' && S.screen === 'q') onType(cur().n, e.target.value);
  });
  document.addEventListener('focusout', (e) => {
    if (e.target.id === 'txt' && S.screen === 'q') flushText(cur().n);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('#sheet') && !$('#sheet').hidden) $('#sheet').hidden = true;
  });
  document.addEventListener('paste', (e) => {
    if (S.screen !== 'q') return;
    const files = Array.from((e.clipboardData && e.clipboardData.files) || []).filter((f) => /^image\//.test(f.type));
    if (files.length) { e.preventDefault(); addFiles(cur().n, files, 'image'); }
  });
  document.addEventListener('dragover', (e) => {
    const a = e.target.closest && e.target.closest('#answer');
    if (a) { e.preventDefault(); a.classList.add('drag'); }
  });
  document.addEventListener('dragleave', (e) => {
    const a = e.target.closest && e.target.closest('#answer');
    if (a) a.classList.remove('drag');
  });
  document.addEventListener('drop', (e) => {
    const a = e.target.closest && e.target.closest('#answer');
    if (!a) return;
    e.preventDefault();
    a.classList.remove('drag');
    addFiles(cur().n, e.dataTransfer && e.dataTransfer.files);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAllTexts();
  });
  window.addEventListener('online', retryAll);
  window.addEventListener('beforeunload', (e) => {
    const waiting = REC || S.items.some((i) => !i.gone && !i.row && i.status !== 'lost') || unsentTexts().length;
    if (waiting) { flushAllTexts(); e.preventDefault(); e.returnValue = ''; }
  });

  // ---------- connection self-test (owner only: ?k=CODE&selftest=1) ----------
  async function selfTest() {
    app.innerHTML = `<main class="wrap"><section class="card"><h1 class="h-xl">Test dyal connexion</h1><ol class="checks" id="checks"></ol><p class="note" id="sum" style="margin-top:18px"></p></section></main>`;
    const out = $('#checks');
    let bad = 0;
    async function step(name, fn) {
      const li = document.createElement('li');
      li.textContent = name + ' …';
      out.appendChild(li);
      try { await fn(); li.textContent = name + ' ✓'; li.className = 'ok'; return true; } catch (e) { bad += 1; li.textContent = name + ' ✗ ' + e.message; li.className = 'bad'; return false; }
    }
    const id = uid();
    const path = TOKEN + '/q00/selftest-' + id + '.png';
    const png = await (await fetch('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=')).blob();
    await step('Row b code s7i7', () => insertRow({ q: 0, kind: 'test', body: 'selftest ' + id }));
    const up = await step('Fichier b code s7i7', () => putFile(path, png, 'image/png'));
    if (up) await step('Row dyal fichier', () => insertRow({ q: 0, kind: 'test', file_path: path, mime: 'image/png', body: 'selftest file ' + id }));
    await step('Row b code ghalat kayt7bes', async () => {
      let passed = false;
      try { await insertRow({ q: 0, kind: 'test', body: 'should fail' }, 'wrong-' + id); passed = true; } catch (e) { /* blocked: good */ }
      if (passed) throw new Error('daz! policy ma khdamach');
    });
    await step('Fichier b code ghalat kayt7bes', async () => {
      let passed = false;
      try { await putFile('wrong-' + id + '/q00/x.png', png, 'image/png'); passed = true; } catch (e) { /* blocked: good */ }
      if (passed) throw new Error('daz! policy ma khdamach');
    });
    await step('Ma y9derch y9ra ljawabat', async () => {
      const r = await fetch(API + '/rest/v1/answers?select=id&limit=1', { headers: hdrs() });
      if (r.ok) {
        const rows = await r.json();
        if (Array.isArray(rows) && rows.length) throw new Error('kay9ra rows!');
      }
    });
    await step('Ma y9derch y9ra l fichiers', async () => {
      const r = await fetch(API + '/storage/v1/object/authenticated/answers/' + path, { headers: hdrs() });
      if (r.ok) throw new Error('kay9ra l fichier!');
    });
    $('#sum').textContent = bad ? bad + ' test ma dazch.' : 'Kolchi mzyan. Lien wajed.';
  }

  // ---------- start ----------
  if (SELFTEST) { selfTest(); return; }
  render();
  if (S.screen === 'q') window.scrollTo(0, 0);
  setTimeout(() => {
    S.items.filter((i) => !i.gone && !i.row && i.status !== 'lost').forEach((i) => send(i));
    unsentTexts().forEach((x) => flushText(x.n));
  }, 600);
})();
