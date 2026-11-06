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

function environment(rows = [], guideRows = []) {
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
          async all() { return { results: sql.includes('FROM curated_fares') ? guideRows : rows }; },
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
test('five explicitly supplied sample routes are listed without fabricated journey dates', async () => {
  const {json} = await response('/api/routes');
  assert.equal(json.routes.length,5);
  assert.ok(json.routes.some(r=>r.key==='newmarket_chapain'));
  assert.ok(json.routes.some(r=>r.key==='shyamoli_shia'));
});

test('local vehicle fare estimates stay separated by transport type', async () => {
  const env = environment([
    { fare: 50, travel_date: '2026-11-01', vehicle_type: 'rickshaw' },
    { fare: 60, travel_date: '2026-11-01', vehicle_type: 'rickshaw' },
    { fare: 35, travel_date: '2026-11-01', vehicle_type: 'auto', fare_basis:'per_person' },
    { fare: 180, travel_date: '2026-11-01', vehicle_type: 'cng' }
  ]);
  const { res, json } = await response('/api/estimates?origin=সাভার&destination=নবীনগর', env);
  assert.equal(res.status, 200);
  assert.equal(json.vehicles.find(x => x.id === 'rickshaw').median, 55);
  assert.equal(json.vehicles.find(x => x.id === 'auto').median, 35);
  assert.deepEqual(json.vehicles.map(x=>x.id),['rickshaw','auto']);
});
test('road distance rejects out-of-country coordinates without contacting routing service', async () => {
  const { res } = await response('/api/route?origin_lat=12&origin_lon=90&destination_lat=23.8&destination_lon=90.3');
  assert.equal(res.status, 400);
});
test('two-letter place search uses only our local landmark directory', async () => {
  const { res, json } = await response('/api/places?q=Dh');
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(json.locations));
  assert.ok(json.locations.every(x=>x.local === true));
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
  assert.equal(entry.args.at(-3), 'auto');
  assert.equal(entry.args.at(-2), 'per_person');
  assert.equal(entry.args.at(-1), 'battery_auto');
});
test('Bengali pickup UI has two transport options, accurate map controls and valid inline JS', async () => {
  const page = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(page, /পিকআপ লোকেশন/);
  assert.match(page, /ড্রপ লোকেশন/);
  assert.match(page, /অটো \/ লেগুনা/);
  assert.doesNotMatch(page, /data-mode="cng"/);
  assert.doesNotMatch(page, /data-mode="easybike"/);
  assert.match(page, /id="pickFrom"/);
  assert.match(page, /id="pickTo"/);
  assert.match(page, /id="map"/);
  const scripts = [...page.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map(match => match[1]).filter(s => s.trim());
  assert.equal(scripts.length, 1);
  assert.doesNotThrow(() => new Function(scripts[0]));
});

test('New Market to Chapain uses the supplied Tk 20 per ride and Tk 10 per person, not fake approved reports',async()=>{
 const guide=[
  {vehicle_type:'rickshaw',fare:20,fare_basis:'per_ride',vehicle_variant:'rickshaw',source_note:''},
  {vehicle_type:'auto',fare:10,fare_basis:'per_person',vehicle_variant:'battery_auto',source_note:''}
 ];
 const {res,json}=await response('/api/estimates?origin=সাভার%20নিউ%20মার্কেট&destination=চাপাইন',environment([],guide));
 assert.equal(res.status,200);
 assert.equal(json.sample_route,'newmarket_chapain');
 assert.deepEqual(json.vehicles.map(x=>x.id),['rickshaw','auto']);
 const r=json.vehicles.find(x=>x.id==='rickshaw');
 const a=json.vehicles.find(x=>x.id==='auto');
 assert.equal(r.count,0);
 assert.equal(r.reference.fare,20);
 assert.equal(r.reference.basis,'per_ride');
 assert.equal(a.reference.fare,10);
 assert.equal(a.reference.basis,'per_person');
});
test('Shyamoli Square to Shia Masjid Leguna fare is per-person',async()=>{
 const guide=[{vehicle_type:'auto',fare:10,fare_basis:'per_person',vehicle_variant:'leguna',source_note:''}];
 const {res,json}=await response('/api/estimates?origin=Shyamoli%20Square&destination=Shia%20Masjid',environment([],guide));
 assert.equal(res.status,200);
 assert.equal(json.sample_route,'shyamoli_shia');
 const a=json.vehicles.find(x=>x.id==='auto');
 assert.equal(a.reference.variant,'leguna');
 assert.equal(a.reference.fare,10);
});
test('the unfinished Dewga origin is transparently flagged',async()=>{
 const {json}=await response('/api/routes');
 const route=json.routes.find(x=>x.key==='newmarket_dewga');
 assert.match(route.note,/নিউ মার্কেট/);
});
test('a legacy CNG submission is rejected from the two-option public API',async()=>{
 const {res}=await response('/api/reports',environment(),{
  method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({origin:'সাভার',destination:'নবীনগর',vehicle_type:'cng',fare:150,travel_date:'2026-11-01',consent:true})
 });
 assert.equal(res.status,400);
});
