import { drawIndex } from '/lib/logic.js';

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  // popover : passe au-dessus des boîtes de dialogue ouvertes
  try { t.hidePopover(); t.showPopover(); } catch { t.style.display = 'block'; }
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { try { t.hidePopover(); } catch { t.style.display = ''; } }, 2200);
}
const $ = (s, r = document) => r.querySelector(s);
const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  for (const k of kids.flat()) if (k != null) e.append(k);
  return e;
};

async function api(path, method = 'GET', body) {
  const res = await fetch('/api/' + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Erreur ' + res.status);
  return res.status === 204 ? null : res.json();
}

const state = { slots: [], kinds: [], seasons: [], meals: [], plan: [], planned: [], cal: { y: new Date().getFullYear(), m: new Date().getMonth(), sel: null }, editing: null };
const slotLabel = (id) => state.slots.find((s) => s.id === id)?.label || id;
const SEASON_BY_MONTH = ['hiver', 'hiver', 'printemps', 'printemps', 'printemps', 'ete', 'ete', 'ete', 'automne', 'automne', 'automne', 'hiver'];
const mealInSeason = (m, date) => !m.seasons?.length || m.seasons.includes(SEASON_BY_MONTH[parse(date).getMonth()]);
const seasonLabel = (id) => state.seasons.find((s) => s.id === id)?.label || id;
const kindOf = (m) => m.kind || 'complet';
const pad = (n) => String(n).padStart(2, '0');
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => isoDate(new Date());
const DAY_IDS = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];
const parse = (str) => new Date(str + 'T12:00:00');
const slotsForDate = (str) => state.slots.filter((s) => s.id.split('-')[0] === DAY_IDS[parse(str).getDay()]);
const fullDate = (str) => parse(str).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

function agoText(dateStr) {
  if (!dateStr) return 'jamais mangé';
  const d = Math.floor((new Date(today()) - new Date(dateStr)) / 86400000);
  if (d <= 0) return "mangé aujourd'hui";
  if (d === 1) return 'mangé hier';
  if (d < 14) return `mangé il y a ${d} jours`;
  if (d < 60) return `mangé il y a ${Math.round(d / 7)} semaines`;
  return `mangé il y a ${Math.round(d / 30)} mois`;
}

// ---------- Onglets ----------
document.querySelectorAll('nav button').forEach((b) =>
  b.addEventListener('click', () => {
    document.querySelectorAll('nav button').forEach((x) => x.classList.toggle('active', x === b));
    for (const t of ['calendar', 'meals', 'shopping']) $('#tab-' + t).hidden = t !== b.dataset.tab;
    ({ calendar: renderCalendar, meals: renderMeals, shopping: renderShopping })[b.dataset.tab]();
  }),
);

const kindLabel = (id) => state.kinds.find((k) => k.id === id)?.label || 'Repas complet';
const kindIcon = { complet: '🍽️', viande: '🥩', accompagnement: '🥗' };

// ---------- Repas ----------
async function refreshMeals() {
  state.meals = (await api('meals')).meals;
  state.plan = (await api('plan')).plan;
  state.planned = (await api('planned')).planned;
  updateCartCount();
}

function renderMeals() {
  const q = $('#filter').value.trim().toLowerCase();
  const list = $('#meal-list');
  list.replaceChildren();
  const kind = $('#kind-filter').value;
  const meals = state.meals.filter((m) => m.name.toLowerCase().includes(q) && (!kind || kindOf(m) === kind)).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  if (!meals.length) list.append(el('li', { className: 'empty' }, 'Aucun repas pour le moment.'));
  for (const m of meals) {
    list.append(el('li', {},
      el('strong', {}, `${kindIcon[kindOf(m)]} ${m.name}`),
      el('div', { className: 'meta' }, `${kindLabel(kindOf(m))} · ${agoText(m.lastEaten)}`),
      el('div', { className: 'tags' }, m.seasons?.length ? el('span', { className: 'season' }, m.seasons.map(seasonLabel).join(' · ')) : null, m.slots.map((s) => el('span', {}, slotLabel(s)))),
      m.ingredients.length ? el('div', { className: 'meta' }, m.ingredients.map((i) => i.name).join(', ')) : null,
      el('div', { className: 'actions' },
        el('button', { onclick: async () => { await api(`meals/${m.id}/eaten`, 'POST', {}); await refreshMeals(); renderMeals(); } }, 'Mangé aujourd\'hui'),
        el('button', { onclick: () => openDialog(m) }, 'Modifier'),
        el('button', { className: 'danger', onclick: async () => { if (confirm(`Supprimer « ${m.name} » ?`)) { await api(`meals/${m.id}`, 'DELETE'); await refreshMeals(); renderMeals(); } } }, 'Supprimer'),
      ),
    ));
  }
}
$('#filter').addEventListener('input', renderMeals);
$('#kind-filter').addEventListener('change', renderMeals);

