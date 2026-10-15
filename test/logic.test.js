import test from 'node:test';
import assert from 'node:assert/strict';
import { seasonOf, inSeason, drawIndex, buildShoppingList, sanitizeMeal, sanitizePlanned, shoppingMealIds, slotsForDate, nextDateForSlot, localDate } from '../lib/logic.js';

const now = new Date('2026-10-14T12:00:00');
const meals = [
  { id: 'a', name: 'Pâtes', slots: ['lun-soir', 'sam-midi'], lastEaten: '2026-10-13', ingredients: [{ name: 'Pâtes', qty: '500 g' }, { name: 'Tomates', qty: '3' }] },
  { id: 'b', name: 'Pizza', slots: ['lun-soir'], lastEaten: '2026-08-01', ingredients: [{ name: 'pates', qty: '250 g' }, { name: 'Tomates', qty: '2' }] },
  { id: 'c', name: 'Brunch', slots: ['dim-midi'], lastEaten: null, ingredients: [] },
];

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


test('tirage pondéré : favorise les repas anciens, reste dans la liste', () => {
  const list = [
    { id: 'recent', lastEaten: '2026-10-13' }, // 1 jour
    { id: 'ancien', lastEaten: '2026-06-01' }, // plafonné à 60
    { id: 'jamais', lastEaten: null }, // 90
  ];
  assert.equal(drawIndex(list, { now, random: () => 0 }), 0);
  assert.equal(drawIndex(list, { now, random: () => 0.2 }), 1);
  assert.equal(drawIndex(list, { now, random: () => 0.5 }), 2);
  assert.equal(drawIndex(list, { now, random: () => 0.99 }), 2);
  assert.equal(drawIndex(list, { now, random: () => 1 }), 2);
  const counts = [0, 0, 0];
  for (let i = 0; i < 3000; i++) counts[drawIndex(list, { now })]++;
  assert.ok(counts[2] > counts[1] && counts[1] > counts[0] * 5);
});
