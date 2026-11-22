'use strict';

/* ---------- Fechas (días enteros en UTC, sin husos horarios) ---------- */
const DAY = 86400000;
const toDay = (iso) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return NaN;
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY);
};
const fromDay = (n) => new Date(n * DAY).toISOString().slice(0, 10);

/* ---------- Números ---------- */
// Acepta "2.450,50", "2,450.50", "2450.5", "1.250.000"...
function parseAmount(text) {
  const s = String(text).replace(/[^\d.,]/g, '');
  if (!/\d/.test(s)) return null;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  let dec = -1;
  if (lastDot >= 0 && lastComma >= 0) {
    dec = Math.max(lastDot, lastComma);
  } else {
    const pos = Math.max(lastDot, lastComma);
    if (pos >= 0) {
      const sep = s[pos];
      const once = s.indexOf(sep) === pos;
      const digitsAfter = s.length - pos - 1;
      if (once && digitsAfter !== 3) dec = pos; // "1.234" se lee como miles
    }
  }
  const intPart = (dec >= 0 ? s.slice(0, dec) : s).replace(/[.,]/g, '');
  const decPart = dec >= 0 ? s.slice(dec + 1) : '';
  const n = Number((intPart || '0') + (decPart ? '.' + decPart : ''));
  return Number.isFinite(n) ? n : null;
}

// Reparte un total entero según pesos, sin perder ni un centavo (resto mayor).
function allocate(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (total == null || !(sum > 0)) return weights.map(() => null);
  const raw = weights.map((w) => (total * w) / sum);
  const out = raw.map(Math.floor);
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => [r - Math.floor(r), i])
    .sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; left > 0 && k < order.length; k++, left--) out[order[k][1]]++;
  return out;
}

/* ---------- Cálculo ---------- */
function compute(state) {
  const start = toDay(state.checkin);
  const end = toDay(state.checkout);
  const nights = end - start;
  const valid = Number.isFinite(nights) && nights > 0 && nights <= 366;

  const { currency, value } = state.amount;
  const rate = state.rate;
  let totalUsd = null; // en centavos
  let totalClp = null; // en pesos
  if (value != null && value > 0) {
    if (currency === 'usd') {
      totalUsd = Math.round(value * 100);
      if (rate > 0) totalClp = Math.round(value * rate);
    } else {
      totalClp = Math.round(value);
      if (rate > 0) totalUsd = Math.round((value / rate) * 100);
    }
  }

  const occ = valid ? new Array(nights).fill(0) : [];
  const rows = state.members.map((m) => {
    const a = Math.max(start, toDay(m.from));
    const b = Math.min(end, toDay(m.to));
    const n = valid && Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, b - a) : 0;
    for (let d = 0; d < n; d++) occ[a - start + d]++;
    return { id: m.id, a, b, nights: n, weight: 0 };
  });

  const sumNights = rows.reduce((s, r) => s + r.nights, 0);
  const emptyNights = occ.filter((c) => c === 0).length;

  if (state.mode === 'per-night') {
    // Cada noche se divide entre quienes durmieron ahí; las noches sin nadie
    // se reparten según las noches de cada uno.
    rows.forEach((r) => {
      let w = 0;
      for (let d = 0; d < r.nights; d++) w += 1 / occ[r.a - start + d];
      if (sumNights > 0) w += (emptyNights * r.nights) / sumNights;
      r.weight = w;
    });
  } else {
    rows.forEach((r) => { r.weight = r.nights; });
  }

  const weights = rows.map((r) => r.weight);
  const sumW = weights.reduce((a, b) => a + b, 0);
  const usd = allocate(totalUsd, weights);
  const clp = allocate(totalClp, weights);
  rows.forEach((r, i) => {
    r.share = sumW > 0 ? r.weight / sumW : 0;
    r.usd = usd[i];
    r.clp = clp[i];
  });

  return { valid, start, end, nights: valid ? nights : 0, rows, occ, sumNights, emptyNights, totalUsd, totalClp };
}

if (typeof module !== 'undefined') module.exports = { toDay, fromDay, parseAmount, allocate, compute };

