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

const state = { slots: [], kinds: [], meals: [], plan: [], planned: [], cal: { y: new Date().getFullYear(), m: new Date().getMonth(), sel: null }, editing: null, excluded: [], forced: null, keep: null };
const slotLabel = (id) => state.slots.find((s) => s.id === id)?.label || id;
const kindOf = (m) => m.kind || 'complet';
const pad = (n) => String(n).padStart(2, '0');
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => isoDate(new Date());
const DAY_IDS = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];
const parse = (str) => new Date(str + 'T12:00:00');
const slotsForDate = (str) => state.slots.filter((s) => s.id.split('-')[0] === DAY_IDS[parse(str).getDay()]);
function nextDateForSlot(slot) {
  const d = new Date();
  d.setHours(12);
  for (let i = 0; i < 7 && DAY_IDS[d.getDay()] !== slot.split('-')[0]; i++) d.setDate(d.getDate() + 1);
  return isoDate(d);
}
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
    for (const t of ['choose', 'calendar', 'meals', 'shopping']) $('#tab-' + t).hidden = t !== b.dataset.tab;
    ({ choose: loadSuggestion, calendar: () => { renderCalendar(); }, meals: renderMeals, shopping: renderShopping })[b.dataset.tab]();
  }),
);

// ---------- Choisir ----------
const kindLabel = (id) => state.kinds.find((k) => k.id === id)?.label || 'Repas complet';
const kindIcon = { complet: '🍽️', viande: '🥩', accompagnement: '🥗' };
const names = (p) => p.meals.map((m) => m.name).join(' + ');

async function loadSuggestion() {
  const slot = $('#slot-select').value;
  const keep = state.keep ? `&keep=${state.keep}` : '';
  const data = await api(`suggest?slot=${slot}&exclude=${state.excluded.join(',')}${keep}`);
  const forced = state.forced && [data.main, ...data.alternatives].find((x) => x?.key === state.forced);
  if (forced) {
    // Une alternative choisie passe en tête ; l'ancienne proposition reste proposée.
    data.alternatives = [data.main, ...data.alternatives].filter((x) => x && x.key !== forced.key).slice(0, 3);
    data.main = forced;
  }
  const box = $('#suggestion');
  box.replaceChildren();
  if (!data.main) {
    box.append(el('p', { className: 'empty' }, state.excluded.length || state.keep
      ? "Plus d'autres idées pour ce moment."
      : `Aucun repas adapté à « ${slotLabel(slot)} ». Ajoute-en dans l'onglet Repas ! (une viande et un accompagnement se combinent tout seuls)`));
    if (state.excluded.length || state.keep) box.append(el('button', { onclick: () => reset(true) }, 'Recommencer'));
    return;
  }
  const p = data.main;
  const duo = p.meals.length === 2;
  box.append(
    el('div', { className: 'big' },
      el('div', { className: 'meta' }, `Proposition pour ${slotLabel(slot).toLowerCase()}`),
      p.meals.map((m) => el('div', { className: 'proposal-item' },
        el('h2', {}, `${kindIcon[kindOf(m)]} ${m.name}`),
        el('div', { className: 'meta' }, (duo ? kindLabel(kindOf(m)) + ' · ' : '') + agoText(m.lastEaten)),
        m.ingredients.length ? el('div', { className: 'meta' }, m.ingredients.map((i) => (i.qty ? `${i.qty} ` : '') + i.name).join(', ')) : null)),
      el('div', { className: 'actions' },
        el('button', { className: 'primary', onclick: async () => { await Promise.all(p.meals.map((m) => api(`meals/${m.id}/eaten`, 'POST', {}))); reset(false); await refreshMeals(); loadSuggestion(); } }, '✅ On mange ça !'),
        el('button', { onclick: () => { state.excluded.push(p.key); state.keep = null; state.forced = null; loadSuggestion(); } }, '🎲 Autre idée'),
        duo ? p.meals.map((m) => el('button', { onclick: () => { state.excluded.push(p.key); state.keep = p.meals.find((x) => x.id !== m.id).id; state.forced = null; loadSuggestion(); } }, `🔄 Autre ${kindOf(m) === 'viande' ? 'viande' : 'accompagnement'}`)) : null,
        el('button', { onclick: () => openPlanDialog({ date: nextDateForSlot(slot), slot, meals: p.meals }) }, '📅 Planifier'),
        el('button', { onclick: async () => { for (const m of p.meals) await setPlanned(m.id, true); toast('Ajouté aux courses'); } }, '🛒 Courses seulement'),
      ),
    ),
  );
  if (data.alternatives.length) {
    box.append(el('div', { className: 'alts' }, el('h3', {}, 'Autres idées'),
      data.alternatives.map((a) => el('button', { onclick: () => { state.forced = a.key; loadSuggestion(); } }, names(a)))));
  }
}

function reset(reload) {
  state.excluded = []; state.keep = null; state.forced = null;
  if (reload) loadSuggestion();
}

