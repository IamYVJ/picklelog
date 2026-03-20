const APP_NAME = 'PickleLog';
const APP_VERSION = 1;

const STORE = {
  theme: 'pb:t',
  index: 'pb:i',
  active: 'pb:a',
  matchPrefix: 'pb:m:'
};

const EVENT_LABELS = {
  0: 'General point',
  1: 'Unforced error',
  2: 'Forced error',
  3: 'Winner',
  4: 'Serve error',
  5: 'Return error',
  6: 'Volley error',
  7: 'Dink error',
  8: 'Out ball',
  9: 'Net ball'
};

const ZONE_LABELS = {
  0: 'None',
  1: 'Left',
  2: 'Middle',
  3: 'Right',
  4: 'Kitchen',
  5: 'Midcourt',
  6: 'Baseline'
};

const ERROR_CODES = new Set([1, 2, 4, 5, 6, 7, 8, 9]);
const WINNER_CODES = new Set([3]);

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const state = {
  activeMatch: null,
  viewingMatch: null,
  currentScreen: 'setup-screen'
};

document.addEventListener('DOMContentLoaded', init);

function init() {
  bindTheme();
  bindNavigation();
  bindSetup();
  bindLive();
  bindHistory();
  bindSummary();
  bindModal();
  renderPlayerFields();
  checkResume();
  renderHistory();
  showScreen('setup-screen');
}

function bindTheme() {
  const saved = localStorage.getItem(STORE.theme);
  const preferred = saved || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  setTheme(preferred);

  $('#theme-toggle')?.addEventListener('click', () => {
    setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  });
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(STORE.theme, theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#0d0d12' : '#f6f6fb');
}

function bindNavigation() {
  $$('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => showScreen(btn.dataset.screen));
  });
}

function showScreen(id) {
  state.currentScreen = id;
  $$('.screen').forEach(el => el.classList.toggle('active', el.id === id));
  $$('.nav-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.screen === id));
}

function bindSetup() {
  $$('input[name="matchType"]').forEach(el => el.addEventListener('change', renderPlayerFields));

  $('#setup-form')?.addEventListener('submit', e => {
    e.preventDefault();
    const match = createMatchFromForm(e.currentTarget);
    if (!match) return;
    state.activeMatch = match;
    state.viewingMatch = null;
    saveActiveMatch();
    renderLive();
    showScreen('live-screen');
  });

  $('#resume-match')?.addEventListener('click', () => {
    const match = loadActiveMatch();
    if (!match) return;
    state.activeMatch = match;
    state.viewingMatch = null;
    renderLive();
    showScreen('live-screen');
  });

  $('#discard-resume')?.addEventListener('click', () => {
    if (!confirm('Discard the recovered in-progress match?')) return;
    clearActiveMatch();
    state.activeMatch = null;
    checkResume();
  });
}

function bindLive() {
  $$('.score-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!state.activeMatch) return;
      const winner = Number(btn.dataset.team);
      if (state.activeMatch.md === 'a') {
        syncAdvancedWinner(winner);
        logRally(winner, getAdvancedPayload());
      } else {
        logRally(winner, { d: 0, e: 0, z: 0, a: -1, l: -1 });
      }
    });
  });

  $('#live-mode-toggle')?.addEventListener('click', () => {
    if (!state.activeMatch) return;
    state.activeMatch.md = state.activeMatch.md === 's' ? 'a' : 's';
    saveActiveMatch();
    renderLive();
  });

  $('#advanced-form')?.addEventListener('submit', e => {
    e.preventDefault();
    if (!state.activeMatch) return;
    const winner = Number($('input[name="advWinner"]:checked')?.value || 0);
    logRally(winner, getAdvancedPayload());
  });

  $('#undo-btn')?.addEventListener('click', () => {
    if (!state.activeMatch?.pts?.length) return;
    state.activeMatch.pts.pop();
    recomputeMatch(state.activeMatch);
    saveActiveMatch();
    renderLive();
  });

  $('#correct-score-btn')?.addEventListener('click', () => {
    if (!state.activeMatch) return;
    openCorrectionModal(state.activeMatch);
  });

  $('#end-match-btn')?.addEventListener('click', () => {
    if (!state.activeMatch) return;
    const message = state.activeMatch.fn
      ? 'End this match and save it?'
      : 'This match has not reached the target yet. End and save anyway?';
    if (!confirm(message)) return;
    finalizeActiveMatch();
  });
}

function bindHistory() {
  $('#history-search')?.addEventListener('input', renderHistory);

  $('#import-btn')?.addEventListener('click', () => $('#import-file')?.click());

  $('#import-file')?.addEventListener('change', async e => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const raw = parseImportedText(text);
      const items = Array.isArray(raw) ? raw : [raw];
      const normalized = items.map(normalizeImportedMatch).filter(Boolean);

      if (!normalized.length) {
        alert('No valid match data was found.');
        return;
      }

      normalized.forEach(saveStoredMatch);
      renderHistory();
      state.viewingMatch = clone(normalized[0]);
      renderSummary(state.viewingMatch);
      showScreen('summary-screen');
      alert(`Imported ${normalized.length} match${normalized.length > 1 ? 'es' : ''}.`);
    } catch (err) {
      console.error(err);
      alert('Import failed. Use a PickleLog JSON export or a text export from this app.');
    } finally {
      e.target.value = '';
    }
  });
}

function bindSummary() {
  $('#copy-summary-btn')?.addEventListener('click', async () => {
    const match = getCurrentSummaryMatch();
    if (!match) return;
    await copyText(buildSummaryText(match, false));
    alert('Summary copied.');
  });

  $('#save-text-btn')?.addEventListener('click', () => {
    const match = getCurrentSummaryMatch();
    if (!match) return;
    downloadText(`${safeFilename(match.lb)}.txt`, buildSummaryText(match, true), 'text/plain');
  });

  $('#save-json-btn')?.addEventListener('click', () => {
    const match = getCurrentSummaryMatch();
    if (!match) return;
    downloadText(
      `${safeFilename(match.lb)}.json`,
      JSON.stringify(minifyForExport(match), null, 2),
      'application/json'
    );
  });

  $('#copy-json-btn')?.addEventListener('click', async () => {
    const match = getCurrentSummaryMatch();
    if (!match) return;
    await copyText(JSON.stringify(minifyForExport(match), null, 2));
    alert('JSON copied.');
  });

  $('#export-image-btn')?.addEventListener('click', async () => {
    const match = getCurrentSummaryMatch();
    if (!match) return;
    try {
      await exportMatchImage(match);
    } catch (err) {
      console.error(err);
      alert('Image export failed on this browser.');
    }
  });

  $('#rematch-btn')?.addEventListener('click', () => {
    const match = getCurrentSummaryMatch();
    if (!match) return;
    const rematch = createRematchFrom(match);
    if (!rematch) {
      alert('Could not create rematch.');
      return;
    }
    state.activeMatch = rematch;
    state.viewingMatch = null;
    saveActiveMatch();
    renderLive();
    showScreen('live-screen');
  });
}

