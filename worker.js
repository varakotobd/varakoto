import html from './index.html';

const security = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), payment=()',
  'x-frame-options': 'DENY'
};
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...security, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}
function clean(value) {
  return String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('bn');
}
function validPlace(value) {
  return value.length >= 2 && value.length <= 90 && !/[<>\x00-\x1f]/.test(value);
}
function validCoordinate(lat, lon) {
  if (lat == null && lon == null) return true;
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= 20 && lat <= 27 && lon >= 88 && lon <= 93;
}
async function digest(value) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash), x => x.toString(16).padStart(2, '0')).join('');
}
function authorized(request, env) {
  const auth = request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const expected = env.ADMIN_TOKEN || '';
  if (!token || !expected || token.length !== expected.length) return false;
  const a = new TextEncoder().encode(token);
  const b = new TextEncoder().encode(expected);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
async function bodyJSON(request) {
  const type = request.headers.get('content-type') || '';
  if (!type.toLowerCase().includes('application/json')) return null;
  if (Number(request.headers.get('content-length') || 0) > 6000) return null;
  const body = await request.text();
  if (body.length > 6000) return null;
  try {
    const obj = JSON.parse(body);
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : null;
  } catch { return null; }
}
function sameOrigin(request, url) {
  const origin = request.headers.get('origin');
  return !origin || origin === url.origin;
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const isWorkersDomain = url.hostname.endsWith('.workers.dev');
    try {
      if ((request.method === 'GET' || request.method === 'HEAD') && (path === '/' || path === '/index.html')) {
        const headers = {
          ...security,
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'public, max-age=120',
          'content-security-policy': "default-src 'self'; script-src 'self' https://unpkg.com 'unsafe-inline'; style-src 'self' https://unpkg.com 'unsafe-inline'; img-src 'self' data: https://*.tile.openstreetmap.org https://*.wordpress.com https://*.wp.com; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
        };
        if (isWorkersDomain) headers['x-robots-tag'] = 'noindex, nofollow';
        return new Response(request.method === 'HEAD' ? null : html, { headers });
      }

      if (request.method === 'GET' && path === '/robots.txt') {
        return new Response(isWorkersDomain ? 'User-agent: *\nDisallow: /\n' : 'User-agent: *\nAllow: /\n', {
          headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' }
        });
      }

      if (request.method === 'GET' && path === '/api/health') {
        if (!env.DB) return json({ ok: false, error: 'Database binding missing' }, 503);
        const table = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='fare_reports'").first();
        if (!table) return json({ ok: false, error: 'Database setup incomplete' }, 503);
        return json({ ok: true, service: 'Vara Koto' });
      }

      if (request.method === 'GET' && path === '/api/fares') {
        const origin = clean(url.searchParams.get('origin'));
        const destination = clean(url.searchParams.get('destination'));
        if (!validPlace(origin) || !validPlace(destination) || origin === destination) {
          return json({ error: 'সঠিক যাত্রার শুরু ও গন্তব্য লিখুন।' }, 400);
        }
        const result = await env.DB.prepare(
          'SELECT fare,travel_date FROM fare_reports WHERE origin=? AND destination=? AND status=? ORDER BY travel_date DESC LIMIT 100'
        ).bind(origin, destination, 'approved').all();
        const entries = result.results || [];
        const fares = entries.map(x => Number(x.fare)).filter(Number.isFinite).sort((a, b) => a - b);
        const n = fares.length;
        if (!n) return json({ count: 0, message: 'এই রুটে এখনো অনুমোদিত ভাড়ার তথ্য নেই। আপনার অভিজ্ঞতা শেয়ার করতে পারেন।' });
        const median = n % 2 ? fares[(n - 1) / 2] : (fares[n / 2 - 1] + fares[n / 2]) / 2;
        const frequencies = new Map();
        fares.forEach(x => frequencies.set(x, (frequencies.get(x) || 0) + 1));
        const mode = [...frequencies.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
        return json({
          count: n, median, mode, min: fares[0], max: fares[n - 1],
          latest: entries[0]?.travel_date,
          disclaimer: 'এটি কমিউনিটির তথ্যভিত্তিক আনুমানিক ভাড়া; নির্ধারিত ভাড়া নয়।'
        });
      }

      if (request.method === 'GET' && path === '/api/routes') {
        const result = await env.DB.prepare(
          "SELECT origin,destination,COUNT(*) AS reports FROM fare_reports WHERE status='approved' GROUP BY origin,destination ORDER BY reports DESC,origin LIMIT 8"
        ).all();
        return json({ routes: result.results || [] });
      }

      if (request.method === 'POST' && path === '/api/reports') {
        if (!sameOrigin(request, url)) return json({ error: 'অনুমোদিত ওয়েবসাইট থেকে অনুরোধ করুন।' }, 403);
        if (!env.RATE_LIMIT_SALT) return json({ error: 'সার্ভারের নিরাপত্তা সেটআপ অসম্পূর্ণ।' }, 503);
        const data = await bodyJSON(request);
        if (!data) return json({ error: 'সঠিক ফরম্যাটে তথ্য দিন।' }, 400);
        const origin = clean(data.origin);
        const destination = clean(data.destination);
        const fare = Number(data.fare);
        const travelDate = String(data.travel_date || '');
        const note = String(data.note || '').trim();
        const parsedDate = new Date(travelDate + 'T00:00:00Z');
        const dateIsValid = /^\d{4}-\d{2}-\d{2}$/.test(travelDate) && Number.isFinite(parsedDate.getTime()) && parsedDate.toISOString().slice(0, 10) === travelDate;
        if (!validPlace(origin) || !validPlace(destination) || origin === destination ||
            !Number.isInteger(fare) || fare < 1 || fare > 5000 || note.length > 300 ||
            !dateIsValid || travelDate > new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString().slice(0, 10) ||
            travelDate < '2020-01-01' || data.consent !== true) {
          return json({ error: 'স্থান, ভাড়া, তারিখ ও সম্মতির তথ্য যাচাই করুন।' }, 400);
        }
        const originLat = data.origin_lat == null ? null : Number(data.origin_lat);
        const originLon = data.origin_lon == null ? null : Number(data.origin_lon);
        const destinationLat = data.destination_lat == null ? null : Number(data.destination_lat);
        const destinationLon = data.destination_lon == null ? null : Number(data.destination_lon);
        if (!validCoordinate(originLat, originLon) || !validCoordinate(destinationLat, destinationLon)) {
          return json({ error: 'অবস্থান বাংলাদেশের মধ্যে হতে হবে।' }, 400);
        }
        const day = new Date().toISOString().slice(0, 10);
        const fingerprint = await digest([request.headers.get('cf-connecting-ip') || 'unknown', env.RATE_LIMIT_SALT, day].join('|'));
        const limited = await env.DB.prepare(
          'INSERT INTO submission_limits(fingerprint,day,count) VALUES(?,?,1) ON CONFLICT(fingerprint,day) DO UPDATE SET count=count+1 WHERE count<5'
        ).bind(fingerprint, day).run();
        if (!limited.meta || limited.meta.changes === 0) return json({ error: 'আজকের জমা দেওয়ার সীমা শেষ। আগামীকাল চেষ্টা করুন।' }, 429);
        await env.DB.prepare(
          'INSERT INTO fare_reports(origin,destination,origin_lat,origin_lon,destination_lat,destination_lon,fare,travel_date,note) VALUES(?,?,?,?,?,?,?,?,?)'
        ).bind(origin, destination, originLat, originLon, destinationLat, destinationLon, fare, travelDate, note).run();
        return json({ ok: true, message: 'ধন্যবাদ! আপনার ভাড়া যাচাইয়ের জন্য জমা হয়েছে।' }, 201);
      }

      if (path.startsWith('/api/admin/')) {
        if (!authorized(request, env)) return json({ error: 'অ্যাডমিন অনুমতি নেই।' }, 401);
        if (request.method === 'GET' && path === '/api/admin/reports') {
          const requested = url.searchParams.get('status');
          const status = ['pending', 'approved', 'rejected'].includes(requested) ? requested : 'pending';
          const result = await env.DB.prepare(
            'SELECT id,origin,destination,fare,travel_date,note,status,created_at FROM fare_reports WHERE status=? ORDER BY created_at DESC LIMIT 100'
          ).bind(status).all();
          return json({ reports: result.results || [] });
        }
        const match = path.match(/^\/api\/admin\/reports\/(\d+)$/);
        if (request.method === 'PATCH' && match) {
          if (!sameOrigin(request, url)) return json({ error: 'অনুমোদিত ওয়েবসাইট থেকে অনুরোধ করুন।' }, 403);
          const data = await bodyJSON(request);
          if (!data || !['approved', 'rejected'].includes(data.status)) return json({ error: 'ভুল সিদ্ধান্ত।' }, 400);
          const result = await env.DB.prepare(
            "UPDATE fare_reports SET status=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'"
          ).bind(data.status, Number(match[1])).run();
          return json({ ok: !!result.meta?.changes });
        }
      }
      return json({ error: 'পাওয়া যায়নি।' }, 404);
    } catch (error) {
      console.error('Vara Koto worker error', error);
      return json({ error: 'সার্ভার সমস্যা। অনুগ্রহ করে আবার চেষ্টা করুন।' }, 500);
    }
  }
};
