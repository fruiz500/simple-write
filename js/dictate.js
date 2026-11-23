/* Simple Write: dictation.
   "browser": the browser's own speech recognition (Chrome, Edge, Safari), live as you speak.
   "ai": records, then sends the recording to the AI provider chosen in Set up AI when you stop.
   The text goes where the cursor is: the document, the Markdown, or the AI prompt line. */
(function () {
  'use strict';
  const SW = window.SW, $ = SW.$, ed = SW.ed;
  const D = SW.dictate = {};
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const btn = $('btn-mic'), msg = $('st-msg');
  let on = false, rec = null, media = null, chunks = [], stream = null, target = null;

  function status(t) { clearTimeout(SW.message.t); msg.textContent = t; msg.classList.toggle('listening', !!t && on); }
  function setOn(v) {
    on = v; btn.classList.toggle('on', v);
    const ck = $('ck-mic'); if (ck) ck.classList.toggle('on', v);
    if (!v) { msg.classList.remove('listening'); }
  }

  /* where the words go: remember the place when dictation starts, follow the cursor after that */
  function currentTarget() {
    const a = document.activeElement;
    if (a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && /^(text|search)$/.test(a.type))) && !a.readOnly) return a;
    return SW.doc.view === 'md' ? $('source') : ed.root();
  }
  function before(t) {               // the text just before the cursor, to decide on spaces and capitals
    if (t !== ed.root()) return t.value.slice(0, t.selectionStart);
    const s = getSelection(); if (!s.rangeCount || !t.contains(s.anchorNode)) return '';
    const r = s.getRangeAt(0).cloneRange(), blk = (r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentNode).closest('p, li, h1, h2, h3, h4, h5, h6, td, th, blockquote, figcaption') || t;
    r.setStart(blk, 0);
    return r.toString();
  }
  // spoken punctuation and commands (English)
  const SPOKEN = [[/\s*\b(?:period|full stop)\b/gi, '.'], [/\s*\bcomma\b/gi, ','], [/\s*\bquestion mark\b/gi, '?'], [/\s*\bexclamation (?:point|mark)\b/gi, '!'],
    [/\s*\bsemicolon\b/gi, ';'], [/\s*\bcolon\b/gi, ':'], [/\s*\bnew paragraph\b\s*/gi, '\n\n'], [/\s*\bnew line\b\s*/gi, '\n']];
  function tidy(text, prev, spoken) {
    let t = text.trim(); if (!t) return '';
    if (spoken && /^en/i.test(D.lang())) for (const [re, s] of SPOKEN) t = t.replace(re, s);
    const p = prev.replace(/\s+$/, ''), startOfSentence = !p || /[.!?:]$/.test(p) || /\n$/.test(prev);
    if (startOfSentence) t = t.replace(/^(\s*)(\p{Ll})/u, (m, a, c) => a + c.toUpperCase());
    else if (/^[A-Z][a-z]+\b/.test(t) && !/^I\b|^I'/.test(t) && spoken) t = t[0].toLowerCase() + t.slice(1);   // the browser capitalizes after every pause
    t = t.replace(/([.!?]\s+|\n\s*)(\p{Ll})/gu, (m, a, c) => a + c.toUpperCase());
    if (prev && !/[\s(\[{"“]$/.test(prev) && !/^[\s.,;:!?)\]}\n]/.test(t)) t = ' ' + t;
    return t;
  }
  function put(text, spoken) {
    const t = target && target.isConnected ? target : currentTarget();
    const s = tidy(text, before(t), spoken); if (!s) return;
    const doc = t === ed.root();
    if (doc && SW.doc.view !== 'doc') return;
    if (document.activeElement !== t) t.focus({ preventScroll: true });
    const write = () => s.split(/(\n+)/).forEach((part, i) => {
      if (!part) return;
      if (/^\n+$/.test(part)) { if (!doc) document.execCommand('insertText', false, part); else document.execCommand(part.length > 1 ? 'insertParagraph' : 'insertLineBreak'); }
      else document.execCommand('insertText', false, i ? part.replace(/^ +/, '') : part);
    });
    if (doc && !spoken) {
      // the AI writes Markdown: its $...$ math becomes equations
      if (/^ /.test(s)) ed.op(() => document.execCommand('insertText', false, ' '));
      ed.insertMarkdown(s.trim());
    } else if (doc) ed.op(write); else { write(); t.dispatchEvent(new Event('input', { bubbles: true })); }
    if (doc && ed.reveal) ed.reveal();
  }

  D.lang = () => SW.store.get('sw.dictlang') || navigator.language || 'en-US';

  /* ---------- the browser's speech recognition ---------- */
  function startBrowser() {
    if (!SR) { SW.message('This browser has no speech recognition (Firefox, for one). Use Chrome, Edge or Safari, or choose “This AI provider” for dictation in Set up AI.', 9000); return false; }
    rec = new SR();
    rec.lang = D.lang(); rec.continuous = true; rec.interimResults = true;
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) put(r[0].transcript, true); else interim += r[0].transcript;
      }
      status('● Listening' + (interim ? ': ' + interim : '…'));
    };
    rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      const why = { 'not-allowed': 'The microphone is blocked. Allow it for this page (the icon at the right of the address bar).', 'service-not-allowed': 'The microphone is blocked. Allow it for this page (the icon at the right of the address bar).',
        'audio-capture': 'No microphone was found.', network: 'Speech recognition needs an internet connection in this browser.' }[e.error] || 'Dictation stopped: ' + e.error;
      D.stop(); SW.message(why, 9000);
    };
    rec.onend = () => { if (on && rec) { try { rec.start(); } catch (e) { /* already started */ } } };   // the browser stops after a silence: keep going
    try { rec.start(); } catch (e) { SW.message('Dictation could not start: ' + e.message, 6000); return false; }
    return true;
  }

  /* ---------- record, then let the AI write it ---------- */
  async function startAI() {
    if (!SW.ai.canTranscribe()) { SW.message('Dictation through AI works with OpenAI, Gemini, or an OpenAI-compatible server. Choose one in Set up AI, or set dictation to “The browser”.', 9000); return false; }
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (e) { SW.message('The microphone is blocked or missing. Allow it for this page and try again.', 8000); return false; }
    const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
    media = new MediaRecorder(stream, type ? { mimeType: type } : undefined); chunks = [];
    media.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    media.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop()); stream = null;
      const blob = new Blob(chunks, { type: media.mimeType || type }); media = null;
      if (blob.size < 2000) { status(''); return; }
      status('Writing what you said…');
      try { const t = await SW.ai.transcribe(blob); status(''); if (t) put(t, false); else SW.message('Nothing was heard.'); }
      catch (e) { SW.message('Dictation: ' + e.message, 10000); }
    };
    media.start();
    const t0 = Date.now();
    const tick = () => { if (on && media) { const s = Math.round((Date.now() - t0) / 1000); status('● Recording ' + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') + ' – press the microphone again to stop'); setTimeout(tick, 500); } };
    tick();
    return true;
  }

  D.start = async function () {
    if (on) return;
    target = currentTarget();
    setOn(true);
    const ok = SW.ai.dictMode() === 'ai' ? await startAI() : startBrowser();
    if (!ok) setOn(false);
  };
  D.stop = function () {
    if (!on) return;
    setOn(false);
    if (rec) { const r = rec; rec = null; try { r.stop(); } catch (e) { /* ignore */ } status(''); }
    if (media && media.state !== 'inactive') media.stop();
    target = null;
  };
  D.toggle = () => (on ? D.stop() : D.start());
  D.active = () => on;

  /* ---------- speech from an audio file: write it out as text at the cursor ---------- */
  const MB = 1024 * 1024;
  const wavOf = (f, rate) => {                       // Float32 mono samples -> 16-bit WAV
    const n = f.length, b = new ArrayBuffer(44 + n * 2), v = new DataView(b);
    const s = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
    s(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); s(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); s(36, 'data'); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, f[i])) * 32767, true);
    return new Blob([b], { type: 'audio/wav' });
  };
  // cut points about every `len` samples, each moved to the quietest moment nearby so words are not split
  function cutPoints(x, len, rate) {
    const cuts = [0], win = Math.round(rate * 0.05), reach = Math.round(rate * 8);
    while (x.length - cuts[cuts.length - 1] > len * 1.15) {
      const target = cuts[cuts.length - 1] + len; let best = target, bestE = Infinity;
      for (let p = target - reach; p < target + Math.min(reach, 0) + 1; p += win) {
        let e = 0; for (let i = p; i < p + win; i++) e += x[i] * x[i];
        if (e < bestE) { bestE = e; best = p + (win >> 1); }
      }
      cuts.push(best);
    }
    cuts.push(x.length);
    return cuts;
  }
  let running = null;
  D.fromFile = function () {
    if (running) { running.abort(); return; }
    if (!SW.ai.canTranscribe()) { SW.message('Writing out a recording needs OpenAI, Gemini or an OpenAI-compatible server with Whisper. Choose one in Set up AI.', 9000); return; }
    ed.saveRange && ed.saveRange();
    const inp = $('audio-file'); inp.value = '';
    inp.onchange = () => { if (inp.files[0]) run(inp.files[0]); };
    inp.click();
  };
  async function run(file) {
    const ctl = new AbortController(); running = ctl;
    { const r = ed.saved; ed.saved = null; if (r && SW.doc.view === 'doc') { ed.root().focus({ preventScroll: true }); const s = getSelection(); s.removeAllRanges(); s.addRange(r); } }
    const esc = (e) => { if (e.key === 'Escape') ctl.abort(); };
    document.addEventListener('keydown', esc);
    const say = (t) => { clearTimeout(SW.message.t); msg.textContent = t; msg.classList.remove('listening'); };
    try {
      const direct = SW.ai.directLimit();
      let parts;
      if (file.size <= direct) parts = [file];
      else {
        say('Reading ' + file.name + '\u2026 (Esc cancels)');
        const rate = 16000, AC = window.AudioContext || window.webkitAudioContext;
        let buf;
        try { buf = await new AC({ sampleRate: rate }).decodeAudioData(await file.arrayBuffer()); }
        catch (e) { throw new Error('This browser cannot read that file. Try an .mp3, .m4a or .wav file, or a smaller one.'); }
        const x = buf.getChannelData(0), ch = buf.numberOfChannels;
        let mono = x;
        if (ch > 1) { mono = new Float32Array(x.length); for (let c = 0; c < ch; c++) { const d = buf.getChannelData(c); for (let i = 0; i < x.length; i++) mono[i] += d[i] / ch; } }
        const len = Math.floor(direct / 2 / rate * rate * 0.9);      // samples per piece, so that each WAV stays under the limit
        const cuts = cutPoints(mono, len, buf.sampleRate);
        parts = []; for (let i = 0; i < cuts.length - 1; i++) parts.push(wavOf(mono.subarray(cuts[i], cuts[i + 1]), buf.sampleRate));
      }
      let got = 0;
      for (let i = 0; i < parts.length; i++) {
        say('Writing out speech' + (parts.length > 1 ? ', part ' + (i + 1) + ' of ' + parts.length : '') + '\u2026 (Esc cancels)');
        const t = await SW.ai.transcribe(parts[i], ctl.signal);
        if (ctl.signal.aborted) break;
        if (t) { target = SW.doc.view === 'md' ? $('source') : ed.root(); put(t, false); got++; }
      }
      say(ctl.signal.aborted ? 'Stopped.' : got ? 'Done: speech from ' + file.name + ' is in the document.' : 'No speech was found in ' + file.name + '.');
    } catch (e) {
      if (e.name === 'AbortError') say('Stopped.'); else { say(''); SW.message('Audio file: ' + e.message, 10000); return; }
    } finally { running = null; document.removeEventListener('keydown', esc); target = null; }
    SW.message(msg.textContent, 5000);
  }

  btn.addEventListener('mousedown', (e) => e.preventDefault());   // keep the cursor where it is
  btn.addEventListener('click', D.toggle);
  // clicking somewhere else while dictating moves where the words go
  document.addEventListener('focusin', (e) => { if (on && (e.target === ed.root() || e.target === $('source') || e.target.id === 'ai-prompt')) target = e.target; });
})();
