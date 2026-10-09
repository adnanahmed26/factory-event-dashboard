const paths = {
  bars: 'M4 20V13M10 20V7M16 20V3M22 20V10',
  document: 'M6 3h12v18H6z M9 7h6 M9 11h6 M9 15h3',
  network: 'M9 3h6v5H9z M3 16h6v5H3z M15 16h6v5h-6z M12 8v4 M6 16v-4h12v4',
  refresh: 'M20 7v5h-5 M4 17v-5h5 M6 6a8 8 0 0 1 14 6 M18 18A8 8 0 0 1 4 12',
  gear: 'M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z M15 12a3 3 0 1 0-6 0 3 3 0 0 0 6 0',
  clock: 'M21 12a9 9 0 1 0-18 0 9 9 0 0 0 18 0 M12 6v6l4 3',
  warning: 'M12 3 2 21h20z M12 9v5 M12 17v1',
  copy: 'M8 7h12v14H8z M15 7V3H3v14h5',
  shuffle: 'M3 6h3l12 12h3 M18 15l3 3-3 3 M3 18h3l12-12h3 M18 3l3 3-3 3',
  check: 'M4 12l5 5L20 6',
  send: 'M22 2 9 15 M22 2l-7 20-6-7-7-6z',
  plus: 'M12 4v16 M4 12h16',
  void: 'M21 12a9 9 0 1 0-18 0 9 9 0 0 0 18 0 M6 6l12 12',
  wifi: 'M3 8a15 15 0 0 1 18 0 M6 12a10 10 0 0 1 12 0 M9 16a5 5 0 0 1 6 0 M12 20h.01',
  chip: 'M6 6h12v12H6z M3 8h3 M3 12h3 M3 16h3 M18 8h3 M18 12h3 M18 16h3 M8 3v3 M12 3v3 M16 3v3 M8 18v3 M12 18v3 M16 18v3',
  key: 'M15 11a5 5 0 1 0-3-5L3 15v6h6v-3h3v-3z',
  message: 'M3 4h18v13H9l-5 4v-4H3z M7 9h.01 M12 9h.01 M17 9h.01',
  list: 'M8 5h13 M8 12h13 M8 19h13 M3 5h.01 M3 12h.01 M3 19h.01',
  info: 'M21 12a9 9 0 1 0-18 0 9 9 0 0 0 18 0 M12 7v7 M12 17h.01',
};
document.querySelectorAll('[data-icon]').forEach((el) => {
  el.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[el.dataset.icon]}"></path></svg>`;
});
const $ = (selector) => document.querySelector(selector);
const store = {
  tab: 'pending',
  nav: 'production',
  source: '',
  selected: new Set(),
  audit: null,
  pending: [],
  exceptions: null,
  device: null,
  rows: [],
  busy: false,
  loading: false,
  refreshId: 0,
};
const escape = (value) =>
  String(value ?? '—').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const date = (value) =>
  value
    ? new Date(value).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : '—';
const badge = (status) =>
  `<span class="badge ${escape(status?.toLowerCase())}">${escape(status)}</span>`;