function bindModal() {
  $('#modal-close')?.addEventListener('click', closeModal);
  $('#modal')?.addEventListener('click', e => {
    const t = e.target;
    if (t instanceof HTMLElement && t.dataset.close === '1') closeModal();
  });
}

function renderPlayerFields() {
  const type = $('input[name="matchType"]:checked')?.value || 'S';
  const holder = $('#player-fields');
  if (!holder) return;

  const prev = readSetupNames();

  if (type === 'S') {
    holder.innerHTML = `
      <div class="team-group">
        <h3>Team A</h3>
        <label class="field">
          <span>Player name</span>
          <input name="p0" maxlength="28" placeholder="A1" value="${escapeAttr(prev.p0 || '')}">
        </label>
      </div>

      <div class="team-group">
        <h3>Team B</h3>
        <label class="field">
          <span>Player name</span>
          <input name="p1" maxlength="28" placeholder="B1" value="${escapeAttr(prev.p1 || '')}">
        </label>
      </div>

      <label class="field">
        <span>Starting server</span>
        <select name="startPlayer" id="start-player"></select>
      </label>
    `;
  } else {
    holder.innerHTML = `
      <div class="team-group">
        <h3>Team A</h3>
        <label class="field">
          <span>Player 1</span>
          <input name="p0" maxlength="28" placeholder="A1" value="${escapeAttr(prev.p0 || '')}">
        </label>
        <label class="field">
          <span>Player 2</span>
          <input name="p1" maxlength="28" placeholder="A2" value="${escapeAttr(prev.p1 || '')}">
        </label>
      </div>

      <div class="team-group">
        <h3>Team B</h3>
        <label class="field">
          <span>Player 1</span>
          <input name="p2" maxlength="28" placeholder="B1" value="${escapeAttr(prev.p2 || '')}">
        </label>
        <label class="field">
          <span>Player 2</span>
          <input name="p3" maxlength="28" placeholder="B2" value="${escapeAttr(prev.p3 || '')}">
        </label>
      </div>

      <label class="field">
        <span>Starting server</span>
        <select name="startPlayer" id="start-player"></select>
      </label>
    `;
  }

  $$('input[name^="p"]', holder).forEach(input => {
    input.addEventListener('input', renderStartServerOptions);
  });

  renderStartServerOptions();
}

function readSetupNames() {
  const out = {};
  ['p0', 'p1', 'p2', 'p3'].forEach(k => {
    const el = document.querySelector(`[name="${k}"]`);
    if (el) out[k] = el.value.trim();
  });
  return out;
}

function defaultNamesForType(type) {
  return type === 'D' ? ['A1', 'A2', 'B1', 'B2'] : ['A1', 'B1'];
}

function nameOrDefault(value, fallback) {
  const v = String(value || '').trim();
  return v || fallback;
}

function renderStartServerOptions() {
  const select = $('#start-player');
  if (!select) return;

  const type = $('input[name="matchType"]:checked')?.value || 'S';
  const defaults = defaultNamesForType(type);
  const prev = select.value;

  const players = type === 'D'
    ? [
        nameOrDefault($('[name="p0"]')?.value, defaults[0]),
        nameOrDefault($('[name="p1"]')?.value, defaults[1]),
        nameOrDefault($('[name="p2"]')?.value, defaults[2]),
        nameOrDefault($('[name="p3"]')?.value, defaults[3])
      ]
    : [
        nameOrDefault($('[name="p0"]')?.value, defaults[0]),
        nameOrDefault($('[name="p1"]')?.value, defaults[1])
      ];

  select.innerHTML = players.map((name, idx) => `<option value="${idx}">${escapeHtml(name)}</option>`).join('');

  if ([...select.options].some(o => o.value === prev)) {
    select.value = prev;
  } else {
    select.value = '0';
  }
}

function createMatchFromForm(form) {
  const fd = new FormData(form);
  const ty = String(fd.get('matchType') || 'S');
  const md = String(fd.get('loggingMode') || 's');
  const target = Math.max(1, Number(fd.get('target') || 11));
  const wb = Math.max(1, Number(fd.get('winBy') || 2));
  const nt = String(fd.get('notes') || '').trim();
  const defaults = defaultNamesForType(ty);

  let pl = [];
  let tm = [];
  let sp = 0;

  if (ty === 'S') {
    pl = [
      nameOrDefault(fd.get('p0'), defaults[0]),
      nameOrDefault(fd.get('p1'), defaults[1])
    ];
    tm = [[0], [1]];
    sp = Number(fd.get('startPlayer') || 0);
    if (![0, 1].includes(sp)) sp = 0;
  } else {
    pl = [
      nameOrDefault(fd.get('p0'), defaults[0]),
      nameOrDefault(fd.get('p1'), defaults[1]),
      nameOrDefault(fd.get('p2'), defaults[2]),
      nameOrDefault(fd.get('p3'), defaults[3])
    ];
    tm = [[0, 1], [2, 3]];
    sp = Number(fd.get('startPlayer') || 0);
    if (![0, 1, 2, 3].includes(sp)) sp = 0;
  }

  const fs = tm[0].includes(sp) ? 0 : 1;

  const match = {
    v: APP_VERSION,
    id: uid(),
    ts: Date.now(),
    et: null,
    ty,
    md,
    target,
    wb,
    fs,
    sp,
    nt,
    pl,
    tm,
    pts: [],
    sc: [0, 0],
    srv: fs,
    sn: ty === 'D' ? 2 : 1,
    st: 'a',
    fn: false,
    lb: ''
  };

  recomputeMatch(match);
  return match;
}

