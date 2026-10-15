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

/** Prochain créneau (midi uniquement le week-end) à partir de `now`. */
export function currentSlot(now = new Date()) {
  const day = DAYS[now.getDay()];
  const weekend = day === 'sam' || day === 'dim';
  if (weekend && now.getHours() < 15) return `${day}-midi`;
  return `${day}-soir`;
}

export function daysSince(dateStr, now = new Date()) {
  if (!dateStr) return Infinity;
  const d = new Date(dateStr + 'T12:00:00');
  return Math.floor((now - d) / 86400000);
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
    for (const ing of meal.ingredients) {
      if (!ing.name || !ing.name.trim()) continue;
      const key = ingredientKey(ing.name);
      if (!groups.has(key)) groups.set(key, { key, name: ing.name.trim(), quantities: [], meals: [] });
      const g = groups.get(key);
      g.quantities.push(ing.qty || '');
      if (!g.meals.includes(meal.name)) g.meals.push(meal.name);
    }
  }
  return [...groups.values()]
    .map((g) => ({ key: g.key, name: g.name, qty: mergeQty(g.quantities), meals: g.meals }))
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
