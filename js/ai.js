/* Simple Write: the AI prompt line. The document (or the selected text) goes to a language model
   with the instruction typed at the bottom; the answer opens in a new tab, replaces the text, or goes below it. */
(function () {
  'use strict';
  const SW = window.SW, $ = SW.$, ed = SW.ed;
  const AI = SW.ai = {};
  const isChild = /^#ai\b/.test(location.hash);   // this tab was opened to show an answer

  /* ---------- providers ---------- */
  const PROVIDERS = {
    openai: { name: 'OpenAI', short: 'OpenAI', kind: 'oai', url: 'https://api.openai.com/v1', key: 'required', keyUrl: 'https://platform.openai.com/api-keys' },
    anthropic: { name: 'Anthropic (Claude)', short: 'Claude', kind: 'anthropic', url: 'https://api.anthropic.com/v1', key: 'required', keyUrl: 'https://console.anthropic.com/settings/keys' },
    gemini: { name: 'Google Gemini', short: 'Gemini', kind: 'gemini', url: 'https://generativelanguage.googleapis.com/v1beta', key: 'required', keyUrl: 'https://aistudio.google.com/apikey' },
    openrouter: { name: 'OpenRouter (many models)', short: 'OpenRouter', kind: 'oai', url: 'https://openrouter.ai/api/v1', key: 'required', keyUrl: 'https://openrouter.ai/keys' },
    ollama: { name: 'Ollama (on this computer)', short: 'Ollama', kind: 'oai', url: 'http://localhost:11434/v1', key: 'none', editUrl: true },
    custom: { name: 'Other (OpenAI-compatible server)', short: 'AI', kind: 'oai', url: 'http://localhost:1234/v1', key: 'optional', editUrl: true }
  };
  function cfg() {
    let c = {}; try { c = JSON.parse(SW.store.get('sw.ai') || '{}'); } catch (e) { /* ignore */ }
    c.provider = PROVIDERS[c.provider] ? c.provider : '';
    c.models = c.models || {}; c.urls = c.urls || {};
    return c;
  }
  const saveCfg = (c) => SW.store.set('sw.ai', JSON.stringify(c));
  const keyOf = (p) => SW.store.get('sw.ai.key.' + p) || '';
  const urlOf = (c, p) => (PROVIDERS[p].editUrl && c.urls[p]) || PROVIDERS[p].url;
  const trimUrl = (u) => String(u || '').trim().replace(/\/+$/, '');

  /* ---------- talking to the providers ---------- */
  async function failure(res) {
    let t = ''; try { t = await res.text(); } catch (e) { /* ignore */ }
    let m = t; try { const j = JSON.parse(t); m = (j.error && (j.error.message || j.error)) || j.message || t; } catch (e) { /* not JSON */ }
    const err = new Error((res.status ? res.status + ': ' : '') + String(m || res.statusText).slice(0, 300));
    err.status = res.status; err.body = t;
    return err;
  }
  function netError(e, p, url) {
    if (e.name === 'AbortError') return e;
    const local = /localhost|127\.0\.0\.1/.test(url);
    return new Error(local
      ? 'Could not reach ' + url + '. Is ' + (p === 'ollama' ? 'Ollama' : 'the server') + ' running?' + (p === 'ollama' ? ' If it is, it may be refusing this page: start it with OLLAMA_ORIGINS=* (see Help).' : '')
      : 'Could not reach ' + PROVIDERS[p].short + ' (' + (e.message || e) + '). Check the connection.');
  }
  function headers(p, key) {
    const k = PROVIDERS[p].kind, h = { 'content-type': 'application/json' };
    if (k === 'anthropic') Object.assign(h, { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' });
    else if (k === 'oai' && key) h.authorization = 'Bearer ' + key;
    if (p === 'openrouter') h['x-title'] = 'Simple Write';
    return h;
  }
  AI.listModels = async function (p, key, base, signal) {
    const k = PROVIDERS[p].kind;
    let url = base + '/models';
    if (k === 'gemini') url += '?pageSize=1000&key=' + encodeURIComponent(key);
    else if (k === 'anthropic') url += '?limit=1000';
    let res;
    try { res = await fetch(url, { headers: k === 'gemini' ? {} : headers(p, key), signal }); } catch (e) { throw netError(e, p, base); }
    if (!res.ok) throw await failure(res);
    const j = await res.json();
    let ids;
    if (k === 'gemini') ids = (j.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent')).map((m) => m.name.replace(/^models\//, ''));
    else ids = (j.data || j.models || []).map((m) => m.id || m.name).filter(Boolean);
    if (p === 'openai') ids = ids.filter((id) => /^(gpt|o\d|chatgpt)/.test(id) && !/(audio|realtime|tts|transcribe|image|embedding|search|moderation|instruct)/.test(id));
    return [...new Set(ids)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  };
  // read a server-sent event stream: calls onData with each "data:" payload
  async function readSSE(res, onData) {
    const rd = res.body.getReader(), dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await rd.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1);
        if (line.startsWith('data:')) { const d = line.slice(5).trim(); if (d && d !== '[DONE]') onData(d); }
      }
    }
    if (buf.startsWith('data:')) { const d = buf.slice(5).trim(); if (d && d !== '[DONE]') onData(d); }
  }
  const parse = (d) => { try { return JSON.parse(d); } catch (e) { return null; } };
  // send one request; onText gets the answer so far
  /* ---------- dictation through the AI provider: speech in, text out ---------- */
  const DICT_PROMPT = 'Transcribe this dictation exactly, with normal punctuation and capitals. If the speaker says math, write it in LaTeX between $ signs (for example $q = h A \\Delta T$). Spoken commands like "new paragraph" become a blank line. Reply with the text only.';
  AI.dictMode = () => (cfg().dict === 'ai' ? 'ai' : 'browser');
  AI.directLimit = () => (cfg().provider === 'gemini' ? 9 : 24) * 1024 * 1024;   // largest recording sent as it is
  AI.canTranscribe = () => { const c = cfg(); return ['openai', 'gemini', 'custom'].includes(c.provider); };
  AI.transcribe = async function (blob, signal) {
    const c = cfg(), p = c.provider;
    if (!['openai', 'gemini', 'custom'].includes(p)) throw new Error('Dictation through AI works with OpenAI, Gemini, or an OpenAI-compatible server with Whisper. Choose one in Set up AI, or switch dictation to the browser.');
    const key = keyOf(p), base = trimUrl(urlOf(c, p));
    if (PROVIDERS[p].key === 'required' && !key) throw new Error('Enter your ' + PROVIDERS[p].short + ' key in Set up AI first.');
    let res;
    try {
      if (p === 'gemini') {
        const b64 = await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.readAsDataURL(blob); });
        const model = c.models.gemini || 'gemini-2.5-flash';
        res = await fetch(base + '/models/' + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(key), { method: 'POST', signal, headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: DICT_PROMPT }, { inline_data: { mime_type: (blob.type || 'audio/webm').split(';')[0], data: b64 } }] }] }) });
        if (!res.ok) throw await failure(res);
        const j = await res.json();
        return ((((j.candidates || [])[0] || {}).content || {}).parts || []).map((x) => x.text || '').join('').trim();
      }
      const f = new FormData();
      f.append('file', blob, 'speech.' + (/mp4/.test(blob.type) ? 'm4a' : /ogg/.test(blob.type) ? 'ogg' : 'webm'));
      f.append('model', p === 'openai' ? 'gpt-4o-mini-transcribe' : 'whisper-1');
      f.append('prompt', 'Engineering lecture notes. Math in LaTeX between $ signs.');
      const h = {}; if (key) h.authorization = 'Bearer ' + key;
      res = await fetch(base + '/audio/transcriptions', { method: 'POST', headers: h, body: f, signal });
      if (!res.ok) throw await failure(res);
      return String((await res.json()).text || '').trim();
    } catch (e) { if (e.status || e.name === 'AbortError') throw e; throw netError(e, p, base); }
  };

  AI.complete = async function ({ p, key, base, model, system, user, signal, onText }) {
    const k = PROVIDERS[p].kind;
    let text = '';
    const add = (t) => { if (t) { text += t; onText(text); } };
    const post = async (url, body, h) => {
      let res;
      try { res = await fetch(url, { method: 'POST', headers: h, body: JSON.stringify(body), signal }); } catch (e) { throw netError(e, p, base); }
      if (!res.ok) throw await failure(res);
      return res;
    };
    if (k === 'anthropic') {
      // the longest answer allowed differs between models: try a long one, then shorter
      for (const max of [32000, 8192, 4096]) {
        try {
          const res = await post(base + '/messages', { model, max_tokens: max, system, stream: true, messages: [{ role: 'user', content: user }] }, headers(p, key));
          await readSSE(res, (d) => {
            const j = parse(d); if (!j) return;
            if (j.type === 'content_block_delta' && j.delta && j.delta.type === 'text_delta') add(j.delta.text);
            if (j.type === 'error') throw new Error((j.error && j.error.message) || 'The answer stopped with an error.');
          });
          return text;
        } catch (e) { if (!(e.status === 400 && /max_tokens/.test(e.message)) || max === 4096) throw e; }
      }
    }
    if (k === 'gemini') {
      const res = await post(base + '/models/' + encodeURIComponent(model) + ':streamGenerateContent?alt=sse&key=' + encodeURIComponent(key),
        { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }] }, { 'content-type': 'application/json' });
      await readSSE(res, (d) => {
        const j = parse(d); if (!j) return;
        if (j.error) throw new Error(j.error.message || 'The answer stopped with an error.');
        const parts = (((j.candidates || [])[0] || {}).content || {}).parts || [];
        parts.forEach((q) => { if (!q.thought) add(q.text); });
      });
      return text;
    }
    const res = await post(base + '/chat/completions', { model, stream: true, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }, headers(p, key));
    if (/json/.test(res.headers.get('content-type') || '')) {          // a server that ignores "stream"
      const j = await res.json(); add(((((j.choices || [])[0] || {}).message) || {}).content || ''); return text;
    }
    await readSSE(res, (d) => {
      const j = parse(d); if (!j) return;
      if (j.error) throw new Error(j.error.message || String(j.error));
      add((((j.choices || [])[0] || {}).delta || {}).content);
    });
    return text;
  };

  const SYSTEM = 'You are helping to write a document in Simple Write, a word processor that stores documents as Markdown: ' +
    'GitHub-flavored Markdown with LaTeX math between $...$ (inline) and $$...$$ (display), Pandoc-style labels such as {#eq:id}, {#fig:id} and {#sec:id}, ' +
    'cross-references such as @fig:id, citations such as [@key], and footnotes such as [^1]. ' +
    'The text may contain notes to you written as [ai: ...]: they are the author\'s remarks about the nearby text, so use them as context for the instruction, and leave them out of your reply. ' +
    'Follow the instruction about the text you are given. Reply with Markdown only: the resulting text, or the answer if the instruction asks a question. ' +
    'No introduction, no closing remarks, and do not wrap the whole reply in a code block. Keep math in LaTeX with $ delimiters, and keep labels, references, citations and picture links unless told otherwise.';
  // models sometimes wrap the answer in a code block or add their reasoning
  AI.clean = function (t) {
    t = String(t).replace(/<think>[\s\S]*?(<\/think>|$)/gi, '').trim();
    const m = t.match(/^```(?:markdown|md)?[ \t]*\n([\s\S]*?)\n```$/i);
    return m ? m[1] : t;
  };

  /* ---------- [ai: ...] notes written inside the text ---------- */
  const TAG_SRC = '\\[ai:((?:[^\\[\\]]|\\[[^\\[\\]]*\\])*)\\]';
  // the notes in a piece of Markdown (code and math are skipped)
  function findTags(md) {
    const blank = (m) => m.replace(/[^\n]/g, ' ');
    const masked = md
      .replace(/^([ \t]*)(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^[ \t]*\2[`~]*[ \t]*$|(?![\s\S]))/gm, blank)
      .replace(/\$\$[\s\S]*?\$\$/g, blank).replace(/(`+)(?!`)[^\n]+?\1(?!`)/g, blank).replace(/\$[^$\n]+\$/g, blank);
    const re = new RegExp(TAG_SRC, 'gi'), out = [];
    let m;
    while ((m = re.exec(masked))) {
      const start = m.index, end = start + m[0].length;
      const ls = masked.lastIndexOf('\n', start - 1) + 1, le = masked.indexOf('\n', end);
      out.push({ start, end, text: md.slice(start, end).replace(/^\[ai:/i, '').slice(0, -1).trim(),
        alone: !masked.slice(ls, start).trim() && !masked.slice(end, le < 0 ? masked.length : le).trim() });
    }
    return out;
  }
  AI.findTags = findTags;
  const docBody = () => SW.doc.view === 'md' ? SW.splitFrontMatter($('source').value).body : SW.splitFrontMatter(ed.getMarkdown()).body;
  const SYSTEM_NOTES = 'You are helping to write a document in Simple Write, a word processor that stores documents as Markdown: ' +
    'GitHub-flavored Markdown with LaTeX math between $...$ (inline) and $$...$$ (display), Pandoc-style labels such as {#eq:id}, cross-references such as @fig:id, citations such as [@key], and footnotes such as [^1]. ' +
    'The author left instructions to you inside the text, written like [ai 1: ...]. Use the text around each one as context. ' +
    'For each instruction, write the text that should take its place. Follow the format you are asked for exactly, with no introduction or closing remarks.';
  function notesMessage(body, tags) {
    let s = '', at = 0;
    tags.forEach((t, i) => { s += body.slice(at, t.start) + '[ai ' + (i + 1) + ': ' + t.text + ']'; at = t.end; });
    s += body.slice(at);
    return 'Here is the document, in Markdown, between the lines <<<BEGIN>>> and <<<END>>>. It contains ' + tags.length + (tags.length === 1 ? ' instruction' : ' instructions') + ' to you, written like [ai 1: ...].\n\n<<<BEGIN>>>\n' + s.trim() + '\n<<<END>>>\n\n' +
      'Carry out each instruction. Reply with the text that replaces each one, in this exact format and order, and nothing else:\n\n<<<1>>>\n(text for instruction 1)\n<<<2>>>\n(text for instruction 2)\n\n' +
      'The text takes the place of the whole [ai ...] note. If a note sits inside a sentence, reply with inline text only (no blank lines, no headings). If it stands on its own line, you may reply with paragraphs, lists, tables or equations. Use Markdown with LaTeX math.';
  }
  // the answer to the notes: apply each replacement where its note was
  function applyNotes(body, tags, ans) {
    const parts = ans.split(/^<<<(\d+)>>>[ \t]*$/m), rep = {};
    for (let i = 1; i < parts.length; i += 2) rep[+parts[i]] = AI.clean(parts[i + 1] || '');
    let out = body, done = 0;
    for (let i = tags.length - 1; i >= 0; i--) {
      let r = rep[i + 1];
      if (r === undefined || !r.trim()) continue;
      if (!tags[i].alone) r = r.replace(/\s*\n\s*/g, ' ');
      out = out.slice(0, tags[i].start) + r + out.slice(tags[i].end);
      done++;
    }
    return { md: out, done };
  }
  async function runNotes(p, key, base, model, tags, body, target) {
    let win = null;
    if (target === 'tab') {
      win = window.open(location.pathname + '#ai', '_blank');
      if (!win) { SW.message('The browser blocked the new tab. Allow pop-ups for this page, or choose another destination.', 8000); return; }
    }
    const ctl = new AbortController();
    setBusy(ctl);
    status.textContent = 'Waiting for ' + PROVIDERS[p].short + '…';
    const child = win ? childLink(win, 'notes in the text', model, { md: body }) : null;
    try {
      const ans = await AI.complete({ p, key, base, model, system: SYSTEM_NOTES, user: notesMessage(body, tags), signal: ctl.signal, onText: (t) => { status.textContent = 'Writing… ' + fmt(t.length) + ' characters'; } });
      const r = applyNotes(body, tags, ans);
      if (!r.done) throw new Error('The answer did not follow the expected format, so nothing was changed.');
      if (child) child.update(r.md, true); else place('replace', { kind: 'doc' }, r.md);
      SW.message((r.done < tags.length ? r.done + ' of ' + tags.length + ' instructions carried out; the others are still in the text. ' : 'Done (' + PROVIDERS[p].short + ' · ' + model + '). ') + 'Check the result: AI can be wrong.' + (child ? '' : ' Ctrl+Z undoes it.'), 7000);
    } catch (e) {
      const stopped = e.name === 'AbortError';
      if (child) child.fail(stopped ? 'Stopped.' : e.message);
      SW.message(stopped ? 'Stopped.' : 'AI: ' + (e.message || e), stopped ? 3000 : 10000);
    } finally { setBusy(null); }
  }
  // mark the notes on the page and count them
  let nTags = 0;
  const canHL = !!(window.Highlight && window.CSS && CSS.highlights);
  function scanTags() {
    let n = 0;
    if (SW.doc.view === 'doc') {
      const ranges = [], re = new RegExp(TAG_SRC, 'gi');
      const w = document.createTreeWalker(ed.root(), NodeFilter.SHOW_TEXT, { acceptNode: (x) => x.parentNode.closest('.obj, pre, code') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
      while (w.nextNode()) {
        const t = w.currentNode, v = t.nodeValue; if (!/\[ai:/i.test(v)) continue;
        re.lastIndex = 0; let m;
        while ((m = re.exec(v))) { n++; if (canHL) { const r = new Range(); r.setStart(t, m.index); r.setEnd(t, m.index + m[0].length); ranges.push(r); } }
      }
      if (canHL) CSS.highlights.set('aitag', new Highlight(...ranges));
    } else { if (canHL) CSS.highlights.delete('aitag'); n = findTags($('source').value).length; }
    nTags = n; showScope();
  }
  const scanSoon = SW.debounce(scanTags, 300);
  AI.insertTag = function () {
    if (SW.doc.view === 'md') {
      const ta = $('source'); ta.focus();
      const s = ta.selectionStart, sel = ta.value.slice(s, ta.selectionEnd);
      if (!document.execCommand('insertText', false, '[ai: ' + sel + ']')) ta.setRangeText('[ai: ' + sel + ']', s, ta.selectionEnd, 'end');
      if (!sel) ta.setSelectionRange(s + 5, s + 5);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      const root = ed.root(), r = ed.saved; ed.saved = null;
      root.focus({ preventScroll: true });
      if (r && root.contains(r.startContainer)) { const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
      const text = getSelection().toString();
      document.execCommand('insertText', false, '[ai: ' + text + ']');
      if (!text) getSelection().modify('move', 'backward', 'character');
    }
    if (bar.hidden) SW.message('Turn on View ▸ AI prompt line to send it to the AI.', 5000);
  };
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.altKey && e.code === 'KeyI' && !document.querySelector('dialog[open]')) { e.preventDefault(); AI.insertTag(); }
  });

  /* ---------- the prompt line ---------- */
  const bar = $('aibar'), input = $('ai-prompt'), sendBtn = $('ai-send'), status = $('ai-status');
  let lastRange = null, busy = null;
  document.addEventListener('selectionchange', () => {
    if (SW.doc.view !== 'doc') return;
    const s = getSelection(); if (!s.rangeCount) return;
    const r = s.getRangeAt(0);
    if (ed.root().contains(r.commonAncestorContainer)) { lastRange = r.cloneRange(); showScope(); }
  });
  $('source').addEventListener('select', () => showScope());
  $('source').addEventListener('keyup', () => showScope());
  $('source').addEventListener('mouseup', () => showScope());
  function scope() {
    if (SW.doc.view === 'md') {
      const ta = $('source');
      if (ta.selectionStart !== ta.selectionEnd) return { kind: 'sel', md: ta.value.slice(ta.selectionStart, ta.selectionEnd), s: ta.selectionStart, e: ta.selectionEnd };
      return { kind: 'doc', md: SW.splitFrontMatter(ta.value).body };
    }
    if (lastRange && !lastRange.collapsed && ed.root().contains(lastRange.commonAncestorContainer)) {
      const md = ed.rangeMarkdown(lastRange);
      if (md.trim()) return { kind: 'sel', md, range: lastRange.cloneRange() };
    }
    return { kind: 'doc', md: SW.splitFrontMatter(ed.getMarkdown()).body };
  }
  function showScope() {
    const sel = SW.doc.view === 'md' ? $('source').selectionStart !== $('source').selectionEnd : !!(lastRange && !lastRange.collapsed && ed.root().contains(lastRange.commonAncestorContainer));
    const notes = nTags > 0 && !input.value.trim();
    $('ai-scope').textContent = notes ? nTags + (nTags === 1 ? ' note' : ' notes') : sel ? 'Selection' : 'Document';
    $('ai-scope').title = notes ? 'Press Enter or Send with this line empty to carry out the [ai: ...] notes in the text' : sel ? 'The selected text goes to the AI' : 'The whole document goes to the AI (select text to send only that)';
    $('ai-target').options[1].textContent = sel ? '→ Replace selection' : '→ Replace document';
    $('ai-target').options[2].textContent = sel ? '→ Insert below selection' : '→ Add at the end';
  }
  function showModel() {
    const c = cfg(), b = $('ai-model');
    if (!c.provider) { b.textContent = 'Set up AI…'; b.title = 'Choose an AI provider and model'; return; }
    const m = c.models[c.provider] || '';
    b.textContent = PROVIDERS[c.provider].short + (m ? ' · ' + m.replace(/^.*\//, '') : ' · choose a model');
    b.title = PROVIDERS[c.provider].name + (m ? ': ' + m : '') + ' (click to change)';
  }
  AI.toggleBar = function (force) {
    const on = force === undefined ? bar.hidden : force;
    bar.hidden = !on;
    $('ck-ai').classList.toggle('on', on);
    SW.store.set('sw.aibar', on ? '1' : '0');
    if (on) { showModel(); showScope(); input.focus(); }
  };
  // the last prompts come back with the arrow keys
  const hist = () => { try { return JSON.parse(SW.store.get('sw.ai.history') || '[]'); } catch (e) { return []; } };
  let hi = -1;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); AI.send(); }
    else if (e.key === 'Escape') { if (busy) { e.stopPropagation(); busy.abort(); } else if (SW.doc.view === 'doc') ed.root().focus(); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const h = hist(); if (!h.length) return;
      e.preventDefault();
      hi = Math.max(-1, Math.min(h.length - 1, hi + (e.key === 'ArrowUp' ? 1 : -1)));
      input.value = hi < 0 ? '' : h[hi];
    }
  });
  sendBtn.addEventListener('click', () => { if (busy) busy.abort(); else AI.send(); });
  $('ai-model').addEventListener('click', () => AI.setup());
  input.addEventListener('input', showScope);
  $('source').addEventListener('input', scanSoon);
  { const r0 = ed.refresh; ed.refresh = function () { r0.apply(this, arguments); scanSoon(); }; }

  function setBusy(ctl) {
    busy = ctl;
    input.disabled = !!ctl;
    sendBtn.textContent = ctl ? 'Stop' : 'Send';
    sendBtn.classList.toggle('stop', !!ctl);
    if (!ctl) status.textContent = '';
  }
  const fmt = (n) => n.toLocaleString('en-US');

  AI.send = async function () {
    if (busy) return;
    const prompt = input.value.trim();
    const body = prompt ? '' : docBody(), tags = prompt ? [] : findTags(body);
    if (!prompt && !tags.length) { input.focus(); SW.message('Type an instruction, or write [ai: your request] in the text and press Send with this line empty.', 6000); return; }
    let c = cfg();
    if (!c.provider || !c.models[c.provider] || (PROVIDERS[c.provider].key === 'required' && !keyOf(c.provider))) {
      if (!(await AI.setup())) return;
      c = cfg();
      if (!c.provider || !c.models[c.provider]) return;
    }
    const p = c.provider, model = c.models[p], key = keyOf(p), base = trimUrl(urlOf(c, p));
    const target = $('ai-target').value;
    if (!prompt) return runNotes(p, key, base, model, tags, body, target);
    const sc = scope();
    const h = hist().filter((x) => x !== prompt); h.unshift(prompt); SW.store.set('sw.ai.history', JSON.stringify(h.slice(0, 30))); hi = -1;
    // a new tab must be opened now, while the key press still counts as the user's action
    let win = null;
    if (target === 'tab') {
      win = window.open(location.pathname + '#ai', '_blank');
      if (!win) { SW.message('The browser blocked the new tab. Allow pop-ups for this page, or send the answer to this document instead.', 8000); return; }
    }
    const user = sc.md.trim()
      ? 'Here is the ' + (sc.kind === 'sel' ? 'selected part of the document' : 'document') + ', in Markdown, between the lines <<<BEGIN>>> and <<<END>>>.\n\n<<<BEGIN>>>\n' + sc.md.trim() + '\n<<<END>>>\n\nInstruction: ' + prompt
      : 'The document is empty. Instruction: ' + prompt;
    const ctl = new AbortController();
    setBusy(ctl);
    status.textContent = 'Waiting for ' + PROVIDERS[p].short + '…';
    const child = win ? childLink(win, prompt, model, sc) : null;
    let answer = '';
    try {
      answer = await AI.complete({ p, key, base, model, system: SYSTEM, user, signal: ctl.signal, onText: (t) => {
        status.textContent = 'Writing… ' + fmt(t.length) + ' characters';
        if (child) child.update(AI.clean(t), false);
      } });
      answer = AI.clean(answer);
      if (!answer.trim()) throw new Error('The answer was empty.');
      if (child) child.update(answer, true);
      else place(target, sc, answer);
      input.value = '';
      SW.message('Done (' + PROVIDERS[p].short + ' · ' + model + '). Check the answer: AI can be wrong.' + (child ? '' : ' Ctrl+Z undoes it.'), 6000);
    } catch (e) {
      const stopped = e.name === 'AbortError';
      if (child) child.fail(stopped ? 'Stopped.' : e.message);
      if (stopped) SW.message('Stopped.', 3000);
      else SW.message('AI: ' + (e.message || e), 10000);
    } finally { setBusy(null); }
  };

  // put the answer into this document
  function place(target, sc, md) {
    if (SW.doc.view === 'md') {
      const ta = $('source');
      ta.focus();
      if (target === 'replace' && sc.kind === 'sel') ta.setSelectionRange(sc.s, sc.e);
      else if (target === 'replace') { const fmLen = ta.value.length - SW.splitFrontMatter(ta.value).body.length; ta.setSelectionRange(fmLen, ta.value.length); }
      else { const at = sc.kind === 'sel' ? sc.e : ta.value.length; ta.setSelectionRange(at, at); md = (at && !/\n\n$/.test(ta.value.slice(0, at)) ? (/\n$/.test(ta.value.slice(0, at)) ? '\n' : '\n\n') : '') + md + '\n'; }
      if (!document.execCommand('insertText', false, md)) ta.setRangeText(md, ta.selectionStart, ta.selectionEnd, 'end');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    const root = ed.root();
    if (target === 'replace' && sc.kind === 'doc') {
      ed.setMarkdown(SW.joinFrontMatter(SW.doc.fm, md), true);
      ed.setModified(true); SW.files.autosaveSoon();
      return;
    }
    let r;
    if (target === 'replace') r = sc.range;
    else if (sc.kind === 'sel') {
      r = document.createRange();
      const blk = ed.topBlock(sc.range.endContainer);
      if (blk && blk.parentNode === root) r.setStartAfter(blk); else { r.setStart(sc.range.endContainer, sc.range.endOffset); }
      r.collapse(true);
    } else { r = document.createRange(); r.selectNodeContents(root); r.collapse(false); }
    if (!r || !root.contains(r.commonAncestorContainer)) { r = document.createRange(); r.selectNodeContents(root); r.collapse(false); }
    root.focus({ preventScroll: true });
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    ed.saved = r;
    ed.insertMarkdown(md);
    lastRange = null; showScope();
  }

  /* ---------- the answer in a new tab ---------- */
  // the tab that asked: keeps the newest state and sends it when the new tab is listening
  function childLink(win, prompt, model, sc) {
    const st = { md: '', done: false, error: '', ready: false, sent: 0 };
    const pics = {};
    const re = /!\[[^\]]*\]\(\s*<?([^)\s>]+)/g; let m;
    while ((m = re.exec(sc.md))) { const b = SW.assetBlob(m[1]); if (b) pics[m[1]] = b; }
    const head = SW.joinFrontMatter(SW.doc.fm, '');
    const name = (SW.doc.name ? SW.doc.name + ' – ' : '') + 'AI ' + prompt.replace(/\s+/g, ' ').slice(0, 40);
    let timer = 0;
    const push = () => {
      timer = 0;
      if (!st.ready || win.closed) return;
      win.postMessage({ sw: 'ai', md: head + st.md, done: st.done, error: st.error, name, model, prompt }, '*');
    };
    const onMsg = (e) => {
      if (e.source !== win || !e.data || e.data.sw !== 'ai-ready') return;
      st.ready = true;
      win.postMessage({ sw: 'ai', pics, bib: SW.bib.text || '', name, md: head + st.md, done: st.done, error: st.error, model, prompt, first: true }, '*');
    };
    window.addEventListener('message', onMsg);
    return {
      update(md, done) { st.md = md; st.done = done; if (done) { clearTimeout(timer); push(); } else if (!timer) timer = setTimeout(push, 350); },
      fail(msg) { st.error = msg; st.done = true; clearTimeout(timer); push(); }
    };
  }
  // the new tab: shows the answer as it comes
  AI.childStart = function () {
    if (!isChild || !window.opener) return;
    SW.ed.setName('AI answer');
    SW.message('Waiting for the answer…', 60000);
    window.addEventListener('message', async (e) => {
      const d = e.data;
      if (e.source !== window.opener || !d || d.sw !== 'ai') return;
      if (d.first) {
        for (const [k, b] of Object.entries(d.pics || {})) SW.putAsset(k, b);
        if (d.bib) SW.bib.set(d.bib);
        SW.ed.setName(d.name);
      }
      if (d.md) { SW.ed.setMarkdown(d.md); SW.message(d.done ? '' : 'Writing… (' + fmt(d.md.length) + ' characters)', 60000); }
      if (d.done) {
        SW.ed.setModified(true); SW.files.saveDraft();
        SW.message(d.error ? 'AI: ' + d.error : 'Answer from ' + d.model + ' to “' + d.prompt.slice(0, 80) + '”. Check it: AI can be wrong.', d.error ? 10000 : 8000);
      }
    });
    window.opener.postMessage({ sw: 'ai-ready' }, '*');
  };

  /* ---------- setup dialog ---------- */
  const dlg = $('dlg-ai');
  let listCtl = null;
  function fillProviders() {
    const s = $('ai-provider');
    s.innerHTML = '<option value="">Choose…</option>' + Object.entries(PROVIDERS).map(([k, v]) => '<option value="' + k + '">' + v.name + '</option>').join('');
  }
  function showProvider(c) {
    const p = $('ai-provider').value, P = PROVIDERS[p];
    $('ai-key-row').hidden = !P || P.key === 'none';
    $('ai-key-lbl').hidden = $('ai-key-row').hidden;
    $('ai-url-row').hidden = !P || !P.editUrl; $('ai-url-lbl').hidden = $('ai-url-row').hidden;
    $('ai-model-row').hidden = !P; $('ai-model-lbl').hidden = !P;
    if (!P) { $('ai-hint').textContent = 'Pick where the AI runs. Ollama runs models on your own computer, free and private.'; return; }
    $('ai-key').value = keyOf(p);
    $('ai-key').placeholder = P.key === 'optional' ? 'only if the server needs one' : 'paste your API key';
    $('ai-keylink').hidden = !P.keyUrl; if (P.keyUrl) $('ai-keylink').href = P.keyUrl;
    $('ai-url').value = urlOf(c, p);
    $('ai-model-in').value = c.models[p] || '';
    $('ai-hint').textContent = P.key === 'none' ? 'No key is needed.' : 'The key is kept in this browser only and is sent only to ' + P.short + '. Using a model may cost money on your account.';
    loadModels();
  }
  async function loadModels() {
    const p = $('ai-provider').value; if (!PROVIDERS[p]) return;
    const key = $('ai-key').value.trim(), base = trimUrl($('ai-url-row').hidden ? PROVIDERS[p].url : $('ai-url').value);
    const list = $('ai-models');
    list.innerHTML = '';
    if (PROVIDERS[p].key === 'required' && !key && p !== 'openrouter') { $('ai-mstatus').textContent = 'Enter the key to see the models.'; return; }
    if (listCtl) listCtl.abort();
    const ctl = listCtl = new AbortController();
    $('ai-mstatus').textContent = 'Loading the models…';
    try {
      const ids = await AI.listModels(p, key, base, ctl.signal);
      if (ctl !== listCtl) return;
      list.innerHTML = ids.map((id) => '<option value="' + SW.esc(id) + '">').join('');
      $('ai-mstatus').textContent = ids.length ? ids.length + ' models: type to search, or pick one from the list.' : 'No models found.' + (p === 'ollama' ? ' Get one with “ollama pull llama3.2”.' : '');
      if (!$('ai-model-in').value && ids.length === 1) $('ai-model-in').value = ids[0];
    } catch (e) {
      if (e.name !== 'AbortError' && ctl === listCtl) $('ai-mstatus').textContent = 'Could not list the models: ' + e.message;
    }
  }
  const loadSoon = SW.debounce(loadModels, 600);
  $('ai-provider').addEventListener('change', () => showProvider(cfg()));
  $('ai-key').addEventListener('input', loadSoon);
  $('ai-url').addEventListener('input', loadSoon);
  $('ai-reload').addEventListener('click', loadModels);
  $('ai-showkey').addEventListener('click', () => { const k = $('ai-key'); k.type = k.type === 'password' ? 'text' : 'password'; });
  $('ai-forget').addEventListener('click', () => { const p = $('ai-provider').value; if (!p) return; try { localStorage.removeItem('sw.ai.key.' + p); } catch (e) { /* ignore */ } $('ai-key').value = ''; loadModels(); });
  AI.setup = function () {
    fillProviders();
    const c = cfg();
    $('ai-provider').value = c.provider;
    $('ai-dict').value = c.dict === 'ai' ? 'ai' : 'browser';
    showProvider(c);
    return new Promise((res) => {
      dlg.returnValue = '';
      dlg.addEventListener('close', () => {
        if (listCtl) listCtl.abort();
        if (dlg.returnValue !== 'ok') { res(false); return; }
        const c2 = cfg(), p = $('ai-provider').value;
        c2.dict = $('ai-dict').value;
        c2.provider = PROVIDERS[p] ? p : '';
        if (c2.provider) {
          c2.models[p] = $('ai-model-in').value.trim();
          if (PROVIDERS[p].editUrl) c2.urls[p] = trimUrl($('ai-url').value) || PROVIDERS[p].url;
          const k = $('ai-key').value.trim();
          if (PROVIDERS[p].key !== 'none') { if (k) SW.store.set('sw.ai.key.' + p, k); else try { localStorage.removeItem('sw.ai.key.' + p); } catch (e) { /* ignore */ } }
        }
        saveCfg(c2); showModel();
        res(!!(c2.provider && c2.models[c2.provider]));
      }, { once: true });
      dlg.showModal();
    });
  };

  /* ---------- start ---------- */
  AI.start = function () {
    AI.toggleBar(SW.store.get('sw.aibar') !== '0');
    ed.root().addEventListener('input', scanSoon);
    scanTags();
    if (SW.doc.view === 'doc') ed.root().focus();
    AI.childStart();
  };
  AI.viewChanged = () => { lastRange = null; scanSoon(); };
})();
