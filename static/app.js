'use strict';
const $ = s => document.querySelector(s);
const HEAT = {green: '#2f6f69', amber: '#f0b34a', red: '#ef6a5b', calibrating: '#3a4d5c', nodata: '#22343f'};
const COL = {green: '#4aa89c', amber: '#f0b34a', red: '#ef6a5b'};
const WORD = {green: 'Nominal', amber: 'Watch', red: 'Act now'}, GLYPH = {green: '●', amber: '▲', red: '■'};
const TREND = {worsening: 'Worsening', improving: 'Improving', steady: 'Steady'};
const SYMPTOMS = {fever: 'Fever or chills', cough: 'Cough', nausea: 'Nausea', headache: 'Headache', dizzy: 'Dizziness',
  muscle_pain: 'Muscle or joint pain', low_mood: 'Low mood or anxiety', chest_pain: 'Chest pain', fainting: 'Fainting',
  vision_change: 'Sudden vision change', severe_headache: 'Severe headache', breathless: 'Shortness of breath'};
const RED_FLAGS = ['chest_pain', 'fainting', 'vision_change', 'severe_headache', 'breathless'];
const FONT = 'system-ui,"Segoe UI",Roboto,sans-serif';
let B, crew, day = 30, metric = 'hrv', timer = null, rtState = null, rtMs = null, deferred = null;
let prefs = {shareBehavioral: true};
try { prefs = Object.assign(prefs, JSON.parse(localStorage.getItem('astrotwin.prefs') || '{}')); } catch (e) { /* storage unavailable */ }
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const toast = (msg) => { const t = $('#toast'); t.textContent = msg; t.style.display = 'block'; clearTimeout(toast.h); toast.h = setTimeout(() => t.style.display = 'none', 3500); };

async function loadBundle() {
  const r = await fetch('/api/bundle');
  if (!r.ok) throw new Error('bundle ' + r.status);
  B = await r.json();
}
async function init() {
  try { await loadBundle(); } catch (e) { $('main').innerHTML = '<section><h2>Cannot load mission data</h2><p>Start the server with ./run.sh, then reload. After one successful load the app works offline.</p></section>'; return; }
  crew = B.meta.crew[0].id;
  $('#metric').innerHTML = Object.entries(B.meta.metrics).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('');
  $('#metric').value = metric;
  $('#metric').onchange = e => { metric = e.target.value; render(); };
  $('#slider').oninput = e => { day = +e.target.value; render(); };
  $('#play').onclick = togglePlay;
  $('#strip').onclick = stripClick;
  $('#share').checked = prefs.shareBehavioral;
  $('#share').onchange = e => { prefs.shareBehavioral = e.target.checked; try { localStorage.setItem('astrotwin.prefs', JSON.stringify(prefs)); } catch (x) { /* ignore */ } render(); };
  $('#checks').innerHTML = Object.entries(SYMPTOMS).map(([k, v]) => `<label><input type="checkbox" value="${k}"> ${v}</label>`).join('');
  $('#checkin').onclick = () => { $('#result').innerHTML = ''; $('#dlg').showModal(); };
  $('#close').onclick = () => $('#dlg').close();
  $('#rtbox').onclick = reactionTest;
  $('#rtbox').onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); reactionTest(); } };
  $('#send').onclick = sendCheckin;
  $('#importBtn').onclick = () => { $('#impMsg').textContent = ''; $('#imp').showModal(); };
  $('#impClose').onclick = () => $('#imp').close();
  $('#impGo').onclick = doImport;
  $('#report').onclick = exportReport;
  $('#install').onclick = async () => { if (deferred) { deferred.prompt(); deferred = null; $('#install').hidden = true; } };
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; $('#install').hidden = false; });
  addEventListener('online', netState); addEventListener('offline', netState);
  addEventListener('resize', () => { drawStrip(); renderTrend(); });
  netState(); render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}
function netState() { $('#net').innerHTML = navigator.onLine ? 'Online' : '<b class="amber">Offline, using saved data</b>'; }
const cur = () => { const cd = B.crew[crew]; const di = Math.min(day, cd.n - 1); return {cd, di, st: cd.statuses[di], beyond: day >= cd.n}; };