function getTeamNames(match) {
  const a = (match.tm?.[0] || []).map(i => match.pl[i]).filter(Boolean).join(' / ') || 'Team A';
  const b = (match.tm?.[1] || []).map(i => match.pl[i]).filter(Boolean).join(' / ') || 'Team B';
  return [a, b];
}

function getShortTeamNames(match) {
  return getTeamNames(match).map(name => match.ty === 'D' ? name.replace(/\s*\/\s*/g, '/') : name);
}

function getScoreCall(match) {
  const servingScore = match.sc[match.srv];
  const receivingScore = match.sc[1 - match.srv];
  return match.ty === 'D'
    ? `${servingScore}-${receivingScore}-${match.sn}`
    : `${servingScore}-${receivingScore}`;
}

function buildMatchLabel(match) {
  return `${formatCompactDateTime(match.ts)} - ${match.ty === 'D' ? 'Doubles' : 'Singles'} - ${getShortTeamNames(match).join(' vs ')} - ${match.sc[0]}-${match.sc[1]}`;
}

function recomputeMatch(match) {
  let sc = [0, 0];
  let srv = Number(match.fs || 0);
  let sn = match.ty === 'D' ? 2 : 1;
  const timeline = [];

  for (let i = 0; i < (match.pts || []).length; i += 1) {
    const entry = match.pts[i];

    if (isCorrection(entry)) {
      const before = { sc: [...sc], srv, sn };
      sc = [Number(entry.c[0] || 0), Number(entry.c[1] || 0)];
      srv = Number(entry.c[2] || 0);
      sn = match.ty === 'D' ? Number(entry.c[3] || 1) : 1;
      timeline.push({ i, k: 'c', before, after: { sc: [...sc], srv, sn } });
      continue;
    }

    if (!Array.isArray(entry)) continue;

    const winner = Number(entry[0] || 0);
    const before = { sc: [...sc], srv, sn };

    if (winner === srv) {
      sc[winner] += 1;
    } else if (match.ty === 'S') {
      srv = winner;
      sn = 1;
    } else if (sn === 1) {
      sn = 2;
    } else {
      srv = winner;
      sn = 1;
    }

    timeline.push({
      i,
      k: 'p',
      w: winner,
      d: Number(entry[1] || 0),
      e: Number(entry[2] || 0),
      z: Number(entry[3] || 0),
      a: Number(entry[4] ?? -1),
      l: Number(entry[5] ?? -1),
      before,
      after: { sc: [...sc], srv, sn }
    });
  }

  match.sc = sc;
  match.srv = srv;
  match.sn = sn;
  match.fn = Math.max(sc[0], sc[1]) >= Number(match.target || 11) && Math.abs(sc[0] - sc[1]) >= Number(match.wb || 2);
  match.tl = getTeamNames(match);
  match.lb = buildMatchLabel(match);
  match._timeline = timeline;
  return match;
}

function renderLive() {
  const match = state.activeMatch;
  if (!match) return;

  recomputeMatch(match);
  const [teamA, teamB] = match.tl;
  const starterName = typeof match.sp === 'number' && match.pl[match.sp] ? match.pl[match.sp] : match.tl[match.fs];

  $('#live-format-pill').textContent = match.ty === 'D' ? 'Doubles' : 'Singles';
  $('#live-mode-toggle').textContent = match.md === 'a' ? 'Advanced mode' : 'Simple mode';
  $('#team-name-0').textContent = teamA;
  $('#team-name-1').textContent = teamB;
  $('#team-score-0').textContent = String(match.sc[0]);
  $('#team-score-1').textContent = String(match.sc[1]);
  $('#team-panel-0').classList.toggle('serving', match.srv === 0);
  $('#team-panel-1').classList.toggle('serving', match.srv === 1);

  $('#serve-indicator').textContent = match.ty === 'D'
    ? `Serving: ${match.tl[match.srv]} · Server ${match.sn}${match.pts.length === 0 ? ` · Start ${starterName}` : ''}`
    : `Serving: ${match.tl[match.srv]}${match.pts.length === 0 ? ` · Start ${starterName}` : ''}`;

  $('#score-call').textContent = getScoreCall(match);
  $('.score-btn[data-team="0"]').textContent = `Point for ${teamA}`;
  $('.score-btn[data-team="1"]').textContent = `Point for ${teamB}`;
  $('#advanced-card').classList.toggle('hidden', match.md !== 'a');

  populateAdvancedSelectors(match);
  renderHistoryChips(match);
  renderRecentEvents(match);
  saveActiveMatch();
}

function populateAdvancedSelectors(match) {
  const loserSel = $('#adv-loser');
  const actorSel = $('#adv-actor');
  if (!loserSel || !actorSel) return;

  const prevLoser = loserSel.value;
  const prevActor = actorSel.value;
  const opts = ['<option value="-1">Not specified</option>']
    .concat(match.pl.map((n, i) => `<option value="${i}">${escapeHtml(n)}</option>`))
    .join('');

  loserSel.innerHTML = opts;
  actorSel.innerHTML = opts;

  if ([...loserSel.options].some(o => o.value === prevLoser)) loserSel.value = prevLoser;
  if ([...actorSel.options].some(o => o.value === prevActor)) actorSel.value = prevActor;
}

function syncAdvancedWinner(winner) {
  const radio = document.getElementById(`adv-win-${winner}`);
  if (radio) radio.checked = true;
}

function getAdvancedPayload() {
  return {
    d: 1,
    e: Number($('#adv-event')?.value || 0),
    z: Number($('#adv-zone')?.value || 0),
    a: Number($('#adv-actor')?.value || -1),
    l: Number($('#adv-loser')?.value || -1)
  };
}

function logRally(winner, detail) {
  const match = state.activeMatch;
  if (!match) return;

  const d = detail || {};
  match.pts.push([
    Number(winner || 0),
    Number(d.d || 0),
    Number(d.e || 0),
    Number(d.z || 0),
    Number(d.a ?? -1),
    Number(d.l ?? -1)
  ]);

  recomputeMatch(match);
  saveActiveMatch();

  if (match.fn) {
    finalizeActiveMatch();
    return;
  }

  renderLive();
}

