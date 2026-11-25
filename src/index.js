// Wishly API: Cloudflare Worker + D1. Static files are served by Workers Assets.
const enc = new TextEncoder();
const SESSION = 60 * 60 * 24 * 30;
const hex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');
const b64 = (b) => btoa(String.fromCharCode(...new Uint8Array(b)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const sha = async (s) => b64(await crypto.subtle.digest('SHA-256', enc.encode(s)));
const now = () => Math.floor(Date.now() / 1000);
const clean = (v, max) => String(v ?? '').trim().slice(0, max);
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const fail = (s, m) => { throw new HttpError(s, m); };
const readBody = async (req) => { try { return await req.json(); } catch { return fail(400, 'Invalid request body.'); } };

// --- passwords (PBKDF2 via WebCrypto) ---
async function pbkdf2(pw, salt) {
  const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  return b64(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256));
}
async function makeHash(pw) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return b64(salt) + '$' + (await pbkdf2(pw, salt));
}
async function checkHash(pw, stored) {
  const [salt, hash] = stored.split('$');
  const test = await pbkdf2(pw, unb64(salt));
  let diff = test.length ^ hash.length;
  for (let i = 0; i < test.length; i++) diff |= test.charCodeAt(i) ^ (hash.charCodeAt(i) || 0);
  return diff === 0;
}

// --- cookies and sessions ---
const cookies = (req) => Object.fromEntries((req.headers.get('cookie') || '').split(/;\s*/).filter(Boolean)
  .map((c) => { const i = c.indexOf('='); return [c.slice(0, i), c.slice(i + 1)]; }));