/* ---------- Interfaz ---------- */
if (typeof document !== 'undefined') (function () {
  const $ = (sel) => document.querySelector(sel);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  const COLORS = ['#35679B', '#C28A1C', '#3F7D5C', '#7C4A7E', '#2A8C8C', '#B0603A', '#5A6478', '#C2577A'];
  const WEEKDAYS = ['do', 'lu', 'ma', 'mi', 'ju', 'vi', 'sá'];
  const monthFmt = new Intl.DateTimeFormat('es-CL', { month: 'long', timeZone: 'UTC' });
  const dateFmt = new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const num = (n, d = 0) => n.toLocaleString('es-CL', { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmtUsd = (cents) => (cents == null ? '—' : 'US$' + num(cents / 100, 2));
  const fmtClp = (p) => (p == null ? '—' : '$' + num(p));
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  const today = Math.floor(Date.now() / DAY);
  const defaults = () => ({
    checkin: fromDay(today + 14),
    checkout: fromDay(today + 21),
    amount: { currency: 'usd', value: null },
    rate: 950,
    mode: 'proportional',
    members: [],
  });
  const state = defaults();
  let nextId = 1;

  /* ----- Guardado: localStorage y link (#s=...) ----- */
  const STORE_KEY = 'thebridge:v1';
  const isIso = (v) => typeof v === 'string' && Number.isFinite(toDay(v));
  const isBlank = () => state.members.length === 0 && state.amount.value == null;

  const pack = () => ({
    v: 1, i: state.checkin, o: state.checkout,
    c: state.amount.currency, a: state.amount.value, r: state.rate, m: state.mode,
    p: state.members.map((m) => [m.name, m.from, m.to, COLORS.indexOf(m.color)]),
  });
  // Lo que viene de un link o del almacenamiento no es confiable: se valida campo a campo.
  function unpack(o) {
    if (!o || typeof o !== 'object' || o.v !== 1 || !Array.isArray(o.p)) return null;
    const d = defaults();
    const posNum = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
    return {
      checkin: isIso(o.i) ? o.i : d.checkin,
      checkout: isIso(o.o) ? o.o : d.checkout,
      amount: { currency: o.c === 'clp' ? 'clp' : 'usd', value: posNum(o.a) },
      rate: posNum(o.r) || 0,
      mode: o.m === 'per-night' ? 'per-night' : 'proportional',
      members: o.p.slice(0, 50).filter(Array.isArray).map((p, i) => ({
        id: i + 1,
        name: String(p[0] == null ? '' : p[0]).slice(0, 40),
        from: isIso(p[1]) ? p[1] : '',
        to: isIso(p[2]) ? p[2] : '',
        color: COLORS[Number.isInteger(p[3]) && p[3] >= 0 ? p[3] % COLORS.length : i % COLORS.length],
      })),
    };
  }
  const encode = (obj) => {
    let bin = '';
    new TextEncoder().encode(JSON.stringify(obj)).forEach((b) => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const decode = (text) => {
    const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
  };
  const fromHash = () => {
    const m = /^#s=([\w-]+)$/.exec(location.hash);
    if (!m) return null;
    try { return unpack(decode(m[1])); } catch (e) { return null; }
  };
  const fromStorage = () => {
    try { return unpack(JSON.parse(localStorage.getItem(STORE_KEY))); } catch (e) { return null; }
  };
  function adopt(loaded) {
    Object.assign(state, loaded);
    nextId = state.members.length + 1;
  }
  function save() {
    const blank = isBlank();
    try {
      if (blank) localStorage.removeItem(STORE_KEY);
      else localStorage.setItem(STORE_KEY, JSON.stringify(pack()));
    } catch (e) { /* almacenamiento bloqueado o lleno: la app sigue funcionando */ }
    try {
      history.replaceState(null, '', blank ? location.pathname + location.search : '#s=' + encode(pack()));
    } catch (e) { /* idem */ }
  }
  let saveTimer = 0;
  const scheduleSave = () => { clearTimeout(saveTimer); saveTimer = setTimeout(save, 250); };
  window.addEventListener('pagehide', () => { clearTimeout(saveTimer); save(); });

  adopt(fromHash() || fromStorage() || defaults());

  const inCheckin = $('#checkin'), inCheckout = $('#checkout');
  const inUsd = $('#usd'), inClp = $('#clp'), inRate = $('#rate');

  /* ----- Puente del encabezado ----- */
  (function drawBridge() {
    const svg = $('#bridge');
    const deck = 92, top = 14, towers = [300, 900];
    const cable = (x) => {
      // parábolas: tramo central entre torres y dos tramos laterales
      if (x < 300) return top + (deck - 14 - top) * Math.pow((300 - x) / 300, 2);
      if (x > 900) return top + (deck - 14 - top) * Math.pow((x - 900) / 300, 2);
      return top + (deck - 20 - top) * (1 - Math.pow((x - 600) / 300, 2));
    };
    let d = '';
    for (let x = 0; x <= 1200; x += 10) d += (x ? 'L' : 'M') + x + ' ' + cable(x).toFixed(1);
    let hang = '';
    for (let x = 30; x < 1200; x += 30) if (!towers.includes(x)) hang += `M${x} ${cable(x).toFixed(1)}V${deck}`;
    svg.innerHTML =
      `<path d="${hang}" class="b-hang"/><path d="${d}" class="b-cable"/>` +
      towers.map((x) => `<path d="M${x} 6V110" class="b-tower"/>`).join('') +
      `<path d="M0 ${deck}H1200" class="b-deck"/>`;
  })();

  /* ----- Campos del Airbnb ----- */
  function syncMoney() {
    const res = compute(state);
    const set = (input, text) => { if (document.activeElement !== input) input.value = text; };
    set(inUsd, res.totalUsd == null ? '' : num(res.totalUsd / 100, 2));
    set(inClp, res.totalClp == null ? '' : num(res.totalClp));
    set(inRate, state.rate > 0 ? num(state.rate, Number.isInteger(state.rate) ? 0 : 2) : '');
  }

  inCheckin.addEventListener('input', () => {
    const before = toDay(state.checkin), now = toDay(inCheckin.value);
    state.checkin = inCheckin.value;
    // si el check-in pasa al check-out, mueve el check-out conservando el largo
    if (Number.isFinite(now) && now >= toDay(state.checkout)) {
      const len = Math.max(1, toDay(state.checkout) - before) || 7;
      state.checkout = fromDay(now + len);
      inCheckout.value = state.checkout;
    }
    render();
  });
  inCheckout.addEventListener('input', () => { state.checkout = inCheckout.value; render(); });
  inUsd.addEventListener('input', () => { state.amount = { currency: 'usd', value: parseAmount(inUsd.value) }; render(); });
  inClp.addEventListener('input', () => { state.amount = { currency: 'clp', value: parseAmount(inClp.value) }; render(); });
  inRate.addEventListener('input', () => { state.rate = parseAmount(inRate.value) || 0; render(); });
  [inUsd, inClp, inRate].forEach((i) => i.addEventListener('blur', syncMoney));
  document.querySelectorAll('input[name="mode"]').forEach((r) =>
    r.addEventListener('change', () => { state.mode = r.value; render(); }));

  /* ----- Personas ----- */
  $('#add-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#add-name');
    const name = input.value.trim() || `Persona ${state.members.length + 1}`;
    const id = nextId++;
    const used = new Set(state.members.map((m) => m.color));
    const color = COLORS.find((c) => !used.has(c)) || COLORS[(id - 1) % COLORS.length];
    state.members.push({ id, name, color, from: state.checkin, to: state.checkout });
    input.value = '';
    input.focus();
    render();
  });

  const rowsEl = $('#rows');
  rowsEl.addEventListener('input', (e) => {
    const tr = e.target.closest('tr');
    const m = tr && state.members.find((x) => x.id === +tr.dataset.id);
    const field = e.target.dataset.field;
    if (!m || !field) return;
    m[field] = e.target.value;
    render();
  });
  rowsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-remove]');
    if (!btn) return;
    const id = +btn.closest('tr').dataset.id;
    state.members = state.members.filter((m) => m.id !== id);
    render();
  });

  function buildRow(m) {
    const tr = el('tr');
    tr.dataset.id = m.id;
    tr.style.setProperty('--c', m.color);
    const cell = (label, cls) => { const td = el('td', cls); td.dataset.label = label; tr.appendChild(td); return td; };
    const input = (type, field, aria) => {
      const i = el('input');
      i.type = type; i.dataset.field = field; i.setAttribute('aria-label', aria);
      return i;
    };
    const name = cell('Persona', 'c-name');
    name.append(el('span', 'dot'), Object.assign(input('text', 'name', 'Nombre'), { maxLength: 40 }));
    cell('Llega', 'c-date').append(input('date', 'from', 'Día en que llega'));
    cell('Se va', 'c-date').append(input('date', 'to', 'Día en que se va'));
    cell('Noches', 'num o-nights');
    cell('Parte', 'num o-share');
    cell('Dólares', 'num o-usd');
    cell('Pesos', 'num o-clp');
    const rm = el('button', 'remove', '×');
    rm.type = 'button'; rm.dataset.remove = '1';
    cell('', 'c-remove').append(rm);
    return tr;
  }

  function renderTable(res) {
    const ids = new Set(state.members.map((m) => m.id));
    [...rowsEl.children].forEach((tr) => { if (!ids.has(+tr.dataset.id)) tr.remove(); });
    const set = (input, v) => { if (document.activeElement !== input && input.value !== v) input.value = v; };
    state.members.forEach((m, i) => {
      let tr = rowsEl.querySelector(`tr[data-id="${m.id}"]`);
      if (!tr) { tr = buildRow(m); rowsEl.appendChild(tr); }
      const r = res.rows[i];
      const [iName, iFrom, iTo] = tr.querySelectorAll('input');
      set(iName, m.name); set(iFrom, m.from); set(iTo, m.to);
      iFrom.min = iTo.min = state.checkin;
      iFrom.max = iTo.max = state.checkout;
      tr.querySelector('.remove').setAttribute('aria-label', `Quitar a ${m.name}`);
      const nights = tr.querySelector('.o-nights');
      nights.textContent = r.nights;
      nights.classList.toggle('warn', res.valid && r.nights === 0);
      tr.querySelector('.o-share').textContent = r.share ? num(r.share * 100, 1) + '%' : '—';
      tr.querySelector('.o-usd').textContent = fmtUsd(r.usd);
      tr.querySelector('.o-clp').textContent = fmtClp(r.clp);
    });

    const has = state.members.length > 0;
    $('#people').hidden = !has;
    $('#empty').hidden = has;
    $('#t-nights').textContent = res.sumNights;
    $('#t-share').textContent = res.sumNights ? '100%' : '—';
    $('#t-usd').textContent = res.sumNights ? fmtUsd(res.totalUsd) : '—';
    $('#t-clp').textContent = res.sumNights ? fmtClp(res.totalClp) : '—';

    $('#mode-hint').textContent = state.mode === 'per-night'
      ? 'Cada noche cuesta lo mismo y se divide entre quienes durmieron ahí esa noche.'
      : 'Cada uno paga en proporción a sus noches, sin importar con cuántos coincidió.';

    const notes = [];
    if (has && res.valid) {
      if (res.totalUsd == null && res.totalClp == null) notes.push('Ingresa el monto del Airbnb, en dólares o en pesos, para ver cuánto paga cada uno.');
      else if (res.totalUsd == null || res.totalClp == null) notes.push('Falta el tipo de cambio para convertir entre dólares y pesos.');
      if (state.mode === 'proportional' && res.sumNights > 0 && (res.totalUsd != null || res.totalClp != null)) {
        const u = res.totalUsd != null ? fmtUsd(Math.round(res.totalUsd / res.sumNights)) : null;
        const c = res.totalClp != null ? fmtClp(Math.round(res.totalClp / res.sumNights)) : null;
        notes.push(`Cada noche de una persona sale ${[u, c].filter(Boolean).join(' o ')}.`);
      }
      if (res.sumNights > 0 && res.emptyNights > 0) {
        notes.push(`${res.emptyNights === 1 ? 'Hay 1 noche' : `Hay ${res.emptyNights} noches`} sin nadie. Su costo se reparte entre todos según sus noches.`);
      }
      const out = state.members.filter((m, i) => res.rows[i].nights === 0).map((m) => m.name);
      if (out.length) notes.push(`${out.join(', ')} no tiene noches dentro de la estadía. Revisa sus fechas.`);
    }
    const ul = $('#notes');
    ul.replaceChildren(...notes.map((t) => el('li', null, t)));
  }

  /* ----- Calendario ----- */
  const calEl = $('#cal');

  function renderCal(res) {
    calEl.replaceChildren();
    const hint = $('#cal-hint');
    if (!res.valid) {
      calEl.style.removeProperty('--n');
      calEl.append(el('p', 'cal-msg', 'El check-out tiene que ser después del check-in (máximo un año).'));
      hint.textContent = '';
      return;
    }
    const n = res.nights;
    calEl.style.setProperty('--n', n);

    // meses
    calEl.append(el('div', 'corner'));
    for (let d = 0; d < n;) {
      const date = new Date((res.start + d) * DAY);
      const month = date.getUTCMonth();
      let span = 0;
      while (d + span < n && new Date((res.start + d + span) * DAY).getUTCMonth() === month) span++;
      const m = el('div', 'month', span >= 2 ? monthFmt.format(date) : '');
      m.style.gridColumn = `span ${span}`;
      calEl.append(m);
      d += span;
    }

    // días
    calEl.append(el('div', 'corner sub', 'Noche del'));
    for (let d = 0; d < n; d++) {
      const date = new Date((res.start + d) * DAY);
      const wd = date.getUTCDay();
      const h = el('div', 'day' + (wd === 0 || wd === 6 ? ' weekend' : ''));
      h.append(el('small', null, WEEKDAYS[wd]), el('b', null, date.getUTCDate()));
      calEl.append(h);
    }

    // personas
    state.members.forEach((m, i) => {
      const r = res.rows[i];
      const name = el('div', 'who');
      name.style.setProperty('--c', m.color);
      name.append(el('span', 'dot'), el('span', 'who-name', m.name));
      calEl.append(name);
      for (let d = 0; d < n; d++) {
        const day = res.start + d;
        const on = r.nights > 0 && day >= r.a && day < r.b;
        const c = el('div', 'cell' + (on ? ' on' : '') + (on && day === r.a ? ' first' : '') + (on && day === r.b - 1 ? ' last' : ''));
        c.dataset.m = m.id;
        c.dataset.d = day;
        c.style.setProperty('--c', m.color);
        calEl.append(c);
      }
    });

    // ocupación
    if (state.members.length) {
      calEl.append(el('div', 'who occ-label', 'Personas'));
      res.occ.forEach((c) => calEl.append(el('div', 'occ' + (c === 0 ? ' zero' : ''), c)));
      hint.textContent = 'Arrastra sobre la fila de alguien para marcar desde qué noche hasta qué noche se queda. El día en que se va no cuenta como noche.';
    } else {
      hint.textContent = '';
    }
  }

  // Arrastrar para marcar un rango
  let drag = null;
  calEl.addEventListener('pointerdown', (e) => {
    const c = e.target.closest('.cell');
    if (!c || (e.pointerType === 'mouse' && e.button !== 0)) return;
    drag = { id: +c.dataset.m, anchor: +c.dataset.d, moved: false };
    e.preventDefault();
  });
  document.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const c = under && under.closest('.cell');
    if (!c) return;
    const day = +c.dataset.d;
    if (!drag.moved && day === drag.anchor) return;
    drag.moved = true;
    const m = state.members.find((x) => x.id === drag.id);
    if (!m) return;
    const from = fromDay(Math.min(drag.anchor, day));
    const to = fromDay(Math.max(drag.anchor, day) + 1);
    if (from === m.from && to === m.to) return;
    m.from = from; m.to = to;
    render();
  });
  const endDrag = () => { drag = null; };
  document.addEventListener('pointerup', endDrag);
  document.addEventListener('pointercancel', endDrag);

  /* ----- Render ----- */
  function render() {
    const res = compute(state);
    syncMoney();
    const s = $('#stay-summary');
    if (!res.valid) s.textContent = '';
    else {
      const range = `${dateFmt.format(new Date(res.start * DAY))} al ${dateFmt.format(new Date(res.end * DAY))}`;
      const perNight = [
        res.totalUsd != null ? fmtUsd(Math.round(res.totalUsd / res.nights)) : null,
        res.totalClp != null ? fmtClp(Math.round(res.totalClp / res.nights)) : null,
      ].filter(Boolean).join(' o ');
      s.textContent = `${plural(res.nights, 'noche', 'noches')}, del ${range}` + (perNight ? `. La noche sale ${perNight}.` : '.');
    }
    renderCal(res);
    renderTable(res);
    $('#reset').hidden = isBlank();
    scheduleSave();
  }

  // Pone en los campos lo que hay en el estado (al cargar o al abrir otro link).
  function fillInputs() {
    document.activeElement && document.activeElement.blur && document.activeElement.blur();
    inCheckin.value = state.checkin;
    inCheckout.value = state.checkout;
    document.querySelectorAll('input[name="mode"]').forEach((r) => { r.checked = r.value === state.mode; });
    rowsEl.replaceChildren();
    render();
  }

  window.addEventListener('hashchange', () => {
    const loaded = fromHash();
    if (loaded) { adopt(loaded); fillInputs(); }
  });

  const copyBtn = $('#copy-link');
  copyBtn.addEventListener('click', async () => {
    clearTimeout(saveTimer); save();
    let ok = true;
    try { await navigator.clipboard.writeText(location.href); } catch (e) { ok = false; }
    copyBtn.textContent = ok ? 'Link copiado' : 'Copia el link desde la barra de direcciones';
    setTimeout(() => { copyBtn.textContent = 'Copiar link'; }, 2500);
  });
  $('#reset').addEventListener('click', () => {
    if (!confirm('Se borran las personas, las fechas y el monto. ¿Empezar de nuevo?')) return;
    adopt(defaults());
    fillInputs();
  });

  fillInputs();
})();
