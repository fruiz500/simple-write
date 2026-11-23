/* Simple Write: a CSV (or TSV) file becomes a table at the cursor */
(function () {
  'use strict';
  const SW = window.SW, $ = SW.$, ed = SW.ed;
  const MAX_ROWS = 1000;

  // the delimiter that gives the most consistent column count in the first lines
  function delimiter(text, name) {
    if (/\.tsv$/i.test(name)) return '\t';
    const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 12);
    let best = ',', bestScore = -1;
    for (const d of [',', ';', '\t', '|']) {
      const counts = lines.map((l) => { let n = 0, q = false; for (const c of l) { if (c === '"') q = !q; else if (c === d && !q) n++; } return n; });
      if (!counts[0]) continue;
      const score = counts.filter((n) => n === counts[0]).length * 100 + counts[0];
      if (score > bestScore) { bestScore = score; best = d; }
    }
    return best;
  }
  SW.parseCsv = function (text, d) {
    const rows = []; let row = [], cell = '', q = false;
    text = text.replace(/^﻿/, '');
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
      else if (c === '"' && !cell) q = true;
      else if (c === d) { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; rows.push(row); row = []; }
      else cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((x) => x.trim()));
  };
  const isNum = (s) => /^[+-]?(\d+([.,]\d+)?|\.\d+)([eE][+-]?\d+)?%?$/.test(s.trim().replace(/[\s,](?=\d{3}\b)/g, '').replace(/^[$€£]/, ''));
  const cellMd = (s) => s.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();

  SW.csvToMarkdown = function (rows) {
    const n = Math.max(...rows.map((r) => r.length));
    rows = rows.map((r) => { r = r.slice(); while (r.length < n) r.push(''); return r; });
    const right = [];
    for (let c = 0; c < n; c++) { const vals = rows.slice(1).map((r) => r[c]).filter((v) => v.trim()); right.push(vals.length > 0 && vals.every(isNum)); }
    const line = (r) => '| ' + r.map(cellMd).join(' | ') + ' |';
    return [line(rows[0]), '| ' + right.map((x) => (x ? '---:' : '---')).join(' | ') + ' |'].concat(rows.slice(1).map(line)).join('\n');
  };

  async function readText(file) {
    const buf = await file.arrayBuffer(), u = new Uint8Array(buf);
    if (u[0] === 0xEF && u[1] === 0xBB && u[2] === 0xBF) return new TextDecoder('utf-8').decode(buf);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
    catch (e) { return new TextDecoder('windows-1252').decode(buf); }     // files saved by older Excel
  }
  SW.importCsv = function () {
    if (SW.doc.view !== 'doc') { SW.message('Switch to the Document view to insert a table.'); return; }
    ed.saveRange && ed.saveRange();
    const inp = $('csv-file'); inp.value = '';
    inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      try {
        const text = await readText(f);
        let rows = SW.parseCsv(text, delimiter(text, f.name));
        if (!rows.length) { SW.message('That file has no data.'); return; }
        let note = '';
        if (rows.length > MAX_ROWS + 1) { note = ' Only the first ' + MAX_ROWS + ' rows were inserted.'; rows = rows.slice(0, MAX_ROWS + 1); }
        const r = ed.saved; ed.saved = null;
        if (r) { ed.root().focus({ preventScroll: true }); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
        ed.insertMarkdown(SW.csvToMarkdown(rows) + '\n');
        SW.message('Table inserted: ' + (rows.length - 1) + ' rows, ' + Math.max(...rows.map((x) => x.length)) + ' columns.' + note, 7000);
      } catch (e) { SW.message('Could not read that file: ' + e.message, 8000); }
    };
    inp.click();
  };
})();
