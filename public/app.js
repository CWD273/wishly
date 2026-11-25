const app = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => (n == null ? '' : '$' + (Number.isInteger(n) ? n : n.toFixed(2)));
const tints = ['#F3C9A8', '#B9D3E8', '#F2DE9C', '#D9C2E6', '#C6DEC2', '#F5D0D0'];
let me = null;

async function api(path, method = 'GET', body) {
  const r = await fetch('/api' + path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body && JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Something went wrong. Try again.');
  return d;
}
const formData = (f) => Object.fromEntries(new FormData(f));
const show = (el, msg) => { el.textContent = msg; };

function shell(main) {
  const nav = me
    ? `<a href="/lists" data-link>My lists</a><button class="link" id="logout" type="button">Log out</button>`
    : `<a href="/login" data-link>Log in</a><a class="btn btn-primary btn-sm" href="/signup" data-link>Start a list</a>`;
  return `<div class="wrap"><header class="site-header"><a class="logo" href="/" data-link>Wishly</a><nav class="nav" aria-label="Main">${nav}</nav></header></div>
<main>${main}</main><div class="wrap"><footer class="site-footer">© Wishly</footer></div>`;
}

// --- views: each returns { title, html, bind? } ---
function home() {
  const cta = me ? `<a class="btn btn-primary" href="/lists" data-link>Go to my lists</a>` : `<a class="btn btn-primary" href="/signup" data-link>Create your list</a>`;
  return { title: 'Wishly – Gift ideas and wish lists', html: `
<div class="wrap"><div class="hero"><div><h1>Gifts people actually want.</h1>
<p class="lead">Build a wish list for any occasion, share one link, and let friends and family claim a gift without doubles or guesswork.</p>
<div class="actions">${cta}</div></div>
<div class="hero-card" aria-hidden="true"><h2>Maya’s 30th Birthday</h2><p class="meta">12 items · Dec 14</p>
<div class="sw">${tints.slice(0, 4).map((c) => `<div style="background:${c}"></div>`).join('')}</div></div></div></div>
<section class="band"><div class="wrap"><h2 class="title">How it works</h2><p class="intro">Three steps from a blank page to a list your people can shop from.</p>
<ol class="steps"><li><h3>Add what you love</h3><p>Paste a link or type an idea. Add a note, size, or color.</p></li>
<li><h3>Share one link</h3><p>Send it to anyone. No account needed to view or claim.</p></li>
<li><h3>Claim in secret</h3><p>Friends mark gifts as taken. You never see who picked what.</p></li></ol></div></section>` };
}

function auth(mode) {
  const signup = mode === 'signup';
  return { title: (signup ? 'Create account' : 'Log in') + ' – Wishly', html: `
<div class="wrap"><div class="auth card"><h1>${signup ? 'Create your account' : 'Welcome back'}</h1>
<form id="f" novalidate>${signup ? '<label>Name<input name="name" autocomplete="name" required></label>' : ''}
<label>Email<input name="email" type="email" autocomplete="email" required></label>
<label>Password<input name="password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" minlength="8" required></label>
<p class="err" id="err" role="alert"></p>
<button class="btn btn-primary" type="submit">${signup ? 'Create account' : 'Log in'}</button></form>
<p style="margin-top:16px;font-size:14px">${signup ? 'Already have an account? <a href="/login" data-link>Log in</a>' : 'New here? <a href="/signup" data-link>Create an account</a>'}</p></div></div>`,
  bind() {
    document.getElementById('f').addEventListener('submit', async (e) => {
      e.preventDefault();
      try { me = (await api('/' + mode, 'POST', formData(e.target))).user; go('/lists'); }
      catch (x) { show(document.getElementById('err'), x.message); }
    });
  } };
}

async function dashboard() {
  if (!me) return go('/login', true);
  const { lists } = await api('/lists');
  return { title: 'My lists – Wishly', html: `
<section><div class="wrap"><h1 class="title">My lists</h1>
<form id="f" class="add card" novalidate><label>Title<input name="title" placeholder="Maya’s 30th Birthday" required></label>
<label>Occasion<select name="occasion"><option>Birthday</option><option>Wedding</option><option>Baby shower</option><option>Holiday</option><option>Other</option></select></label>
<label>Date<input name="event_date" type="date"></label>
<button class="btn btn-primary" type="submit">Create list</button><p class="err wide" id="err" role="alert"></p></form>
<div class="lists">${lists.map((l) => `<a class="card" href="/l/${l.slug}" data-link><h3>${esc(l.title)}</h3><p class="note" style="color:var(--muted)">${esc(l.occasion || 'List')} · ${l.count} item${l.count === 1 ? '' : 's'}${l.event_date ? ' · ' + esc(l.event_date) : ''}</p></a>`).join('') || '<p class="empty">You haven’t made a list yet. Create your first one above.</p>'}</div></div></section>`,
  bind() {
    document.getElementById('f').addEventListener('submit', async (e) => {
      e.preventDefault();
      try { go('/l/' + (await api('/lists', 'POST', formData(e.target))).slug); }
      catch (x) { show(document.getElementById('err'), x.message); }
    });
  } };
}

async function listView(slug) {
  let data;
  try { data = await api('/lists/' + slug); }
  catch { return { title: 'Not found – Wishly', html: `<div class="wrap"><section><h1 class="title">We couldn’t find that list</h1><p class="intro">Check the link, or ask the person who shared it to send it again.</p></section></div>` }; }
  const { list, owner } = data, items = data.items;
  let filter = 'all';
  const chips = [['all', 'All items'], ...(owner ? [] : [['available', 'Available'], ['claimed', 'Claimed']]), ['under', 'Under $50']];
  const counts = () => `${items.length} item${items.length === 1 ? '' : 's'}${owner ? '' : ' · ' + items.filter((i) => i.claimed).length + ' claimed'}`;
  return { title: list.title + ' – Wishly', html: `
<section><div class="wrap"><div class="head"><div><p class="by">${esc(list.occasion || 'List')} by ${esc(list.owner_name)}</p><h1>${esc(list.title)}</h1>
<p class="meta"><span id="count">${counts()}</span>${list.event_date ? ' · ' + esc(list.event_date) : ''}</p></div>
<button class="btn btn-outline" id="copy" type="button">Copy share link</button></div>
${owner ? `<form id="add" class="add card" novalidate><label>Item<input name="title" required></label><label>Link<input name="url" type="url" placeholder="https://"></label>
<label>Price ($)<input name="price" type="number" min="0" step="0.01"></label><label class="wide">Note<input name="note" placeholder="Size, color, or anything helpful"></label>
<button class="btn btn-primary" type="submit">Add item</button></form>` : ''}
<p class="err" id="err" role="alert"></p>
<div class="chips" role="group" aria-label="Filter items">${chips.map(([k, t]) => `<button class="chip" type="button" data-f="${k}" aria-pressed="${k === 'all'}">${t}</button>`).join('')}</div>
<ul class="grid" id="grid"></ul></div></section>`,
  bind() {
    const grid = document.getElementById('grid'), err = document.getElementById('err');
    const draw = () => {
      document.getElementById('count').textContent = counts();
      const f = items.filter((i) => filter === 'all' || (filter === 'available' && !i.claimed) || (filter === 'claimed' && i.claimed) || (filter === 'under' && i.price != null && i.price < 50));
      grid.innerHTML = f.map((i) => {
        const btn = owner ? `<button class="claim" data-act="remove" data-id="${i.id}" type="button">Remove</button>`
          : i.mine ? `<button class="claim" data-act="unclaim" data-id="${i.id}" type="button">Unclaim</button>`
          : i.claimed ? `<button class="claim" disabled type="button">Claimed</button>`
          : `<button class="claim" data-act="claim" data-id="${i.id}" type="button">Claim gift</button>`;
        const title = i.url ? `<a href="${esc(i.url)}" target="_blank" rel="noopener noreferrer">${esc(i.title)}</a>` : esc(i.title);
        return `<li class="item"><div class="thumb" style="background:${tints[i.id % tints.length]}"></div><h3>${title}</h3>${i.note ? `<p class="note">${esc(i.note)}</p>` : ''}<div class="row"><span>${money(i.price)}</span>${btn}</div></li>`;
      }).join('') || '<li class="empty">Nothing here yet.</li>';
    };
    draw();
    grid.addEventListener('click', async (e) => {
      const b = e.target.closest('button[data-act]'); if (!b) return;
      const id = +b.dataset.id, it = items.find((x) => x.id === id); show(err, '');
      try {
        if (b.dataset.act === 'remove') { await api('/items/' + id, 'DELETE'); items.splice(items.indexOf(it), 1); }
        else if (b.dataset.act === 'claim') { await api(`/items/${id}/claim`, 'POST'); it.claimed = it.mine = true; }
        else { await api(`/items/${id}/claim`, 'DELETE'); it.claimed = it.mine = false; }
      } catch (x) { show(err, x.message); if (b.dataset.act === 'claim') it.claimed = true; }
      draw();
    });
    document.querySelector('.chips').addEventListener('click', (e) => {
      const c = e.target.closest('.chip'); if (!c) return; filter = c.dataset.f;
      document.querySelectorAll('.chip').forEach((x) => x.setAttribute('aria-pressed', x === c)); draw();
    });
    document.getElementById('copy').addEventListener('click', async (e) => {
      try { await navigator.clipboard.writeText(location.href); e.target.textContent = 'Link copied'; } catch { e.target.textContent = 'Copy the address bar link'; }
    });
    document.getElementById('add')?.addEventListener('submit', async (e) => {
      e.preventDefault(); show(err, '');
      try { items.push((await api(`/lists/${slug}/items`, 'POST', formData(e.target))).item); e.target.reset(); draw(); }
      catch (x) { show(err, x.message); }
    });
  } };
}

// --- router ---
async function route() {
  const p = location.pathname; let m, v;
  try {
    if (p === '/') v = home();
    else if (p === '/login' || p === '/signup') v = me ? (go('/lists', true), null) : auth(p.slice(1));
    else if (p === '/lists') v = await dashboard();
    else if ((m = p.match(/^\/l\/([a-f0-9]+)$/))) v = await listView(m[1]);
    else v = { title: 'Not found – Wishly', html: '<div class="wrap"><section><h1 class="title">Page not found</h1><a href="/" data-link>Back to home</a></section></div>' };
  } catch (x) { v = { title: 'Error – Wishly', html: `<div class="wrap"><section><p class="err">${esc(x.message)}</p></section></div>` }; }
  if (!v) return;
  document.title = v.title; app.innerHTML = shell(v.html); v.bind?.();
  document.getElementById('logout')?.addEventListener('click', async () => { await api('/logout', 'POST'); me = null; go('/'); });
  window.scrollTo(0, 0);
}
function go(path, replace) { history[replace ? 'replaceState' : 'pushState']({}, '', path); return route(); }
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-link]');
  if (a && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) { e.preventDefault(); go(a.getAttribute('href')); }
});
addEventListener('popstate', route);
api('/me').then((d) => { me = d.user; }).catch(() => {}).finally(route);
