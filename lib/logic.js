// Logique pure : créneaux, suggestions, liste de courses.

export const SLOTS = [
  { id: 'lun-soir', label: 'Lundi soir' },
  { id: 'mar-soir', label: 'Mardi soir' },
  { id: 'mer-soir', label: 'Mercredi soir' },
  { id: 'jeu-soir', label: 'Jeudi soir' },
  { id: 'ven-soir', label: 'Vendredi soir' },
  { id: 'sam-midi', label: 'Samedi midi' },
  { id: 'sam-soir', label: 'Samedi soir' },
  { id: 'dim-midi', label: 'Dimanche midi' },
  { id: 'dim-soir', label: 'Dimanche soir' },
];

const DAYS = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];

/** Date locale au format YYYY-MM-DD (toISOString donnerait la date UTC). */
export function localDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const parseDate = (str) => new Date(str + 'T12:00:00');
export const slotDay = (slot) => slot.split('-')[0];
export const dateDay = (str) => DAYS[parseDate(str).getDay()];

/** Créneaux possibles pour une date donnée (ex. samedi : midi et soir). */
export const slotsForDate = (str) => SLOTS.filter((s) => slotDay(s.id) === dateDay(str));

/** Prochaine date (à partir de `from`, incluse) qui correspond au créneau. */
export function nextDateForSlot(slot, from = new Date()) {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate(), 12);
  for (let i = 0; i < 7 && DAYS[d.getDay()] !== slotDay(slot); i++) d.setDate(d.getDate() + 1);
  return localDate(d);
}

export function daysSince(dateStr, now = new Date()) {
  if (!dateStr) return Infinity;
  return Math.floor((now - parseDate(dateStr)) / 86400000);
}

export const KINDS = [
  { id: 'complet', label: 'Repas complet' },
  { id: 'viande', label: 'Viande' },
  { id: 'accompagnement', label: 'Accompagnement' },
];

export const SEASONS = [
  { id: 'printemps', label: 'Printemps' },
  { id: 'ete', label: 'Été' },
  { id: 'automne', label: 'Automne' },
  { id: 'hiver', label: 'Hiver' },
];

/** Saisons météorologiques : printemps mars-mai, été juin-août, automne sept.-nov., hiver déc.-févr. */
export function seasonOf(date = new Date()) {
  const d = typeof date === 'string' ? parseDate(date) : date;
  return ['hiver', 'hiver', 'printemps', 'printemps', 'printemps', 'ete', 'ete', 'ete', 'automne', 'automne', 'automne', 'hiver'][d.getMonth()];
}

/** Un repas sans saison cochée est disponible toute l'année. */
export const inSeason = (m, date = new Date()) => !m.seasons?.length || m.seasons.includes(seasonOf(date));

export const kindOf = (m) => m.kind || 'complet';

/**
 * Tirage « surprends-moi » : plus un repas n'a pas été mangé depuis longtemps
 * (ou jamais), plus il a de chances. Renvoie l'index tiré dans `meals`.
 */
export function drawIndex(meals, { now = new Date(), random = Math.random } = {}) {
  const weights = meals.map((m) => {
    const days = daysSince(m.lastEaten, now);
    return days === Infinity ? 90 : Math.max(1, Math.min(days, 60));
  });
  let r = random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < weights.length; i++) if ((r -= weights[i]) < 0) return i;
  return weights.length - 1;
}

const QTY_RE = /^(\d+(?:[.,]\d+)?)\s*(.*)$/;

function parseQty(q) {
  const m = QTY_RE.exec((q || '').trim());
  return m ? { n: parseFloat(m[1].replace(',', '.')), unit: m[2].trim().toLowerCase() } : null;
}

const fmt = (n) => String(Math.round(n * 100) / 100).replace('.', ',');

