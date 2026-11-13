'use strict';
/* Measurement guides + reminders. Self-contained: adds its own button, dialog and styles.
   Content lives in /guides.json (cached by the service worker, so it works offline).
   Readings are stored only in this browser (localStorage). */
(function () {
  const WORD = {green: 'Nominal', amber: 'Watch', red: 'Act now'};
  const RANK = {green: 0, amber: 1, red: 2};
  const esc = s => String(s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

  // ---- pure logic (also used by tests) ----
  function evaluate(field, value) {
    for (const b of field.bands) {
      if (b.max === undefined || value < b.max) return {level: b.level, text: b.text};
    }
    return {level: 'green', text: ''};
  }
  function evaluateAll(m, values) {
    let worst = {level: 'green', text: ''}, parts = [];
    for (const f of m.fields) {
      const v = values[f.id];
      if (typeof v !== 'number' || isNaN(v) || v < f.min || v > f.max) return {error: `${f.label}: enter a number between ${f.min} and ${f.max}.`};
      const r = evaluate(f, v);
      if (m.fields.length > 1 && r.level !== 'green') parts.push(`${f.label}: ${r.text}`);
      if (RANK[r.level] > RANK[worst.level]) worst = r;
    }
    return {level: worst.level, text: parts.length ? parts.join(' ') : worst.text};
  }
  function dueInfo(lastTs, everyHours, now) {
    if (!lastTs) return {due: true, label: 'Not measured yet'};
    const hrs = (now - lastTs) / 3600000;
    if (hrs >= everyHours) return {due: true, label: `Due (last ${Math.floor(hrs)} h ago)`};
    return {due: false, label: `Next in about ${Math.max(1, Math.ceil(everyHours - hrs))} h`};
  }
  if (typeof module !== 'undefined') { module.exports = {evaluate, evaluateAll, dueInfo}; }
  if (typeof document === 'undefined') return;

  // ---- UI ----
  let G = null, env = 'spacecraft', log = {};
  const KEY_ENV = 'astrotwin.env', KEY_LOG = 'astrotwin.log';
  try { env = localStorage.getItem(KEY_ENV) || env; log = JSON.parse(localStorage.getItem(KEY_LOG) || '{}'); } catch (e) { /* storage unavailable */ }
  const save = () => { try { localStorage.setItem(KEY_ENV, env); localStorage.setItem(KEY_LOG, JSON.stringify(log)); } catch (e) { /* ignore */ } };
  const $ = s => document.querySelector(s);

  const css = document.createElement('style');
  css.textContent = `
  #gdlg{width:min(680px,95vw);max-height:90vh;overflow:auto}
  #gdlg .chip{display:inline-block;border-radius:999px;padding:1px 10px;font-size:.78rem;font-weight:700;margin-left:8px;border:1px solid var(--line)}
  #gdlg .chip.green{color:var(--ok)}#gdlg .chip.amber{color:var(--warn)}#gdlg .chip.red{color:var(--bad)}#gdlg .chip.due{background:var(--warn);color:#2a1d00;border-color:var(--warn)}
  #gdlg summary{cursor:pointer;padding:10px 12px;font-weight:700}
  #gdlg .body{padding:0 14px 12px}
  #gdlg ol,#gdlg ul{margin:4px 0 8px;padding-left:22px}
  #gdlg .fld{display:flex;gap:8px;align-items:center;margin:6px 0;flex-wrap:wrap}
  #gdlg input[type=number]{width:110px;padding:6px 8px;border-radius:8px;border:1px solid var(--line);background:var(--panel2);color:var(--text)}
  #gdlg .res{margin-top:8px;padding:10px 12px;border-radius:8px;border:1px solid var(--line);background:var(--panel2)}
  #gdlg .res.green{border-color:var(--ok)}#gdlg .res.amber{border-color:var(--warn)}#gdlg .res.red{border-color:var(--bad)}
  #gdlg .envbox{background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:8px 12px;margin:8px 0}
  `;
  document.head.appendChild(css);

  const dlg = document.createElement('dialog');
  dlg.id = 'gdlg';
  dlg.setAttribute('aria-label', 'Measurement guides');
  document.body.appendChild(dlg);

  const btn = document.createElement('button');
  btn.type = 'button'; btn.id = 'guidesBtn'; btn.textContent = 'Measure guides';
  const tools = document.querySelector('.tools');
  if (tools) tools.insertBefore(btn, tools.firstChild);

  const last = id => log[id] || null;
  const profile = () => G.environments[env] || G.environments.spacecraft;
  function dueCount() {
    if (!G) return 0;
    const p = profile(), now = Date.now();
    return G.measurements.filter(m => dueInfo(last(m.id) && last(m.id).ts, p.every_hours[m.id] || 24, now).due).length;
  }
  function refreshBtn() { const n = dueCount(); btn.textContent = n ? `Measure guides (${n} due)` : 'Measure guides'; }

  function chipFor(m) {
    const p = profile(), l = last(m.id), d = dueInfo(l && l.ts, p.every_hours[m.id] || 24, Date.now());
    const lvl = l ? `<span class="chip ${l.level}">${WORD[l.level]}</span>` : '';
    return `${lvl}<span class="chip ${d.due ? 'due' : ''}">${esc(d.label)}</span>`;
  }
  function cardHTML(m) {
    const fields = m.fields.map(f => `<div class="fld"><label for="g_${m.id}_${f.id}">${esc(f.label)}</label>
      <input type="number" id="g_${m.id}_${f.id}" data-m="${m.id}" data-f="${f.id}" step="${f.step || 1}" min="${f.min}" max="${f.max}" inputmode="decimal"> <span class="note">${esc(f.unit)}</span></div>`).join('');
    return `<details data-m="${m.id}"><summary>${esc(m.name)}${chipFor(m)}</summary><div class="body">
      <h3>How to take it</h3><ol>${m.how.map(s => `<li>${esc(s)}</li>`).join('')}</ol>
      <h3>Why it matters</h3><p>${esc(m.why)}</p>
      ${fields}
      <button type="button" data-save="${m.id}">Check my reading</button>
      <div class="res" id="res_${m.id}" aria-live="polite" hidden></div></div></details>`;
  }
  function paint() {
    const p = profile();
    dlg.innerHTML = `<h2>Measurement guides</h2>
      <p class="note">${esc(G.disclaimer)}</p>
      <label>Where are you? <select id="envSel">${Object.entries(G.environments).map(([k, v]) => `<option value="${k}" ${k === env ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select></label>
      <div class="envbox"><b>Communication:</b> ${esc(p.comms)}<br><b>Equipment:</b> ${esc(p.equipment)}</div>
      ${G.measurements.map(cardHTML).join('')}
      <div class="row" style="margin-top:12px"><button type="button" id="notifBtn" class="ghost">Enable reminder notifications</button><button type="button" id="gclose" class="ghost">Close</button></div>
      <p class="note">Reminders appear while the app is open. Readings stay on this device.</p>`;
    $('#envSel').onchange = e => { env = e.target.value; save(); open_(); };
    $('#gclose').onclick = () => dlg.close();
    $('#notifBtn').onclick = askNotify;
    dlg.querySelectorAll('[data-save]').forEach(b => b.onclick = () => saveReading(b.dataset.save));
  }
  function open_() {
    const openIds = [...dlg.querySelectorAll('details[open]')].map(d => d.dataset.m);
    paint();
    openIds.forEach(id => { const d = dlg.querySelector(`details[data-m="${id}"]`); if (d) d.open = true; });
    refreshBtn();
  }
  function saveReading(id) {
    const m = G.measurements.find(x => x.id === id), values = {};
    m.fields.forEach(f => { const el = document.getElementById(`g_${id}_${f.id}`); values[f.id] = el.value === '' ? NaN : parseFloat(el.value); });
    const out = evaluateAll(m, values), box = document.getElementById(`res_${id}`);
    box.hidden = false;
    if (out.error) { box.className = 'res'; box.textContent = out.error; return; }
    log[id] = {ts: Date.now(), values, level: out.level}; save();
    const more = out.level === 'green' ? '' : `<p><b>What to do:</b></p><ul>${m.if_abnormal.map(s => `<li>${esc(s)}</li>`).join('')}</ul>`;
    box.className = `res ${out.level}`;
    box.innerHTML = `<b>${WORD[out.level]}.</b> ${esc(out.text)}${more}`;
    const sum = dlg.querySelector(`details[data-m="${id}"] summary`);
    sum.innerHTML = `${esc(m.name)}${chipFor(m)}`;
    refreshBtn();
  }
  async function askNotify() {
    if (!('Notification' in window)) { alert('Notifications are not supported in this browser.'); return; }
    const r = await Notification.requestPermission();
    $('#notifBtn').textContent = r === 'granted' ? 'Reminders enabled' : 'Notifications blocked';
  }
  const notified = {};
  function remind() {
    if (!G || !('Notification' in window) || Notification.permission !== 'granted') return;
    const p = profile(), now = Date.now();
    G.measurements.forEach(m => {
      const l = last(m.id), d = dueInfo(l && l.ts, p.every_hours[m.id] || 24, now);
      const key = `${env}:${m.id}:${l ? l.ts : 0}`;
      if (d.due && !notified[key]) { notified[key] = 1; try { new Notification('AstroTwin: measurement due', {body: `${m.name} is due.`}); } catch (e) { /* ignore */ } }
    });
  }

  btn.onclick = async () => {
    if (!G) {
      try { const r = await fetch('/guides.json'); if (!r.ok) throw 0; G = await r.json(); }
      catch (e) { alert('Guides are not available yet. Load the app once while online.'); return; }
    }
    open_(); dlg.showModal();
  };
  fetch('/guides.json').then(r => r.json()).then(j => { G = j; refreshBtn(); remind(); setInterval(() => { refreshBtn(); remind(); }, 60000); }).catch(() => {});
})();