function renderHistoryChips(match) {
  const holder = $('#history-chips');
  const list = (match._timeline || []).filter(x => x.k === 'p').slice(-24);

  if (!list.length) {
    holder.innerHTML = '<div class="empty-state">No rallies logged yet.</div>';
    return;
  }

  holder.innerHTML = list.map(ev => {
    const label = ev.w === 0 ? 'A' : 'B';
    return `<span class="history-chip win" title="${escapeAttr(describeTimelineEvent(match, ev))}">${label}</span>`;
  }).join('');
}

function renderRecentEvents(match) {
  const holder = $('#recent-events');
  const items = (match._timeline || []).slice().reverse().slice(0, 12);

  if (!items.length) {
    holder.innerHTML = '<div class="empty-state">Recent rally details will appear here.</div>';
    return;
  }

  holder.innerHTML = items.map(item => `
    <article class="event-item">
      <div class="event-item-top">
        <p><strong>${escapeHtml(describeTimelineEvent(match, item))}</strong></p>
        <p class="event-meta">${item.before.sc[0]}-${item.before.sc[1]} → ${item.after.sc[0]}-${item.after.sc[1]}</p>
      </div>
      <div class="actions split">
        <button class="ghost-btn small" type="button" data-edit-event="${item.i}">Edit</button>
        <button class="ghost-btn small" type="button" data-delete-event="${item.i}">Remove</button>
      </div>
    </article>
  `).join('');

  $$('[data-edit-event]', holder).forEach(btn => {
    btn.addEventListener('click', () => openEventEditor(Number(btn.dataset.editEvent)));
  });

  $$('[data-delete-event]', holder).forEach(btn => {
    btn.addEventListener('click', () => {
      const i = Number(btn.dataset.deleteEvent);
      if (!confirm('Remove this entry?')) return;
      state.activeMatch.pts.splice(i, 1);
      recomputeMatch(state.activeMatch);
      saveActiveMatch();
      renderLive();
    });
  });
}

function describeTimelineEvent(match, item) {
  if (item.k === 'c') {
    return `Manual correction · ${item.after.sc[0]}-${item.after.sc[1]} · Serving ${match.tl[item.after.srv]}${match.ty === 'D' ? ` · Server ${item.after.sn}` : ''}`;
  }

  const parts = [`${match.tl[item.w]} won the rally`];
  if (item.e && EVENT_LABELS[item.e]) parts.push(EVENT_LABELS[item.e]);
  if (item.a >= 0 && match.pl[item.a]) parts.push(`by ${match.pl[item.a]}`);
  if (item.l >= 0 && match.pl[item.l]) parts.push(`against ${match.pl[item.l]}`);
  if (item.z > 0 && ZONE_LABELS[item.z]) parts.push(`at ${ZONE_LABELS[item.z].toLowerCase()}`);
  return parts.join(' · ');
}

function openEventEditor(index) {
  const match = state.activeMatch;
  if (!match) return;
  const entry = match.pts[index];
  if (!entry) return;

  if (isCorrection(entry)) {
    openCorrectionModal(match, index);
    return;
  }

  const teamOpts = `
    <option value="0"${Number(entry[0]) === 0 ? ' selected' : ''}>${escapeHtml(match.tl[0])}</option>
    <option value="1"${Number(entry[0]) === 1 ? ' selected' : ''}>${escapeHtml(match.tl[1])}</option>
  `;

  const playerOpts = selected => {
    let html = '<option value="-1">Not specified</option>';
    match.pl.forEach((name, i) => {
      html += `<option value="${i}"${Number(selected) === i ? ' selected' : ''}>${escapeHtml(name)}</option>`;
    });
    return html;
  };

  const eventOpts = Object.entries(EVENT_LABELS).map(([k, v]) =>
    `<option value="${k}"${Number(entry[2]) === Number(k) ? ' selected' : ''}>${escapeHtml(v)}</option>`
  ).join('');

  const zoneOpts = Object.entries(ZONE_LABELS).map(([k, v]) =>
    `<option value="${k}"${Number(entry[3]) === Number(k) ? ' selected' : ''}>${escapeHtml(v)}</option>`
  ).join('');

  openModal(
    'Edit rally',
    `
      <div class="field-grid two">
        <label class="field">
          <span>Point winner</span>
          <select id="edit-winner">${teamOpts}</select>
        </label>
        <label class="field">
          <span>Event type</span>
          <select id="edit-event">${eventOpts}</select>
        </label>
      </div>
      <div class="field-grid two">
        <label class="field">
          <span>Winning player</span>
          <select id="edit-actor">${playerOpts(entry[4])}</select>
        </label>
        <label class="field">
          <span>Losing player</span>
          <select id="edit-loser">${playerOpts(entry[5])}</select>
        </label>
      </div>
      <label class="field">
        <span>Zone</span>
        <select id="edit-zone">${zoneOpts}</select>
      </label>
    `,
    [
      {
        label: 'Delete',
        cls: 'ghost-btn',
        onClick: () => {
          if (!confirm('Delete this rally?')) return;
          match.pts.splice(index, 1);
          recomputeMatch(match);
          saveActiveMatch();
          renderLive();
          closeModal();
        }
      },
      {
        label: 'Save',
        cls: 'primary-btn',
        onClick: () => {
          const winner = Number($('#edit-winner').value || 0);
          const eventCode = Number($('#edit-event').value || 0);
          const zone = Number($('#edit-zone').value || 0);
          const actor = Number($('#edit-actor').value || -1);
          const loser = Number($('#edit-loser').value || -1);
          const detail = eventCode !== 0 || zone !== 0 || actor !== -1 || loser !== -1 ? 1 : 0;
          match.pts[index] = [winner, detail, eventCode, zone, actor, loser];
          recomputeMatch(match);
          saveActiveMatch();
          renderLive();
          closeModal();
        }
      }
    ]
  );
}