/** Additionne les quantités de même unité, juxtapose les autres. */
function mergeQty(quantities) {
  const sums = new Map();
  const others = [];
  for (const q of quantities) {
    const p = parseQty(q);
    if (p) sums.set(p.unit, (sums.get(p.unit) || 0) + p.n);
    else if (q && q.trim()) others.push(q.trim());
  }
  const parts = [...sums].map(([unit, n]) => (unit ? `${fmt(n)} ${unit}` : fmt(n)));
  return [...parts, ...others].join(' + ');
}

export const ingredientKey = (name) =>
  name.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Fusionne les ingrédients des repas planifiés en une liste de courses. */
export function buildShoppingList(meals, planIds) {
  const groups = new Map();
  for (const id of planIds) {
    const meal = meals.find((m) => m.id === id);
    if (!meal) continue;
    const ingredients = meal.ingredients.filter((i) => i.name?.trim());
    // Sans ingrédients, c'est le plat lui-même qu'il faut se procurer (plat du traiteur, surgelé…).
    const whole = !ingredients.length;
    for (const ing of whole ? [{ name: meal.name, qty: '' }] : ingredients) {
      const key = ingredientKey(ing.name);
      if (!groups.has(key)) groups.set(key, { key, name: ing.name.trim(), quantities: [], meals: [], whole });
      const g = groups.get(key);
      g.quantities.push(ing.qty || '');
      if (!g.meals.includes(meal.name)) g.meals.push(meal.name);
    }
  }
  return [...groups.values()]
    .map((g) => ({ key: g.key, name: g.name, qty: mergeQty(g.quantities), meals: g.meals, whole: g.whole }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

/** Valide et normalise un repas reçu du client. Lève une Error si invalide. */
export function sanitizeMeal(input) {
  const name = String(input?.name ?? '').trim();
  if (!name) throw new Error('Le nom du repas est obligatoire.');
  const valid = new Set(SLOTS.map((s) => s.id));
  const slots = [...new Set((input.slots || []).filter((s) => valid.has(s)))];
  const ingredients = (input.ingredients || [])
    .map((i) => ({ name: String(i?.name ?? '').trim(), qty: String(i?.qty ?? '').trim() }))
    .filter((i) => i.name);
  const lastEaten = /^\d{4}-\d{2}-\d{2}$/.test(input.lastEaten || '') ? input.lastEaten : null;
  const kind = KINDS.some((k) => k.id === input.kind) ? input.kind : 'complet';
  const seasons = [...new Set((input.seasons || []).filter((x) => SEASONS.some((s) => s.id === x)))];
  // Les quatre saisons cochées reviennent à « toute l'année ».
  const limited = seasons.length === SEASONS.length ? [] : seasons;
  return { name: name.slice(0, 120), kind, seasons: limited, slots, ingredients, lastEaten, notes: String(input.notes ?? '').slice(0, 1000) };
}

/**
 * Valide un repas planifié {date, slot, mealIds}. Le créneau doit exister
 * pour ce jour de la semaine. Lève une Error si invalide.
 */
export function sanitizePlanned(input, meals) {
  const date = String(input?.date ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parseDate(date).getTime())) throw new Error('Date invalide.');
  const slot = String(input?.slot ?? '');
  if (!slotsForDate(date).some((s) => s.id === slot)) throw new Error("Ce moment n'existe pas pour ce jour.");
  const mealIds = [...new Set(input?.mealIds || [])].filter((id) => meals.some((m) => m.id === id)).slice(0, 4);
  if (!mealIds.length) throw new Error('Choisis au moins un repas.');
  return { date, slot, mealIds };
}

/** Repas à acheter : ajouts manuels + repas planifiés d'aujourd'hui et à venir (non mangés). */
export function shoppingMealIds(manualPlan, planned, today) {
  const upcoming = planned.filter((p) => p.date >= today && !p.done).flatMap((p) => p.mealIds);
  return [...upcoming, ...manualPlan.filter((id) => !upcoming.includes(id))];
}
