import test from 'node:test';
import assert from 'node:assert/strict';
import { seasonOf, inSeason, suggest, buildShoppingList, sanitizeMeal, currentSlot, sanitizePlanned, shoppingMealIds, slotsForDate, nextDateForSlot, localDate } from '../lib/logic.js';

const now = new Date('2026-10-14T12:00:00');
const meals = [
  { id: 'a', name: 'Pâtes', slots: ['lun-soir', 'sam-midi'], lastEaten: '2026-10-13', ingredients: [{ name: 'Pâtes', qty: '500 g' }, { name: 'Tomates', qty: '3' }] },
  { id: 'b', name: 'Pizza', slots: ['lun-soir'], lastEaten: '2026-08-01', ingredients: [{ name: 'pates', qty: '250 g' }, { name: 'Tomates', qty: '2' }] },
  { id: 'c', name: 'Brunch', slots: ['dim-midi'], lastEaten: null, ingredients: [] },
];

test('suggère le repas le plus ancien parmi ceux du créneau', () => {
  const r = suggest(meals, 'lun-soir', { now, random: () => 0.5 });
  assert.equal(r.main.meals[0].id, 'b');
  assert.equal(r.alternatives[0].meals[0].id, 'a');
});

test('ignore les repas hors créneau et les exclus', () => {
  assert.equal(suggest(meals, 'mar-soir', { now }).main, null);
  assert.equal(suggest(meals, 'lun-soir', { now, excludeKeys: ['b', 'a'] }).main, null);
});

test('un repas jamais mangé passe en premier', () => {
  const r = suggest([...meals, { id: 'd', name: 'Neuf', slots: ['lun-soir'], lastEaten: null, ingredients: [] }], 'lun-soir', { now, random: () => 0.5 });
  assert.equal(r.main.meals[0].id, 'd');
});

test('fusionne les ingrédients et additionne les quantités', () => {
  const list = buildShoppingList(meals, ['a', 'b']);
  const tomates = list.find((i) => i.name === 'Tomates');
  assert.equal(tomates.qty, '5');
  const pates = list.find((i) => i.key === 'pates');
  assert.equal(pates.qty, '750 g');
  assert.deepEqual(pates.meals, ['Pâtes', 'Pizza']);
});

test('sanitizeMeal valide les entrées', () => {
  assert.throws(() => sanitizeMeal({ name: '  ' }), /obligatoire/);
  const m = sanitizeMeal({ name: 'X', slots: ['lun-soir', 'bidon'], ingredients: [{ name: '' }, { name: 'Sel' }], lastEaten: 'hier' });
  assert.deepEqual(m.slots, ['lun-soir']);
  assert.equal(m.ingredients.length, 1);
  assert.equal(m.lastEaten, null);
});

test('créneau courant : midi le week-end avant 15h', () => {
  assert.equal(currentSlot(new Date('2026-10-17T11:00:00')), 'sam-midi');
  assert.equal(currentSlot(new Date('2026-10-17T18:00:00')), 'sam-soir');
  assert.equal(currentSlot(new Date('2026-10-14T11:00:00')), 'mer-soir');
});

test('mix & match : viande + accompagnement, avec exclusion et garde', () => {
  const duo = [
    { id: 'v1', name: 'Poulet', kind: 'viande', slots: ['mer-soir'], lastEaten: '2026-01-01', ingredients: [] },
    { id: 'v2', name: 'Steak', kind: 'viande', slots: ['mer-soir'], lastEaten: '2026-10-10', ingredients: [] },
    { id: 'a1', name: 'Riz', kind: 'accompagnement', slots: ['mer-soir'], lastEaten: '2026-02-01', ingredients: [] },
    { id: 'a2', name: 'Frites', kind: 'accompagnement', slots: ['mer-soir', 'lun-soir'], lastEaten: '2026-10-11', ingredients: [] },
  ];
  const o = { now, random: () => 0.5 };
  assert.equal(suggest(duo, 'mer-soir', o).main.key, 'v1+a1');
  assert.equal(suggest(duo, 'mer-soir', { ...o, excludeKeys: ['v1+a1'] }).main.key, 'v2+a1');
  const keep = suggest(duo, 'mer-soir', { ...o, excludeKeys: ['v1+a1', 'v2+a1'], keepId: 'a2' });
  assert.equal(keep.main.key, 'v1+a2');
  assert.ok(keep.alternatives.every((p) => p.meals.some((m) => m.id === 'a2')));
  assert.equal(suggest(duo, 'lun-soir', o).main, null); // pas de viande pour ce créneau
});

