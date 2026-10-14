import test from 'node:test';
import assert from 'node:assert/strict';
import { suggest, buildShoppingList, sanitizeMeal, currentSlot } from '../lib/logic.js';

const now = new Date('2026-10-14T12:00:00');
const meals = [
  { id: 'a', name: 'Pâtes', slots: ['lun-soir', 'sam-midi'], lastEaten: '2026-10-13', ingredients: [{ name: 'Pâtes', qty: '500 g' }, { name: 'Tomates', qty: '3' }] },
  { id: 'b', name: 'Pizza', slots: ['lun-soir'], lastEaten: '2026-08-01', ingredients: [{ name: 'pates', qty: '250 g' }, { name: 'Tomates', qty: '2' }] },
  { id: 'c', name: 'Brunch', slots: ['dim-midi'], lastEaten: null, ingredients: [] },
];

test('suggère le repas le plus ancien parmi ceux du créneau', () => {
  const r = suggest(meals, 'lun-soir', { now, random: () => 0.5 });
  assert.equal(r.main.meal.id, 'b');
  assert.equal(r.alternatives[0].meal.id, 'a');
});

test('ignore les repas hors créneau et les exclus', () => {
  assert.equal(suggest(meals, 'mar-soir', { now }).main, null);
  assert.equal(suggest(meals, 'lun-soir', { now, excludeIds: ['b', 'a'] }).main, null);
});

test('un repas jamais mangé passe en premier', () => {
  const r = suggest([...meals, { id: 'd', name: 'Neuf', slots: ['lun-soir'], lastEaten: null, ingredients: [] }], 'lun-soir', { now, random: () => 0.5 });
  assert.equal(r.main.meal.id, 'd');
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
