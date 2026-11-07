import html from './index.html';
import { logoBase64 } from './brand-logo.js';
import beauty from './beauty.html';
import journal from './travel-blog.html';
import about from './about.html';
import articleCox from './articles/coxsbazar.html';
import articleSreemangal from './articles/sreemangal.html';
import articleRatargul from './articles/ratargul.html';
import articleSavar from './articles/savar-local.html';
import articleFares from './articles/local-fares.html';

const TRANSPORT = ['rickshaw', 'auto'];
const DAILY_SUBMISSION_LIMIT = 10000; // Total submissions across the site per Bangladesh calendar day.
const ARTICLE_PAGES = {
  '/travel-blog/coxsbazar': articleCox,
  '/travel-blog/sreemangal': articleSreemangal,
  '/travel-blog/ratargul': articleRatargul,
  '/travel-blog/savar-local': articleSavar,
  '/travel-blog/local-fares': articleFares
};
const MODES = { rickshaw: 'রিকশা', auto: 'ব্যাটারি অটো / লেগুনা' };
const BD = { minLat: 20, maxLat: 27, minLon: 88, maxLon: 93 };

// Fares explicitly supplied by the project owner. No journey dates were provided.
// These are route references, NOT government tariffs or independently verified rides.
const LANDMARKS = [
  { id:'savar_new_market', name:'সাভার নিউ মার্কেট', aliases:['savar new market','savar new markt','new markt','new market','newmarket','newmarket savar','new market savar','savar newmarket','সাভার নিউ মার্কেট','সাভার নিউমার্কেট','নিউ মার্কেট','নিউমার্কেট','নিউ মার্কেট সাভার','নিউমার্কেট সাভার'], lat:23.8506418, lon:90.2590522 },
  { id:'chapain', name:'চাপাইন, সাভার', aliases:['chapain','chapain savar','chapain bazar','chapain bazaar','চাপাইন','চাপাই','চাপাইন সাভার','চাপাইন বাজার'], lat:23.85121, lon:90.26947, approximate:true, location_hint:'চাপাইন বায়তুল মামুর জামে মসজিদের নিকটবর্তী আনুমানিক পিন; সঠিক ওঠানামার জায়গায় পিন ঠিক করুন।' },
  { id:'dewga', name:'দেওগা বাজার, সাভার', aliases:['dewga bazar','dewga bazaar','dewga bazar savar','dewga','deoga bazar','deoga bazaar','deoga bazar savar','দেওগা বাজার','দেওগাঁ বাজার','দেউগা বাজার','দেওগা','দেওগা বাজার সাভার'], lat:null, lon:null },
  { id:'crp', name:'সিআরপি, সাভার', aliases:['crp','crp savar','centre for the rehabilitation of the paralysed','সিআরপি','সিআরপি সাভার'], lat:23.8545053, lon:90.2602316 },
  { id:'radio_colony', name:'রেডিও কলোনি, সাভার', aliases:['radio colony','radio colony savar','savar colony','colony','রেডিও কলোনি','রেডিও কলোনী','কলোনি','কলোনী'], lat:23.858713, lon:90.262322 },
  { id:'shyamoli_square', name:'শ্যামলী স্কয়ার, ঢাকা', aliases:['shyamoli square','shyamoli square dhaka','shyamoy square','shyamoly square','শ্যামলী স্কয়ার','শ্যামলী স্কয়ার','শ্যামলী স্কয়ার ঢাকা'], lat:23.77445, lon:90.3654 },
  { id:'shia_masjid', name:'শিয়া মসজিদ, ঢাকা', aliases:['shia masjid','shia mosque','shia masjid dhaka','shiya mosjid','shiya masjid','শিয়া মসজিদ','শিয়া মসজিদ','শিয়া মসজিদ ঢাকা','শিয়া মসজিদ ঢাকা'], lat:23.7620647, lon:90.3591241 }
];
const ROUTE_GUIDES = [
  {key:'newmarket_chapain',from:'savar_new_market',to:'chapain',entries:[['rickshaw',20,'per_ride','rickshaw'],['auto',10,'per_person','battery_auto']]},
  {key:'newmarket_dewga',from:'savar_new_market',to:'dewga',note:'নিউ মার্কেট থেকে দেওগা বাজার ধরে নেওয়া হয়েছে; শুরুর স্থান নিশ্চিত করা প্রয়োজন।',entries:[['rickshaw',40,'per_ride','rickshaw'],['auto',20,'per_person','battery_auto']]},
  {key:'chapain_crp',from:'chapain',to:'crp',entries:[['rickshaw',20,'per_ride','rickshaw']]},
  {key:'chapain_radio_colony',from:'chapain',to:'radio_colony',entries:[['rickshaw',30,'per_ride','rickshaw']]},
  {key:'shyamoli_shia',from:'shyamoli_square',to:'shia_masjid',entries:[['rickshaw',30,'per_ride','rickshaw'],['auto',10,'per_person','leguna']]}
];
function landmarkOf(value) {
  const val=normalize(value).replace(/[.,;]+/g,' ').replace(/\s+/g,' ').trim();
  if (!val) return null;
  // Avoid equating Dhaka New Market with the separate Savar New Market.
  if ((val === 'new market dhaka' || val === 'নিউ মার্কেট ঢাকা') && !val.includes('savar')) return null;
  for (const p of LANDMARKS) {
    for (const name of p.aliases) {
      const alias=normalize(name);
      if (val===alias || val.startsWith(alias+' ') || val.startsWith(alias+',') ||
          (val.length < 60 && alias.length > 5 && val.endsWith(' '+alias))) return p;
    }
  }
  return null;
}
function guideFor(origin, destination) {
  const a=landmarkOf(origin),b=landmarkOf(destination);
  if(!a||!b)return null;
  return ROUTE_GUIDES.find(r=>r.from===a.id&&r.to===b.id)||null;
}
let guideReady=false;
async function ensureGuideSchema(env) {
  if(guideReady)return;
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS curated_fares("+
    "route_key TEXT NOT NULL, vehicle_type TEXT NOT NULL, fare INTEGER NOT NULL,"+
    "fare_basis TEXT NOT NULL, vehicle_variant TEXT NOT NULL,"+
    "source_note TEXT NOT NULL DEFAULT '', PRIMARY KEY(route_key,vehicle_type))"
  ).run();
  for(const r of ROUTE_GUIDES){
    for(const [mode,fare,basis,variant] of r.entries){
      await env.DB.prepare(
        "INSERT INTO curated_fares(route_key,vehicle_type,fare,fare_basis,vehicle_variant,source_note) "+
        "VALUES(?,?,?,?,?,?) ON CONFLICT(route_key,vehicle_type) DO NOTHING"
      ).bind(r.key,mode,fare,basis,variant,r.note||'').run();
    }
  }
  guideReady=true;
}
function publicGuideRoutes() {
  const byId = new Map(LANDMARKS.map(x=>[x.id,x]));
  return ROUTE_GUIDES.map(r=>({
    key:r.key,
    origin:byId.get(r.from).name,
    destination:byId.get(r.to).name,
    origin_location:byId.get(r.from),
    destination_location:byId.get(r.to),
    note:r.note||null
  }));
}

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
  const latest = await env.DB.prepare('PRAGMA table_info(fare_reports)').all();
  // Older D1 databases were created before local map coordinates were supported.
  // Add all coordinate columns before running location-aware fare searches.
  for (const [name, sql] of [
    ['fare_basis', "ALTER TABLE fare_reports ADD COLUMN fare_basis TEXT"],
    ['vehicle_variant', "ALTER TABLE fare_reports ADD COLUMN vehicle_variant TEXT"],
    ['note', "ALTER TABLE fare_reports ADD COLUMN note TEXT NOT NULL DEFAULT ''"],
    ['origin_lat', "ALTER TABLE fare_reports ADD COLUMN origin_lat REAL"],
    ['origin_lon', "ALTER TABLE fare_reports ADD COLUMN origin_lon REAL"],
    ['destination_lat', "ALTER TABLE fare_reports ADD COLUMN destination_lat REAL"],
    ['destination_lon', "ALTER TABLE fare_reports ADD COLUMN destination_lon REAL"]
  ]) {
    if (!(latest.results||[]).some(c=>c.name===name)) {
      try { await env.DB.prepare(sql).run(); }
      catch(err){ if(!/duplicate column name/i.test(String(err?.message||err))) throw err; }
    }
  }
  migrationFinished = true;
}
// Older live databases may have fare_reports but no submission_limits table.
// Create the rate-limit table on demand so a valid fare report does not fail with HTTP 500.
let submissionSchemaReady = false;
async function ensureSubmissionSchema(env) {
  if (submissionSchemaReady) return;
  await env.DB.prepare(
    'CREATE TABLE IF NOT EXISTS submission_limits (' +
    'fingerprint TEXT NOT NULL, day TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 1,' +
    'PRIMARY KEY (fingerprint, day))'
  ).run();
  submissionSchemaReady = true;
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
  if (query.length < 2 || query.length > 80) return json({ locations: [] });
  const term=normalize(query);
  const local=LANDMARKS.filter(p=>p.aliases.some(a=>{
    const alias=normalize(a);
    return alias.includes(term)||term.includes(alias);
  })).slice(0,5).map(p=>({
    name:p.name,label:p.name,lat:p.lat,lon:p.lon,local:true,
    approximate:!!p.approximate, location_hint:p.location_hint||null,
    // A location without known coordinates needs a user-selected map pin.
    requires_map_pin:p.lat==null
  }));
  if(query.length<3)return json({ locations:local, attribution:'Local route directory' });
  // Preserve very small local landmarks even when an external geocoder is slow or unavailable.
  const upstream = new URL('https://photon.komoot.io/api/');
  upstream.searchParams.set('q', query);
  upstream.searchParams.set('limit', '12');
  upstream.searchParams.set('bbox', '88,20,93,27');
  if (local.length || /সাভার|savar|চাপাইন|chapain|colony|কলোনি|কলোনী|crp|সিআরপি/i.test(query)) {
    upstream.searchParams.set('lat', '23.85064');
    upstream.searchParams.set('lon', '90.25905');
    upstream.searchParams.set('zoom', '14');
  }
  const seen = new Set(local.map(p => p.label));
  const locations = [...local];
  try {
    const response = await fetch(upstream.toString(), {
      headers: { accept: 'application/json', 'accept-language': 'en' },
      cf: { cacheTtl: 1800, cacheEverything: true },
      signal: AbortSignal.timeout(7000)
    });
    if (!response.ok) throw Error('Photon ' + response.status);
    const data = await response.json();
    for (const f of data.features || []) {
      const p = f.properties || {};
      const coords = f.geometry?.coordinates;
      if (!Array.isArray(coords) || !inBangladesh(Number(coords[1]), Number(coords[0]))) continue;
      if (p.countrycode && p.countrycode.toUpperCase() !== 'BD') continue;
      const label = placeNames(p);
      if (!label || seen.has(label)) continue;
      seen.add(label);
      locations.push({ name: String(p.name || label), label, lat: Number(coords[1]), lon: Number(coords[0]) });
      if (locations.length >= 9) break;
    }
    return json({ locations, attribution: '© OpenStreetMap contributors / Photon' }, 200, 'public, max-age=120');
  } catch (error) {
    console.warn('Photon geocoding temporarily unavailable', error?.message || error);
    return json({
      locations, fallback: true,
      message: locations.length ? 'স্থানীয় তালিকার তথ্য দেখানো হচ্ছে।' : 'স্থান খোঁজার সেবা পাওয়া যাচ্ছে না। মানচিত্রে পিন দিতে পারেন।'
    }, 200);
  }
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
function decodePolyline6(value) {
  if (typeof value !== 'string') return [];
  const points = [];
  let lat = 0, lon = 0, position = 0;
  const readNumber = () => {
    let shift = 0, result = 0, byte;
    do {
      if (position >= value.length || shift > 35) throw Error('Invalid polyline');
      byte = value.charCodeAt(position++) - 63;
      if (byte < 0) throw Error('Invalid polyline');
      result |= (byte & 31) << shift;
      shift += 5;
    } while (byte >= 32);
    return (result & 1) ? ~(result >> 1) : (result >> 1);
  };
  while (position < value.length && points.length < 12000) {
    lat += readNumber();
    lon += readNumber();
    points.push([lon / 1e6, lat / 1e6]);
  }
  return points;
}
async function route(url) {
  const query = Object.fromEntries(url.searchParams);
  const origin = locationPair(query, 'origin');
  const destination = locationPair(query, 'destination');
  if (!origin || !destination) return json({ error: 'মানচিত্রে দুটি সঠিক অবস্থান বাছুন।' }, 400);
  if (origin.lat === destination.lat && origin.lon === destination.lon) {
    return json({ error: 'আলাদা দুটি অবস্থান বাছুন।' }, 400);
  }
  const coords = origin.lon + ',' + origin.lat + ';' + destination.lon + ',' + destination.lat;
  const osrmQuery = coords + '?overview=full&geometries=geojson&steps=false&alternatives=false';
  const valhallaQuery = encodeURIComponent(JSON.stringify({
    locations: [{ lat: origin.lat, lon: origin.lon }, { lat: destination.lat, lon: destination.lon }],
    costing: 'auto', units: 'kilometers', language: 'en'
  }));
  const providers = [
    { type: 'valhalla', url: 'https://valhalla1.openstreetmap.de/route?json=' + valhallaQuery },
    { type: 'osrm', url: 'https://routing.openstreetmap.de/routed-car/route/v1/driving/' + osrmQuery },
    { type: 'osrm', url: 'https://router.project-osrm.org/route/v1/driving/' + osrmQuery }
  ];
  for (const provider of providers) {
    try {
      const response = await fetch(provider.url, {
        headers: {
          accept: 'application/json',
          'x-client-id': 'varakoto.rickshaw.workers.dev'
        },
        cf: { cacheTtl: 3600, cacheEverything: true },
        signal: AbortSignal.timeout(5500)
      });
      if (!response.ok) continue;
      const body = await response.json();
      let distance = null, geometry = [];
      if (provider.type === 'valhalla') {
        const length = Number(body.trip?.summary?.length);
        if (Number.isFinite(length) && length > 0 && length < 2000) {
          distance = length;
          try { geometry = decodePolyline6(body.trip?.legs?.[0]?.shape); } catch {}
        }
      } else {
        const result = body.routes?.[0];
        if (result && Number.isFinite(result.distance) &&
            result.distance > 0 && result.distance < 2000000) {
          distance = result.distance / 1000;
          geometry = Array.isArray(result.geometry?.coordinates) ? result.geometry.coordinates : [];
        }
      }
      if (!Number.isFinite(distance) || distance <= 0) continue;
      return json({
        distance_km: Math.round(distance * 10) / 10,
        geometry: geometry.length > 1 ? geometry : [],
        type: 'road',
        description: 'সড়কপথের আনুমানিক দূরত্ব; রিকশা বা অটোর বাস্তব পথ আলাদা হতে পারে।',
        attribution: '© OpenStreetMap contributors / ' + (provider.type === 'valhalla' ? 'Valhalla' : 'OSRM')
      }, 200, 'public, max-age=300');
    } catch (error) {
      console.warn('External routing provider unavailable', error?.message || error);
    }
  }
  return json({ error: 'সড়কপথের দূরত্ব এখন পাওয়া যাচ্ছে না। সরলরেখার দূরত্ব ব্যবহার করুন।' }, 502);
}
async function estimates(url, env) {
  await ensureTransportSchema(env);
  await ensureGuideSchema(env);
  const origin = normalize(url.searchParams.get('origin'));
  const destination = normalize(url.searchParams.get('destination'));
  if (!validPlace(origin) || !validPlace(destination) || origin === destination) {
    return json({ error: 'শুরু ও গন্তব্যের স্থান সঠিকভাবে লিখুন।' }, 400);
  }
  const p = Object.fromEntries(url.searchParams);
  const from = locationPair(p, 'origin'), to = locationPair(p, 'destination');
  if (from === false || to === false) return json({ error: 'অবস্থানের স্থানাঙ্ক সঠিক নয়।' }, 400);
  const routeGuide = guideFor(origin,destination);
  const normalizedOrigin=landmarkOf(origin)?.name ? normalize(landmarkOf(origin).name) : origin;
  const normalizedDestination=landmarkOf(destination)?.name ? normalize(landmarkOf(destination).name) : destination;
  let sql = "SELECT fare,travel_date,vehicle_type,fare_basis,vehicle_variant FROM fare_reports " +
    "WHERE status='approved' AND (origin=? AND destination=?)";
  let args = [normalizedOrigin, normalizedDestination];
  if (from && to) {
    const tolerance = 0.002;
    sql = "SELECT fare,travel_date,vehicle_type,fare_basis,vehicle_variant FROM fare_reports "+
      "WHERE status='approved' AND ((origin=? AND destination=?) OR "+
      "(origin_lat BETWEEN ? AND ? AND origin_lon BETWEEN ? AND ? AND "+
      "destination_lat BETWEEN ? AND ? AND destination_lon BETWEEN ? AND ?))";
    args = [normalizedOrigin, normalizedDestination,
      from.lat-tolerance,from.lat+tolerance,from.lon-tolerance,from.lon+tolerance,
      to.lat-tolerance,to.lat+tolerance,to.lon-tolerance,to.lon+tolerance];
  }
  const reportResult = await env.DB.prepare(sql+' ORDER BY travel_date DESC LIMIT 500').bind(...args).all();
  const rows = reportResult.results || [];
  const guideRows = routeGuide ? (await env.DB.prepare(
    "SELECT vehicle_type,fare,fare_basis,vehicle_variant,source_note FROM curated_fares WHERE route_key=?"
  ).bind(routeGuide.key).all()).results || [] : [];
  const vehicles = TRANSPORT.map(id=>{
    // Never mix fares per rider with fares for the entire vehicle.
    const basis = id==='rickshaw'?'per_ride':'per_person';
    const matching=rows.filter(row=>
      (row.vehicle_type||'rickshaw')===id &&
      (id==='rickshaw'?(!row.fare_basis||row.fare_basis==='per_ride'):row.fare_basis==='per_person')
    );
    const guideEntry=guideRows.find(r=>r.vehicle_type===id);
    const reference=guideEntry?{
      fare:guideEntry.fare,basis:guideEntry.fare_basis,
      variant:guideEntry.vehicle_variant,source:'owner_provided',
      note:guideEntry.source_note||null,
      dated:false
    }:null;
    return {id,label:MODES[id],unit:basis,...summary(matching),reference};
  });
  return json({
    origin,destination,vehicles,
    sample_route:routeGuide?.key||null,
    disclaimer:'স্থানীয়ভাবে শেয়ার করা ভাড়া এবং যাচাই করা রিপোর্ট আলাদা করে দেখানো হয়। এগুলো সরকারি নির্ধারিত ভাড়া নয়।'
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
  if (!data.count) return json({ count: 0, vehicle_type: vehicle, message: 'এই রুটের জন্য এখনো অনুমোদিত ভাড়ার তথ্য নেই।' });
  return json({ ...data, vehicle_type: vehicle,
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
  const basis = body.fare_basis || (vehicle==='auto'?'per_person':'per_ride');
  const variant = vehicle==='auto'?(body.vehicle_variant==='leguna'?'leguna':'battery_auto'):'rickshaw';
  const fare = Number(body.fare);
  const note = String(body.note || '').trim();
  const from = locationPair(body, 'origin'), to = locationPair(body, 'destination');
  if (!validPlace(origin) || !validPlace(destination) || origin === destination ||
      !vehicle || !['per_person','per_ride'].includes(basis) ||
      (variant==='leguna'&&basis!=='per_person') ||
      !Number.isInteger(fare) || fare < 1 || fare > 5000 || !validTravelDate(body.travel_date) ||
      note.length > 300 || body.consent !== true || from === false || to === false) {
    return json({ error: 'স্থান, পরিবহন, ভাড়া, তারিখ ও সম্মতির তথ্য যাচাই করুন।' }, 400);
  }
  await ensureTransportSchema(env);
  await ensureSubmissionSchema(env);
  const day = new Date(Date.now() + 6 * 3600000).toISOString().slice(0, 10);
  // One atomic D1 counter shared by all visitors: up to 10,000 submissions/day.
  // Do not count each IP separately; that would allow more than the site-wide cap.
  const fingerprint = await sha(['varakoto-sitewide', env.RATE_LIMIT_SALT, day].join('|'));
  const tracked = await env.DB.prepare(
    'INSERT INTO submission_limits(fingerprint,day,count) VALUES(?,?,1) ' +
    'ON CONFLICT(fingerprint,day) DO UPDATE SET count=count+1 WHERE count < ?'
  ).bind(fingerprint, day, DAILY_SUBMISSION_LIMIT).run();
  if (!tracked.meta?.changes) return json({ error: 'আজকের ১০,০০০টি তথ্য জমার সীমা পূর্ণ হয়েছে। আগামীকাল আবার চেষ্টা করুন।' }, 429);
  await env.DB.prepare(
    'INSERT INTO fare_reports(origin,destination,origin_lat,origin_lon,destination_lat,destination_lon,fare,travel_date,note,vehicle_type,fare_basis,vehicle_variant) ' +
    'VALUES(?,?,?,?,?,?,?,?,?,?,?,?)'
  ).bind(
    origin, destination, from?.lat ?? null, from?.lon ?? null, to?.lat ?? null, to?.lon ?? null,
    fare, String(body.travel_date), note, vehicle, basis, variant
  ).run();
  return json({ ok: true, message: 'আপনার ডাটা সফলভাবে সাবমিট হয়েছে। যাচাইয়ের পর প্রকাশ করা হবে।' }, 201);
}
async function admin(request, url, env) {
  if (!isAdmin(request, env)) return json({ error: 'অ্যাডমিন অনুমতি নেই।' }, 401);
  await ensureTransportSchema(env);
  const path = url.pathname;
  if (request.method === 'GET' && path === '/api/admin/reports') {
    const status = url.searchParams.get('status');
    const selected = ['pending', 'approved', 'rejected'].includes(status) ? status : 'pending';
    const result = await env.DB.prepare(
      'SELECT id,origin,destination,vehicle_type,vehicle_variant,fare_basis,fare,travel_date,note,status,created_at ' +
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
      if ((request.method === 'GET' || request.method === 'HEAD') && (path === '/brand/logo.png' || path === '/favicon.ico')) {
        const image = Uint8Array.from(atob(logoBase64), char => char.charCodeAt(0));
        return new Response(request.method === 'HEAD' ? null : image, {
          headers: {
            ...commonHeaders,
            'content-type': 'image/png',
            'cache-control': 'public, max-age=3600',
            'x-content-type-options': 'nosniff'
          }
        });
      }
      if ((request.method === 'GET' || request.method === 'HEAD') && (path === '/' || path === '/index.html' || path === '/beauty' || path === '/beauty/' || path === '/travel-blog' || path === '/travel-blog/' || path === '/about' || path === '/about/' || !!ARTICLE_PAGES[path.replace(/\/$/, '')])) {
        const headers = {
          ...commonHeaders,
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'public, max-age=120',
          'content-security-policy': "default-src 'self'; script-src 'self' https://unpkg.com 'unsafe-inline'; " +
            "style-src 'self' https://unpkg.com 'unsafe-inline'; " +
            "img-src 'self' data: https://*.tile.openstreetmap.org https://*.wordpress.com https://*.wp.com https://upload.wikimedia.org; " +
            "connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
        };
        if (tempDomain) headers['x-robots-tag'] = 'noindex, nofollow';
        const page = ARTICLE_PAGES[path.replace(/\/$/, '')] ||
          (path.startsWith('/beauty') ? beauty : path.startsWith('/travel-blog') ? journal : path.startsWith('/about') ? about : html);
        return new Response(request.method === 'HEAD' ? null : page, { headers });
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
        if (!table) return json({ ok: false, error: 'Database setup incomplete' }, 503);
        // Repair legacy report and rate-limit schemas before declaring submissions ready.
        await ensureTransportSchema(env);
        await ensureSubmissionSchema(env);
        // Read-only schema checks: detect older columns that block INSERTs without
        // generating fake submissions or exposing actual report data.
        const fareInfo = await env.DB.prepare('PRAGMA table_info(fare_reports)').all();
        const limitInfo = await env.DB.prepare('PRAGMA table_info(submission_limits)').all();
        const fareCols = fareInfo.results || [], limitCols = limitInfo.results || [];
        const fareInsertNames = ['origin','destination','origin_lat','origin_lon',
          'destination_lat','destination_lon','fare','travel_date','note',
          'vehicle_type','fare_basis','vehicle_variant'];
        const limitInsertNames = ['fingerprint','day','count'];
        const missingFareColumns = fareInsertNames.filter(name => !fareCols.some(c=>c.name===name));
        const unexpectedRequiredColumns = fareCols.filter(c =>
          Number(c.notnull) === 1 && Number(c.pk)!==1 && c.dflt_value==null &&
          !fareInsertNames.includes(c.name)).map(c=>c.name);
        const missingLimitColumns = limitInsertNames.filter(name => !limitCols.some(c=>c.name===name));
        return json({
          ok: true, service: 'Vara Koto',
          submissions_ready: !!env.RATE_LIMIT_SALT &&
            !missingFareColumns.length && !unexpectedRequiredColumns.length &&
            !missingLimitColumns.length,
          daily_submission_limit: DAILY_SUBMISSION_LIMIT
        });
      }
      if (request.method === 'GET' && path === '/api/places') return await places(url);
      if (request.method === 'GET' && path === '/api/reverse') return await reverse(url);
      if (request.method === 'GET' && path === '/api/route') return await route(url);
      if (request.method === 'GET' && path === '/api/estimates') return await estimates(url, env);
      if (request.method === 'GET' && path === '/api/fares') return await fares(url, env);
      if (request.method === 'GET' && path === '/api/routes') {
        await ensureGuideSchema(env);
        return json({ routes:publicGuideRoutes() });
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
