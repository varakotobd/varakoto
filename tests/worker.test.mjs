import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';

const source = await readFile(new URL('../worker.js', import.meta.url), 'utf8');
const factory = new Function(
  'html', 'crypto', 'TextEncoder', 'Response', 'URL',
  source.replace("import html from './index.html';", '').replace('export default', 'return')
);
const worker = factory('<!doctype html><html lang="bn">Vara Koto</html>', webcrypto, TextEncoder, Response, URL);

function environment(rows = []) {
  const operations = [];
  return {
    operations,
    ADMIN_TOKEN: 'local-test-token',
    RATE_LIMIT_SALT: 'local-test-salt',
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            operations.push({ sql, args });
            return this;
          },
          async first() {
            if (sql.includes('sqlite_master')) return { name: 'fare_reports' };
            return { count: 1 };
          },
          async all() { return { results: rows }; },
          async run() { return { meta: { changes: 1 } }; }
        };
      }
    }
  };
}
function url(path) { return 'https://varakoto.vkbd.workers.dev' + path; }
async function response(path, env = environment(), options = {}) {
  const res = await worker.fetch(new Request(url(path), options), env);
  return { res, json: res.headers.get('content-type')?.includes('application/json') ? await res.json() : null };
}
test('homepage loads and temporary workers.dev address is not indexed', async () => {
  const { res } = await response('/');
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Vara Koto/);
  assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow');
});
test('health endpoint checks that the D1 schema exists', async () => {
  const { res, json } = await response('/api/health');
  assert.equal(res.status, 200);
  assert.equal(json.ok, true);
});
test('fare search never invents missing information', async () => {
  const { res, json } = await response('/api/fares?origin=সাভার&destination=নবীনগর');
  assert.equal(res.status, 200);
  assert.equal(json.count, 0);
  assert.equal(json.median, undefined);
});
test('fare search calculates the median from approved reports', async () => {
  const env = environment([{ fare: 50, travel_date: '2026-10-01' }, { fare: 60, travel_date: '2026-09-30' }]);
  const { res, json } = await response('/api/fares?origin=সাভার&destination=নবীনগর', env);
  assert.equal(res.status, 200);
  assert.equal(json.median, 55);
  assert.equal(json.min, 50);
  assert.equal(json.max, 60);
  assert.equal(json.count, 2);
});
test('report submission rejects missing consent', async () => {
  const { res } = await response('/api/reports', environment(), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ origin: 'সাভার', destination: 'নবীনগর', fare: 60, travel_date: '2026-11-01', consent: false })
  });
  assert.equal(res.status, 400);
});
test('report submission is placed in review without requiring personal contact', async () => {
  const env = environment();
  const { res, json } = await response('/api/reports', env, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ origin: 'সাভার', destination: 'নবীনগর', fare: 60, travel_date: '2026-11-01', consent: true })
  });
  assert.equal(res.status, 201);
  assert.equal(json.ok, true);
  assert.ok(env.operations.some(x => x.sql.includes('INSERT INTO fare_reports')));
});
test('admin report list refuses unauthenticated requests', async () => {
  const { res } = await response('/api/admin/reports');
  assert.equal(res.status, 401);
});
test('admin report list loads for a valid token', async () => {
  const { res, json } = await response('/api/admin/reports', environment(), {
    headers: { authorization: 'Bearer local-test-token' }
  });
  assert.equal(res.status, 200);
  assert.deepEqual(json.reports, []);
});
test('missing routes are discovered from real reports only', async () => {
  const { json } = await response('/api/routes');
  assert.deepEqual(json.routes, []);
});

test('local vehicle fare estimates stay separated by transport type', async () => {
  const env = environment([
    { fare: 50, travel_date: '2026-11-01', vehicle_type: 'rickshaw' },
    { fare: 60, travel_date: '2026-11-01', vehicle_type: 'rickshaw' },
    { fare: 35, travel_date: '2026-11-01', vehicle_type: 'auto' },
    { fare: 180, travel_date: '2026-11-01', vehicle_type: 'cng' }
  ]);
  const { res, json } = await response('/api/estimates?origin=সাভার&destination=নবীনগর', env);
  assert.equal(res.status, 200);
  assert.equal(json.vehicles.find(x => x.id === 'rickshaw').median, 55);
  assert.equal(json.vehicles.find(x => x.id === 'auto').median, 35);
  assert.equal(json.vehicles.find(x => x.id === 'cng').median, 180);
  assert.equal(json.vehicles.find(x => x.id === 'easybike').count, 0);
});
test('road distance rejects out-of-country coordinates without contacting routing service', async () => {
  const { res } = await response('/api/route?origin_lat=12&origin_lon=90&destination_lat=23.8&destination_lon=90.3');
  assert.equal(res.status, 400);
});
test('very short place search does not contact third-party provider', async () => {
  const { res, json } = await response('/api/places?q=Dh');
  assert.equal(res.status, 200);
  assert.deepEqual(json.locations, []);
});
test('reported vehicle type is saved with the pending fare', async () => {
  const env = environment();
  const { res } = await response('/api/reports', env, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      origin: 'সাভার', destination: 'নবীনগর', vehicle_type: 'auto',
      fare: 40, travel_date: '2026-11-01', consent: true
    })
  });
  assert.equal(res.status, 201);
  const entry = env.operations.find(x => x.sql.includes('INSERT INTO fare_reports'));
  assert.ok(entry);
  assert.equal(entry.args.at(-1), 'auto');
});
test('Bengali pickup UI has four transport options and valid inline JS', async () => {
  const page = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(page, /পিকআপ লোকেশন/);
  assert.match(page, /ড্রপ লোকেশন/);
  assert.match(page, /ব্যাটারি অটো/);
  assert.match(page, /id="map"/);
  const scripts = [...page.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map(match => match[1]).filter(s => s.trim());
  assert.equal(scripts.length, 1);
  assert.doesNotThrow(() => new Function(scripts[0]));
});
