import html from './index.html';
const json=(obj,status=200)=>new Response(JSON.stringify(obj),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
const normalize=s=>String(s||'').normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('bn').slice(0,90);
const validName=s=>s.length>=2&&s.length<=90&&!/[<>\x00-\x1f]/.test(s);
const coords=(lat,lon)=>lat==null&&lon==null?true:Number.isFinite(lat)&&Number.isFinite(lon)&&lat>=20&&lat<=27&&lon>=88&&lon<=93;
async function sha(s){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');}
async function isAdmin(request,env){const header=request.headers.get('authorization')||'';const token=header.startsWith('Bearer ')?header.slice(7):'';if(!token||!env.ADMIN_TOKEN||token.length!==env.ADMIN_TOKEN.length)return false;const a=new TextEncoder().encode(token),b=new TextEncoder().encode(env.ADMIN_TOKEN);let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];return diff===0;}
export default {async fetch(request,env){
 const u=new URL(request.url),p=u.pathname;
 try {
 if(request.method==='GET'&&(p==='/'||p==='/index.html'))return new Response(html,{headers:{'content-type':'text/html; charset=utf-8','x-content-type-options':'nosniff','content-security-policy':"default-src 'self'; script-src 'self' https://unpkg.com 'unsafe-inline'; style-src 'self' https://unpkg.com 'unsafe-inline'; img-src 'self' data: https://*.tile.openstreetmap.org; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"}});
 if(request.method==='GET'&&p==='/api/health')return json({ok:true,service:'Vara Koto'});
 if(request.method==='GET'&&p==='/api/fares'){
  const origin=normalize(u.searchParams.get('origin')),destination=normalize(u.searchParams.get('destination'));
  if(!validName(origin)||!validName(destination))return json({error:'দুটি স্থান লিখুন।'},400);
  const r=await env.DB.prepare('SELECT fare,travel_date FROM fare_reports WHERE origin=? AND destination=? AND status=? ORDER BY travel_date DESC LIMIT 100').bind(origin,destination,'approved').all();
  const fares=r.results.map(x=>x.fare).sort((a,b)=>a-b),n=fares.length;
  if(!n)return json({count:0,message:'এই রুটের জন্য এখনো অনুমোদিত ভাড়ার তথ্য নেই।'});
  const median=n%2?fares[(n-1)/2]:(fares[n/2-1]+fares[n/2])/2;
  const counts=new Map();fares.forEach(x=>counts.set(x,(counts.get(x)||0)+1));const mode=[...counts].sort((a,b)=>b[1]-a[1]||a[0]-b[0])[0][0];
  return json({count:n,median,mode,min:fares[0],max:fares[n-1],latest:r.results[0].travel_date,disclaimer:'এটি কমিউনিটির তথ্যভিত্তিক আনুমানিক ভাড়া; নির্ধারিত ভাড়া নয়।'});
 }
 if(request.method==='POST'&&p==='/api/reports'){
  if(Number(request.headers.get('content-length')||0)>5000)return json({error:'অনুরোধ বড়।'},413);
  let b;try{b=await request.json();}catch{return json({error:'সঠিক তথ্য দিন।'},400)}
  const origin=normalize(b.origin),destination=normalize(b.destination),fare=Number(b.fare),date=String(b.travel_date||''),note=String(b.note||'').trim();
  if(!validName(origin)||!validName(destination)||origin===destination||!Number.isInteger(fare)||fare<1||fare>5000||note.length>300||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||date>new Date().toISOString().slice(0,10)||date<'2020-01-01'||b.consent!==true)return json({error:'তথ্য যাচাই করুন (স্থান, ভাড়া, তারিখ, সম্মতি)।'},400);
  const ol=b.origin_lat==null?null:Number(b.origin_lat),on=b.origin_lon==null?null:Number(b.origin_lon),dl=b.destination_lat==null?null:Number(b.destination_lat),dn=b.destination_lon==null?null:Number(b.destination_lon);
  if(!coords(ol,on)||!coords(dl,dn))return json({error:'অবস্থান সঠিক নয়।'},400);
  const day=new Date().toISOString().slice(0,10),fingerprint=await sha((request.headers.get('cf-connecting-ip')||'unknown')+'|'+(env.RATE_LIMIT_SALT||'')+'|'+day);
  await env.DB.prepare('INSERT INTO submission_limits(fingerprint,day,count) VALUES(?,?,1) ON CONFLICT(fingerprint,day) DO UPDATE SET count=count+1').bind(fingerprint,day).run();
  const limit=await env.DB.prepare('SELECT count FROM submission_limits WHERE fingerprint=? AND day=?').bind(fingerprint,day).first();
  if(limit.count>5)return json({error:'আজকের জমার সীমা শেষ। কাল আবার চেষ্টা করুন।'},429);
  await env.DB.prepare('INSERT INTO fare_reports(origin,destination,origin_lat,origin_lon,destination_lat,destination_lon,fare,travel_date,note) VALUES(?,?,?,?,?,?,?,?,?)').bind(origin,destination,ol,on,dl,dn,fare,date,note).run();
  return json({ok:true,message:'ধন্যবাদ! আপনার তথ্য যাচাইয়ের অপেক্ষায় আছে।'},201);
 }
 if(p.startsWith('/api/admin/')){
  if(!await isAdmin(request,env))return json({error:'অনুমতি নেই।'},401);
  if(request.method==='GET'&&p==='/api/admin/reports'){
   const status=u.searchParams.get('status')==='approved'?'approved':u.searchParams.get('status')==='rejected'?'rejected':'pending';
   const r=await env.DB.prepare('SELECT id,origin,destination,fare,travel_date,note,status,created_at FROM fare_reports WHERE status=? ORDER BY created_at DESC LIMIT 100').bind(status).all();return json({reports:r.results});
  }
  const m=p.match(/^\/api\/admin\/reports\/(\d+)$/);
  if(request.method==='PATCH'&&m){const b=await request.json();if(!['approved','rejected'].includes(b.status))return json({error:'ভুল স্ট্যাটাস।'},400);const r=await env.DB.prepare('UPDATE fare_reports SET status=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=? AND status=?').bind(b.status,Number(m[1]),'pending').run();return json({ok:r.meta.changes>0});}
 }
 return json({error:'পাওয়া যায়নি।'},404);
 }catch(e){console.error(e);return json({error:'সার্ভার সমস্যা। পরে চেষ্টা করুন।'},500)}
 }};