test('un repas complet peut concurrencer un duo', () => {
  const list = [
    { id: 'c', name: 'Lasagnes', slots: ['mer-soir'], lastEaten: null, ingredients: [] },
    { id: 'v', name: 'Poulet', kind: 'viande', slots: ['mer-soir'], lastEaten: '2026-10-13', ingredients: [] },
    { id: 'a', name: 'Riz', kind: 'accompagnement', slots: ['mer-soir'], lastEaten: '2026-10-13', ingredients: [] },
  ];
  assert.equal(suggest(list, 'mer-soir', { now, random: () => 0.5 }).main.key, 'c');
});

test('sanitizeMeal : type par défaut et invalide', () => {
  assert.equal(sanitizeMeal({ name: 'X', kind: 'viande' }).kind, 'viande');
  assert.equal(sanitizeMeal({ name: 'X', kind: 'nimporte' }).kind, 'complet');
});

test('créneaux d\'une date et prochaine date d\'un créneau', () => {
  assert.deepEqual(slotsForDate('2026-10-17').map((s) => s.id), ['sam-midi', 'sam-soir']); // samedi
  assert.deepEqual(slotsForDate('2026-10-14').map((s) => s.id), ['mer-soir']);
  assert.equal(nextDateForSlot('sam-midi', new Date('2026-10-14T10:00:00')), '2026-10-17');
  assert.equal(nextDateForSlot('mer-soir', new Date('2026-10-14T10:00:00')), '2026-10-14');
  assert.equal(localDate(new Date(2026, 0, 5)), '2026-01-05');
});

test('sanitizePlanned valide date, créneau et repas', () => {
  const ok = sanitizePlanned({ date: '2026-10-17', slot: 'sam-midi', mealIds: ['a', 'a', 'zzz'] }, meals);
  assert.deepEqual(ok, { date: '2026-10-17', slot: 'sam-midi', mealIds: ['a'] });
  assert.throws(() => sanitizePlanned({ date: 'demain', slot: 'sam-midi', mealIds: ['a'] }, meals), /Date/);
  assert.throws(() => sanitizePlanned({ date: '2026-10-14', slot: 'sam-midi', mealIds: ['a'] }, meals), /existe pas/);
  assert.throws(() => sanitizePlanned({ date: '2026-10-17', slot: 'sam-midi', mealIds: ['zzz'] }, meals), /au moins/);
});

test('courses : repas planifiés à venir ajoutés, passés ou mangés ignorés, pas de doublon', () => {
  const planned = [
    { date: '2026-10-13', mealIds: ['old'] },
    { date: '2026-10-14', mealIds: ['a'] },
    { date: '2026-10-20', mealIds: ['b'], done: true },
    { date: '2026-10-21', mealIds: ['c'] },
  ];
  assert.deepEqual(shoppingMealIds(['a', 'x'], planned, '2026-10-14'), ['a', 'c', 'x']);
});

test('repas sans ingrédient : le plat lui-même est un article à acheter', () => {
  const list = buildShoppingList(meals, ['a', 'c']);
  const brunch = list.find((i) => i.name === 'Brunch');
  assert.ok(brunch && brunch.whole);
  assert.deepEqual(brunch.meals, ['Brunch']);
  assert.ok(!list.find((i) => i.name === 'Pâtes').whole);
});

test('saisons : mois, repas toute l\'année ou limité', () => {
  assert.equal(seasonOf(new Date(2026, 0, 15)), 'hiver');
  assert.equal(seasonOf('2026-04-02'), 'printemps');
  assert.equal(seasonOf('2026-07-14'), 'ete');
  assert.equal(seasonOf(new Date(2026, 9, 14)), 'automne');
  assert.ok(inSeason({ seasons: [] }, new Date(2026, 6, 1)));
  assert.ok(inSeason({}, new Date(2026, 6, 1)));
  assert.ok(!inSeason({ seasons: ['hiver'] }, new Date(2026, 6, 1)));
  assert.deepEqual(sanitizeMeal({ name: 'X', seasons: ['ete', 'bidon'] }).seasons, ['ete']);
  assert.deepEqual(sanitizeMeal({ name: 'X', seasons: ['ete', 'hiver', 'automne', 'printemps'] }).seasons, []);
});

test('suggestion : un repas hors saison est exclu', () => {
  const list = [
    { id: 'raclette', name: 'Raclette', slots: ['mer-soir'], seasons: ['hiver'], lastEaten: null, ingredients: [] },
    { id: 'salade', name: 'Salade', slots: ['mer-soir'], seasons: ['ete'], lastEaten: null, ingredients: [] },
    { id: 'toute', name: 'Pâtes', slots: ['mer-soir'], lastEaten: '2026-10-13', ingredients: [] },
  ];
  const keys = [suggest(list, 'mer-soir', { now, random: () => 0.5 }).main, ...suggest(list, 'mer-soir', { now, random: () => 0.5 }).alternatives].map((p) => p.key);
  assert.deepEqual(keys, ['toute']); // now = 14 octobre : automne
});