$('#slot-select').addEventListener('change', () => reset(true));

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
      el('div', { className: 'tags' }, m.slots.map((s) => el('span', {}, slotLabel(s)))),
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

function addIngredientRow(ing = { name: '', qty: '' }) {
  $('#ingredients').append(el('div', { className: 'ing-row' },
    el('input', { placeholder: 'Ingrédient', value: ing.name, name: 'ing-name' }),
    el('input', { placeholder: 'Quantité (ex. 500 g)', value: ing.qty, name: 'ing-qty' }),
    el('button', { type: 'button', title: 'Retirer', onclick: (e) => e.target.parentElement.remove() }, '✕'),
  ));
}

function openDialog(meal) {
  state.editing = meal?.id || null;
  $('#dialog-title').textContent = meal ? 'Modifier le repas' : 'Nouveau repas';
  form.name.value = meal?.name || '';
  form.kind.value = meal ? kindOf(meal) : 'complet';
  form.lastEaten.value = meal?.lastEaten || '';
  form.notes.value = meal?.notes || '';
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

// Planification d'un repas à une date
const planDialog = $('#plan-dialog');
const planForm = $('#plan-form');
let editingEntry = null;

function fillSlots(selected) {
  planForm.slot.replaceChildren(...slotsForDate(planForm.date.value).map((s) => el('option', { value: s.id, selected: s.id === selected }, s.label)));
  fillMeals();
}

function mealOptions(select, kinds, current, optional) {
  const slot = planForm.slot.value;
  const list = state.meals.filter((m) => kinds.includes(kindOf(m))).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const group = (label, items) => items.length ? el('optgroup', { label }, items.map((m) => el('option', { value: m.id, selected: m.id === current }, m.name))) : null;
  select.replaceChildren(optional ? el('option', { value: '' }, '— aucun —') : null,
    group('Adaptés à ce moment', list.filter((m) => m.slots.includes(slot))),
    group('Autres', list.filter((m) => !m.slots.includes(slot))));
}

function fillMeals(meals = null) {
  const cur = meals || [mealById(planForm.main.value), mealById(planForm.side.value)].filter(Boolean);
  mealOptions(planForm.main, ['complet', 'viande'], (cur.find((m) => kindOf(m) !== 'accompagnement') || {}).id, false);
  mealOptions(planForm.side, ['accompagnement'], (cur.find((m) => kindOf(m) === 'accompagnement') || {}).id, true);
}

function openPlanDialog({ date, slot, meals, entry = null }) {
  if (!state.meals.length) return toast("Ajoute d'abord des repas.");
  editingEntry = entry;
  $('#plan-title').textContent = entry ? 'Repas planifié' : 'Planifier un repas';
  $('#plan-entry-actions').hidden = !entry;
  $('#plan-eaten').hidden = !!entry?.done;
  planForm.date.value = date;
  fillSlots(slot);
  fillMeals(meals);
  planDialog.showModal();
}

async function afterPlanChange() {
  planDialog.close();
  await refreshMeals();
  renderCalendar();
}

planForm.date.addEventListener('change', () => fillSlots());
planForm.slot.addEventListener('change', () => fillMeals());
$('#plan-cancel').addEventListener('click', () => planDialog.close());
$('#plan-eaten').addEventListener('click', async () => { await api(`planned/${editingEntry.id}/eaten`, 'POST', {}); toast('Noté comme mangé'); afterPlanChange(); });
$('#plan-remove').addEventListener('click', async () => { await api(`planned/${editingEntry.id}`, 'DELETE'); afterPlanChange(); });
planForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const body = { date: planForm.date.value, slot: planForm.slot.value, mealIds: [planForm.main.value, planForm.side.value].filter(Boolean) };
    await api('planned', 'POST', body); // remplace l'éventuel repas du même créneau
    const moved = editingEntry && (editingEntry.date !== body.date || editingEntry.slot !== body.slot);
    if (moved) await api(`planned/${editingEntry.id}`, 'DELETE');
    toast('Planifié et ajouté aux courses');
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

function renderNoShopping(names) {
  const box = $('#no-shopping');
  box.hidden = !names.length;
  box.replaceChildren(el('h3', {}, 'Repas sans courses'), el('p', { className: 'hint' }, 'Aucun ingrédient renseigné : rien à acheter pour ces repas.'),
    el('ul', {}, names.map((n) => el('li', {}, n))));
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

  const { items, noShopping } = await api('shopping');
  lastItems = items;
  renderNoShopping(noShopping);
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
        el('div', { className: 'meta' }, it.meals.join(', ')))));
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
  const { slots, kinds, current } = await api('slots');
  state.slots = slots;
  state.kinds = kinds;
  for (const sel of [form.kind, $('#kind-filter')]) sel.append(...kinds.map((k) => el('option', { value: k.id }, k.label)));
  $('#slot-select').replaceChildren(...slots.map((s) => el('option', { value: s.id, selected: s.id === current }, s.label)));
  await refreshMeals();
  loadSuggestion();
})();
