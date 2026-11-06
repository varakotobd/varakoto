import html from './index.html';

const TRANSPORT = ['rickshaw', 'auto', 'cng', 'easybike'];
const MODES = {
  rickshaw: 'রিকশা',
  auto: 'ব্যাটারি অটো',
  cng: 'সিএনজি',
  easybike: 'ইজিবাইক'
};
const BD = { minLat: 20, maxLat: 27, minLon: 88, maxLon: 93 };
const commonHeaders = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), payment=()',
  'x-frame-options': 'DENY'
};
const json = (value, status = 200, cache = 'no-store') =>
  new Response(JSON.stringify(value), {
    status,
    headers: { ...commonHeaders, 'content-type': 'application/json; charset=utf-8', 'cache-control': cache }
  });
const normalize = value => String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('bn');
const validPlace = value => value.length >= 2 && value.length <= 90 && !/[<>\x00-\x1f]/.test(value);
const inBangladesh = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) &&
  lat >= BD.minLat && lat <= BD.maxLat && lon >= BD.minLon && lon <= BD.maxLon;
function locationPair(data, prefix) {
  const lat = data[prefix + '_lat'];
  const lon = data[prefix + '_lon'];
  if (lat == null && lon == null) return null;
  if (lat == null || lon == null) return false;
  const a = Number(lat), b = Number(lon);
  return inBangladesh(a, b) ? { lat: a, lon: b } : false;
}
function modeOf(value) {
  return TRANSPORT.includes(value) ? value : null;
}
function isSameOrigin(request, url) {
  const from = request.headers.get('origin');
  return !from || from === url.origin;
}
function validTravelDate(value) {
  const date = String(value ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(date + 'T00:00:00.000Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date &&
    date >= '2020-01-01' &&
    date <= new Date(Date.now() + 6 * 3600000).toISOString().slice(0, 10);
}
async function sha(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, '0')).join('');
}
function isAdmin(request, env) {
  const authorization = request.headers.get('authorization') || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const stored = env.ADMIN_TOKEN || '';
  if (!token || !stored || token.length !== stored.length) return false;
  const a = new TextEncoder().encode(token), b = new TextEncoder().encode(stored);
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}
async function readJSON(request) {
  if (!(request.headers.get('content-type') || '').toLowerCase().includes('application/json')) return null;
  if (Number(request.headers.get('content-length') || 0) > 6000) return null;
  const body = await request.text();
  if (body.length > 6000) return null;
  try {
    const result = JSON.parse(body);
    return result && typeof result === 'object' && !Array.isArray(result) ? result : null;
  } catch { return null; }
}
let migrationFinished = false;
async function ensureTransportSchema(env) {
  if (migrationFinished) return;
  const columns = await env.DB.prepare('PRAGMA table_info(fare_reports)').all();
  const found = (columns.results || []).some(c => c.name === 'vehicle_type');
  if (!found) {
    try {
      await env.DB.prepare("ALTER TABLE fare_reports ADD COLUMN vehicle_type TEXT NOT NULL DEFAULT 'rickshaw'").run();
    } catch (err) {
      if (!/duplicate column name/i.test(String(err?.message ?? err))) throw err;
    }
  }
  migrationFinished = true;
}
function summary(reports) {
  const values = reports.map(r => Number(r.fare)).filter(Number.isFinite).sort((a, b) => a - b);
  const n = values.length;
  if (!n) return { count: 0, median: null, mode: null, min: null, max: null, latest: null };
  const median = n % 2 ? values[(n - 1) / 2] : (values[n / 2 - 1] + values[n / 2]) / 2;
  const counts = new Map();
  values.forEach(v => counts.set(v, (counts.get(v) || 0) + 1));
  const common = [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
  return { count: n, median, mode: common, min: values[0], max: values[n - 1], latest: reports[0]?.travel_date || null };
}
const placeNames = properties => {
  const parts = [properties.name, properties.street, properties.city, properties.district, properties.state]
    .filter(v => typeof v === 'string' && v.trim());
  return [...new Set(parts)].slice(0, 3).join(', ');
};
async function places(url) {
  const query = String(url.searchParams.get('q') || '').trim().replace(/\s+/g, ' ');
  if (query.length < 3 || query.length > 80) return json({ locations: [] });
  const upstream = new URL('https://photon.komoot.io/api/');
  upstream.searchParams.set('q', query);
  upstream.searchParams.set('limit', '7');
  upstream.searchParams.set('bbox', '88,20,93,27');
  const response = await fetch(upstream.toString(), {
    headers: { accept: 'application/json', 'accept-language': 'en' },
    cf: { cacheTtl: 1800, cacheEverything: true },
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) return json({ locations: [], error: 'স্থান খোঁজার সেবা আপাতত পাওয়া যাচ্ছে না।' }, 502);
  const data = await response.json();
  const seen = new Set();
  const locations = [];
  for (const f of data.features || []) {
    const p = f.properties || {};
    const coords = f.geometry?.coordinates;
    if (!Array.isArray(coords) || !inBangladesh(Number(coords[1]), Number(coords[0]))) continue;
    if (p.countrycode && p.countrycode.toUpperCase() !== 'BD') continue;
    const label = placeNames(p);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    locations.push({ name: String(p.name || label), label, lat: Number(coords[1]), lon: Number(coords[0]) });
    if (locations.length >= 5) break;
  }
  return json({ locations, attribution: '© OpenStreetMap contributors / Photon' }, 200, 'public, max-age=300');
}
async function reverse(url) {
  const lat = Number(url.searchParams.get('lat')), lon = Number(url.searchParams.get('lon'));
  if (!inBangladesh(lat, lon)) return json({ error: 'বাংলাদেশের মধ্যে সঠিক অবস্থান দিন।' }, 400);
  const endpoint = new URL('https://photon.komoot.io/reverse');
  endpoint.searchParams.set('lat', String(lat));
  endpoint.searchParams.set('lon', String(lon));
  endpoint.searchParams.set('limit', '1');
  const response = await fetch(endpoint.toString(), {
    headers: { accept: 'application/json', 'accept-language': 'en' },
    cf: { cacheTtl: 1800, cacheEverything: true },
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) return json({ error: 'বর্তমান অবস্থানের নাম পাওয়া যাচ্ছে না।' }, 502);
  const body = await response.json();
  const p = body.features?.[0]?.properties || {};
  const label = placeNames(p).slice(0, 90);
  if (!label) return json({ error: 'বর্তমান অবস্থানের নাম পাওয়া যায়নি।' }, 404);
  return json({ location: { label, lat, lon } }, 200, 'public, max-age=300');
}
async function route(url) {
  const origin = locationPair(Object.fromEntries(url.searchParams), 'origin');
  const destination = locationPair(Object.fromEntries(url.searchParams), 'destination');
  if (!origin || !destination) return json({ error: 'মানচিত্রে দুটি সঠিক অবস্থান বাছুন।' }, 400);
  if (origin.lat === destination.lat && origin.lon === destination.lon) return json({ error: 'আলাদা দুটি অবস্থান বাছুন।' }, 400);
  const path = origin.lon + ',' + origin.lat + ';' + destination.lon + ',' + destination.lat;
  const endpoint = 'https://router.project-osrm.org/route/v1/driving/' + path +
    '?overview=full&geometries=geojson&steps=false&alternatives=false';
  const response = await fetch(endpoint, {
    headers: { accept: 'application/json' },
    cf: { cacheTtl: 3600, cacheEverything: true },
    signal: AbortSignal.timeout(9000)
  });
  if (!response.ok) return json({ error: 'রাস্তার দূরত্ব এখন পাওয়া যাচ্ছে না।' }, 502);
  const body = await response.json();
  const result = body.routes?.[0];
  if (!result || !Number.isFinite(result.distance) || result.distance <= 0 || result.distance > 2000000 ||
      !Array.isArray(result.geometry?.coordinates)) {
    return json({ error: 'এই রুটে রাস্তার দূরত্ব পাওয়া যায়নি।' }, 502);
  }
  return json({
    distance_km: Math.round(result.distance / 100) / 10,
    geometry: result.geometry.coordinates,
    type: 'road',
    description: 'মোটরযানের রাস্তা ধরে আনুমানিক দূরত্ব; রিকশা বা অটোর প্রকৃত পথ আলাদা হতে পারে।',
    attribution: '© OpenStreetMap contributors / OSRM'
  }, 200, 'public, max-age=300');
}
async function estimates(url, env) {
  await ensureTransportSchema(env);
  const origin = normalize(url.searchParams.get('origin'));
  const destination = normalize(url.searchParams.get('destination'));
  if (!validPlace(origin) || !validPlace(destination) || origin === destination) {
    return json({ error: 'শুরু ও গন্তব্যের স্থান সঠিকভাবে লিখুন।' }, 400);
  }
  const p = Object.fromEntries(url.searchParams);
  const from = locationPair(p, 'origin'), to = locationPair(p, 'destination');
  if (from === false || to === false) return json({ error: 'অবস্থানের স্থানাঙ্ক সঠিক নয়।' }, 400);
  let sql = "SELECT fare,travel_date,vehicle_type FROM fare_reports WHERE status='approved' AND (origin=? AND destination=?)";
  let args = [origin, destination];
  if (from && to) {
    const tolerance = 0.006;
    sql = "SELECT fare,travel_date,vehicle_type FROM fare_reports WHERE status='approved' AND " +
      "((origin=? AND destination=?) OR " +
      "(origin_lat BETWEEN ? AND ? AND origin_lon BETWEEN ? AND ? AND " +
      "destination_lat BETWEEN ? AND ? AND destination_lon BETWEEN ? AND ?))";
    args = [
      origin, destination,
      from.lat - tolerance, from.lat + tolerance, from.lon - tolerance, from.lon + tolerance,
      to.lat - tolerance, to.lat + tolerance, to.lon - tolerance, to.lon + tolerance
    ];
  }
  const result = await env.DB.prepare(sql + ' ORDER BY travel_date DESC LIMIT 500').bind(...args).all();
  const rows = result.results || [];
  const vehicles = TRANSPORT.map(id => {
    const matching = rows.filter(r => (r.vehicle_type || 'rickshaw') === id);
    return { id, label: MODES[id], ...summary(matching) };
  });
  return json({
    origin, destination, vehicles,
    disclaimer: 'ভাড়া কেবল অনুমোদিত যাত্রী রিপোর্টের ওপর ভিত্তি করে; এটি সরকারি বা নিশ্চিত ভাড়া নয়।',
    matching: 'দুই স্থান বা কাছাকাছি নির্বাচিত অবস্থানের রিপোর্ট'
  });
}
async function fares(url, env) {
  await ensureTransportSchema(env);
  const origin = normalize(url.searchParams.get('origin'));
  const destination = normalize(url.searchParams.get('destination'));
  const vehicle = modeOf(url.searchParams.get('vehicle') || 'rickshaw');
  if (!validPlace(origin) || !validPlace(destination) || origin === destination || !vehicle) {
    return json({ error: 'সঠিক স্থান ও যানবাহন নির্বাচন করুন।' }, 400);
  }
  const result = await env.DB.prepare(
    "SELECT fare,travel_date FROM fare_reports WHERE origin=? AND destination=? AND status='approved' AND vehicle_type=? ORDER BY travel_date DESC LIMIT 100"
  ).bind(origin, destination, vehicle).all();
  const data = summary(result.results || []);
  return json({ ...data, vehicle_type: vehicle,
    ...(data.count ? {} : { message: 'এই রুটের জন্য এখনো অনুমোদিত ভাড়ার তথ্য নেই।' }),
    disclaimer: 'এটি কমিউনিটির তথ্যভিত্তিক আনুমানিক ভাড়া; নির্ধারিত ভাড়া নয়।'
  });
}
async function reports(request, url, env) {
  if (!isSameOrigin(request, url)) return json({ error: 'অনুমোদিত ওয়েবসাইট থেকে অনুরোধ করুন।' }, 403);
  if (!env.RATE_LIMIT_SALT) return json({ error: 'নিরাপত্তা সেটআপ অসম্পূর্ণ।' }, 503);
  const body = await readJSON(request);
  if (!body) return json({ error: 'সঠিকভাবে তথ্য পূরণ করুন।' }, 400);
  const origin = normalize(body.origin), destination = normalize(body.destination);
  const vehicle = modeOf(body.vehicle_type || 'rickshaw');
  const fare = Number(body.fare);
  const note = String(body.note || '').trim();
  const from = locationPair(body, 'origin'), to = locationPair(body, 'destination');
  if (!validPlace(origin) || !validPlace(destination) || origin === destination ||
      !vehicle || !Number.isInteger(fare) || fare < 1 || fare > 5000 || !validTravelDate(body.travel_date) ||
      note.length > 300 || body.consent !== true || from === false || to === false) {
    return json({ error: 'স্থান, পরিবহন, ভাড়া, তারিখ ও সম্মতির তথ্য যাচাই করুন।' }, 400);
  }
  await ensureTransportSchema(env);
  const day = new Date(Date.now() + 6 * 3600000).toISOString().slice(0, 10);
  const fingerprint = await sha([
    request.headers.get('cf-connecting-ip') || 'unknown',
    env.RATE_LIMIT_SALT, day
  ].join('|'));
  const tracked = await env.DB.prepare(
    'INSERT INTO submission_limits(fingerprint,day,count) VALUES(?,?,1) ' +
    'ON CONFLICT(fingerprint,day) DO UPDATE SET count=count+1 WHERE count<5'
  ).bind(fingerprint, day).run();
  if (!tracked.meta?.changes) return json({ error: 'আজকের জমার সীমা শেষ। আগামীকাল চেষ্টা করুন।' }, 429);
  await env.DB.prepare(
    'INSERT INTO fare_reports(origin,destination,origin_lat,origin_lon,destination_lat,destination_lon,fare,travel_date,note,vehicle_type) ' +
    'VALUES(?,?,?,?,?,?,?,?,?,?)'
  ).bind(
    origin, destination, from?.lat ?? null, from?.lon ?? null, to?.lat ?? null, to?.lon ?? null,
    fare, String(body.travel_date), note, vehicle
  ).run();
  return json({ ok: true, message: 'ধন্যবাদ! আপনার ভাড়ার তথ্য যাচাইয়ের জন্য জমা হয়েছে।' }, 201);
}
async function admin(request, url, env) {
  if (!isAdmin(request, env)) return json({ error: 'অ্যাডমিন অনুমতি নেই।' }, 401);
  await ensureTransportSchema(env);
  const path = url.pathname;
  if (request.method === 'GET' && path === '/api/admin/reports') {
    const status = url.searchParams.get('status');
    const selected = ['pending', 'approved', 'rejected'].includes(status) ? status : 'pending';
    const result = await env.DB.prepare(
      'SELECT id,origin,destination,vehicle_type,fare,travel_date,note,status,created_at ' +
      'FROM fare_reports WHERE status=? ORDER BY created_at DESC LIMIT 100'
    ).bind(selected).all();
    return json({ reports: result.results || [] });
  }
  const id = path.match(/^\/api\/admin\/reports\/(\d+)$/);
  if (request.method === 'PATCH' && id) {
    if (!isSameOrigin(request, url)) return json({ error: 'অনুমোদিত ওয়েবসাইট থেকে অনুরোধ করুন।' }, 403);
    const body = await readJSON(request);
    if (!body || !['approved', 'rejected'].includes(body.status)) return json({ error: 'ভুল সিদ্ধান্ত।' }, 400);
    const result = await env.DB.prepare(
      "UPDATE fare_reports SET status=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'"
    ).bind(body.status, Number(id[1])).run();
    return json({ ok: !!result.meta?.changes });
  }
  return json({ error: 'পাওয়া যায়নি।' }, 404);
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url), path = url.pathname;
    const tempDomain = url.hostname.endsWith('.workers.dev');
    try {
      if ((request.method === 'GET' || request.method === 'HEAD') && (path === '/' || path === '/index.html')) {
        const headers = {
          ...commonHeaders,
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'public, max-age=120',
          'content-security-policy': "default-src 'self'; script-src 'self' https://unpkg.com 'unsafe-inline'; " +
            "style-src 'self' https://unpkg.com 'unsafe-inline'; " +
            "img-src 'self' data: https://*.tile.openstreetmap.org https://*.wordpress.com https://*.wp.com; " +
            "connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
        };
        if (tempDomain) headers['x-robots-tag'] = 'noindex, nofollow';
        return new Response(request.method === 'HEAD' ? null : html, { headers });
      }
      if (request.method === 'GET' && path === '/robots.txt')
        return new Response(tempDomain ? 'User-agent: *\nDisallow: /\n' : 'User-agent: *\nAllow: /\n', {
          headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' }
        });
      if (request.method === 'GET' && path === '/api/health') {
        if (!env.DB) return json({ ok: false, error: 'Database binding missing' }, 503);
        const table = await env.DB.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='fare_reports'"
        ).first();
        return table ? json({ ok: true, service: 'Vara Koto' }) :
          json({ ok: false, error: 'Database setup incomplete' }, 503);
      }
      if (request.method === 'GET' && path === '/api/places') return await places(url);
      if (request.method === 'GET' && path === '/api/reverse') return await reverse(url);
      if (request.method === 'GET' && path === '/api/route') return await route(url);
      if (request.method === 'GET' && path === '/api/estimates') return await estimates(url, env);
      if (request.method === 'GET' && path === '/api/fares') return await fares(url, env);
      if (request.method === 'GET' && path === '/api/routes') {
        await ensureTransportSchema(env);
        const list = await env.DB.prepare(
          "SELECT origin,destination,vehicle_type,COUNT(*) AS reports FROM fare_reports " +
          "WHERE status='approved' GROUP BY origin,destination,vehicle_type " +
          "ORDER BY reports DESC,origin LIMIT 8"
        ).all();
        return json({ routes: list.results || [] });
      }
      if (request.method === 'POST' && path === '/api/reports') return await reports(request, url, env);
      if (path.startsWith('/api/admin/')) return await admin(request, url, env);
      return json({ error: 'পাওয়া যায়নি।' }, 404);
    } catch (err) {
      console.error('Vara Koto:', err);
      return json({ error: 'সেবা সাময়িকভাবে পাওয়া যাচ্ছে না। আবার চেষ্টা করুন।' }, 500);
    }
  }
};