// ---------- Formulaire ----------
const dialog = $('#meal-dialog');
const form = $('#meal-form');

// Entrée dans un ingrédient : nom → quantité → ingrédient suivant (une ligne vide n'est jamais ajoutée).
function addIngredientRow(ing = { name: '', qty: '' }) {
  const name = el('input', { placeholder: 'Ingrédient', value: ing.name, name: 'ing-name', enterKeyHint: 'next' });
  const qty = el('input', { placeholder: 'Quantité (ex. 500 g)', value: ing.qty, name: 'ing-qty', enterKeyHint: 'next' });
  const row = el('div', { className: 'ing-row' }, name, qty,
    el('button', { type: 'button', title: 'Retirer', onclick: () => row.remove() }, '✕'));
  name.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault(); // ne pas envoyer tout le formulaire
    if (name.value.trim()) qty.focus();
  });
  qty.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (!name.value.trim()) return name.focus();
    const next = row.nextElementSibling;
    if (next) next.querySelector('input').focus();
    else addIngredientRow().querySelector('input').focus();
  });
  $('#ingredients').append(row);
  return row;
}

function openDialog(meal) {
  state.editing = meal?.id || null;
  $('#dialog-title').textContent = meal ? 'Modifier le repas' : 'Nouveau repas';
  form.name.value = meal?.name || '';
  form.kind.value = meal ? kindOf(meal) : 'complet';
  form.lastEaten.value = meal?.lastEaten || '';
  form.notes.value = meal?.notes || '';
  $('#season-checks').replaceChildren(...state.seasons.map((s) =>
    el('label', {}, el('input', { type: 'checkbox', value: s.id, checked: !!meal?.seasons?.includes(s.id) }), s.label)));
  $('#slot-checks').replaceChildren(...state.slots.map((s) =>
    el('label', {}, el('input', { type: 'checkbox', value: s.id, checked: meal ? meal.slots.includes(s.id) : false }), s.label)));
  $('#ingredients').replaceChildren();
  (meal?.ingredients.length ? meal.ingredients : [{ name: '', qty: '' }]).forEach(addIngredientRow);
  dialog.showModal();
}

$('#add-meal').addEventListener('click', () => openDialog(null));
$('#add-ingredient').addEventListener('click', () => addIngredientRow());
$('#cancel').addEventListener('click', () => dialog.close());
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    name: form.name.value,
    kind: form.kind.value,
    lastEaten: form.lastEaten.value,
    notes: form.notes.value,
    slots: [...document.querySelectorAll('#slot-checks input:checked')].map((i) => i.value),
    seasons: [...document.querySelectorAll('#season-checks input:checked')].map((i) => i.value),
    ingredients: [...document.querySelectorAll('.ing-row')].map((r) => ({ name: r.children[0].value, qty: r.children[1].value })),
  };
  try {
    await (state.editing ? api(`meals/${state.editing}`, 'PUT', payload) : api('meals', 'POST', payload));
    dialog.close();
    await refreshMeals();
    renderMeals();
  } catch (err) { toast(err.message); }
});


// ---------- Calendrier ----------
const mealById = (id) => state.meals.find((m) => m.id === id);
const entryNames = (e) => e.mealIds.map((id) => mealById(id)?.name).filter(Boolean).join(' + ');
const CAL_WEEKS_BACK = 2, CAL_WEEKS_AHEAD = 10, CAL_STEP = 6;
const cal = { from: -CAL_WEEKS_BACK, to: CAL_WEEKS_AHEAD, placed: false, busy: false };
const scroller = $('#cal-scroll');

