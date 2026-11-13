'use strict';
/* Symptom chat: a short guided conversation (yes/no questions, then one blood-pressure reading)
   that turns the answers plus the cuff display into plain instructions.

   Question and advice text lives in /triage.json, reading ranges in /guides.json, both cached by the
   service worker. The full evaluation runs on the server; offline the chat falls back to a local
   red-flag screen. Nothing is stored beyond this session. */
(function () {
  const WORD = {green: 'Nominal', amber: 'Watch', red: 'Act now'};
  const GLYPH = {green: '●', amber: '▲', red: '■'};
  const RANK = {green: 0, amber: 1, red: 2};
  const esc = s => String(s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const worse = (a, b) => RANK[b] > RANK[a] ? b : a;

  // ---- pure logic (also used by the guides-style tests) ----
  function band(field, value) {
    for (const b of field.bands) {
      if (b.max === undefined || value < b.max) return {level: b.level, text: b.text};
    }
    return {level: 'green', text: ''};
  }
  function localScreen(flow, guides, answers, readings) {
    const meas = {};
    (guides.measurements || []).forEach(m => { meas[m.id] = m; });
    const fields = {};
    if (meas.blood_pressure) meas.blood_pressure.fields.forEach(f => { fields[f.id] = f; });
    if (meas.heart_rate) fields.pulse = meas.heart_rate.fields[0];
    let level = 'green';
    const findings = [], steps = [];
    flow.questions.forEach(q => {
      const a = answers[q.id];
      if (a === 'yes') {
        level = worse(level, q.level);
        findings.push({label: q.finding, level: q.level});
        steps.push(...q.instructions);
      } else if (a === 'unsure' && q.level === 'red') {
        level = worse(level, 'amber');
        findings.push({label: q.finding + ' (unsure)', level: 'amber'});
      }
    });
    const out = [];
    Object.entries(readings || {}).forEach(([key, value]) => {
      const f = fields[key];
      if (!f || typeof value !== 'number' || isNaN(value)) return;
      const r = band(f, value);
      out.push({key, label: f.label, value, unit: f.unit, level: r.level, text: r.text});
      if (r.level !== 'green') {
        level = worse(level, r.level);
        findings.push({label: `${f.label} ${value} ${f.unit}`, level: r.level});
        const src = key === 'pulse' ? meas.heart_rate : meas.blood_pressure;
        steps.push(...src.if_abnormal);
      }
    });
    return {level, headline: flow.headlines[level], findings, notes: [],
      readings: out, instructions: [...new Set(flow.level_instructions[level].concat(steps))],
      recheck: flow.recheck[level], escalate: level === 'red', baseline_note: null,
      offline: true, disclaimer: flow.disclaimer};
  }
  if (typeof module !== 'undefined') { module.exports = {band, localScreen, worse}; }
  if (typeof document === 'undefined') return;

  // ---- UI ----
  const css = document.createElement('style');
  css.textContent = `
  #cdlg{width:min(580px,95vw);max-height:92vh;background:var(--panel);color:var(--text);border:1px solid var(--line);border-radius:var(--r)}
  #cdlg[open]{display:flex;flex-direction:column;gap:8px}
  #cdlg .chead{display:flex;justify-content:space-between;align-items:center;gap:10px}
  #cdlg .chead h2{margin:0}
  #cdlg .clog{overflow:auto;flex:1;min-height:160px;max-height:52vh;display:flex;flex-direction:column;gap:8px;padding:4px 2px}
  #cdlg .msg{max-width:90%;padding:8px 12px;border-radius:12px;font-size:.95rem}
  #cdlg .bot{background:var(--panel2);border:1px solid var(--line);border-top-left-radius:3px}
  #cdlg .me{align-self:flex-end;background:var(--ok);color:#06231f;border-top-right-radius:3px;font-weight:600}
  #cdlg .prog{color:var(--muted);font-size:.8rem;text-transform:uppercase;letter-spacing:.04em}
  #cdlg .cctl{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding-top:4px}
  #cdlg .cread{display:grid;gap:8px;width:100%}
  #cdlg .cread label{display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap}
  #cdlg .cread input{width:120px;padding:6px 8px;border-radius:8px;border:1px solid var(--line);background:var(--panel2);color:var(--text)}
  #cdlg .cread .row{margin:0;justify-content:flex-start}
  #cdlg .err{color:var(--bad);margin:0;font-size:.9rem}
  #cdlg .rescard{border-left:4px solid var(--line);padding-left:10px}
  #cdlg .rescard.green{border-color:var(--ok)}#cdlg .rescard.amber{border-color:var(--warn)}#cdlg .rescard.red{border-color:var(--bad)}
  #cdlg .lvl{font-weight:700;margin:0 0 6px}
  #cdlg h3{font-size:.9rem;margin:8px 0 2px}
  #cdlg ol,#cdlg ul{margin:2px 0 6px;padding-left:20px}
  #cdlg .note{color:var(--muted);font-size:.85rem}
  `;
  document.head.appendChild(css);

  const dlg = document.createElement('dialog');
  dlg.id = 'cdlg';
  dlg.setAttribute('aria-label', 'Symptom chat');
  dlg.innerHTML = `<div class="chead"><h2>Symptom chat</h2><button type="button" id="cclose" class="ghost">Close</button></div>
    <div id="clog" class="clog" aria-live="polite"></div>
    <div id="cctl" class="cctl"></div>
    <p class="note" id="cnote"></p>`;
  document.body.appendChild(dlg);

  const btn = document.createElement('button');
  btn.type = 'button'; btn.id = 'chatBtn'; btn.textContent = 'Symptom chat';
  const tools = document.querySelector('.tools');
  if (tools) tools.insertBefore(btn, tools.firstChild);

  const $ = s => dlg.querySelector(s);
  let flow = null, guides = null, qi = 0, answers = {};

  function bot(html) {
    const d = document.createElement('div');
    d.className = 'msg bot'; d.innerHTML = html;
    $('#clog').appendChild(d); $('#clog').scrollTop = $('#clog').scrollHeight;
  }
  function me(text) {
    const d = document.createElement('div');
    d.className = 'msg me'; d.textContent = text;
    $('#clog').appendChild(d); $('#clog').scrollTop = $('#clog').scrollHeight;
  }
  function choices(options, onPick) {
    const ctl = $('#cctl');
    ctl.innerHTML = '';
    options.forEach(o => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = o.label;
      if (o.ghost) b.className = 'ghost';
      b.onclick = () => { ctl.innerHTML = ''; onPick(o.value); };
      ctl.appendChild(b);
    });
    const first = ctl.querySelector('button');
    if (first) first.focus();
  }
  function start() {
    qi = 0; answers = {};
    $('#clog').innerHTML = ''; $('#cctl').innerHTML = '';
    $('#cnote').textContent = flow.disclaimer;
    bot(esc(flow.intro));
    next();
  }
  function next() {
    if (qi >= flow.questions.length) return readingsStep();
    const q = flow.questions[qi];
    bot(`<span class="prog">Question ${qi + 1} of ${flow.questions.length}</span><br>${esc(q.text)}`);
    choices([{label: 'Yes', value: 'yes'}, {label: 'Not sure', value: 'unsure', ghost: true},
      {label: 'No', value: 'no', ghost: true}], v => {
      answers[q.id] = v;
      me(v === 'yes' ? 'Yes' : v === 'no' ? 'No' : 'Not sure');
      if (v === 'yes' && q.followup) askFollowup(q); else { qi++; next(); }
    });
  }
  function askFollowup(q) {
    bot(esc(q.followup.text));
    choices([{label: 'Yes', value: 'yes'}, {label: 'No', value: 'no', ghost: true}], v => {
      answers[q.id + '_detail'] = v;
      me(v === 'yes' ? 'Yes' : 'No');
      qi++; next();
    });
  }
  function readingFields() {
    const bp = guides.measurements.find(m => m.id === 'blood_pressure');
    const hr = guides.measurements.find(m => m.id === 'heart_rate');
    if (!bp || !hr) return null;
    return {sys: bp.fields.find(f => f.id === 'sys'), dia: bp.fields.find(f => f.id === 'dia'), pulse: hr.fields[0]};
  }
  function readingsStep() {
    const spec = readingFields();
    if (!spec) { submit({}); return; }
    bot(esc(flow.reading_prompt));
    const input = (name, f, required) => `<label>${esc(f.label)} <input type="number" name="${name}" step="${f.step || 1}"
      min="${f.min}" max="${f.max}" inputmode="decimal" placeholder="${esc(f.unit)}"${required ? ' required' : ''}></label>`;
    $('#cctl').innerHTML = `<form id="cread" class="cread" novalidate>
      ${input('sys', spec.sys, true)}${input('dia', spec.dia, true)}${input('pulse', spec.pulse, false)}
      <div class="row"><button type="submit">Check readings</button><button type="button" id="cnocuff" class="ghost">No cuff</button></div>
      <p class="err" id="cerr" role="alert"></p></form>`;
    $('#cread').onsubmit = e => { e.preventDefault(); readSubmission(); };
    $('#cnocuff').onclick = () => { me(flow.no_cuff); submit({}); };
    $('#cread').querySelector('input').focus();
  }
  function readSubmission() {
    const spec = readingFields(), readings = {}, parts = [];
    for (const key of Object.keys(spec)) {
      const f = spec[key], raw = $('#cread').elements[key].value.trim();
      if (raw === '') {
        if (key === 'pulse') continue;
        $('#cerr').textContent = `${f.label} is needed, or press No cuff.`;
        return;
      }
      const value = Number(raw);
      if (!isFinite(value) || value < f.min || value > f.max) {
        $('#cerr').textContent = `${f.label}: enter a number between ${f.min} and ${f.max}.`;
        return;
      }
      readings[key] = value;
      parts.push(`${f.label} ${value} ${f.unit}`);
    }
    me(parts.join(', '));
    submit(readings);
  }
  async function submit(readings) {
    $('#cctl').innerHTML = '<span class="note">Checking your answers…</span>';
    let r;
    try {
      const res = await fetch('/api/symptom-chat', {method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({crew_id: document.body.dataset.crew || null, answers, readings})});
      if (!res.ok) throw new Error('chat ' + res.status);
      r = await res.json();
    } catch (e) {
      r = localScreen(flow, guides, answers, readings);
    }
    showResult(r);
  }
  function showResult(r) {
    const reads = r.readings.length ? `<h3>Your readings</h3><ul>${r.readings.map(x =>
      `<li><span class="${x.level}">${GLYPH[x.level]}</span> ${esc(x.label)} <b>${esc(x.value)} ${esc(x.unit)}</b>${x.text ? ', ' + esc(x.text) : ''}</li>`).join('')}</ul>` : '';
    const finds = r.findings.length ? `<h3>What stands out</h3><ul>${r.findings.map(f => `<li>${esc(f.label)}</li>`).join('')}</ul>` : '';
    const notes = r.notes.length ? `<ul class="note">${r.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : '';
    bot(`<div class="rescard ${r.level}">
      <p class="lvl ${r.level}">${GLYPH[r.level]} ${esc(r.headline)}</p>
      ${r.baseline_note ? `<p class="note">${esc(r.baseline_note)}</p>` : ''}
      ${reads}${finds}${notes}
      <h3>What to do</h3><ol>${r.instructions.map(s => `<li>${esc(s)}</li>`).join('')}</ol>
      <p><b>Next check:</b> ${esc(r.recheck)}</p>
      ${r.escalate ? '<p class="red"><b>Priority message to the flight surgeon queued.</b></p>' : ''}
      ${r.offline ? '<p class="note">Offline screening only. Reconnect and run the chat again for the full check.</p>' : ''}
      <p class="note">${esc(r.disclaimer)}</p></div>`);
    choices([{label: 'Start over', value: 'again'}, {label: 'Close', value: 'close', ghost: true}],
      v => v === 'again' ? start() : dlg.close());
  }

  btn.onclick = async () => {
    if (!flow || !guides) {
      btn.disabled = true;
      try {
        const [a, b] = await Promise.all([fetch('/triage.json'), fetch('/guides.json')]);
        if (!a.ok) throw new Error('flow ' + a.status);
        flow = await a.json();
        guides = b.ok ? await b.json() : {measurements: []};
      } catch (e) {
        btn.disabled = false;
        alert('The symptom chat needs one load while online. Reload when the link is back.');
        return;
      }
      btn.disabled = false;
    }
    dlg.showModal();
    start();
  };
  $('#cclose').onclick = () => dlg.close();
})();