const setCookie = (name, val, maxAge) => `${name}=${val}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

async function currentUser(req, env) {
  const t = cookies(req).sid;
  if (!t) return null;
  return env.DB.prepare('SELECT u.id, u.name, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires > ?')
    .bind(await sha(t), now()).first();
}
async function startSession(env, userId) {
  const t = hex(32);
  await env.DB.prepare('INSERT INTO sessions (token, user_id, expires) VALUES (?, ?, ?)').bind(await sha(t), userId, now() + SESSION).run();
  return { 'set-cookie': setCookie('sid', t, SESSION) };
}
const requireUser = (ctx) => ctx.user || fail(401, 'Log in to continue.');

// --- handlers ---
async function signup({ req, env }) {
  const b = await readBody(req);
  const email = clean(b.email, 200).toLowerCase(), name = clean(b.name, 80), pw = String(b.password ?? '');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail(400, 'Enter a valid email address.');
  if (!name) fail(400, 'Enter your name.');
  if (pw.length < 8) fail(400, 'Password must be at least 8 characters.');
  if (await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first()) fail(409, 'An account with that email already exists.');
  const r = await env.DB.prepare('INSERT INTO users (email, name, pw, created) VALUES (?, ?, ?, ?)')
    .bind(email, name, await makeHash(pw), now()).run();
  const id = r.meta.last_row_id;
  return json({ user: { id, name, email } }, 201, await startSession(env, id));
}
async function login({ req, env }) {
  const b = await readBody(req);
  const u = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(clean(b.email, 200).toLowerCase()).first();
  if (!u || !(await checkHash(String(b.password ?? ''), u.pw))) fail(401, 'Wrong email or password.');
  return json({ user: { id: u.id, name: u.name, email: u.email } }, 200, await startSession(env, u.id));
}
async function logout({ req, env }) {
  const t = cookies(req).sid;
  if (t) await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(await sha(t)).run();
  return json({ ok: true }, 200, { 'set-cookie': setCookie('sid', '', 0) });
}
const me = ({ user }) => json({ user });

async function myLists(ctx) {
  const u = requireUser(ctx);
  const { results } = await ctx.env.DB.prepare(
    'SELECT l.slug, l.title, l.occasion, l.event_date, (SELECT COUNT(*) FROM items i WHERE i.list_id = l.id) AS count FROM lists l WHERE l.user_id = ? ORDER BY l.created DESC'
  ).bind(u.id).all();
  return json({ lists: results });
}
async function createList(ctx) {
  const u = requireUser(ctx);
  const b = await readBody(ctx.req);
  const title = clean(b.title, 120);
  if (!title) fail(400, 'Give your list a title.');
  const slug = hex(5);
  await ctx.env.DB.prepare('INSERT INTO lists (slug, user_id, title, occasion, event_date, created) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(slug, u.id, title, clean(b.occasion, 40) || null, clean(b.event_date, 10) || null, now()).run();
  return json({ slug }, 201);
}
async function loadList(env, slug) {
  return (await env.DB.prepare('SELECT l.*, u.name AS owner_name FROM lists l JOIN users u ON u.id = l.user_id WHERE l.slug = ?').bind(slug).first()) || fail(404, 'List not found.');
}
async function getList({ req, env, user, m }) {
  const list = await loadList(env, m[1]);
  const owner = !!user && user.id === list.user_id;
  const vid = cookies(req).vid;
  const { results } = await env.DB.prepare('SELECT id, title, url, price, note, claimed_by FROM items WHERE list_id = ? ORDER BY id').bind(list.id).all();
  // Owners never see claim status, so gifts stay a surprise.
  const items = results.map((i) => ({
    id: i.id, title: i.title, url: i.url, price: i.price, note: i.note,
    claimed: owner ? false : !!i.claimed_by, mine: !owner && !!vid && i.claimed_by === vid,
  }));
  return json({ list: { slug: list.slug, title: list.title, occasion: list.occasion, event_date: list.event_date, owner_name: list.owner_name }, owner, items });
}
async function addItem(ctx) {
  const u = requireUser(ctx);
  const list = await loadList(ctx.env, ctx.m[1]);
  if (list.user_id !== u.id) fail(403, 'Only the list owner can add items.');
  const b = await readBody(ctx.req);
  const title = clean(b.title, 140);
  if (!title) fail(400, 'Enter an item name.');
  let url = clean(b.url, 500) || null;
  if (url) { try { if (!/^https?:$/.test(new URL(url).protocol)) throw 0; } catch { fail(400, 'Enter a valid web link starting with http or https.'); } }
  const price = b.price === '' || b.price == null ? null : Number(b.price);
  if (price !== null && (!Number.isFinite(price) || price < 0)) fail(400, 'Enter a valid price.');
  const note = clean(b.note, 300) || null;
  const r = await ctx.env.DB.prepare('INSERT INTO items (list_id, title, url, price, note, created) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(list.id, title, url, price, note, now()).run();
  return json({ item: { id: r.meta.last_row_id, title, url, price, note, claimed: false, mine: false } }, 201);
}
async function deleteItem(ctx) {
  const u = requireUser(ctx);
  const r = await ctx.env.DB.prepare('DELETE FROM items WHERE id = ? AND list_id IN (SELECT id FROM lists WHERE user_id = ?)').bind(ctx.m[1], u.id).run();
  if (!r.meta.changes) fail(404, 'Item not found.');
  return json({ ok: true });
}
async function claim({ req, env, user, m }) {
  const item = await env.DB.prepare('SELECT i.id, l.user_id FROM items i JOIN lists l ON l.id = i.list_id WHERE i.id = ?').bind(m[1]).first();
  if (!item) fail(404, 'Item not found.');
  if (user && user.id === item.user_id) fail(403, 'You can’t claim gifts on your own list.');
  let vid = cookies(req).vid, headers = {};
  if (!vid) { vid = hex(16); headers = { 'set-cookie': setCookie('vid', vid, 31536000) }; }
  const r = await env.DB.prepare('UPDATE items SET claimed_by = ? WHERE id = ? AND claimed_by IS NULL').bind(vid, item.id).run();
  if (!r.meta.changes) fail(409, 'Someone already claimed this gift.');
  return json({ ok: true }, 200, headers);
}
async function unclaim({ req, env, m }) {
  const vid = cookies(req).vid;
  const r = vid ? await env.DB.prepare('UPDATE items SET claimed_by = NULL WHERE id = ? AND claimed_by = ?').bind(m[1], vid).run() : { meta: { changes: 0 } };
  if (!r.meta.changes) fail(404, 'You haven’t claimed this gift.');
  return json({ ok: true });
}

const routes = [
  ['POST', /^\/signup$/, signup], ['POST', /^\/login$/, login], ['POST', /^\/logout$/, logout], ['GET', /^\/me$/, me],
  ['GET', /^\/lists$/, myLists], ['POST', /^\/lists$/, createList],
  ['GET', /^\/lists\/([a-f0-9]+)$/, getList], ['POST', /^\/lists\/([a-f0-9]+)\/items$/, addItem],
  ['DELETE', /^\/items\/(\d+)$/, deleteItem],
  ['POST', /^\/items\/(\d+)\/claim$/, claim], ['DELETE', /^\/items\/(\d+)\/claim$/, unclaim],
];

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/api/, '') || '/';
    try {
      if (req.method !== 'GET') {
        const origin = req.headers.get('origin');
        if (origin && origin !== url.origin) fail(403, 'Bad origin.');
      }
      for (const [method, re, fn] of routes) {
        const m = method === req.method && path.match(re);
        if (m) return await fn({ req, env, url, m, user: await currentUser(req, env) });
      }
      return fail(404, 'Not found.');
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: 'Something went wrong. Try again.' }, 500);
    }
  },
};