function mondayOfThisWeek() {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}
const shortDay = (d) => d.toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', '');
const shortRange = (a, b) => {
  const m = (d) => d.toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '');
  return a.getMonth() === b.getMonth() ? `${a.getDate()} – ${b.getDate()} ${m(b)}` : `${a.getDate()} ${m(a)} – ${b.getDate()} ${m(b)}`;
};

function dayColumn(d) {
  const date = isoDate(d);
  const weekend = d.getDay() === 0 || d.getDay() === 6;
  const col = el('div', { className: ['cal-day', weekend ? 'weekend' : '', date === today() ? 'today' : '', date < today() ? 'past' : ''].join(' ').trim() },
    el('div', { className: 'cal-day-head' },
      el('span', { className: 'dow' }, shortDay(d)),
      el('span', { className: 'num' }, String(d.getDate())),
      d.getDate() === 1 ? el('span', { className: 'mon' }, d.toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '')) : null));
  for (const slot of slotsForDate(date)) {
    const e = state.planned.find((p) => p.date === date && p.slot === slot.id);
    const label = slot.id.endsWith('midi') ? 'Midi' : 'Soir';
    col.append(e
      ? el('button', { className: 'cal-slot filled' + (e.done ? ' done' : ''), type: 'button', onclick: () => openPlanDialog({ date, slot: slot.id, meals: e.mealIds.map(mealById).filter(Boolean), entry: e }) },
        el('span', { className: 'slot-label' }, label + (e.done ? ' ✓' : '')), el('span', { className: 'slot-meal' }, entryNames(e) || 'Repas supprimé'))
      : el('button', { className: 'cal-slot empty', type: 'button', onclick: () => openPlanDialog({ date, slot: slot.id, meals: [] }) },
        el('span', { className: 'slot-label' }, label), el('span', { className: 'slot-meal' }, '+')));
  }
  return col;
}

function renderCalendar() {
  const keep = scroller.scrollLeft;
  const monday = mondayOfThisWeek();
  const strip = $('#cal-strip');
  strip.replaceChildren();
  for (let w = cal.from; w <= cal.to; w++) {
    const start = new Date(monday); start.setDate(start.getDate() + w * 7);
    const end = new Date(start); end.setDate(end.getDate() + 6);
    const week = el('section', { className: 'cal-week' + (w === 0 ? ' current' : '') },
      el('h3', {}, w === 0 ? 'Cette semaine · ' : '', shortRange(start, end)));
    const days = el('div', { className: 'cal-days' });
    for (let i = 0; i < 7; i++) { const d = new Date(start); d.setDate(d.getDate() + i); days.append(dayColumn(d)); }
    week.append(days);
    strip.append(week);
  }
  scroller.scrollLeft = keep;
  if (!cal.placed) { cal.placed = true; scrollToToday(false); }
}

function scrollToToday(smooth = true) {
  const col = $('#cal-strip .cal-day.today');
  if (!col) return;
  const gutter = parseFloat(getComputedStyle(scroller).paddingLeft) || 0;
  const delta = col.getBoundingClientRect().left - scroller.getBoundingClientRect().left - gutter;
  // Un défilement animé sur une longue distance serait coupé par l'ajout de semaines : on saute.
  const near = Math.abs(delta) < scroller.clientWidth * 3;
  scroller.scrollTo({ left: scroller.scrollLeft + delta, behavior: smooth && near ? 'smooth' : 'auto' });
}

// Défilement continu : on ajoute des semaines quand on approche d'un bord.
scroller.addEventListener('scroll', () => {
  if (cal.busy) return;
  const weekW = $('#cal-strip').children[1]?.offsetLeft - $('#cal-strip').children[0]?.offsetLeft || 1;
  if (scroller.scrollLeft < weekW) {
    cal.busy = true;
    const keep = scroller.scrollLeft;
    cal.from -= CAL_STEP;
    renderCalendar();
    scroller.scrollLeft = keep + weekW * CAL_STEP;
    cal.busy = false;
  } else if (scroller.scrollLeft + scroller.clientWidth > scroller.scrollWidth - weekW) {
    cal.busy = true;
    cal.to += CAL_STEP;
    renderCalendar();
    cal.busy = false;
  }
}, { passive: true });
$('#cal-today').addEventListener('click', () => scrollToToday());

// ---------- Roulettes (scroll vertical infini) ----------
const ROW = () => parseFloat(getComputedStyle(document.documentElement).fontSize) * 3.6; // même hauteur que --row
const COPIES = 5;