function openCorrectionModal(match, index = null) {
  recomputeMatch(match);
  const existing = typeof index === 'number' && isCorrection(match.pts[index]) ? match.pts[index].c : null;
  const current = existing || [match.sc[0], match.sc[1], match.srv, match.ty === 'D' ? match.sn : 1];

  openModal(
    existing ? 'Edit correction' : 'Manual score correction',
    `
      <div class="field-grid two">
        <label class="field">
          <span>${escapeHtml(match.tl[0])} score</span>
          <input id="corr-a" type="number" min="0" inputmode="numeric" value="${Number(current[0] || 0)}">
        </label>
        <label class="field">
          <span>${escapeHtml(match.tl[1])} score</span>
          <input id="corr-b" type="number" min="0" inputmode="numeric" value="${Number(current[1] || 0)}">
        </label>
      </div>
      <div class="field-grid two">
        <label class="field">
          <span>Serving team</span>
          <select id="corr-srv">
            <option value="0"${Number(current[2]) === 0 ? ' selected' : ''}>${escapeHtml(match.tl[0])}</option>
            <option value="1"${Number(current[2]) === 1 ? ' selected' : ''}>${escapeHtml(match.tl[1])}</option>
          </select>
        </label>
        <label class="field">
          <span>Server number</span>
          <select id="corr-sn" ${match.ty === 'S' ? 'disabled' : ''}>
            <option value="1"${Number(current[3]) === 1 ? ' selected' : ''}>1</option>
            <option value="2"${Number(current[3]) === 2 ? ' selected' : ''}>2</option>
          </select>
        </label>
      </div>
    `,
    [
      {
        label: 'Save',
        cls: 'primary-btn',
        onClick: () => {
          const a = Math.max(0, Number($('#corr-a').value || 0));
          const b = Math.max(0, Number($('#corr-b').value || 0));
          const srv = Number($('#corr-srv').value || 0);
          const sn = match.ty === 'D' ? Number($('#corr-sn').value || 1) : 1;
          const correction = { c: [a, b, srv, sn] };

          if (existing) match.pts[index] = correction;
          else match.pts.push(correction);

          recomputeMatch(match);
          saveActiveMatch();
          renderLive();
          closeModal();
        }
      }
    ]
  );
}

function finalizeActiveMatch() {
  const match = state.activeMatch;
  if (!match) return;

  recomputeMatch(match);
  match.et = match.et || Date.now();
  match.st = 'f';
  match.lb = buildMatchLabel(match);

  saveStoredMatch(match);
  clearActiveMatch();
  state.activeMatch = null;
  state.viewingMatch = clone(match);

  renderHistory();
  renderSummary(state.viewingMatch);
  showScreen('summary-screen');
  checkResume();
}

function renderHistory() {
  const holder = $('#match-list');
  if (!holder) return;

  const q = ($('#history-search')?.value || '').trim().toLowerCase();
  const rows = getStoredIndex()
    .filter(item => !q || `${item.lb} ${item.ty} ${item.ts}`.toLowerCase().includes(q))
    .sort((a, b) => b.ts - a.ts);

  if (!rows.length) {
    holder.innerHTML = '<div class="empty-state">No saved matches yet. Start a match to build your history.</div>';
    return;
  }

  holder.innerHTML = rows.map(item => `
    <article class="match-item">
      <div class="match-item-top">
        <h3>${escapeHtml(item.lb)}</h3>
      </div>
      <div class="match-item-bottom">
        <p class="match-sub">${escapeHtml(formatPrettyDateTime(item.ts))}</p>
        <div class="actions split">
          <button class="ghost-btn small" type="button" data-open-match="${item.id}">Open</button>
          <button class="ghost-btn small" type="button" data-delete-match="${item.id}">Delete</button>
        </div>
      </div>
    </article>
  `).join('');

  $$('[data-open-match]', holder).forEach(btn => {
    btn.addEventListener('click', () => {
      const match = getStoredMatch(btn.dataset.openMatch);
      if (!match) {
        alert('That match could not be loaded.');
        renderHistory();
        return;
      }
      state.viewingMatch = match;
      renderSummary(match);
      showScreen('summary-screen');
    });
  });

  $$('[data-delete-match]', holder).forEach(btn => {
    btn.addEventListener('click', () => {
      if (!confirm('Delete this saved match?')) return;
      deleteStoredMatch(btn.dataset.deleteMatch);
      renderHistory();
    });
  });
}

function renderSummary(match) {
  recomputeMatch(match);
  const stats = computeStats(match);
  const winner = match.sc[0] === match.sc[1] ? 'Tie / manual end' : match.tl[match.sc[0] > match.sc[1] ? 0 : 1];

  $('#summary-head').innerHTML = `
    <div class="summary-headline">
      <span class="result-badge">${escapeHtml(match.ty === 'D' ? 'Doubles' : 'Singles')}</span>
      <h3>${escapeHtml(winner)}</h3>
      <div class="result-score">${match.sc[0]} - ${match.sc[1]}</div>
      <p class="muted">${escapeHtml(match.lb)}</p>
    </div>
  `;

  $('#summary-meta').innerHTML = [
    statCard('Date', formatPrettyDateTime(match.ts)),
    statCard('Duration', formatDuration((match.et || Date.now()) - match.ts)),
    statCard('Total rallies', String(stats.totalRallies)),
    statCard('Logging mode', match.md === 'a' ? 'Advanced' : 'Simple'),
    statCard('Starting server', match.pl?.[match.sp] || '—'),
    statCard('Notes', match.nt || '—')
  ].join('');

  $('#summary-stats').innerHTML = [0, 1].map(team => {
    const t = stats.teams[team];
    return `
      <div class="team-stat-card">
        <h3>${escapeHtml(match.tl[team])}</h3>
        <div class="stat-list">
          ${statRow('Rallies won', t.pointsWon)}
          ${statRow('Rallies lost', t.pointsLost)}
          ${statRow('Points on serve', t.scored)}
          ${statRow('Errors logged', t.errors)}
          ${statRow('Winners logged', t.winners)}
          ${statRow('Serve errors', t.errorByType['Serve error'] || 0)}
          ${statRow('Return errors', t.errorByType['Return error'] || 0)}
          ${statRow('Volley errors', t.errorByType['Volley error'] || 0)}
          ${statRow('Dink errors', t.errorByType['Dink error'] || 0)}
        </div>
      </div>
    `;
  }).join('');

  const logs = (match._timeline || []).slice().reverse();
  $('#summary-logs').innerHTML = logs.length
    ? logs.map(item => `
        <article class="event-item">
          <div class="event-item-top">
            <p><strong>${escapeHtml(describeTimelineEvent(match, item))}</strong></p>
            <p class="event-meta">${item.before.sc[0]}-${item.before.sc[1]} → ${item.after.sc[0]}-${item.after.sc[1]}</p>
          </div>
        </article>
      `).join('')
    : '<div class="empty-state">No rally logs were recorded.</div>';
}

