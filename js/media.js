/* Simple Write: video and audio files inside the document.
   The file is kept like a picture (in a media folder) and shown with the browser's own player.
   Size, rotation and crop only change how it is shown: the file is not re-encoded, so nothing is lost
   and undo is exact. (Word and PDF do not play video anyway.) */
(function () {
  'use strict';
  const SW = window.SW, $ = SW.$;
  const M = SW.media = {};

  const kindOf = (f) => (/^audio\//.test(f.type) || /\.(mp3|m4a|wav|aac|oga|ogg|opus|flac|weba)$/i.test(f.name) ? 'audio' : 'video');
  M.insert = function (files) {
    const nodes = [];
    for (const f of files) {
      const kind = kindOf(f);
      nodes.push(SW.makeMedia(SW.addAssetBlob(f, f.name || kind), kind, '', 0, ''));
    }
    if (nodes.length) SW.ed.insertNodes(nodes);
    if (files.some((f) => f.size > 300e6)) SW.message('That is a large file. It is kept in memory while you edit, so a very big video may make the browser slow.', 7000);
  };
  M.fromUrl = async function () {                              // a web address: a file link, or YouTube / Vimeo
    const v = await SW.dlg.ask('Video or audio from a web address', 'Paste a link to a video or audio file, or a YouTube or Vimeo link. The file stays on its website, so it plays only while you are online. For a talk where it must not fail, insert the file itself.', [{ label: 'Cancel', value: 'cancel' }, { label: 'Insert', value: 'ok', primary: true }], '');
    if (v === null || !String(v).trim()) return;
    const r = SW.parseMediaUrl(v);
    if (!r) { SW.message('That does not look like a web address.', 4000); return; }
    SW.ed.insertNodes([SW.makeMedia(r.src, r.kind, '', 0, '')]);
  };
  M.pick = () => { const i = $('media-file'); i.value = ''; i.click(); };
  $('media-file').addEventListener('change', (e) => { const l = [...e.target.files]; e.target.value = ''; if (l.length) M.insert(l); });

  /* ---------- how it is shown ---------- */
  const pieces = (el) => { const mv = el.querySelector('.mv'), v = mv && mv.firstElementChild; return { mv, v }; };
  const crop4 = (v) => { const a = String(v.dataset.crop || '').split(',').map(Number); return a.length === 4 && a.every((x) => isFinite(x) && x >= 0) ? a : [0, 0, 0, 0]; };   // percent trimmed: left, top, right, bottom (of the rotated picture)
  const rotOf = (v) => (((parseInt(v.dataset.rotate || '0', 10) || 0) % 360) + 360) % 360;
  const fmt = (t) => { t = Math.max(0, t || 0); return Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0'); };

  M.layout = function (el) {
    const { mv, v } = pieces(el); if (!mv || !v) return;
    el.classList.remove('fl-left', 'fl-right', 'fl-center');
    if (el.dataset.float) el.classList.add('fl-' + el.dataset.float);
    const avail = (el.parentNode && el.parentNode.clientWidth) || el.clientWidth || 0;       // the line the player sits in
    const wset = v.dataset.width || '';
    let W = 0;
    if (/%$/.test(wset)) W = avail * parseFloat(wset) / 100; else if (wset) W = parseFloat(wset) || 0;
    mv.querySelectorAll('.mc-bar').forEach((b) => b.remove());
    if (v.nodeName === 'IFRAME') { mv.style.width = W ? Math.round(W) + 'px' : ''; return; }
    if (v.nodeName === 'AUDIO') { mv.classList.add('au'); mv.style.width = W ? Math.round(W) + 'px' : ''; mv.style.height = ''; return; }
    const rot = rotOf(v), [l, t, r, b] = crop4(v).map((x) => x / 100);
    const plain = !rot && !l && !t && !r && !b;
    if (plain) {
      Object.assign(v.style, { position: '', left: '', top: '', transform: '', width: W ? '100%' : '', height: '' });
      v.controls = true; mv.style.width = W ? Math.round(W) + 'px' : ''; mv.style.height = ''; mv.classList.remove('xf');
      return;
    }
    if (!v.videoWidth) return;                                   // laid out again when the size is known
    const vw = v.videoWidth, vh = v.videoHeight, odd = rot === 90 || rot === 270;
    const rw = odd ? vh : vw, rh = odd ? vw : vh;
    const cw = rw * (1 - l - r), ch = rh * (1 - t - b);
    if (!W) W = Math.min(cw, 640);
    if (avail) W = Math.min(W, avail);
    const s = W / cw;
    mv.classList.add('xf'); mv.style.width = Math.round(W) + 'px'; mv.style.height = Math.round(ch * s) + 'px';
    const cx = rw * s / 2 - l * rw * s, cy = rh * s / 2 - t * rh * s;           // the middle of the whole rotated picture
    Object.assign(v.style, { position: 'absolute', width: vw * s + 'px', height: vh * s + 'px', left: cx - vw * s / 2 + 'px', top: cy - vh * s / 2 + 'px', transform: 'rotate(' + rot + 'deg)', transformOrigin: 'center center' });
    v.controls = false;                                          // the browser's controls would turn and be cut off: a small bar of our own
    const bar = document.createElement('div'); bar.className = 'mc-bar';
    bar.innerHTML = '<button type="button" class="mc-play" aria-label="Play or pause">▶</button><input type="range" class="mc-seek" min="0" max="1000" value="0" aria-label="Position"><span class="mc-time">0:00</span>';
    mv.appendChild(bar);
    const play = bar.querySelector('.mc-play'), seek = bar.querySelector('.mc-seek'), time = bar.querySelector('.mc-time');
    const toggle = () => { if (v.paused) v.play().catch(() => {}); else v.pause(); };
    const upd = () => { play.textContent = v.paused ? '▶' : '❚❚'; if (v.duration) { seek.value = String(Math.round(v.currentTime / v.duration * 1000)); time.textContent = fmt(v.currentTime) + ' / ' + fmt(v.duration); } };
    play.onclick = toggle; v.onclick = toggle;
    seek.oninput = () => { if (v.duration) v.currentTime = seek.value / 1000 * v.duration; };
    v.ontimeupdate = v.onplay = v.onpause = upd; upd();
    bar.addEventListener('mousedown', (e) => e.stopPropagation());
  };
  M.setup = function (el) {
    const { v } = pieces(el); if (!v) return;
    el._rdy = true;
    v.addEventListener('loadedmetadata', () => M.layout(el));
    M.layout(el);
  };
  // after undo, redo or a change of view the elements are new copies: wire them up again
  const prevRefresh = SW.ed.refresh;
  SW.ed.refresh = function () { prevRefresh.apply(this, arguments); const r = SW.$('doc'); if (r) r.querySelectorAll('.media').forEach((el) => { if (!el._rdy) M.setup(el); }); };
  M.relayout = (root) => root.querySelectorAll('.media').forEach(M.layout);
  window.addEventListener('resize', () => { const r = SW.$('doc'); if (r) M.relayout(r); });

  /* ---------- the floating bar: size, rotate, crop ---------- */
  M.setWidth = function (el, w) {                              // w: a number of pixels, a "50%" string, or '' for natural size
    const { v } = pieces(el); if (!v) return;
    if (!w) delete v.dataset.width; else v.dataset.width = String(typeof w === 'number' ? Math.round(w) : w);
    M.layout(el);
  };
  const rotateCrop = (c, cw) => (cw ? [c[3], c[0], c[1], c[2]] : [c[1], c[2], c[3], c[0]]);   // [l,t,r,b] after turning the picture
  M.op = async function (op) {
    const ed = SW.ed, el = ed.selObj; if (!el || !el.classList.contains('media')) return;
    const { v } = pieces(el); if (!v) return;
    if (op === 'delete') { ed.op(() => { el.remove(); ed.deselect(); }); return; }
    if (v.nodeName === 'IFRAME' && (op === 'crop' || op === 'rotl' || op === 'rotr')) return;
    if (op === 'crop') return crop(el);
    ed.op(() => {
      if (op === 'rotl' || op === 'rotr') {
        const cw = op === 'rotr', c = rotateCrop(crop4(v), cw), rot = (rotOf(v) + (cw ? 90 : 270)) % 360;
        if (rot) v.dataset.rotate = String(rot); else delete v.dataset.rotate;
        if (c.some((x) => x)) v.dataset.crop = c.map((x) => Math.round(x * 10) / 10).join(','); else delete v.dataset.crop;
        // the displayed width is kept; the height follows
      } else if (op.startsWith('float:')) { const f = op.slice(6); if (f === 'none') delete el.dataset.float; else el.dataset.float = f; }
      else if (op === 'auto') M.setWidth(el, '');
      else M.setWidth(el, op + '%');
      M.layout(el);
    });
    ed.selectObj(el);
  };

  /* ---------- crop: a few frames of the video, with the box dragged over the picture ---------- */
  function frames(v, n, maxW) {                                // n frames, turned as shown, as canvases
    return new Promise((res) => {
      const t = document.createElement('video'); t.muted = true; t.preload = 'auto'; t.src = v.currentSrc || v.src;
      const rot = rotOf(v), out = [];
      let k = 0;
      const odd = rot === 90 || rot === 270;
      const snap = () => {
        const vw = t.videoWidth, vh = t.videoHeight, rw = odd ? vh : vw, rh = odd ? vw : vh, sc = Math.min(1, maxW / rw);
        const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(rw * sc)); c.height = Math.max(1, Math.round(rh * sc));
        const g = c.getContext('2d'); g.translate(c.width / 2, c.height / 2); g.rotate(rot * Math.PI / 180);
        g.drawImage(t, -vw * sc / 2, -vh * sc / 2, vw * sc, vh * sc);
        out.push(c);
      };
      const next = () => { if (k >= n) { res(out); return; } t.currentTime = Math.max(0, (t.duration || 1) * (0.1 + 0.8 * k / Math.max(1, n - 1))); k++; };
      t.addEventListener('seeked', () => { snap(); next(); });
      t.addEventListener('loadedmetadata', next);
      t.addEventListener('error', () => res(out));
      setTimeout(() => res(out), 8000);
    });
  }
  function blackBars(cs) {                                     // the box (fractions) that holds everything that is not black, over all the frames
    let x1 = 1, y1 = 1, x2 = 0, y2 = 0;
    for (const c of cs) {
      const W = c.width, H = c.height, d = c.getContext('2d').getImageData(0, 0, W, H).data;
      const rows = new Array(H).fill(0), cols = new Array(W).fill(0);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; if (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11 > 28) { rows[y]++; cols[x]++; } }
      const ry = rows.map((n) => n > W * 0.02), cx = cols.map((n) => n > H * 0.02);
      const fy = ry.indexOf(true), ly = ry.lastIndexOf(true), fx = cx.indexOf(true), lx = cx.lastIndexOf(true);
      if (fy < 0 || fx < 0) continue;
      x1 = Math.min(x1, fx / W); x2 = Math.max(x2, (lx + 1) / W); y1 = Math.min(y1, fy / H); y2 = Math.max(y2, (ly + 1) / H);
    }
    if (x2 <= x1 || y2 <= y1) return null;
    if (x1 < 0.01 && y1 < 0.01 && x2 > 0.99 && y2 > 0.99) return null;
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }
  async function crop(el) {
    const { v } = pieces(el); if (!v) return;
    SW.message('Looking at the video…', 4000);
    const cs = await frames(v, 3, 640);
    if (!cs.length) { SW.message('This browser could not read the video to crop it.', 5000); return; }
    const [l, t, r, b] = crop4(v).map((x) => x / 100);
    const c0 = cs[1] || cs[0];
    const box = await SW.pic.askBox(c0.toDataURL('image/jpeg', 0.85), c0.width, c0.height, { init: { x: l, y: t, w: Math.max(0.05, 1 - l - r), h: Math.max(0.05, 1 - t - b) }, auto: () => blackBars(cs) });
    if (!box) return;
    const val = [box.x, box.y, 1 - box.x - box.w, 1 - box.y - box.h].map((x) => Math.max(0, Math.round(x * 1000) / 10));
    SW.ed.op(() => {
      if (val.some((x) => x > 0.2)) v.dataset.crop = val.join(','); else delete v.dataset.crop;
      M.layout(el);
    });
    SW.ed.selectObj(el);
  }
})();
