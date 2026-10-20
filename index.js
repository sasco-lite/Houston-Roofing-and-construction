// Public website + booking API. Exports the Express app (Vercel serverless; no app.listen).
const express = require('express'), crypto = require('crypto'), { MongoClient } = require('mongodb');

// ---- Client details: replace every [PLACEHOLDER] with verified information ----
const C = {
  name: '[BUSINESS NAME]', phone: '[PHONE e.g. +1 555 000 0000]', wa: '[WHATSAPP DIGITS ONLY]',
  email: '[EMAIL]', address: '[BUSINESS ADDRESS]', area: '[SERVICE AREA]', hours: '[BUSINESS HOURS]',
  url: process.env.SITE_URL || ''
};
const SERVICES = [
  ['New Roof Installation', 'Complete roofing systems built to last.'],
  ['Roof Repairs', 'Leaks, missing shingles and storm damage fixed fast.'],
  ['Roof Replacement', 'Strip-off and replacement with clear, written scope.'],
  ['Roof Inspections', 'A full check with photos and an honest report.'],
  ['Gutters', 'Installation, repair and cleaning.'],
  ['Renovations', 'Extensions and general construction work.']
];
const STATUSES = ['Pending', 'Confirmed', 'In Progress', 'Completed', 'Cancelled'];

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use((q, r, n) => {
  r.set({
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains', 'Permissions-Policy': 'geolocation=(), camera=()',
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
  });
  n();
});
app.use(express.json({ limit: '10kb' }));

// ---- Cached MongoDB connection (reused across warm serverless invocations) ----
const g = global.__mongo || (global.__mongo = {});
async function db() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set');
  if (!g.p) g.p = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 5, serverSelectionTimeoutMS: 6000 }).connect().catch(e => { g.p = null; throw e; });
  return (await g.p).db('roofing');
}
// Fixed-window rate limiter stored in MongoDB (works across serverless instances)
async function hit(key, max, win) {
  const c = (await db()).collection('ratelimits'), now = Date.now();
  const d = await c.findOneAndUpdate({ _id: key, t: { $gt: now } }, { $inc: { n: 1 } }, { returnDocument: 'after' });
  if (d) return d.n <= max;
  await c.replaceOne({ _id: key }, { _id: key, n: 1, t: now + win }, { upsert: true });
  return true;
}
const s = (v, m) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, m);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
const ip = q => (q.headers['x-forwarded-for'] || q.ip || '').split(',')[0].trim();

// Shared by the public form and the admin editor
function validate(b, partial) {
  const v = {}, e = [];
  const f = (k, fn) => { if (!partial || k in b) fn(); };
  f('name', () => { v.name = s(b.name, 80); if (v.name.length < 2) e.push('Enter your name.'); });
  f('phone', () => { v.phone = s(b.phone, 25); const d = v.phone.replace(/\D/g, ''); if (!/^\+?[0-9\s\-().]+$/.test(v.phone) || d.length < 7 || d.length > 15) e.push('Enter a valid phone number.'); });
  f('email', () => { v.email = s(b.email, 120).toLowerCase(); if (v.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.email)) e.push('Enter a valid email or leave it blank.'); });
  f('address', () => { v.address = s(b.address, 200); if (v.address.length < 5) e.push('Enter the property address.'); });
  f('service', () => { v.service = s(b.service, 60); if (!SERVICES.some(x => x[0] === v.service)) e.push('Choose a service.'); });
  f('date', () => {
    v.date = s(b.date, 10); const t = Date.parse(v.date + 'T00:00:00Z'), today = Date.parse(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date) || isNaN(t) || (!partial && t < today) || t > today + 366 * 864e5) e.push('Choose a valid date within the next year.');
  });
  f('time', () => { v.time = s(b.time, 5); if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v.time)) e.push('Choose a preferred time.'); });
  f('description', () => { v.description = s(b.description, 1000); if (v.description.length < 10) e.push('Describe the job in at least 10 characters.'); });
  return { v, e };
}

app.post('/api/bookings', async (q, r) => {
  try {
    if (q.body.website) return r.json({ ok: true, bookingId: 'BK-0' }); // honeypot: silently drop bots
    if (!(await hit('book:' + ip(q), 5, 36e5))) return r.status(429).json({ error: 'Too many requests. Please call us instead.' });
    const { v, e } = validate(q.body || {});
    if (e.length) return r.status(400).json({ error: e[0], errors: e });
    const col = (await db()).collection('bookings');
    if (await col.findOne({ phone: v.phone, address: v.address, date: v.date, status: { $in: ['Pending', 'Confirmed'] } }))
      return r.status(409).json({ error: 'A booking for this address and date already exists. We will contact you shortly.' });
    const doc = { bookingId: 'BK-' + crypto.randomBytes(4).toString('hex').toUpperCase(), ...v, status: 'Pending', createdAt: new Date(), updatedAt: new Date() };
    await col.insertOne(doc);
    r.status(201).json({ ok: true, bookingId: doc.bookingId });
  } catch (err) { console.error(err); r.status(500).json({ error: 'Could not save your booking. Please call us.' }); }
});