/**
 * Roulette verticale infinie : la liste est répétée 5 fois et on se recentre
 * sur la copie du milieu quand le défilement s'arrête.
 * items : [{ id, label, meta }] ; l'élément au centre est la sélection.
 */
function createReel(box, items, selectedId, onChange) {
  const n = items.length;
  box.replaceChildren();
  box.dataset.count = n;
  if (!n) return { value: () => null, spin() {}, items };
  for (let c = 0; c < COPIES; c++)
    items.forEach((it, i) => box.append(el('div', { className: 'reel-item', onclick: () => { if (!box.dataset.moved) box.scrollTo({ top: (c * n + i) * ROW(), behavior: 'smooth' }); } },
      el('span', { className: 'ri-label' }, it.label), it.meta ? el('span', { className: 'ri-meta' }, it.meta) : null)));
  const index = () => Math.round(box.scrollTop / ROW());
  const value = () => items[((index() % n) + n) % n].id;
  const jump = (idx) => { box.style.scrollSnapType = 'none'; box.scrollTop = idx * ROW(); box.style.scrollSnapType = ''; };
  let timer;
  box.onscroll = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      target = null;
      if (dragging) return;
      const idx = index();
      if (idx < n || idx >= (COPIES - 1) * n) jump(2 * n + (((idx % n) + n) % n));
      onChange?.(value());
    }, 140);
  };
  // Souris : molette (un cran par défilement), glisser-déposer, flèches du clavier. Le tactile garde le défilement natif.
  let target = null, dragging = false, lastWheel = 0;
  const step = (dir) => { target = (target ?? index()) + dir; box.scrollTo({ top: target * ROW(), behavior: 'smooth' }); };
  box.onwheel = (e) => {
    e.preventDefault();
    const now = performance.now();
    if (!e.deltaY || now - lastWheel < 80) return;
    lastWheel = now;
    step(Math.sign(e.deltaY));
  };
  box.onkeydown = (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    step(e.key === 'ArrowDown' ? 1 : -1);
  };
  box.onpointerdown = (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    dragging = true;
    box.dataset.moved = '';
    const y0 = e.clientY, top0 = box.scrollTop;
    box.setPointerCapture(e.pointerId);
    box.style.scrollSnapType = 'none';
    box.classList.add('dragging');
    box.onpointermove = (m) => {
      if (Math.abs(m.clientY - y0) > 4) box.dataset.moved = '1';
      box.scrollTop = top0 - (m.clientY - y0);
    };
    box.onpointerup = box.onpointercancel = () => {
      dragging = false;
      box.onpointermove = box.onpointerup = box.onpointercancel = null;
      box.classList.remove('dragging');
      const snapped = Math.round(box.scrollTop / ROW()) * ROW();
      box.scrollTo({ top: snapped, behavior: 'smooth' });
      setTimeout(() => { box.style.scrollSnapType = ''; }, 300);
    };
  };
  const start = Math.max(0, items.findIndex((it) => it.id === selectedId));
  requestAnimationFrame(() => { jump(2 * n + start); onChange?.(value()); });
  return {
    value,
    items,
    spin(target = Math.floor(Math.random() * n)) {
      let idx = Math.floor(index() / n) * n + target;
      while (idx <= index() + n) idx += n; // au moins un tour complet
      if (idx >= COPIES * n) idx -= n;
      box.scrollTo({ top: idx * ROW(), behavior: 'smooth' });
    },
  };
}

// ---------- Planification d'un repas à une date ----------
const planDialog = $('#plan-dialog');
const planForm = $('#plan-form');
const plan = { ctx: null, main: null, side: null };

const fold = (str) => str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const reelItem = (m) => ({ id: m.id, label: `${kindIcon[kindOf(m)]} ${m.name}`, meta: agoText(m.lastEaten) });