function computeStats(match) {
  recomputeMatch(match);

  const teams = [0, 1].map(() => ({
    pointsWon: 0,
    pointsLost: 0,
    scored: 0,
    errors: 0,
    winners: 0,
    errorByType: {},
    winnerByType: {}
  }));

  const players = match.pl.map(name => ({
    name,
    pointsWon: 0,
    pointsLost: 0,
    errors: 0,
    winners: 0
  }));

  (match._timeline || []).forEach(item => {
    if (item.k !== 'p') return;

    const w = item.w;
    const l = 1 - w;
    teams[w].pointsWon += 1;
    teams[l].pointsLost += 1;
    if (item.after.sc[w] > item.before.sc[w]) teams[w].scored += 1;

    if (item.a >= 0 && players[item.a]) players[item.a].pointsWon += 1;
    if (item.l >= 0 && players[item.l]) players[item.l].pointsLost += 1;

    const loserTeam = item.l >= 0 ? teamFromPlayer(match, item.l) : l;
    const actorTeam = item.a >= 0 ? teamFromPlayer(match, item.a) : w;
    const label = EVENT_LABELS[item.e];

    if (ERROR_CODES.has(item.e)) {
      teams[loserTeam].errors += 1;
      teams[loserTeam].errorByType[label] = (teams[loserTeam].errorByType[label] || 0) + 1;
      if (item.l >= 0 && players[item.l]) players[item.l].errors += 1;
    }

    if (WINNER_CODES.has(item.e)) {
      teams[actorTeam].winners += 1;
      teams[actorTeam].winnerByType[label] = (teams[actorTeam].winnerByType[label] || 0) + 1;
      if (item.a >= 0 && players[item.a]) players[item.a].winners += 1;
    }
  });

  return {
    totalRallies: (match._timeline || []).filter(x => x.k === 'p').length,
    teams,
    players
  };
}

function getCurrentSummaryMatch() {
  return state.viewingMatch || state.activeMatch;
}

function buildSummaryText(match, withData) {
  recomputeMatch(match);
  const stats = computeStats(match);
  const winner = match.sc[0] === match.sc[1] ? 'Tie / manual end' : match.tl[match.sc[0] > match.sc[1] ? 0 : 1];

  const lines = [
    `${APP_NAME} Match Summary`,
    '',
    `Label: ${match.lb}`,
    `Winner: ${winner}`,
    `Final score: ${match.sc[0]}-${match.sc[1]}`,
    `Current score call: ${getScoreCall(match)}`,
    `Format: ${match.ty === 'D' ? 'Doubles' : 'Singles'}`,
    `Players: ${match.pl.join(', ')}`,
    `Starting server: ${match.pl?.[match.sp] || '-'}`,
    `Date: ${formatPrettyDateTime(match.ts)}`,
    `Duration: ${formatDuration((match.et || Date.now()) - match.ts)}`,
    `Total rallies: ${stats.totalRallies}`,
    `Logging mode: ${match.md === 'a' ? 'Advanced' : 'Simple'}`,
    `Notes: ${match.nt || '-'}`,
    '',
    `Team A: ${match.tl[0]}`,
    `- Rallies won: ${stats.teams[0].pointsWon}`,
    `- Rallies lost: ${stats.teams[0].pointsLost}`,
    `- Points on serve: ${stats.teams[0].scored}`,
    `- Errors: ${stats.teams[0].errors}`,
    `- Winners: ${stats.teams[0].winners}`,
    '',
    `Team B: ${match.tl[1]}`,
    `- Rallies won: ${stats.teams[1].pointsWon}`,
    `- Rallies lost: ${stats.teams[1].pointsLost}`,
    `- Points on serve: ${stats.teams[1].scored}`,
    `- Errors: ${stats.teams[1].errors}`,
    `- Winners: ${stats.teams[1].winners}`,
    '',
    'Rally log:'
  ];

  (match._timeline || []).forEach(item => {
    lines.push(`- ${describeTimelineEvent(match, item)} (${item.before.sc[0]}-${item.before.sc[1]} -> ${item.after.sc[0]}-${item.after.sc[1]})`);
  });

  if (withData) {
    lines.push(
      '',
      '--- PICKLELOG DATA START ---',
      JSON.stringify(minifyForExport(match)),
      '--- PICKLELOG DATA END ---'
    );
  }

  return lines.join('\n');
}

function minifyForExport(match) {
  return {
    v: APP_VERSION,
    id: match.id,
    ts: match.ts,
    et: match.et,
    ty: match.ty,
    md: match.md,
    target: match.target,
    wb: match.wb,
    fs: match.fs,
    sp: typeof match.sp === 'number' ? match.sp : 0,
    nt: match.nt || '',
    pl: match.pl,
    tm: match.tm,
    pts: match.pts,
    st: match.st || 'f'
  };
}

function parseImportedText(text) {
  const t = text.trim();
  if (!t) throw new Error('Empty file');

  if (t.startsWith('{') || t.startsWith('[')) {
    return JSON.parse(t);
  }

  const match = t.match(/--- PICKLELOG DATA START ---\s*([\s\S]*?)\s*--- PICKLELOG DATA END ---/);
  if (match) return JSON.parse(match[1]);

  throw new Error('Unsupported import format');
}

