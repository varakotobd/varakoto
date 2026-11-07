import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';

const source = await readFile(new URL('../worker.js', import.meta.url), 'utf8');
const logoModule = await readFile(new URL('../brand-logo.js', import.meta.url), 'utf8');
const logoMatch = logoModule.match(/export const logoBase64 = '([^']+)'/);
assert.ok(logoMatch, 'Official logo data must be available');
const testLogo = logoMatch[1];

const factory = new Function(
  'html', 'beauty', 'journal', 'about', 'articleCox', 'articleSreemangal',
  'articleRatargul', 'articleSavar', 'articleFares', 'logoBase64', 'atob', 'crypto', 'TextEncoder', 'Response', 'URL',
  source.replace(/^import\s+.+?\s+from\s+['"][^'"]+['"];?\s*$/gm, '').replace('export default', 'return')
);
const worker = factory('<!doctype html><html lang="bn">Vara Koto</html>',
  '<html>সৌন্দর্যের বাংলাদেশ</html>', '<html>ভ্রমণ ব্লগ</html>',
  '<html>আমাদের সম্পর্কে</html>', '<html>কক্সবাজার ভ্রমণ</html>',
  '<html>শ্রীমঙ্গল ভ্রমণ</html>', '<html>রাতারগুল</html>',
  '<html>সাভারের স্থানীয় রুট</html>', '<html>রিকশা ও অটো</html>',
  testLogo, value => Buffer.from(value, 'base64').toString('binary'),
  webcrypto, TextEncoder, Response, URL);

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
          async all() {
            if(sql.includes('PRAGMA table_info(fare_reports)'))
              return { results: ['id','origin','destination','origin_lat','origin_lon',
                'destination_lat','destination_lon','fare','travel_date','note',
                'vehicle_type','fare_basis','vehicle_variant','status'].map(name=>
                  ({name,notnull:0,pk:name==='id'?1:0,dflt_value:null})) };
            if(sql.includes('PRAGMA table_info(submission_limits)'))
              return { results:['fingerprint','day','count'].map(name=>
                ({name,notnull:0,pk:0,dflt_value:null})) };
            return { results: sql.includes('FROM curated_fares') ? guideRows : rows };
          },
          async run() { return { meta: { changes: 1 } }; }
        };
      }
    }
  };
}
function url(path) { return 'https://varakoto.rickshaw.workers.dev' + path; }
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
  assert.equal(json.submissions_ready, true);
  assert.equal(json.daily_submission_limit, 10000);
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


test('new editorial pages serve and retain noindex on temporary domain', async () => {
  for(const [path,label] of [['/beauty','সৌন্দর্যের বাংলাদেশ'],['/travel-blog','ভ্রমণ ব্লগ'],['/about','আমাদের সম্পর্কে']]){
    const {res}=await response(path);
    assert.equal(res.status,200);
    assert.equal(res.headers.get('x-robots-tag'),'noindex, nofollow');
    assert.match(await res.text(), new RegExp(label));
  }
});
test('the local search includes mapped CRP and Radio Colony stops', async () => {
  const {res,json}=await response('/api/places?q=crp');
  assert.equal(res.status,200);
  assert.ok(json.locations.some(p=>p.label.includes('সিআরপি')&&Number.isFinite(p.lat)&&Number.isFinite(p.lon)));
});