function buildReels(keepMain, keepSide) {
  const { slot, date } = plan.ctx;
  const unlocked = $('#plan-unlock').checked;
  const pool = (kinds) => state.meals
    .filter((m) => kinds.includes(kindOf(m)) && (unlocked || (m.slots.includes(slot) && mealInSeason(m, date))))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  // Recherche : une roulette sans aucun résultat garde sa liste complète
  // (chercher « poulet » ne vide pas les accompagnements).
  const q = fold($('#reel-search').value.trim());
  const matches = (list) => (q ? list.filter((m) => fold(m.name).includes(q)) : list);
  const narrow = (list) => (matches(list).length ? matches(list) : list);
  const mains = narrow(pool(['complet', 'viande']));
  const sides = narrow(pool(['accompagnement']));
  const found = matches(pool(['complet', 'viande'])).length + matches(pool(['accompagnement'])).length;
  let hidden = 0;
  if (q && !found && !unlocked) {
    const all = state.meals.filter((m) => matches([m]).length);
    hidden = all.length;
  }
  $('#reel-note').textContent = hidden
    ? `${hidden} repas correspondent à « ${$('#reel-search').value.trim()} » mais ne sont pas prévus pour ce moment ou cette saison. Coche « Débloquer » pour les voir.`
    : q && !found ? `Aucun repas ne correspond à « ${$('#reel-search').value.trim()} ».`
    : !mains.length ? 'Aucun plat prévu pour ce moment et cette saison. Débloque en bas pour voir tous les repas.'
    : 'Seuls les repas prévus pour ce moment et cette saison tournent. Un repas complet désactive l\'accompagnement.';
  plan.main = createReel($('#reel-main'), mains.map(reelItem), keepMain, syncSide);
  // Pas de « sans » : une viande doit toujours avoir son accompagnement.
  plan.side = createReel($('#reel-side'), sides.map(reelItem), keepSide, null);
  if (!sides.length) $('#reel-side').append(el('p', { className: 'reel-empty' }, 'Aucun accompagnement pour ce moment'));
  syncSide();
}

// Un repas complet à gauche désactive la roulette de droite.
function syncSide() {
  const main = mealById(plan.main?.value());
  const off = !!main && kindOf(main) === 'complet';
  $('#col-side').classList.toggle('disabled', off);
  $('#spin-side').disabled = off;
}

function openPlanDialog({ date, slot, meals, entry = null }) {
  if (!state.meals.length) return toast("Ajoute d'abord des repas.");
  const label = state.slots.find((s) => s.id === slot)?.label.split(' ').pop();
  plan.ctx = { date, slot, entry };
  $('#reel-search').value = '';
  $('#plan-when').textContent = `${fullDate(date)} · ${label}`;
  $('#plan-title').textContent = entry ? 'Repas planifié' : 'Planifier un repas';
  $('#plan-entry-actions').hidden = !entry;
  $('#plan-save-eaten').hidden = date > today() || !!entry?.done; // « mangé » seulement pour aujourd'hui ou le passé
  $('#plan-unlock').checked = meals.some((m) => !m.slots.includes(slot) || !mealInSeason(m, date)); // un repas planifié hors cadre reste affiché
  planDialog.showModal();
  buildReels(meals.find((m) => kindOf(m) !== 'accompagnement')?.id, meals.find((m) => kindOf(m) === 'accompagnement')?.id);
}

async function afterPlanChange() {
  planDialog.close();
  await refreshMeals();
  renderCalendar();
}

let searchTimer;
$('#reel-search').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => buildReels(plan.main.value(), plan.side.value()), 150);
});
$('#reel-search').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
$('#plan-unlock').addEventListener('change', () => buildReels(plan.main.value(), plan.side.value()));
function spinWeighted() {
  const pick = (reel) => reel.spin(drawIndex(reel.items.map((it) => mealById(it.id)).filter(Boolean)));
  pick(plan.main);
  if (!$('#col-side').classList.contains('disabled') && plan.side.items.length) pick(plan.side);
}
$('#spin-weighted').addEventListener('click', spinWeighted);
$('#spin-main').addEventListener('click', () => plan.main.spin());
$('#spin-side').addEventListener('click', () => plan.side.spin());
$('#spin-all').addEventListener('click', () => { plan.main.spin(); if (!$('#col-side').classList.contains('disabled')) plan.side.spin(); });
$('#plan-cancel').addEventListener('click', () => planDialog.close());
$('#plan-remove').addEventListener('click', async () => { await api(`planned/${plan.ctx.entry.id}`, 'DELETE'); afterPlanChange(); });

// Enregistre le repas choisi (remplace l'éventuel repas du même créneau).
async function savePlan() {
  const main = plan.main.value();
  if (!main) throw new Error('Aucun plat à planifier.');
  const side = $('#col-side').classList.contains('disabled') ? null : plan.side.value();
  return api('planned', 'POST', { date: plan.ctx.date, slot: plan.ctx.slot, mealIds: [main, side].filter(Boolean) });
}

planForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await savePlan();
    toast('Planifié et ajouté aux courses');
    await afterPlanChange();
  } catch (err) { toast(err.message); }
});
$('#plan-save-eaten').addEventListener('click', async () => {
  try {
    const entry = await savePlan();
    await api(`planned/${entry.id}/eaten`, 'POST', {});
    toast('Noté comme mangé');
    await afterPlanChange();
  } catch (err) { toast(err.message); }
});

// ---------- Courses ----------
async function setPlanned(id, on) {
  const set = new Set(state.plan);
  on ? set.add(id) : set.delete(id);
  state.plan = (await api('plan', 'PUT', { plan: [...set] })).plan;
  updateCartCount();
}

function updateCartCount() {
  const c = $('#cart-count');
  const n = new Set([...state.plan, ...upcomingPlanned().flatMap((p) => p.mealIds)]).size;
  c.hidden = !n;
  c.textContent = n;
}

let lastItems = [];
function upcomingPlanned() {
  return state.planned.filter((p) => p.date >= today() && !p.done);
}

async function renderShopping() {
  const up = upcomingPlanned().length;
  $('#planned-hint').textContent = up
    ? `${up} repas planifié${up > 1 ? 's' : ''} à venir : leurs ingrédients sont déjà dans la liste. Tu peux ajouter d'autres repas ci-dessous.`
    : 'Planifie des repas dans le calendrier : leurs ingrédients arrivent ici tout seuls. Tu peux aussi cocher des repas ci-dessous.';
  const plan = $('#plan-list');
  plan.replaceChildren(...[...state.meals].sort((a, b) => a.name.localeCompare(b.name, 'fr')).map((m) => {
    const cb = el('input', { type: 'checkbox', checked: state.plan.includes(m.id), onchange: async () => { await setPlanned(m.id, cb.checked); renderShopping(); } });
    return el('li', {}, el('label', { className: cb.checked ? 'on' : '' }, cb, m.name));
  }));
  if (!state.meals.length) plan.append(el('li', { className: 'empty' }, 'Ajoute d\'abord des repas.'));

  const { items } = await api('shopping');
  lastItems = items;
  const ul = $('#shopping-list');
  ul.replaceChildren();
  if (!items.length) ul.append(el('li', { className: 'empty' }, 'Rien à acheter pour l\'instant.'));
  for (const it of items) {
    const cb = el('input', { type: 'checkbox', checked: it.checked, onchange: async () => {
      const keys = lastItems.filter((x) => x.key === it.key ? cb.checked : x.checked).map((x) => x.key);
      await api('shopping/checked', 'PUT', { checked: keys });
      renderShopping();
    } });
    ul.append(el('li', { className: it.checked ? 'done' : '' }, cb,
      el('span', { className: 'label' }, el('span', { className: 'qty' }, it.qty ? it.qty + ' ' : ''), it.name,
        el('div', { className: 'meta' }, it.whole ? 'Repas entier, sans ingrédients' : it.meals.join(', ')))));
  }
}

$('#copy-list').addEventListener('click', async () => {
  const text = lastItems.filter((i) => !i.checked).map((i) => `- ${i.qty ? i.qty + ' ' : ''}${i.name}`).join('\n');
  try { await navigator.clipboard.writeText(text); toast('Liste copiée'); } catch { prompt('Copie la liste :', text); }
});
$('#clear-checked').addEventListener('click', async () => {
  await api('shopping/checked', 'PUT', { checked: [] });
  renderShopping();
});
$('#clear-plan').addEventListener('click', async () => {
  state.plan = (await api('plan', 'PUT', { plan: [] })).plan;
  await api('shopping/checked', 'PUT', { checked: [] });
  updateCartCount();
  renderShopping();
});

// ---------- Démarrage ----------
(async () => {
  const { slots, kinds, seasons } = await api('slots');
  state.slots = slots;
  state.seasons = seasons;
  state.kinds = kinds;
  for (const sel of [form.kind, $('#kind-filter')]) sel.append(...kinds.map((k) => el('option', { value: k.id }, k.label)));
  await refreshMeals();
  renderCalendar();
})();