function notice(message, error = false) {
  const el = $('#notice');
  el.textContent = message;
  el.classList.toggle('error', error);
  el.hidden = !message;
}
async function api(url, body) {
  const response = await fetch(
    url,
    body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'The server could not complete this request.');
  return data;
}
function showDetails(title, data) {
  $('#detail-title').textContent = title;
  $('#detail-json').textContent = JSON.stringify(data, null, 2);
  $('#detail-dialog').showModal();
}
function setTab(tab) {
  store.tab = tab;
  store.selected.clear();
  document.querySelectorAll('[data-tab]').forEach((el) => {
    const active = el.dataset.tab === tab;
    el.classList.toggle('active', active);
    el.setAttribute('aria-selected', String(active));
  });
  renderTable();
}
function renderTable() {
  if (!store.audit) return;
  let rows;
  const auditing = store.nav === 'audit';
  if (auditing)
    rows = store.audit.attempts.map((a) => ({
      ...a,
      status: a.classification,
      quantity: a.normalized_payload?.quantity,
      type: a.normalized_payload?.type || a.raw_payload?.type,
    }));
  else if (store.tab === 'pending') rows = store.pending;
  else if (store.tab === 'all') rows = store.audit.events;
  else {
    const rejectedAttempts = new Set(
      store.exceptions.attempts
        .filter((a) => a.classification === 'REJECTED')
        .map((a) => a.event_id),
    );
    rows = [
      ...store.exceptions.events.filter(
        (e) => e.status === 'PENDING_REFERENCE' || !rejectedAttempts.has(e.event_id),
      ),
      ...store.exceptions.attempts.map((a) => ({
        ...a,
        status: a.classification,
        type: a.normalized_payload?.type || a.raw_payload?.type,
        quantity: a.normalized_payload?.quantity,
      })),
    ];
  }
  store.rows = rows;
  const selectable = !auditing && store.tab === 'pending';
  $('#table-head').innerHTML =
    `<tr><th>${selectable ? '<input type="checkbox" id="select-all" aria-label="Select all pending events">' : ''}</th><th>Event</th><th>Source</th><th>Type</th><th>Quantity</th><th>Status</th><th>Received</th></tr>`;
  $('#table-body').innerHTML = rows
    .map(
      (row, i) =>
        `<tr><td>${selectable ? `<input type="checkbox" data-select="${i}" aria-label="Select ${escape(row.event_id)}" ${store.selected.has(row.event_id) ? 'checked' : ''}>` : ''}</td><td><button class="event-link" data-detail="${i}">${escape(row.event_id)}</button>${row.target_event_id ? `<span class="cell-sub">Reverses ${escape(row.target_event_id)}</span>` : ''}${row.error ? `<span class="cell-sub" title="${escape(row.error)}">${escape(row.error)}</span>` : ''}</td><td>${escape(row.source_id)}</td><td>${escape(row.type)}</td><td>${row.quantity == null ? '—' : escape(row.quantity)}</td><td>${badge(row.status)}${row.acknowledged_at ? '<span class="cell-sub">Acknowledged</span>' : ''}</td><td>${escape(date(row.received_at))}</td></tr>`,
    )
    .join('');
  const empty = $('#empty');
  empty.hidden = rows.length > 0;
  if (!rows.length) {
    empty.querySelector('strong').textContent = auditing
      ? 'No submission attempts yet'
      : store.tab === 'pending'
        ? 'No events waiting for review'
        : store.tab === 'exceptions'
          ? 'No exceptions to resolve'
          : 'No events received yet';
    empty.querySelector('p').textContent =
      store.tab === 'pending' && !auditing
        ? 'Events from connected devices will appear here when they need your attention.'
        : 'Submit an event or connect a device to start building the production ledger.';
  }
  $('#row-count').textContent =
    `${rows.length} ${auditing ? 'submission attempts' : 'events'}${store.selected.size ? ` · ${store.selected.size} selected` : ''}`;
  $('#ack').hidden = auditing || store.tab !== 'pending';
  $('#ack').disabled = !store.selected.size || store.busy || store.loading;
  $('.tabs').hidden = auditing;
  $('#activity-heading').textContent = auditing ? 'Submission audit history' : 'Event activity';
  $('#table-body')
    .querySelectorAll('[data-detail]')
    .forEach((el) =>
      el.addEventListener('click', () =>
        showDetails(
          auditing ? 'Submission attempt' : 'Event details',
          rows[Number(el.dataset.detail)],
        ),
      ),
    );
  $('#table-body')
    .querySelectorAll('[data-select]')
    .forEach((el) =>
      el.addEventListener('change', () => {
        const id = rows[Number(el.dataset.select)].event_id;
        el.checked ? store.selected.add(id) : store.selected.delete(id);
        renderTable();
      }),
    );
  $('#select-all')?.addEventListener('change', (event) => {
    store.selected = event.target.checked ? new Set(rows.map((r) => r.event_id)) : new Set();
    renderTable();
  });
  if ($('#select-all')) {
    $('#select-all').checked = rows.length > 0 && store.selected.size === rows.length;
    $('#select-all').indeterminate = store.selected.size > 0 && store.selected.size < rows.length;
    $('#select-all').disabled = !rows.length;
  }
}
function renderDevice(device) {
  store.device = device;
  const latest = device.challenges[0];
  $('#mqtt-status').textContent = device.status.charAt(0) + device.status.slice(1).toLowerCase();
  $('#candidate').textContent = device.candidate_id;
  $('#last-challenge').textContent = device.last_challenge_id || latest?.challenge_id || '—';
  $('#last-challenge').title = latest ? date(latest.received_at) : '';
  $('#last-response').textContent = device.last_response_status || latest?.status || '—';
  $('#challenge-count').textContent = device.challenge_count;
  $('#last-error').textContent = device.last_error || latest?.response?.error?.code || '—';
  $('#challenges').innerHTML = device.challenges.length
    ? device.challenges
        .map(
          (c, i) =>
            `<div class="challenge-row"><button class="event-link" data-challenge="${i}">${escape(c.challenge_id)}</button><span>${escape(date(c.received_at))}</span>${badge(c.status)}<span>${c.published_at ? 'Published' : 'Awaiting publish'}</span></div>`,
        )
        .join('')
    : 'No challenges received.';
  $('#challenges')
    .querySelectorAll('[data-challenge]')
    .forEach((el) =>
      el.addEventListener('click', () =>
        showDetails('MQTT challenge & response', device.challenges[Number(el.dataset.challenge)]),
      ),
    );
}
async function refresh({ quiet = false } = {}) {
  const refreshId = ++store.refreshId;
  store.loading = true;
  $('#refresh').disabled = true;
  $('#ack').disabled = true;
  $('.metrics').setAttribute('aria-busy', 'true');
  $('.table-container').setAttribute('aria-busy', 'true');
  $('#table-body').hidden = true;
  $('#empty').hidden = false;
  $('#empty strong').textContent = 'Loading events…';
  $('#empty p').textContent = store.source ? `Loading ${store.source}.` : 'Loading all sources.';
  const source = store.source ? `&source_id=${encodeURIComponent(store.source)}` : '';
  try {
    const [summary, pending, exceptions, audit, device] = await Promise.all([
      api('/api/state?view=summary' + source),
      api('/api/state?view=pending' + source),
      api('/api/state?view=exceptions' + source),
      api('/api/audit' + (store.source ? '?source_id=' + encodeURIComponent(store.source) : '')),
      api('/api/device'),
    ]);
    if (refreshId !== store.refreshId) return;
    Object.entries(summary).forEach(([key, value]) => {
      const el = $(`[data-metric="${key}"]`);
      if (el) el.textContent = Number(value).toLocaleString();
    });
    store.pending = pending.events;
    store.exceptions = exceptions;
    store.audit = audit;
    store.selected = new Set(
      [...store.selected].filter((id) => store.pending.some((e) => e.event_id === id)),
    );
    const sourceIds = new Set([
      ...audit.sources.map((s) => s.source_id),
      ...audit.attempts.map((a) => a.source_id).filter(Boolean),
    ]);
    if (store.source) sourceIds.add(store.source);
    $('#source-options').innerHTML = [...sourceIds]
      .sort()
      .map((id) => `<option value="${escape(id)}">${escape(id)}</option>`)
      .join('');
    renderTable();
    renderDevice(device);
    $('#updated').textContent =
      'Updated ' + new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    $('#health-dot').classList.add('online');
    $('#health-text').textContent = 'Backend connected';
    if (!quiet) notice('');
  } catch (error) {
    if (refreshId !== store.refreshId) return;
    notice('Unable to refresh. ' + error.message, true);
    $('#health-dot').classList.remove('online');
    $('#health-text').textContent = 'Backend unavailable';
    document.querySelectorAll('[data-metric]').forEach((el) => (el.textContent = '—'));
    store.audit = null;
    store.rows = [];
    store.selected.clear();
    $('#table-body').innerHTML = '';
    $('#empty strong').textContent = 'Unable to load events';
    $('#empty p').textContent = 'Check the backend connection, then select Refresh.';
    $('#row-count').textContent = 'Unavailable';
  } finally {
    if (refreshId === store.refreshId) {
      store.loading = false;
      $('#refresh').disabled = false;
      $('.metrics').setAttribute('aria-busy', 'false');
      $('.table-container').setAttribute('aria-busy', 'false');
      $('#table-body').hidden = false;
      if (store.audit) renderTable();
    }
  }
}
function sample(type) {
  const id = 'EV-' + Date.now().toString(36).toUpperCase();
  const event = {
    source_id: store.source || 'LINE-01',
    event_id: id,
    type,
    quantity: type === 'COUNT' ? 5 : null,
    target_event_id: null,
    event_time: new Date().toISOString(),
  };
  if (type === 'VOID') {
    const target = store.audit?.events.find(
      (e) =>
        e.type === 'COUNT' &&
        e.status === 'ACCEPTED' &&
        !store.audit.events.some(
          (v) => v.type === 'VOID' && v.status === 'ACCEPTED' && v.target_event_id === e.event_id,
        ),
    );
    event.target_event_id = target?.event_id || 'EV-COUNT-TO-REVERSE';
    event.source_id = target?.source_id || event.source_id;
  }
  $('#payload').value = JSON.stringify(event, null, 2);
}
$('#sample-count').addEventListener('click', () => sample('COUNT'));
$('#sample-void').addEventListener('click', () => sample('VOID'));
$('#refresh').addEventListener('click', () => refresh());
$('#source-filter').addEventListener('submit', (event) => {
  event.preventDefault();
  store.source = $('#source').value.trim();
  $('#source').value = store.source;
  store.selected.clear();
  refresh();
});
$('#clear-source').addEventListener('click', () => {
  $('#source').value = '';
  store.source = '';
  store.selected.clear();
  refresh();
});
document
  .querySelectorAll('[data-tab]')
  .forEach((el) => el.addEventListener('click', () => setTab(el.dataset.tab)));