test('all five full-article routes resolve correctly and carry the temporary-domain noindex rule', async () => {
  const routes = [
    ['/travel-blog/coxsbazar','কক্সবাজার'],
    ['/travel-blog/sreemangal','শ্রীমঙ্গল'],
    ['/travel-blog/ratargul','রাতারগুল'],
    ['/travel-blog/savar-local','সাভারের স্থানীয়'],
    ['/travel-blog/local-fares','রিকশা ও অটো']
  ];
  for (const [path, label] of routes) {
    const { res } = await response(path);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow');
    assert.match(await res.text(), new RegExp(label));
  }
});
test('homepage shows selected route and fare results before the map and has no route animation', async () => {
  const page = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const resultPosition = page.indexOf('id="journeyLabel"');
  const mapPosition = page.indexOf('id="map"');
  assert.ok(resultPosition >= 0 && mapPosition > resultPosition);
  assert.match(page, /dashArray:'7,10'/);
  assert.match(page, /bindTooltip\(isEnd\?'ড্রপ':'পিকআপ'/);
  assert.doesNotMatch(page, /animation:route-flow/);
  assert.doesNotMatch(page, /map\.flyToBounds/);
});
test('travel landing and Bangladesh beauty pages link to completed destination subpages', async () => {
  const journal = await readFile(new URL('../travel-blog.html', import.meta.url), 'utf8');
  const beauty = await readFile(new URL('../beauty.html', import.meta.url), 'utf8');
  for (const slug of ['coxsbazar','sreemangal','ratargul']) {
    assert.ok(journal.includes('/travel-blog/' + slug));
    assert.ok(beauty.includes('/travel-blog/' + slug));
    const article = await readFile(new URL('../articles/' + slug + '.html', import.meta.url), 'utf8');
    assert.ok(article.includes('<article class="article">'));
    assert.ok((article.match(/<h2>/g)||[]).length >= 5);
  }
  // Local transport guides remain accessible by direct URL, but the Travel Blog
  // landing page intentionally shows the new Gallery instead of Local Journeys.
  for (const slug of ['savar-local','local-fares']) {
    assert.ok(!journal.includes('/travel-blog/' + slug));
    const article = await readFile(new URL('../articles/' + slug + '.html', import.meta.url), 'utf8');
    assert.ok(article.includes('<article class="article">'));
  }
});

test('official uploaded logo is a complete PNG and served from our own domain', async () => {
  const bytes = Buffer.from(testLogo, 'base64');
  assert.equal(bytes.length, 3175);
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(bytes.subarray(-8).toString('hex'), '49454e44ae426082');
  assert.equal(bytes.readUInt32BE(16), 120);
  const { res } = await response('/brand/logo.png');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  const image = Buffer.from(await res.arrayBuffer());
  assert.deepEqual(image, bytes);
});
test('all nine website pages display the uploaded official logo', async () => {
  const pages = ['index.html', 'beauty.html', 'travel-blog.html', 'about.html',
    'articles/coxsbazar.html', 'articles/sreemangal.html', 'articles/ratargul.html',
    'articles/savar-local.html', 'articles/local-fares.html'];
  for (const path of pages) {
    const html = await readFile(new URL('../' + path, import.meta.url), 'utf8');
    assert.match(html, /<header[\s\S]*?<img[^>]+src="https:\/\/varakoto\.wordpress\.com\/wp-content\/uploads\/2026\/11\/varakoto-transparent-official-logo\.png"/);
    assert.match(html, /rel="icon"[^>]+href="https:\/\/varakoto\.wordpress\.com\/wp-content\/uploads\/2026\/11\/varakoto-transparent-official-logo\.png"/);
  }
});

test('homepage cover matches colorful traditional rickshaw reference', async () => {
  const homepage = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const hero = homepage.match(/<div class="hero-art"[^>]*>([\s\S]*?)<\/div>/)?.[1] || '';
  assert.match(hero, /varakoto-transparent-official-logo\.png/);
  assert.match(hero, /বাংলাদেশের পথে পথে/);
  assert.match(homepage, /\.hero-art:before\{display:block!important\}/);
});

test('Chapain local suggestion has a sourced, explicitly approximate coordinate for km calculation',async()=>{
  // Two Bengali characters return local directory results without contacting Photon.
  const {res,json} = await response('/api/places?q='+encodeURIComponent('চা'));
  assert.equal(res.status,200);
  const chapain=json.locations.find(x=>x.name.includes('চাপাইন'));
  assert.ok(chapain,'Chapain should appear in hyperlocal suggestions');
  assert.equal(chapain.requires_map_pin,false);
  assert.equal(chapain.approximate,true);
  assert.ok(Number.isFinite(chapain.lat)&&Number.isFinite(chapain.lon));
  assert.match(chapain.location_hint,/আনুমানিক/);
});
test('route search shows km for approximate pins and requests a pin when no coordinates exist',async()=>{
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  assert.match(html,/usesApproximatePin/);
  assert.match(html,/lang\.format\(distance\)\+' কিমি'/);
  assert.match(html,/activateMapPick\(missing\)/);
  assert.match(html,/আনুমানিক এলাকার পিন/);
});

test('Savar New Market fares also match common English typo and Chapain aliases', async () => {
  const guideRows = [
    {vehicle_type:'rickshaw',fare:20,fare_basis:'per_ride',vehicle_variant:'rickshaw',source_note:''},
    {vehicle_type:'auto',fare:10,fare_basis:'per_person',vehicle_variant:'battery_auto',source_note:''}
  ];
  for (const [origin,destination] of [
    ['Savar New Markt','Chapain'],
    ['নিউ মার্কেট সাভার','চাপাইন বাজার'],
    ['New Market Savar','Chapain Savar']
  ]) {
    const search = new URLSearchParams({origin,destination});
    const {res,json} = await response('/api/estimates?'+search.toString(),environment([],guideRows));
    assert.equal(res.status,200);
    assert.equal(json.sample_route,'newmarket_chapain');
    assert.equal(json.vehicles.find(x=>x.id==='rickshaw').reference?.fare,20);
    assert.equal(json.vehicles.find(x=>x.id==='auto').reference?.fare,10);
  }
});


test('travel blog replaces local journeys section with an accessible photo gallery', async () => {
  const page = await readFile(new URL('../travel-blog.html', import.meta.url), 'utf8');
  assert.match(page, /id="gallery"/);
  assert.match(page, /গ্যালারি — ছবিতে সুন্দর বাংলাদেশ/);
  assert.doesNotMatch(page, /LOCAL JOURNEYS/);
  assert.doesNotMatch(page, /class="local-grid"/);
  const gallery = page.match(/<section id="gallery"[\s\S]*?<\/section>/)?.[0] || '';
  assert.equal((gallery.match(/class="gallery-photo"/g) || []).length, 3);
  for (const slug of ['coxsbazar', 'sreemangal', 'ratargul']) {
    assert.match(gallery, new RegExp('/travel-blog/' + slug));
  }
  assert.match(gallery, /href="\/beauty"/);
  assert.match(gallery, /loading="lazy"/);
});

test('homepage map is labelled Bangladesh-wide and resets to national bounds', async () => {
  const page = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(page, /id="mapInfo">📍 বাংলাদেশের মানচিত্র/);
  assert.match(page, /setText\('mapInfo','📍 বাংলাদেশের মানচিত্র'\)/);
  assert.doesNotMatch(page, /সাভারের মানচিত্র দেখানো হচ্ছে/);
  assert.match(page, /map\.fitBounds\(\[\[20\.55,88\.0\],\[26\.75,92\.75\]\]/);
});

test('fare reporting automatically creates missing submission limit table', async () => {
  const code = await readFile(new URL('../worker.js', import.meta.url), 'utf8');
  assert.match(code, /CREATE TABLE IF NOT EXISTS submission_limits/);
  assert.match(code, /await ensureSubmissionSchema\(env\)/);
  assert.match(code, /submissions_ready: !!env\.RATE_LIMIT_SALT/);
});


test('submission cap is 10000 daily across all visitors, with pending-review confirmation', async () => {
  const mkRequest = ip => ({
    method: 'POST',
    headers: {'content-type':'application/json','cf-connecting-ip':ip},
    body: JSON.stringify({
      origin:'সাভার নিউ মার্কেট',destination:'চাপাইন',
      fare:20,vehicle_type:'rickshaw',fare_basis:'per_ride',
      travel_date:'2026-11-07',consent:true
    })
  });
  const envA=environment();
  const envB=environment();
  const resultA=await response('/api/reports',envA,mkRequest('203.0.113.10'));
  const resultB=await response('/api/reports',envB,mkRequest('203.0.113.20'));
  assert.equal(resultA.res.status,201);
  assert.equal(resultB.res.status,201);
  assert.match(resultA.json.message,/আপনার ডাটা সফলভাবে সাবমিট হয়েছে/);
  assert.match(resultA.json.message,/যাচাইয়ের পর/);
  const upsertA=envA.operations.find(x=>x.sql.includes('INSERT INTO submission_limits'));
  const upsertB=envB.operations.find(x=>x.sql.includes('INSERT INTO submission_limits'));
  assert.ok(upsertA && upsertB, 'Daily cap is recorded');
  assert.equal(upsertA.args[0],upsertB.args[0], 'All visitor IPs share a site-wide counter');
  assert.equal(upsertA.args[2],10000);
  assert.match(upsertA.sql,/count < \?/);
});

test('daily submission cap sends 429 without inserting a fare report', async () => {
  const env=environment();
  const previous=env.DB.prepare.bind(env.DB);
  env.DB.prepare = sql => {
    const statement=previous(sql);
    if(sql.includes('INSERT INTO submission_limits')){
      statement.run=async()=>({meta:{changes:0}});
    }
    return statement;
  };
  const result=await response('/api/reports',env,{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({
      origin:'সাভার',destination:'নবীনগর',fare:20,
      travel_date:'2026-11-07',consent:true
    })
  });
  assert.equal(result.res.status,429);
  assert.match(result.json.error,/১০,০০০/);
  assert.ok(!env.operations.some(x=>x.sql.includes('INSERT INTO fare_reports')));
});

test('report form offers real place suggestions for both route inputs', async () => {
  const page=await readFile(new URL('../index.html',import.meta.url),'utf8');
  for(const id of ['rFrom','rTo']){
    assert.match(page,new RegExp('id="'+id+'"[^>]+aria-autocomplete="list"'));
    assert.match(page,new RegExp('id="'+id+'List" class="suggestions"'));
  }
  assert.match(page,/function makeReportPlaceHandler\(type\)/);
  assert.match(page,/api\('\/api\/places\?q='\+encodeURIComponent\(q\)/);
  assert.match(page,/reportCoordinates\[type\]=isCoord\(place\)/);
});