function normalizeImportedMatch(raw) {
  try {
    if (!raw || typeof raw !== 'object') return null;

    const match = {
      v: Number(raw.v || 1),
      id: String(raw.id || uid()),
      ts: Number(raw.ts || Date.now()),
      et: raw.et ? Number(raw.et) : null,
      ty: raw.ty === 'D' ? 'D' : 'S',
      md: raw.md === 'a' ? 'a' : 's',
      target: Math.max(1, Number(raw.target || 11)),
      wb: Math.max(1, Number(raw.wb || 2)),
      fs: Number(raw.fs || 0) === 1 ? 1 : 0,
      sp: Number.isInteger(raw.sp) ? raw.sp : 0,
      nt: String(raw.nt || ''),
      pl: Array.isArray(raw.pl) ? raw.pl.map(x => String(x || '').trim()).filter(Boolean) : [],
      tm: Array.isArray(raw.tm) ? raw.tm : [],
      pts: Array.isArray(raw.pts) ? raw.pts : [],
      st: raw.st || 'f',
      sc: [0, 0],
      srv: 0,
      sn: 1,
      fn: false,
      lb: ''
    };

    if (match.ty === 'S' && match.pl.length < 2) return null;
    if (match.ty === 'D' && match.pl.length < 4) return null;
    if (!match.tm.length) match.tm = match.ty === 'S' ? [[0], [1]] : [[0, 1], [2, 3]];
    match.pts = match.pts.filter(p => (Array.isArray(p) && p.length >= 1) || isCorrection(p));

    recomputeMatch(match);
    return match;
  } catch {
    return null;
  }
}

function createRematchFrom(match) {
  const base = normalizeImportedMatch(minifyForExport(match));
  if (!base) return null;

  const rematch = {
    v: APP_VERSION,
    id: uid(),
    ts: Date.now(),
    et: null,
    ty: base.ty,
    md: base.md,
    target: base.target,
    wb: base.wb,
    fs: base.fs,
    sp: typeof base.sp === 'number' ? base.sp : 0,
    nt: '',
    pl: [...base.pl],
    tm: clone(base.tm),
    pts: [],
    sc: [0, 0],
    srv: base.fs,
    sn: base.ty === 'D' ? 2 : 1,
    st: 'a',
    fn: false,
    lb: ''
  };

  recomputeMatch(rematch);
  return rematch;
}

async function exportMatchImage(match) {
  recomputeMatch(match);
  const stats = computeStats(match);
  const winner = match.sc[0] === match.sc[1] ? 'Tie / manual end' : match.tl[match.sc[0] > match.sc[1] ? 0 : 1];

  const style = getComputedStyle(document.documentElement);
  const bg = style.getPropertyValue('--bg').trim() || '#0d0d12';
  const surface = style.getPropertyValue('--surface').trim() || '#14141c';
  const text = style.getPropertyValue('--text').trim() || '#ffffff';
  const muted = style.getPropertyValue('--muted').trim() || 'rgba(255,255,255,.7)';
  const accent = style.getPropertyValue('--accent').trim() || '#b28dff';
  const accentSoft = style.getPropertyValue('--accent-2').trim() || 'rgba(178,141,255,.15)';

  const linesA = wrapText(match.tl[0], 28);
  const linesB = wrapText(match.tl[1], 28);
  const labelLines = wrapText(match.lb, 44);

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600" viewBox="0 0 1200 1600">
      <rect width="1200" height="1600" fill="${svgSafe(bg)}"/>
      <rect x="60" y="60" width="1080" height="1480" rx="42" fill="${svgSafe(surface)}"/>
      <rect x="96" y="96" width="210" height="52" rx="26" fill="${svgSafe(accentSoft)}"/>
      <text x="201" y="129" text-anchor="middle" font-family="system-ui, -apple-system, Segoe UI, Roboto, Arial" font-size="24" font-weight="700" fill="${svgSafe(accent)}">${svgSafe(match.ty === 'D' ? 'Doubles' : 'Singles')}</text>

      <text x="96" y="220" font-family="system-ui, -apple-system, Segoe UI, Roboto, Arial" font-size="30" fill="${svgSafe(muted)}">Winner</text>
      <text x="96" y="286" font-family="system-ui, -apple-system, Segoe UI, Roboto, Arial" font-size="54" font-weight="800" fill="${svgSafe(text)}">${svgSafe(truncate(winner, 28))}</text>
      <text x="96" y="390" font-family="system-ui, -apple-system, Segoe UI, Roboto, Arial" font-size="148" font-weight="900" fill="${svgSafe(text)}">${match.sc[0]}-${match.sc[1]}</text>

      ${labelLines.map((line, i) => `
        <text x="96" y="${470 + i * 34}" font-family="system-ui, -apple-system, Segoe UI, Roboto, Arial" font-size="28" fill="${svgSafe(muted)}">${svgSafe(line)}</text>
      `).join('')}

      <rect x="96" y="610" width="486" height="250" rx="30" fill="${svgSafe(bg)}"/>
      <rect x="618" y="610" width="486" height="250" rx="30" fill="${svgSafe(bg)}"/>

      ${linesA.map((line, i) => `
        <text x="130" y="${690 + i * 34}" font-family="system-ui, -apple-system, Segoe UI, Roboto, Arial" font-size="28" font-weight="700" fill="${svgSafe(text)}">${svgSafe(line)}</text>
      `).join('')}
      <text x="130" y="790" font-family="system-ui, -apple-system, Segoe UI, Roboto, Arial" font-size="24" fill="${svgSafe(muted)}">Rallies won ${stats.teams[0].pointsWon}</text>
      <text x="130" y="828" font-family="system-ui, -apple-system, Segoe UI, Roboto, Arial" font-size="24" fill="${svgSafe(muted)}">Errors ${stats.teams[0].errors} · Winners ${stats.teams[0].winners}</text>

      ${linesB.map((line, i) => `
        <text x="652" y="${690 + i * 34}" font-family="system-ui, -apple-system, Segoe UI, Roboto, Arial" font-size="28" font-weight="700" fill="${svgSafe(text)}">${svgSafe(line)}</text>
      `).join('')}
      <text x="652" y="790" font-family="system-ui, -apple-system, Segoe UI, Roboto, Arial" font-size="24" fill="${svgSafe(muted)}">Rallies won ${stats.teams[1].pointsWon}</text>
      <text x="652" y="828" font-family="system-ui, -apple-system, Segoe UI, Roboto, Arial" font-size="24" fill="${svgSafe(muted)}">Errors ${stats.teams[1].errors} · Winners ${stats.teams[1].winners}</text>

      <text x="96" y="950" font-family="system-ui, -apple-system, Segoe UI, Roboto, Arial" font-size="30" fill="${svgSafe(muted)}">Details</text>
      <text x="96" y="1012" font-family="system-ui, -apple-system, Segoe UI, Roboto, Arial" font-size="28" fill="${svgSafe(text)}">Date: ${svgSafe(formatPrettyDateTime(match.ts))}</text>
      <text x="96" y="1060" font-family="system-ui, -apple-system, Segoe UI, Roboto, Arial" font-size="28" fill="${svgSafe(text)}">Duration: ${svgSafe(formatDuration((match.et || Date.now()) - match.ts))}</text>
      <text x="96" y="1108" font-family="system-ui, -apple-system, Segoe UI, Roboto, Arial" font-size="28" fill="${svgSafe(text)}">Total rallies: ${stats.totalRallies}</text>
      <text x="96" y="1156" font-family="system-ui, -apple-system, Segoe UI, Roboto, Arial" font-size="28" fill="${svgSafe(text)}">Logging mode: ${svgSafe(match.md === 'a' ? 'Advanced' : 'Simple')}</text>
      <text x="96" y="1204" font-family="system-ui, -apple-system, Segoe UI, Roboto, Arial" font-size="28" fill="${svgSafe(text)}">Starting server: ${svgSafe(match.pl?.[match.sp] || '-')}</text>

      <text x="96" y="1460" font-family="system-ui, -apple-system, Segoe UI, Roboto, Arial" font-size="26" fill="${svgSafe(muted)}">${svgSafe(APP_NAME)}</text>
    </svg>
  `;

  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const img = new Image();

  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = url;
  });

  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 1600;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  URL.revokeObjectURL(url);

  const pngUrl = canvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = pngUrl;
  a.download = `${safeFilename(match.lb)}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function saveActiveMatch() {
  if (!state.activeMatch) return;
  try {
    localStorage.setItem(STORE.active, JSON.stringify(minifyForExport(state.activeMatch)));
  } catch (err) {
    console.error(err);
    alert('Could not save the in-progress match locally.');
  }
}

function loadActiveMatch() {
  try {
    const raw = localStorage.getItem(STORE.active);
    if (!raw) return null;
    return normalizeImportedMatch(JSON.parse(raw));
  } catch {
    return null;
  }
}

function clearActiveMatch() {
  localStorage.removeItem(STORE.active);
}

function checkResume() {
  const card = $('#resume-card');
  const text = $('#resume-text');
  const match = loadActiveMatch();

  if (!card || !text) return;

  if (match) {
    card.classList.remove('hidden');
    text.textContent = match.lb || buildMatchLabel(match);
  } else {
    card.classList.add('hidden');
    text.textContent = '';
  }
}

function saveStoredMatch(match) {
  const normalized = normalizeImportedMatch(minifyForExport(match));
  if (!normalized) return;

  try {
    localStorage.setItem(`${STORE.matchPrefix}${normalized.id}`, JSON.stringify(minifyForExport(normalized)));
    const idx = getStoredIndex().filter(x => x.id !== normalized.id);
    idx.push({
      id: normalized.id,
      ts: normalized.ts,
      ty: normalized.ty,
      lb: normalized.lb
    });
    idx.sort((a, b) => b.ts - a.ts);
    localStorage.setItem(STORE.index, JSON.stringify(idx));
  } catch (err) {
    console.error(err);
    alert('Could not save the match locally.');
  }
}

function getStoredIndex() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE.index) || '[]');
    if (!Array.isArray(raw)) return [];
    return raw.filter(x => x && typeof x.id === 'string' && typeof x.lb === 'string');
  } catch {
    return [];
  }
}