function render() {
  const {st, beyond} = cur();
  document.body.dataset.crew = crew;
  $('#slider').value = day; $('#dayLbl').textContent = day;
  const bo = B.meta.blackout, down = day >= bo[0] && day <= bo[1];
  $('#link').innerHTML = down ? '<b class="red">Link down</b>' : `Link delay <b>${B.meta.link_delay[day]} min</b>`;
  drawStrip(); renderOverview(); renderStatus(st, beyond); renderTrend(); renderQueue(down);
}
function stripRows() { return B.meta.crew; }
function drawStrip() {
  const c = $('#strip'), dpr = devicePixelRatio || 1, w = c.clientWidth || 800, L = 84, n = B.meta.days, rows = stripRows();
  const rh = 34, top = 8, h = top + rows.length * (rh + 4) + 22, cw = (w - L) / n;
  c.style.height = h + 'px'; c.width = w * dpr; c.height = h * dpr;
  const x = c.getContext('2d'); x.scale(dpr, dpr); x.textBaseline = 'middle';
  rows.forEach((p, i) => {
    const y = top + i * (rh + 4), cd = B.crew[p.id];
    x.fillStyle = p.id === crew ? '#e8f0f5' : '#93aab9'; x.font = (p.id === crew ? 'bold ' : '') + '14px ' + FONT; x.fillText(p.name, 4, y + rh / 2);
    for (let d = 0; d < n; d++) {
      const s = d >= cd.n ? 'nodata' : cd.statuses[d].calibrating ? 'calibrating' : cd.statuses[d].overall;
      x.globalAlpha = d <= day ? 1 : .28; x.fillStyle = HEAT[s]; x.fillRect(L + d * cw, y, Math.max(cw - .6, 1), rh);
    }
    x.globalAlpha = 1;
    if (p.id === crew) { x.strokeStyle = '#e8f0f5'; x.lineWidth = 1.5; x.strokeRect(L - 1, y - 1, w - L + 1, rh + 2); }
  });
  x.fillStyle = '#e8f0f5'; x.fillRect(L + day * cw - 1, top - 4, 2.5, rows.length * (rh + 4) + 4);
  x.fillStyle = '#93aab9'; x.font = '12px ' + FONT;
  [0, 30, 60, 90, 119].forEach(d => x.fillText(d, L + d * cw, top + rows.length * (rh + 4) + 8));
  c.dataset.L = L; c.dataset.cw = cw;
}
function stripClick(e) {
  const r = e.target.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top, L = +e.target.dataset.L, cw = +e.target.dataset.cw;
  const i = Math.floor((py - 8) / 38); if (i >= 0 && i < stripRows().length) crew = stripRows()[i].id;
  if (px >= L) day = Math.min(B.meta.days - 1, Math.max(0, Math.floor((px - L) / cw)));
  render();
}
function renderOverview() {
  const s = B.summaries[day], live = s.mean_readiness !== null;
  const stats = live ? `<div class="stats"><div><b>${s.mean_readiness}</b>Crew readiness</div><div><b class="${s.team_strain.label === 'High' ? 'red' : s.team_strain.label === 'Moderate' ? 'amber' : 'green'}">${s.team_strain.label}</b>Team strain</div><div><b>${s.counts.red}</b>Act now</div><div><b>${s.counts.amber}</b>Watch</div></div>` : `<p class="note">Learning baselines (first ${B.meta.baseline_days} days).</p>`;
  $('#overview').innerHTML = stats + '<ul class="attn">' + s.attention.map(r => {
    const lvl = r.calibrating ? 'green' : r.overall;
    const sub = r.calibrating ? 'Calibrating baseline' : `${esc(r.worst.label)} ${WORD[r.worst.level].toLowerCase()}` + (r.eta ? `. Projected ${r.eta.level} in about ${r.eta.days} days (${esc(r.eta.label)})` : '') + (r.trend ? `. ${TREND[r.trend]}` : '');
    return `<li><button class="link" data-id="${r.id}" aria-current="${r.id === crew}"><span class="pill ${lvl}">${GLYPH[lvl]} ${r.calibrating ? 'Learning' : WORD[lvl]}</span><span><b>${esc(r.name)}</b>, ${esc(r.role)}</span><span>${r.readiness ?? '-'}</span><small>${sub}</small></button></li>`;
  }).join('') + '</ul>';
  document.querySelectorAll('.attn button').forEach(b => b.onclick = () => { crew = b.dataset.id; render(); });
}
function renderStatus(st, beyond) {
  const p = B.meta.crew.find(c => c.id === crew), ring = $('#ring');
  $('#who').textContent = `${p.name}, ${p.role}` + (beyond ? ' (no data for this day, showing last day)' : '');
  $('#readyNum').textContent = st.calibrating ? '-' : st.readiness;
  $('#readyTxt').textContent = st.calibrating ? `Learning ${p.name}'s baseline (day ${st.day + 1} of ${B.meta.baseline_days})` : `Readiness, overall ${WORD[st.overall].toLowerCase()}`;
  ring.setAttribute('stroke', COL[st.overall]); ring.setAttribute('stroke-dasharray', `${st.calibrating ? 0 : 239 * st.readiness / 100} 239`);
  $('#domains').innerHTML = Object.entries(st.domains).map(([k, d]) => {
    const f = d.forecast, open = d.level !== 'green' ? ' open' : '';
    const badge = f && !st.calibrating ? `<span class="badge ${f.trend === 'worsening' ? 'w' : ''}">${TREND[f.trend]}</span>` : '';
    const why = st.calibrating ? 'Calibrating.' : d.level === 'green' ? 'Within personal baseline.' : d.reasons.slice(0, 2).map(esc).join('. ');
    const eta = f && f.eta ? `<p><b>Early warning:</b> at the current trend this reaches ${f.eta.level} in about ${f.eta.days} days.</p>` : '';
    const body = d.level === 'green' && !eta ? '' : `<div class="body">${d.level === 'green' ? '' : `<h3>Why it flagged</h3><ul>${d.reasons.map(x => `<li>${esc(x)}</li>`).join('')}</ul>${d.goals.length ? `<h3>Recovery goal</h3><ul>${d.goals.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}<h3>What to do</h3><ul>${d.actions.map(x => `<li>${esc(x)}</li>`).join('')}</ul>${d.escalate ? '<p><b>Priority message queued to Earth.</b></p>' : ''}${d.attribution.map(x => `<p class="note">${esc(x)}</p>`).join('')}<p class="note">Illustrative protocol. Replace with flight-surgeon-approved procedures.</p>`}${eta}</div>`;
    return `<details${open}><summary><span class="dname">${esc(d.label)}${badge}</span><span class="pill ${d.level}">${GLYPH[d.level]} ${WORD[d.level]}</span><span class="why">${why}</span></summary>${body}</details>`;
  }).join('');
}
function renderTrend() {
  const {cd, di} = cur(), s = cd.series[metric], c = $('#trend'), dpr = devicePixelRatio || 1, w = c.clientWidth || 500, h = 220;
  c.width = w * dpr; c.height = h * dpr; c.style.height = h + 'px';
  const x = c.getContext('2d'); x.scale(dpr, dpr);
  const P = {l: 44, r: 10, t: 10, b: 22}, n = B.meta.days, vals = s.values;
  const lo = Math.min(...vals, s.baseline - 3 * s.band), hi = Math.max(...vals, s.baseline + 3 * s.band);
  const X = d => P.l + d * (w - P.l - P.r) / (n - 1), Y = v => P.t + (hi - v) * (h - P.t - P.b) / (hi - lo || 1);
  x.font = '12px ' + FONT; x.fillStyle = '#93aab9'; x.strokeStyle = '#2d4659'; x.lineWidth = 1;
  for (let i = 0; i <= 3; i++) { const v = lo + (hi - lo) * i / 3, y = Y(v); x.beginPath(); x.moveTo(P.l, y); x.lineTo(w - P.r, y); x.stroke(); x.fillText(v >= 100 ? v.toFixed(0) : v.toFixed(1), 2, y + 4); }
  x.fillStyle = 'rgba(74,168,156,.18)'; x.fillRect(P.l, Y(s.baseline + s.band), w - P.l - P.r, Y(s.baseline - s.band) - Y(s.baseline + s.band));
  x.setLineDash([5, 4]); x.strokeStyle = '#4aa89c'; x.beginPath(); x.moveTo(P.l, Y(s.baseline)); x.lineTo(w - P.r, Y(s.baseline)); x.stroke(); x.setLineDash([]);
  x.strokeStyle = '#e8f0f5'; x.lineWidth = 2; x.beginPath();
  for (let d = 0; d <= di; d++) d ? x.lineTo(X(d), Y(vals[d])) : x.moveTo(X(d), Y(vals[d]));
  x.stroke(); x.fillStyle = '#e8f0f5'; x.beginPath(); x.arc(X(di), Y(vals[di]), 4, 0, 7); x.fill();
  const m = B.meta.metrics[metric]; x.fillStyle = '#93aab9'; x.fillText(`${m.label} (${m.unit}), band is ±1 SD of baseline`, P.l + 4, h - 6);
}
function renderQueue(down) {
  $('#linkNote').textContent = down ? 'Link is down. Messages are stored and forwarded when it returns.' : `Compressed summaries, about 0.3 KB each. One-way delay is ${B.meta.link_delay[day]} min.`;
  const list = B.queue.filter(m => m.day <= day).slice(-6).reverse();
  $('#queue').innerHTML = list.length ? list.map(m => {
    const sent = day >= m.delivered_day, hide = !prefs.shareBehavioral && m.domain_key === 'behavioral';
    return `<li class="${m.priority}"><b>Day ${m.day}, ${esc(m.name)}:</b> ${esc(m.domain)} is ${WORD[m.level].toLowerCase()}<small>${m.priority === 'urgent' ? 'Priority' : 'Routine'}. ${sent ? `Delivered, arrives about ${B.meta.link_delay[m.delivered_day]} min after sending` : `Held until day ${m.delivered_day}, link down`}</small><small>${hide ? 'Details withheld by crew member. Level only.' : esc(m.summary)}</small></li>`;
  }).join('') : '<li>No messages yet. Flags appear here when a status rises.</li>';
}
function togglePlay() {
  if (timer) { clearInterval(timer); timer = null; $('#play').textContent = 'Play mission'; return; }
  if (day >= B.meta.days - 1) day = 0;
  $('#play').textContent = 'Pause';
  timer = setInterval(() => { if (day >= B.meta.days - 1) { togglePlay(); return; } day++; render(); }, 450);
}
function reactionTest() {
  const b = $('#rtbox');
  if (rtState === 'wait') return;
  if (typeof rtState === 'number') { rtMs = Math.round(performance.now() - rtState); b.classList.remove('go'); b.textContent = `${rtMs} ms. Click to retry`; rtState = null; return; }
  b.textContent = 'Wait for teal...'; rtState = 'wait';
  setTimeout(() => { b.classList.add('go'); b.textContent = 'Click now'; rtState = performance.now(); }, 1000 + Math.random() * 2000);
}
function localTriage(symptoms) {
  const red = symptoms.some(s => RED_FLAGS.includes(s)), amber = symptoms.length > 0;
  const level = red ? 'red' : amber ? 'amber' : 'green';
  return {level, notes: [`Offline screening only: ${symptoms.length ? symptoms.map(s => SYMPTOMS[s]).join(', ') : 'no symptoms reported'}.`],
    actions: red ? ['Stop current activity and notify the crew medical officer now.'] : amber ? ['Re-check in 4 hours, rest, hydrate, and log how you feel.'] : ['No flags. Keep your routine.'],
    disclaimer: 'Decision support only. Not a diagnosis.'};
}
async function sendCheckin() {
  const symptoms = [...document.querySelectorAll('#checks input:checked')].map(i => i.value);
  const mood = $('#mood').value ? +$('#mood').value : null;
  let r;
  try {
    const res = await fetch('/api/checkin', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({crew_id: crew, symptoms, reaction_ms: rtMs, mood})});
    if (!res.ok) throw new Error(res.status);
    r = await res.json();
  } catch (e) { r = localTriage(symptoms); }
  $('#result').innerHTML = `<h3 class="${r.level}">${GLYPH[r.level]} ${WORD[r.level]}</h3><ul>${r.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul><ul>${r.actions.map(n => `<li>${esc(n)}</li>`).join('')}</ul><p class="note">${esc(r.disclaimer)}</p>`;
}
async function doImport() {
  const f = $('#impFile').files[0], msg = $('#impMsg');
  if (!f) { msg.innerHTML = '<p class="red">Choose a CSV file first.</p>'; return; }
  try {
    const csv = await f.text();
    const r = await fetch('/api/import', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name: $('#impName').value, csv})});
    const j = await r.json();
    if (!r.ok) { msg.innerHTML = `<p class="red">${esc(j.detail || 'Import failed')}</p>`; return; }
    await loadBundle(); crew = j.person.id; day = Math.min(day, j.days - 1); $('#imp').close(); render(); toast(`Imported ${j.days} days for ${j.person.name}`);
  } catch (e) { msg.innerHTML = '<p class="red">Import needs the server. Reconnect and try again.</p>'; }
}
async function exportReport() {
  try {
    const r = await fetch(`/api/crew/${crew}/report?day=${Math.min(day, cur().cd.n - 1)}`);
    if (!r.ok) throw new Error(r.status);
    const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = `astrotwin_${crew}_day${day}.md`; a.click();
  } catch (e) { toast('Export needs the server connection.'); }
}
init();
