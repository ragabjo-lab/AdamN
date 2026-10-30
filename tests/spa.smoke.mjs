/**
 * Optional browser-level smoke test (not part of `npm test`).
 * Requires a running seeded server and happy-dom:
 *   npm install --no-save happy-dom
 *   npm start            # in another terminal
 *   node tests/spa.smoke.mjs
 * Verifies that the SPA boots, every route renders, and no runtime errors occur.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Window } from 'happy-dom';

const BASE = 'http://localhost:4000';
let cookie = '';
const realFetch = globalThis.fetch;

async function apiFetch(url, init = {}) {
  const full = String(url).startsWith('http') ? String(url) : BASE + String(url);
  const headers = { ...(init.headers || {}) };
  if (cookie) headers.cookie = cookie;
  const res = await realFetch(full, { ...init, headers, redirect: 'follow' });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  return res;
}

// login first to obtain a session cookie for the "logged-in" run
const login = await apiFetch('/api/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-adamn-client': '1' },
  body: JSON.stringify({ username: 'admin', password: 'AdamN2026' }),
});
if (!login.ok) throw new Error('login failed: ' + login.status);
console.log('logged in, cookie ok:', cookie.slice(0, 18) + '…');

// copy ES modules into a "type: module" package so Node can import them
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adamn-spa-'));
fs.cpSync(path.join(process.cwd(), 'public/js'), path.join(dir, 'js'), { recursive: true });
fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ type: 'module' }));

const html = fs.readFileSync(path.join(process.cwd(), 'public/index.html'), 'utf8')
  .replace(/<script type="module"[\s\S]*?<\/script>/, '');

const window = new Window({ url: `${BASE}/`, width: 1440, height: 900 });
window.document.write(html);

globalThis.window = window;
globalThis.document = window.document;
globalThis.HTMLElement = window.HTMLElement;
globalThis.Node = window.Node;
globalThis.Event = window.Event;
globalThis.CustomEvent = window.CustomEvent;
globalThis.localStorage = window.localStorage;
globalThis.location = window.location;
try { Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true }); } catch { /* node owns navigator */ }
globalThis.fetch = apiFetch;
globalThis.FormData = globalThis.FormData || window.FormData;
globalThis.URL = window.URL;
window.fetch = apiFetch;
window.setInterval = setInterval;
window.setTimeout = setTimeout;
window.addEventListener = window.addEventListener.bind(window);

const errors = [];
window.addEventListener('error', (e) => errors.push('window error: ' + e.message));
const origError = console.error;
console.error = (...args) => { errors.push('console.error: ' + args.join(' ')); origError(...args); };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('--- booting SPA (logged in) ---');
await import(`file://${path.join(dir, 'js/app.js')}?v=1`);
await sleep(1200);

const $ = (sel) => window.document.querySelector(sel);
const appVisible = !$('#app').classList.contains('hidden');
const bootHidden = $('#boot').classList.contains('hidden');
console.log('app visible:', appVisible, '| boot hidden:', bootHidden);
console.log('user name:', $('#user-name')?.textContent, '| role:', $('#user-role')?.textContent);
console.log('students table rendered:', !!$('#students-table-host table'));
console.log('rows:', window.document.querySelectorAll('#students-table-host tbody tr').length);
console.log('stats:', window.document.querySelectorAll('#students-stats .stat').length);
console.log('nav tabs:', window.document.querySelectorAll('#main-tabs .tab').length);
console.log('notif badge:', $('#notif-badge').textContent, 'hidden:', $('#notif-badge').classList.contains('hidden'));

// navigate through every route
for (const route of ['staff', 'revenue', 'expenses', 'finance', 'settings', 'students']) {
  window.location.hash = `#/${route}`;
  window.dispatchEvent(new window.Event('hashchange'));
  await sleep(700);
  const view = $('#view');
  const heading = view.querySelector('h1')?.textContent || view.querySelector('h2')?.textContent || '(none)';
  const cards = view.querySelectorAll('.card').length;
  const rowsCount = view.querySelectorAll('table.data tbody tr').length;
  const errs = view.querySelectorAll('.field-error').length;
  console.log(`route ${route}: heading="${heading}" cards=${cards} rows=${rowsCount} errors=${errs} textLen=${view.textContent.trim().length}`);
}

// simulate a payment click on a student cell
window.location.hash = '#/students';
window.dispatchEvent(new window.Event('hashchange'));
await sleep(800);
const payBtn = window.document.querySelector('[data-pay]');
if (payBtn) {
  payBtn.click();
  await sleep(300);
  const modalOpen = !!$('.modal-backdrop');
  console.log('payment modal opens:', modalOpen, '| inputs:', window.document.querySelectorAll('.modal input').length);
  window.document.querySelector('.modal-close')?.click();
}

// open the notification panel
$('#btn-notifications').click();
await sleep(600);
console.log('notification items:', window.document.querySelectorAll('.notif-item').length);

// settings: open each section
window.location.hash = '#/settings';
window.dispatchEvent(new window.Event('hashchange'));
await sleep(700);
for (const section of ['dataFile', 'users', 'security', 'system', 'audit', 'general']) {
  const btn = window.document.querySelector(`#settings-nav button[data-section="${section}"]`);
  if (!btn) { console.log(`settings ${section}: nav missing`); continue; }
  btn.click();
  await sleep(250);
  const host = window.document.querySelector('#settings-host');
  console.log(`settings ${section}: cards=${host.querySelectorAll('.card').length} errors=${host.querySelectorAll('.field-error').length} len=${host.textContent.trim().length}`);
}

// language toggle → English / LTR
window.document.querySelector('#btn-lang').click();
await sleep(900);
console.log('after lang toggle → dir:', window.document.documentElement.dir, '| lang:', window.document.documentElement.lang,
  '| heading:', window.document.querySelector('#view h1')?.textContent);
window.location.hash = '#/staff';
window.dispatchEvent(new window.Event('hashchange'));
await sleep(700);
console.log('staff (EN) heading:', window.document.querySelector('#view h1')?.textContent, '| errors:', window.document.querySelectorAll('.field-error').length);

// login screen (no session)
cookie = '';
const w2 = new Window({ url: `${BASE}/`, width: 1200, height: 900 });
w2.document.write(fs.readFileSync(path.join(process.cwd(), 'public/index.html'), 'utf8').replace(/<script type="module"[\s\S]*?<\/script>/, ''));
globalThis.window = w2; globalThis.document = w2.document;
globalThis.localStorage = w2.localStorage; globalThis.location = w2.location;
w2.fetch = apiFetch;
const errs2 = [];
w2.addEventListener('error', (e) => errs2.push('window error: ' + e.message));
await import(`file://${path.join(dir, 'js/app.js')}?v=login`);
await sleep(900);
console.log('login form rendered:', !!w2.document.querySelector('#auth-form'), '| fields:', w2.document.querySelectorAll('#auth-form input').length);
console.log('login errors:', errs2.length);

console.log('--- page errors ---');
console.log(errors.length ? errors.slice(0, 8).join('\n') : 'none');
window.close();
process.exit(0);
