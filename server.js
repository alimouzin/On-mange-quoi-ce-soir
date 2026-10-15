import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, timingSafeEqual, createHash } from 'node:crypto';
import { SLOTS, KINDS, currentSlot, suggest, buildShoppingList, sanitizeMeal } from './lib/logic.js';
import { Store } from './lib/store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || 3000);
const PASSWORD = process.env.APP_PASSWORD || '';
// Sans mot de passe, on n'écoute qu'en local pour rester privé.
const HOST = process.env.HOST || (PASSWORD ? '0.0.0.0' : '127.0.0.1');
const store = await new Store(process.env.DATA_FILE || path.join(__dirname, 'data', 'data.json')).load();

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };
const sha = (s) => createHash('sha256').update(s).digest();

function authorized(req) {
  if (!PASSWORD) return true;
  const h = req.headers.authorization || '';
  if (!h.startsWith('Basic ')) return false;
  const pass = Buffer.from(h.slice(6), 'base64').toString().split(':').slice(1).join(':');
  return timingSafeEqual(sha(pass), sha(PASSWORD));
}

const send = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body === undefined ? '' : JSON.stringify(body));
};

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 1e6) throw Object.assign(new Error('Requête trop volumineuse'), { status: 413 });
    chunks.push(c);
  }
  try {
    return chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
  } catch {
    throw Object.assign(new Error('JSON invalide'), { status: 400 });
  }
}

const shopping = () => {
  const items = buildShoppingList(store.data.meals, store.data.plan);
  return { items: items.map((i) => ({ ...i, checked: store.data.checked.includes(i.key) })) };
};

async function api(req, res, url) {
  const { meals } = store.data;
  const parts = url.pathname.split('/').filter(Boolean).slice(1); // sans "api"
  const [resource, id, action] = parts;
  const m = req.method;

  if (resource === 'slots' && m === 'GET') return send(res, 200, { slots: SLOTS, kinds: KINDS, current: currentSlot() });

  if (resource === 'meals') {
    if (!id && m === 'GET') return send(res, 200, { meals });
    if (!id && m === 'POST') {
      const meal = { id: randomUUID(), ...sanitizeMeal(await readBody(req)) };
      meals.push(meal);
      await store.save();
      return send(res, 201, meal);
    }
    const idx = meals.findIndex((x) => x.id === id);
    if (idx < 0) return send(res, 404, { error: 'Repas introuvable' });
    if (!action && m === 'PUT') {
      meals[idx] = { id, ...sanitizeMeal(await readBody(req)) };
      await store.save();
      return send(res, 200, meals[idx]);
    }
    if (!action && m === 'DELETE') {
      meals.splice(idx, 1);
      store.data.plan = store.data.plan.filter((p) => p !== id);
      await store.save();
      return send(res, 204);
    }
    if (action === 'eaten' && m === 'POST') {
      const { date } = await readBody(req);
      meals[idx].lastEaten = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : new Date().toISOString().slice(0, 10);
      await store.save();
      return send(res, 200, meals[idx]);
    }
  }

  if (resource === 'suggest' && m === 'GET') {
    const slot = url.searchParams.get('slot') || currentSlot();
    const excludeKeys = (url.searchParams.get('exclude') || '').split(',').filter(Boolean);
    const keepId = url.searchParams.get('keep') || null;
    return send(res, 200, { slot, ...suggest(meals, slot, { excludeKeys, keepId }) });
  }

  if (resource === 'plan') {
    if (m === 'GET') return send(res, 200, { plan: store.data.plan });
    if (m === 'PUT') {
      const { plan } = await readBody(req);
      store.data.plan = [...new Set(Array.isArray(plan) ? plan : [])].filter((p) => meals.some((x) => x.id === p));
      await store.save();
      return send(res, 200, { plan: store.data.plan });
    }
  }

  if (resource === 'shopping') {
    if (m === 'GET') return send(res, 200, shopping());
    if (id === 'checked' && m === 'PUT') {
      const { checked } = await readBody(req);
      store.data.checked = Array.isArray(checked) ? checked.map(String) : [];
      await store.save();
      return send(res, 200, shopping());
    }
  }

  return send(res, 404, { error: 'Route inconnue' });
}

async function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, { error: 'Interdit' });
  try {
    const body = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    send(res, 404, { error: 'Introuvable' });
  }
}

http
  .createServer(async (req, res) => {
    if (!authorized(req)) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="On mange quoi ce soir", charset="UTF-8"' });
      return res.end('Authentification requise');
    }
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) await api(req, res, url);
      else await serveStatic(res, url.pathname);
    } catch (e) {
      const status = e.status || (e.message?.includes('obligatoire') ? 400 : 500);
      if (status === 500) console.error(e);
      send(res, status, { error: status === 500 ? 'Erreur serveur' : e.message });
    }
  })
  .listen(PORT, HOST, () => {
    console.log(`On mange quoi ce soir ? → http://${HOST}:${PORT}`);
    if (!PASSWORD) console.warn('⚠ APP_PASSWORD non défini : accès limité à cette machine (127.0.0.1).');
  });