document.querySelectorAll('[data-tab]').forEach((el) =>
  el.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const tabs = [...document.querySelectorAll('[data-tab]')];
    const next = tabs[(tabs.indexOf(el) + (event.key === 'ArrowRight' ? 1 : 2)) % 3];
    next.focus();
    setTab(next.dataset.tab);
  }),
);
document.querySelectorAll('[data-nav]').forEach((el) =>
  el.addEventListener('click', () => {
    document.querySelectorAll('[data-nav]').forEach((n) => n.classList.toggle('active', n === el));
    if (el.dataset.nav === 'device') {
      $('#device').scrollIntoView({
        behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
      });
      return;
    }
    store.nav = el.dataset.nav;
    store.selected.clear();
    renderTable();
    $('#activity-heading').scrollIntoView({ block: 'nearest' });
  }),
);
$('#event-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (store.busy) return;
  let payload;
  try {
    payload = JSON.parse($('#payload').value);
  } catch {
    notice('Invalid JSON. Check quotes, commas, and brackets before submitting.', true);
    return;
  }
  store.busy = true;
  $('#submit').disabled = true;
  $('#submit').lastChild.textContent = ' Submitting…';
  try {
    const result = await api('/api/events', payload);
    $('#submit-results').hidden = false;
    $('#submit-results').innerHTML =
      result.results
        .map(
          (r) =>
            `<div class="result-item"><strong>${escape(r.event_id || 'Invalid item')}</strong>${badge(r.status)}<p>${escape(r.message)}</p></div>`,
        )
        .join('') || '<p>Empty batch received. No events processed.</p>';
    await refresh({ quiet: true });
    notice(
      `${result.results.length} submission result${result.results.length === 1 ? '' : 's'} recorded.`,
    );
  } catch (error) {
    notice(error.message, true);
  } finally {
    store.busy = false;
    $('#submit').disabled = false;
    $('#submit').lastChild.textContent = ' Submit events';
    renderTable();
  }
});
$('#ack').addEventListener('click', async () => {
  if (store.busy || !store.selected.size) return;
  store.busy = true;
  $('#ack').disabled = true;
  try {
    const result = await api('/api/ack', { event_ids: [...store.selected] });
    store.selected.clear();
    await refresh({ quiet: true });
    notice(result.results.map((r) => `${r.event_id}: ${r.status}`).join(' · '));
  } catch (error) {
    notice(error.message, true);
  } finally {
    store.busy = false;
    renderTable();
  }
});
$('#close-detail').addEventListener('click', () => $('#detail-dialog').close());
$('#close-settings').addEventListener('click', () => $('#settings-dialog').close());
$('#settings').addEventListener('click', () => {
  const candidate = store.device?.candidate_id || '10';
  $('#settings-text').textContent =
    `MQTT_ENABLED=true\nCANDIDATE_ID=${candidate}\nMQTT_URL=mqtt://152.42.238.142:1883\n\nSubscribe: fse-01/${candidate}/challenge\nPublish:   fse-01/${candidate}/response\nStatus:    fse-01/${candidate}/status`;
  $('#settings-dialog').showModal();
});
sample('COUNT');
refresh();
setInterval(() => {
  if (!store.busy && !store.loading && !document.hidden) refresh({ quiet: true });
}, 15000);
