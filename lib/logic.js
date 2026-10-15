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

/** Prochain créneau (midi uniquement le week-end) à partir de `now`. */
export function currentSlot(now = new Date()) {
  const day = DAYS[now.getDay()];
  const weekend = day === 'sam' || day === 'dim';
  if (weekend && now.getHours() < 15) return `${day}-midi`;
  return `${day}-soir`;
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

export const kindOf = (m) => m.kind || 'complet';

/** Score d'envie : plus un repas est ancien (ou jamais mangé), plus il est haut. */
function scoreMeal(m, now, random) {
  const days = daysSince(m.lastEaten, now);
  const base = days === Infinity ? 90 : Math.min(days, 60);
  return base * (0.7 + random() * 0.6);
}

/**
 * Propositions pour un créneau, de la meilleure à la moins bonne :
 * un repas complet seul, ou un duo viande + accompagnement (mix & match).
 * `excludeKeys` écarte des propositions déjà vues ; `keepId` impose un repas
 * (ex. garder l'accompagnement et changer la viande).
 */
export function proposals(meals, slot, { now = new Date(), random = Math.random, excludeKeys = [], keepId = null } = {}) {
  const scored = meals
    .filter((m) => m.slots.includes(slot))
    .map((m) => ({ meal: m, score: scoreMeal(m, now, random) }));
  const by = (k) => scored.filter((x) => kindOf(x.meal) === k).sort((a, b) => b.score - a.score);
  const out = by('complet').map((x) => ({ meals: [x.meal], score: x.score }));
  // Duos : on se limite aux 8 meilleurs de chaque côté pour borner les combinaisons.
  for (const v of by('viande').slice(0, 8))
    for (const a of by('accompagnement').slice(0, 8))
      out.push({ meals: [v.meal, a.meal], score: (v.score + a.score) / 2 });
  return out
    .map((p) => ({ ...p, key: p.meals.map((m) => m.id).join('+') }))
    .filter((p) => !excludeKeys.includes(p.key) && (!keepId || p.meals.some((m) => m.id === keepId)))
    .sort((a, b) => b.score - a.score);
}

export function suggest(meals, slot, opts = {}) {
  const list = proposals(meals, slot, opts);
  return { main: list[0] || null, alternatives: list.slice(1, 4) };
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
  return { name: name.slice(0, 120), kind, slots, ingredients, lastEaten, notes: String(input.notes ?? '').slice(0, 1000) };
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