require('./admin')(app, { db, hit, s, esc, ip, validate, STATUSES, SERVICES, C });

const ph = C.phone.replace(/[^\d+]/g, ''), wa = 'https://wa.me/' + C.wa.replace(/\D/g, '');
const ld = JSON.stringify({ '@context': 'https://schema.org', '@type': 'RoofingContractor', name: C.name, telephone: C.phone, email: C.email, address: C.address, areaServed: C.area, openingHours: C.hours, url: C.url }).replace(/</g, '\\u003c');
const page = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(C.name)} | Roofing & Construction in ${esc(C.area)}</title>
<meta name="description" content="${esc(C.name)} provides roof installation, repair, replacement, inspections and gutters in ${esc(C.area)}. Book a free estimate online.">
<meta property="og:title" content="${esc(C.name)} | Roofing & Construction"><meta property="og:description" content="Book a free roofing estimate online."><meta property="og:type" content="website"><meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Cpath d='M2 17 16 5l14 12h-4v10H6V17z' fill='%23F26A1B'/%3E%3C/svg%3E">
<script type="application/ld+json">${ld}</script>
<style>
:root{--bg:#FAF6F0;--card:#fff;--ink:#2B2F36;--mute:#5d6470;--or:#E85D0C;--or2:#FF8A3D;--bl:#14385C;--bl2:#1f5a94;--r:18px}
*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:76px}
body{margin:0;font:17px/1.6 "Trebuchet MS","Segoe UI",system-ui,sans-serif;color:var(--ink);background:var(--bg);animation:in .5s ease}
@keyframes in{from{opacity:0}}h1,h2,h3{font-family:Georgia,"Times New Roman",serif;line-height:1.15;margin:0 0 .5em;color:var(--bl)}
h1{font-size:clamp(2.2rem,6vw,3.8rem)}h2{font-size:clamp(1.7rem,4vw,2.4rem)}a{color:inherit}
:focus-visible{outline:3px solid var(--or);outline-offset:3px}
.w{max-width:1120px;margin:auto;padding:0 20px}section{padding:72px 0}
nav{position:sticky;top:0;z-index:20;background:rgba(250,246,240,.92);backdrop-filter:blur(8px);box-shadow:0 1px 8px #0001}
nav .w{display:flex;align-items:center;gap:16px;height:64px}.logo{font:700 1.15rem Georgia,serif;color:var(--bl);text-decoration:none;display:flex;gap:8px;align-items:center;margin-right:auto}
nav ul{display:flex;gap:20px;list-style:none;margin:0;padding:0}nav ul a{text-decoration:none;font-weight:600}nav ul a:hover{color:var(--or)}
.btn{display:inline-block;border:0;cursor:pointer;font:700 1rem inherit;font-family:inherit;text-decoration:none;padding:12px 22px;border-radius:999px;transition:transform .15s,box-shadow .15s}
.clay{background:linear-gradient(145deg,var(--or2),var(--or));color:#fff;box-shadow:6px 6px 14px #e85d0c55,-3px -3px 8px #fff8,inset 2px 2px 5px #fff6,inset -3px -3px 6px #0002}
.clay:hover{transform:translateY(-2px)}.clay:active{transform:translateY(1px)}.ghost{background:#fff;color:var(--bl);box-shadow:0 2px 8px #0002}
#mb{display:none;background:none;border:0;font-size:1.6rem}
.hero{background:linear-gradient(135deg,var(--bl),#0b2038 60%,#3a2a1c);color:#fff;padding:90px 0 80px;position:relative;overflow:hidden}
.hero:before{content:"";position:absolute;right:-80px;top:-60px;width:420px;height:420px;border-radius:50%;background:radial-gradient(var(--or),transparent 70%);opacity:.45}
.hero .w{position:relative;display:grid;grid-template-columns:1.3fr 1fr;gap:36px;align-items:center}.hero h1{color:#fff}.hero p{max-width:52ch;color:#e6ebf2}
.glass{background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.35);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-radius:var(--r);padding:24px;box-shadow:0 8px 30px #0004}
.glass p{margin:.3em 0}.row{display:flex;gap:12px;flex-wrap:wrap;margin-top:24px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:20px}
.card{background:var(--card);border-radius:var(--r);padding:26px;box-shadow:0 2px 12px #14385c14;border-top:4px solid var(--or)}.card:nth-child(even){border-top-color:var(--bl)}
.card h3{font-size:1.25rem}.card p{margin:0;color:var(--mute)}
.steps{counter-reset:s;list-style:none;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:20px}
.steps li{counter-increment:s;background:var(--card);padding:24px;border-radius:var(--r);box-shadow:0 2px 12px #14385c14}
.steps li:before{content:counter(s);display:grid;place-items:center;width:38px;height:38px;border-radius:50%;margin-bottom:10px;font-weight:700;color:#fff;background:var(--bl)}
.ph{aspect-ratio:4/3;border-radius:var(--r);display:grid;place-items:center;text-align:center;padding:14px;color:#fff;font-weight:600;background:linear-gradient(135deg,var(--bl2),var(--bl))}.ph:nth-child(2n){background:linear-gradient(135deg,var(--or2),#b9430a)}
.alt{background:#fff}details{background:var(--bg);border-radius:12px;padding:14px 18px;margin-bottom:10px}summary{cursor:pointer;font-weight:700;color:var(--bl)}
.book{display:grid;grid-template-columns:1fr 1.3fr;gap:36px;align-items:start}
form{background:var(--card);padding:28px;border-radius:var(--r);box-shadow:0 6px 24px #14385c1f;display:grid;grid-template-columns:1fr 1fr;gap:14px}
label{display:grid;gap:4px;font-weight:600;font-size:.92rem}.f{grid-column:1/-1}
input,select,textarea{font:inherit;padding:11px 12px;border:1.5px solid #cfd4db;border-radius:10px;background:#fff;color:var(--ink)}textarea{min-height:96px;resize:vertical}
.hp{position:absolute;left:-9999px}#msg{grid-column:1/-1;padding:12px;border-radius:10px;display:none;font-weight:600}#msg.ok{display:block;background:#e6f6ec;color:#17613a}#msg.err{display:block;background:#fdeaea;color:#9b1c1c}
.note{font-size:.85rem;color:var(--mute)}footer{background:#1d2026;color:#cfd4db;padding:40px 0}footer a{color:#fff}
.rv{opacity:0;transform:translateY(14px);transition:.6s}.rv.on{opacity:1;transform:none}
@media(max-width:820px){.hero .w,.book{grid-template-columns:1fr}form{grid-template-columns:1fr}#mb{display:block}
nav ul{display:none;position:absolute;top:64px;left:0;right:0;flex-direction:column;background:var(--bg);padding:16px 20px;box-shadow:0 8px 12px #0002}nav ul.open{display:flex}nav .cta{display:none}}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important;scroll-behavior:auto!important}.rv{opacity:1;transform:none}}
</style></head><body>
<nav aria-label="Main"><div class="w"><a class="logo" href="#top"><svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true"><path d="M2 17 16 5l14 12h-4v10H6V17z" fill="#E85D0C"/></svg>${esc(C.name)}</a>
<ul id="menu"><li><a href="#services">Services</a></li><li><a href="#process">Process</a></li><li><a href="#gallery">Projects</a></li><li><a href="#area">Service area</a></li><li><a href="#faq">FAQ</a></li><li><a href="#book">Book</a></li></ul>
<a class="btn ghost cta" href="tel:${esc(ph)}">Call ${esc(C.phone)}</a><a class="btn clay cta" href="${esc(wa)}" target="_blank" rel="noopener">WhatsApp</a>
<button id="mb" aria-label="Menu" aria-expanded="false">&#9776;</button></div></nav>
<header class="hero" id="top"><div class="w"><div><h1>Roofs and building work you can rely on.</h1>
<p>${esc(C.name)} repairs, replaces and installs roofs across ${esc(C.area)}. Tell us about your property and we will arrange a free estimate.</p>
<div class="row"><a class="btn clay" href="#book">Book a free estimate</a><a class="btn ghost" href="tel:${esc(ph)}">Call now</a></div></div>
<aside class="glass" aria-label="Contact details"><h3 style="color:#fff">Talk to us</h3><p>Phone: <a href="tel:${esc(ph)}">${esc(C.phone)}</a></p><p>Email: ${esc(C.email)}</p><p>Hours: ${esc(C.hours)}</p><p>Address: ${esc(C.address)}</p></aside></div></header>
<section id="services"><div class="w"><h2>What we do</h2><div class="grid">${SERVICES.map(x => `<article class="card rv"><h3>${esc(x[0])}</h3><p>${esc(x[1])}</p></article>`).join('')}</div>
<p class="note">Edit this list to match the services the business actually offers.</p></div></section>
<section class="alt" id="about"><div class="w"><h2>About ${esc(C.name)}</h2><p style="max-width:65ch">[COMPANY INTRODUCTION: add verified history, team, licences and insurance details here.]</p></div></section>
<section id="process"><div class="w"><h2>How it works</h2><ol class="steps"><li class="rv"><h3>Book online</h3>Send your details and preferred time.</li><li class="rv"><h3>Free estimate</h3>We inspect the roof and quote in writing.</li><li class="rv"><h3>The work</h3>We schedule and complete the job.</li><li class="rv"><h3>Sign-off</h3>We walk you through the finished work.</li></ol></div></section>
<section class="alt" id="gallery"><div class="w"><h2>Recent projects</h2><div class="grid">${[1, 2, 3].map(i => `<div class="ph rv" role="img" aria-label="Project photo placeholder ${i}">[PROJECT PHOTO ${i}]</div>`).join('')}</div>
<h3 style="margin-top:36px">What customers say</h3><p class="note">[ADD GENUINE CUSTOMER TESTIMONIALS HERE. None are invented.]</p></div></section>
<section id="area"><div class="w"><h2>Where we work</h2><p style="max-width:65ch">We serve ${esc(C.area)}. Not sure if you are covered? Call ${esc(C.phone)}.</p></div></section>
<section class="alt" id="faq"><div class="w"><h2>Questions</h2>
<details><summary>Is the estimate free?</summary><p>[CONFIRM: describe your estimate policy.]</p></details>
<details><summary>How soon can you visit?</summary><p>[CONFIRM: typical lead time.]</p></details>
<details><summary>Do you offer emergency repairs?</summary><p>[CONFIRM: only keep this if applicable.]</p></details></div></section>
<section id="book"><div class="w book"><div><h2>Book a free estimate</h2><p>Fill in the form and we will confirm your visit by phone. Prefer to talk? <a href="tel:${esc(ph)}"><strong>${esc(C.phone)}</strong></a></p></div>
<form id="bf" novalidate><label>Full name<input name="name" required autocomplete="name" maxlength="80"></label><label>Phone<input name="phone" type="tel" required autocomplete="tel" maxlength="25"></label>
<label class="f">Email (optional)<input name="email" type="email" autocomplete="email" maxlength="120"></label><label class="f">Property address<input name="address" required autocomplete="street-address" maxlength="200"></label>
<label class="f">Service<select name="service" required><option value="">Choose a service</option>${SERVICES.map(x => `<option>${esc(x[0])}</option>`).join('')}</select></label>
<label>Preferred date<input name="date" type="date" required></label><label>Preferred time<input name="time" type="time" required></label>
<label class="f">Project description<textarea name="description" required maxlength="1000" placeholder="What needs doing?"></textarea></label>
<input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true"><div id="msg" role="status"></div><button class="btn clay f" id="sb">Send booking request</button></form></div></section>
<footer><div class="w"><strong>${esc(C.name)}</strong><br>${esc(C.address)} &middot; <a href="tel:${esc(ph)}">${esc(C.phone)}</a> &middot; ${esc(C.email)}<br><span class="note">&copy; ${new Date().getFullYear()} ${esc(C.name)}</span></div></footer>
<script>
const $=s=>document.querySelector(s),f=$('#bf'),m=$('#msg'),b=$('#sb');
$('#mb').onclick=e=>{const o=$('#menu').classList.toggle('open');e.currentTarget.setAttribute('aria-expanded',o)};
document.querySelectorAll('#menu a').forEach(a=>a.onclick=()=>$('#menu').classList.remove('open'));
f.date.min=new Date().toISOString().slice(0,10);
const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('on');io.unobserve(e.target)}}),{threshold:.15});
document.querySelectorAll('.rv').forEach(x=>io.observe(x));
f.onsubmit=async e=>{e.preventDefault();m.className='';m.style.display='none';
 if(!f.checkValidity()&&!f.email.value){m.className='err';m.textContent='Please complete all required fields.';return}
 b.disabled=true;b.textContent='Sending...';
 try{const r=await fetch('/api/bookings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(f)))});
  const d=await r.json().catch(()=>({}));
  if(r.ok){m.className='ok';m.textContent='Thank you. Your booking ID is '+d.bookingId+'. We will contact you to confirm.';f.reset()}
  else{m.className='err';m.textContent=d.error||'Something went wrong. Please call us.'}
 }catch(x){m.className='err';m.textContent='Network error. Check your connection or call us.'}
 b.disabled=false;b.textContent='Send booking request'};
</script></body></html>`;
app.get('/', (q, r) => r.type('html').send(page));
app.get('/healthz', (q, r) => r.json({ ok: true }));
app.use((q, r) => r.status(404).type('html').send('<h1>Page not found</h1><a href="/">Back to home</a>'));
module.exports = app;
