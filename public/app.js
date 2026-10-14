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

const state = { slots: [], meals: [], plan: [], editing: null, excluded: [], forced: null };
const slotLabel = (id) => state.slots.find((s) => s.id === id)?.label || id;
const today = () => new Date().toISOString().slice(0, 10);

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
    for (const t of ['choose', 'meals', 'shopping']) $('#tab-' + t).hidden = t !== b.dataset.tab;
    ({ choose: loadSuggestion, meals: renderMeals, shopping: renderShopping })[b.dataset.tab]();
  }),
);

// ---------- Choisir ----------
async function loadSuggestion() {
  const slot = $('#slot-select').value;
  const data = await api(`suggest?slot=${slot}&exclude=${state.excluded.join(',')}`);
  const forced = state.forced && state.meals.find((x) => x.id === state.forced && x.slots.includes(slot));
  if (forced) {
    // Un repas choisi dans « Autres idées » passe en tête ; l'ancien principal reste proposé.
    const rest = [data.main, ...data.alternatives].filter((x) => x && x.meal.id !== forced.id);
    data.main = { meal: forced };
    data.alternatives = rest.slice(0, 3);
  }
  const box = $('#suggestion');
  box.replaceChildren();
  if (!data.main) {
    box.append(el('p', { className: 'empty' }, state.excluded.length
      ? 'Plus d\'autres idées pour ce moment.' : `Aucun repas adapté à « ${slotLabel(slot)} ». Ajoute-en dans l'onglet Repas !`));
    if (state.excluded.length) box.append(el('button', { onclick: () => { state.excluded = []; loadSuggestion(); } }, 'Recommencer'));
    return;
  }
  const m = data.main.meal;
  box.append(
    el('div', { className: 'big' },
      el('div', { className: 'meta' }, `Proposition pour ${slotLabel(slot).toLowerCase()}`),
      el('h2', {}, m.name),
      el('div', { className: 'meta' }, agoText(m.lastEaten)),
      m.ingredients.length ? el('p', {}, m.ingredients.map((i) => (i.qty ? `${i.qty} ` : '') + i.name).join(', ')) : null,
      el('div', { className: 'actions' },
        el('button', { className: 'primary', onclick: async () => { await api(`meals/${m.id}/eaten`, 'POST', {}); state.excluded = []; state.forced = null; await refreshMeals(); loadSuggestion(); } }, '✅ On mange ça !'),
        el('button', { onclick: () => { state.excluded.push(m.id); state.forced = null; loadSuggestion(); } }, '🎲 Autre idée'),
        el('button', { onclick: async () => { await setPlanned(m.id, true); alert('Ajouté aux courses'); } }, '🛒 Ajouter aux courses'),
      ),
    ),
  );
  if (data.alternatives.length) {
    box.append(el('div', { className: 'alts' }, el('h3', {}, 'Autres idées'),
      data.alternatives.map((a) => el('button', { onclick: () => { state.forced = a.meal.id; loadSuggestion(); } },
        `${a.meal.name} — ${agoText(a.meal.lastEaten)}`))));
  }
}

$('#slot-select').addEventListener('change', () => { state.excluded = []; state.forced = null; loadSuggestion(); });

// ---------- Repas ----------
async function refreshMeals() {
  state.meals = (await api('meals')).meals;
  state.plan = (await api('plan')).plan;
  updateCartCount();
}

function renderMeals() {
  const q = $('#filter').value.trim().toLowerCase();
  const list = $('#meal-list');
  list.replaceChildren();
  const meals = state.meals.filter((m) => m.name.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  if (!meals.length) list.append(el('li', { className: 'empty' }, 'Aucun repas pour le moment.'));
  for (const m of meals) {
    list.append(el('li', {},
      el('strong', {}, m.name),
      el('div', { className: 'meta' }, agoText(m.lastEaten)),
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
  } catch (err) { alert(err.message); }
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
  c.hidden = !state.plan.length;
  c.textContent = state.plan.length;
}

let lastItems = [];
async function renderShopping() {
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
        el('div', { className: 'meta' }, it.meals.join(', ')))));
  }
}

$('#copy-list').addEventListener('click', async () => {
  const text = lastItems.filter((i) => !i.checked).map((i) => `- ${i.qty ? i.qty + ' ' : ''}${i.name}`).join('\n');
  try { await navigator.clipboard.writeText(text); alert('Liste copiée'); } catch { prompt('Copie la liste :', text); }
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
  const { slots, current } = await api('slots');
  state.slots = slots;
  $('#slot-select').replaceChildren(...slots.map((s) => el('option', { value: s.id, selected: s.id === current }, s.label)));
  await refreshMeals();
  loadSuggestion();
})();
