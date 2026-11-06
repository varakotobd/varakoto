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