function getStoredMatch(id) {
  try {
    const raw = localStorage.getItem(`${STORE.matchPrefix}${id}`);
    if (!raw) return null;
    return normalizeImportedMatch(JSON.parse(raw));
  } catch {
    return null;
  }
}

function deleteStoredMatch(id) {
  localStorage.removeItem(`${STORE.matchPrefix}${id}`);
  const next = getStoredIndex().filter(x => x.id !== id);
  localStorage.setItem(STORE.index, JSON.stringify(next));
}

function openModal(title, bodyHtml, actions) {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = bodyHtml;
  const actionsEl = $('#modal-actions');
  actionsEl.innerHTML = '';

  (actions || []).forEach(cfg => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = cfg.cls || 'ghost-btn';
    btn.textContent = cfg.label;
    btn.addEventListener('click', cfg.onClick);
    actionsEl.appendChild(btn);
  });

  $('#modal').classList.remove('hidden');
  $('#modal').setAttribute('aria-hidden', 'false');
}

function closeModal() {
  $('#modal').classList.add('hidden');
  $('#modal').setAttribute('aria-hidden', 'true');
  $('#modal-body').innerHTML = '';
  $('#modal-actions').innerHTML = '';
}

function statCard(k, v) {
  return `
    <div class="stat-card">
      <div class="stat-k">${escapeHtml(k)}</div>
      <div class="stat-v">${escapeHtml(String(v))}</div>
    </div>
  `;
}

function statRow(k, v) {
  return `<div class="stat-row"><span>${escapeHtml(k)}</span><strong>${escapeHtml(String(v))}</strong></div>`;
}

function teamFromPlayer(match, playerIndex) {
  if ((match.tm?.[0] || []).includes(playerIndex)) return 0;
  return 1;
}

function isCorrection(entry) {
  return !!entry && typeof entry === 'object' && !Array.isArray(entry) && Array.isArray(entry.c);
}

function uid() {
  return `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function formatCompactDateTime(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function formatPrettyDateTime(ts) {
  const d = new Date(ts);
  return d.toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatDuration(ms) {
  const mins = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h ${m}m` : `${m} min`;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch]));
}

function escapeAttr(str) {
  return escapeHtml(str);
}

function safeFilename(str) {
  return String(str || 'picklelog-match')
    .replace(/[\\/:*?"<>|]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function downloadText(filename, content, type) {
  const blob = new Blob([content], { type: type || 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 200);
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  ta.remove();
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function wrapText(str, max) {
  const words = String(str).split(/\s+/);
  const lines = [];
  let line = '';

  words.forEach(word => {
    const next = line ? `${line} ${word}` : word;
    if (next.length <= max) {
      line = next;
    } else {
      if (line) lines.push(line);
      line = word;
    }
  });

  if (line) lines.push(line);
  return lines.slice(0, 3).map(x => truncate(x, max));
}

function truncate(str, len) {
  const s = String(str);
  return s.length > len ? `${s.slice(0, len - 1)}…` : s;
}

function svgSafe(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;');
}