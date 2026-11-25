'use strict';
/**
 * SEO: har bir til uchun alohida URL (/en/, /ru/, ...), hreflang, kanonik havolalar, Open Graph, JSON-LD,
 * server tomonida tayyorlanadigan sahifalar (107 manzil × 12 til, jurnal maqolalari, huquqiy sahifa), sitemap.xml va robots.txt.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const catalog = require('./catalog');
const db = require('./db');

const PUB = path.join(__dirname, '..', 'public');
const ctx = { window: {} };
vm.createContext(ctx);
for (const f of ['i18n.js', 'i18n-ext.js', 'articles.js', 'legal.js']) vm.runInContext(fs.readFileSync(path.join(PUB, f), 'utf8'), ctx);
const W = ctx.window, I18N = W.I18N, LANGS = W.LANGS.map(l => l[0]), RTL = W.RTL, ARTICLES = W.ARTICLES, LEGAL = W.LEGAL;
const DEFAULT = 'uz';
const t = (l, k, v) => { let s = (I18N[l] && I18N[l][k]) || I18N.en[k] || k; if (v) for (const x in v) s = s.split('{' + x + '}').join(v[x]); return s; };
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const base = () => (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
const abs = p => (base() || '') + p;
const IS_PROD = process.env.NODE_ENV === 'production';

let INDEX = null;
const indexHtml = () => { if (!INDEX || !IS_PROD) INDEX = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8'); return INDEX; };
const uimg = (id, w) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${w}&q=72`;
const countryName = (iso, l) => { try { return iso ? new Intl.DisplayNames([l], { type: 'region' }).of(iso) : ''; } catch (_) { return iso || ''; } };
const monthNames = (months, l) => (months || []).map(m => { try { return new Intl.DateTimeFormat(l, { month: 'long' }).format(new Date(Date.UTC(2026, m - 1, 15))); } catch (_) { return String(m); } }).join(', ');
const dName = (d, l) => d.names[l] || d.names.en;
const budget = d => Math.round(d.cost.hotel / 2 + d.cost.food + d.cost.transport + d.cost.activities);

function alternates(pathFor) {
  return LANGS.map(l => `<link rel="alternate" hreflang="${l}" href="${esc(abs(pathFor(l)))}">`).join('') + `<link rel="alternate" hreflang="x-default" href="${esc(abs(pathFor(DEFAULT)))}">`;
}
function headTags({ lang, title, desc, canonical, image, pathFor, jsonld, type = 'website' }) {
  return [
    `<meta name="description" content="${esc(desc)}">`,
    `<link rel="canonical" href="${esc(abs(canonical))}">`,
    alternates(pathFor),
    `<meta property="og:type" content="${type}"><meta property="og:site_name" content="Manzil"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${esc(abs(canonical))}"><meta property="og:locale" content="${esc(lang)}">`,
    image ? `<meta property="og:image" content="${esc(image)}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${esc(image)}">` : '',
    `<meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(desc)}">`,
    jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, '\\u003c')}</script>` : ''
  ].join('\n');
}

// ---- Bosh sahifa (/ va /{lang}/) ----
function renderHome(lang) {
  const title = t(lang, 'seo_home_title'), desc = t(lang, 'hero_sub');
  const jsonld = [{ '@context': 'https://schema.org', '@type': 'TravelAgency', name: 'Manzil', url: abs('/'), description: desc, image: uimg('1499678329028-101435549a4e', 1200), areaServed: 'Worldwide', availableLanguage: LANGS },
    { '@context': 'https://schema.org', '@type': 'WebSite', name: 'Manzil', url: abs('/'), inLanguage: lang }];
  let html = indexHtml()
    .replace(/<html lang="[^"]*" dir="[^"]*">/, `<html lang="${lang}" dir="${RTL.includes(lang) ? 'rtl' : 'ltr'}">`)
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`)
    .replace(/<meta name="description"[^>]*>/, '');
  const extra = headTags({ lang, title, desc, canonical: lang === DEFAULT ? '/' : `/${lang}/`, image: uimg('1499678329028-101435549a4e', 1200), pathFor: l => (l === DEFAULT ? '/' : `/${l}/`), jsonld }) + `\n<script>window.__LANG=${JSON.stringify(lang)};</script>`;
  return html.replace('</head>', extra + '\n</head>');
}

// ---- Server tomonida tayyorlanadigan oddiy sahifalar ----
const PAGE_CSS = `:root{--sand:#F6F1E8;--sand2:#EFE7DA;--ink:#1C1917;--ink2:#44403C;--mute:#78716C;--terra:#C45C26;--line:rgba(28,25,23,.12);--serif:"Fraunces",Georgia,"Noto Serif",serif;--sans:"Geist",system-ui,-apple-system,"Segoe UI","Noto Sans",sans-serif}
*{box-sizing:border-box}body{margin:0;background:var(--sand);color:var(--ink);font:400 17px/1.7 var(--sans);-webkit-font-smoothing:antialiased}a{color:inherit}
.w{max-width:860px;margin:0 auto;padding:0 20px}header{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:20px 0;border-bottom:1px solid var(--line);flex-wrap:wrap}
.brand{font-family:var(--serif);font-size:26px;text-decoration:none}.langs{display:flex;gap:10px;flex-wrap:wrap;font-size:13px}.langs a{text-decoration:none;color:var(--mute)}.langs a[aria-current]{color:var(--ink);font-weight:600}
h1{font-family:var(--serif);font-weight:330;font-size:clamp(36px,6vw,58px);line-height:1.05;letter-spacing:-.02em;margin:40px 0 12px}.lede{color:var(--ink2);font-size:20px;margin:0 0 28px}
figure{margin:0 0 28px}figure img{width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:6px;display:block}figcaption{font-size:12px;color:var(--mute);margin-top:8px}
.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;padding:20px 0;border-block:1px solid var(--line);margin:0 0 28px}.facts small{display:block;color:var(--mute);font-size:12px;letter-spacing:.12em;text-transform:uppercase}.facts b{font-family:var(--serif);font-weight:400;font-size:22px}
.btn{display:inline-flex;align-items:center;min-height:52px;padding:0 28px;border-radius:999px;background:var(--terra);color:#fff;text-decoration:none;font-weight:500}
.k{font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:var(--terra)}article p{margin:0 0 18px}h2{font-family:var(--serif);font-weight:370;font-size:30px;margin:40px 0 12px}
ul.list{list-style:none;padding:0;margin:0}ul.list li{padding:14px 0;border-bottom:1px solid var(--line)}ul.list a{text-decoration:none;font-family:var(--serif);font-size:22px}
footer{margin:64px 0 0;padding:28px 0 40px;border-top:1px solid var(--line);font-size:14px;color:var(--mute);display:flex;gap:18px;flex-wrap:wrap}footer a{color:var(--ink2)}
.crumb{font-size:14px;color:var(--mute);margin-top:24px}.crumb a{color:var(--mute)}`;
function page({ lang, title, desc, canonical, pathFor, image, jsonld, body, type }) {
  const langs = LANGS.map(l => `<a href="${esc(pathFor(l))}" hreflang="${l}" lang="${l}" ${l === lang ? 'aria-current="true"' : ''}>${esc(W.LANGS.find(x => x[0] === l)[1])}</a>`).join('');
  return `<!doctype html><html lang="${lang}" dir="${RTL.includes(lang) ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>${headTags({ lang, title, desc, canonical, image, pathFor, jsonld, type })}
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300..500&family=Geist:wght@400;500&display=swap" rel="stylesheet"><meta name="theme-color" content="#F6F1E8"><style>${PAGE_CSS}</style></head>
<body><div class="w"><header><a class="brand" href="/${lang === DEFAULT ? '' : lang + '/'}">Manzil</a><nav class="langs" aria-label="Language">${langs}</nav></header>
${body}
<footer><a href="/${lang}/">${esc(t(lang, 'seo_home'))}</a><a href="/${lang}/#explore">${esc(t(lang, 'nav_dest'))}</a><a href="/${lang}/journal">${esc(t(lang, 'nav_journal'))}</a><a href="/${lang}/legal">${esc(t(lang, 'foot_legal'))}</a><span>© ${new Date().getFullYear()} Manzil</span></footer></div></body></html>`;
}

function renderDestination(lang, d) {
  const name = dName(d, lang), country = countryName(d.country, lang), months = monthNames(d.months, lang);
  const title = t(lang, 'seo_dest_title', { name }) + ' | Manzil';
  const intro = t(lang, 'dd_auto', { name, country, months, budget: budget(d) });
  const img = catalog.imgUrl(d, 1280);
  const hosts = db.get("SELECT COUNT(*) n FROM guides WHERE status='approved' AND dest_slug=?", d.slug).n;
  const pk = db.all("SELECT kind, days, price_c, is_sample FROM packages WHERE status='approved' AND dest_slug=? ORDER BY price_c", d.slug);
  const pathFor = l => `/${l}/destinations/${d.slug}`;
  const jsonld = [{ '@context': 'https://schema.org', '@type': 'TouristDestination', name, description: intro, image: img, geo: { '@type': 'GeoCoordinates', latitude: d.lat, longitude: d.lng }, containedInPlace: country ? { '@type': 'Country', name: country } : undefined },
    { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Manzil', item: abs(`/${lang}/`) }, { '@type': 'ListItem', position: 2, name: t(lang, 'nav_dest'), item: abs(`/${lang}/#explore`) }, { '@type': 'ListItem', position: 3, name, item: abs(pathFor(lang)) }] }];
  const body = `<p class="crumb"><a href="/${lang}/#explore">${esc(t(lang, 'seo_back'))}</a></p>
<div class="k">${esc(t(lang, 'r_' + d.region))}${country ? ' · ' + esc(country) : ''}</div><h1>${esc(name)}</h1><p class="lede">${esc(intro)}</p>
${img ? `<figure><img src="${esc(img)}" alt="${esc(name)}" width="1280" height="720" fetchpriority="high"><figcaption>${esc(t(lang, 'photo_by'))}: ${esc(d.credit ? d.credit.artist : '')} · ${d.credit ? `<a href="${esc(d.credit.source)}" rel="noopener nofollow">${esc(d.credit.license)}</a>` : ''}</figcaption></figure>` : ''}
<div class="facts"><div><small>${esc(t(lang, 'dd_best'))}</small><b>${esc(months)}</b></div><div><small>${esc(t(lang, 'dd_budget'))}</small><b>~$${budget(d)}</b></div><div><small>${esc(t(lang, 'dd_hosts'))}</small><b>${hosts}</b></div><div><small>${esc(t(lang, 'dd_packages'))}</small><b>${pk.length}</b></div></div>
${lang === 'uz' && d.descUz ? `<p>${esc(d.descUz)}</p>` : ''}
${pk.length ? `<h2>${esc(t(lang, 'dd_packages'))}</h2><ul class="list">${pk.map(p => `<li><b>${esc(t(lang, 'pk_k_' + p.kind, { place: name }) || '')}</b> · ${esc(t(lang, 'pk_days', { n: p.days }))} · ${esc(t(lang, 'from'))} $${Math.round(p.price_c / 100)} ${esc(t(lang, 'pk_per_person'))}${p.is_sample ? ' · ' + esc(t(lang, 'pk_sample')) : ''}<br><span style="color:var(--mute)">${esc(t(lang, 'pk_d_' + p.kind))}</span></li>`).join('')}</ul>` : ''}
<p style="margin-top:32px"><a class="btn" href="/${lang}/#d=${esc(d.slug)}">${esc(t(lang, 'seo_see'))}</a></p>
<p style="font-size:13px;color:var(--mute)">${esc(t(lang, 'dd_budget_note'))}</p>`;
  return page({ lang, title, desc: intro, canonical: pathFor(lang), pathFor, image: img, jsonld, body, type: 'article' });
}

function articleOf(a, lang) { return a.t[lang] || a.t.en; }
function renderArticle(lang, a) {
  const [title, sub, paras] = articleOf(a, lang);
  const pathFor = l => `/${l}/journal/${a.slug}`;
  const img = uimg(a.img, 1280);
  const jsonld = { '@context': 'https://schema.org', '@type': 'Article', headline: title, description: sub, image: img, datePublished: a.date, inLanguage: lang, author: { '@type': 'Organization', name: 'Manzil' }, publisher: { '@type': 'Organization', name: 'Manzil' }, mainEntityOfPage: abs(pathFor(lang)) };
  const others = ARTICLES.filter(x => x.slug !== a.slug).slice(0, 4);
  const body = `<p class="crumb"><a href="/${lang}/journal">${esc(t(lang, 'jr_all'))}</a></p><div class="k">${esc(t(lang, 'journal_kicker'))} · ${esc(t(lang, 'jr_min', { n: a.min }))}</div>
<h1>${esc(title)}</h1><p class="lede">${esc(sub)}</p><figure><img src="${esc(img)}" alt="" width="1280" height="720" fetchpriority="high"><figcaption>${esc(t(lang, 'photo_by'))}: Unsplash</figcaption></figure>
<article>${paras.map(p => `<p>${esc(p)}</p>`).join('')}</article>
<p style="margin-top:32px"><a class="btn" href="/${lang}/#hosts">${esc(t(lang, 'nav_hosts'))}</a></p>
<h2>${esc(t(lang, 'journal_title'))}</h2><ul class="list">${others.map(x => `<li><a href="/${lang}/journal/${x.slug}">${esc(articleOf(x, lang)[0])}</a></li>`).join('')}</ul>`;
  return page({ lang, title: title + ' | Manzil', desc: sub, canonical: pathFor(lang), pathFor, image: img, jsonld, body, type: 'article' });
}
function renderJournal(lang) {
  const pathFor = l => `/${l}/journal`;
  const body = `<div class="k" style="margin-top:40px">${esc(t(lang, 'journal_kicker'))}</div><h1>${esc(t(lang, 'journal_title'))}</h1>
<ul class="list">${ARTICLES.map(a => { const [ti, sub] = articleOf(a, lang); return `<li><a href="/${lang}/journal/${a.slug}">${esc(ti)}</a><br><span style="color:var(--mute)">${esc(sub)}</span></li>`; }).join('')}</ul>`;
  return page({ lang, title: t(lang, 'journal_title') + ' | Manzil', desc: t(lang, 'j1_d'), canonical: pathFor(lang), pathFor, body });
}
function renderLegal(lang) {
  const pathFor = l => `/${l}/legal`;
  const L = LEGAL[lang] || LEGAL.en;
  const body = `<h1>${esc(t(lang, 'lg_title'))}</h1><p style="color:var(--mute);font-size:14px">v1.0 · 2026-11-19</p>${L.map(([h, ps]) => `<h2>${esc(h)}</h2><ul>${ps.map(p => `<li>${esc(p)}</li>`).join('')}</ul>`).join('')}`;
  return page({ lang, title: t(lang, 'lg_title') + ' | Manzil', desc: L[0][1][0], canonical: pathFor(lang), pathFor, body });
}

function sitemap() {
  const urls = [];
  const add = (pathFor, prio) => urls.push(`<url><loc>${esc(abs(pathFor(DEFAULT)))}</loc>${LANGS.map(l => `<xhtml:link rel="alternate" hreflang="${l}" href="${esc(abs(pathFor(l)))}"/>`).join('')}<priority>${prio}</priority></url>`);
  // Har bir til versiyasi alohida <url> sifatida (hreflang bilan)
  const addAll = (pathFor, prio) => LANGS.forEach(l => urls.push(`<url><loc>${esc(abs(pathFor(l)))}</loc>${LANGS.map(x => `<xhtml:link rel="alternate" hreflang="${x}" href="${esc(abs(pathFor(x)))}"/>`).join('')}<xhtml:link rel="alternate" hreflang="x-default" href="${esc(abs(pathFor(DEFAULT)))}"/><priority>${prio}</priority></url>`));
  addAll(l => (l === DEFAULT ? '/' : `/${l}/`), '1.0');
  addAll(l => `/${l}/journal`, '0.6');
  for (const a of ARTICLES) addAll(l => `/${l}/journal/${a.slug}`, '0.7');
  for (const d of catalog.CATALOG) addAll(l => `/${l}/destinations/${d.slug}`, '0.8');
  addAll(l => `/${l}/legal`, '0.3');
  void add;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>`;
}

function send(res, status, type, body, cache = 'public, max-age=600') { res.writeHead(status, { 'Content-Type': type, 'Cache-Control': cache }); res.end(body); }

/** true qaytarsa — so'rov shu yerda yakunlandi */
function handle(req, res, url) {
  const p = url.pathname;
  if (p === '/robots.txt') { send(res, 200, 'text/plain; charset=utf-8', `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /guide\nDisallow: /api/\nSitemap: ${abs('/sitemap.xml')}\n`); return true; }
  if (p === '/sitemap.xml') { send(res, 200, 'application/xml; charset=utf-8', sitemap(), 'public, max-age=3600'); return true; }
  if (p === '/planner.html' || p === '/planner') { res.writeHead(301, { Location: '/#explore' }); res.end(); return true; }
  if (p === '/' || p === '/index.html') { send(res, 200, 'text/html; charset=utf-8', renderHome(DEFAULT), 'no-cache'); return true; }
  const m = p.match(/^\/([a-z]{2})(\/.*)?$/);
  if (!m || !LANGS.includes(m[1])) return false;
  const lang = m[1], rest = (m[2] || '/').replace(/\/+$/, '') || '/';
  if (rest === '/') { if (!m[2]) { res.writeHead(301, { Location: `/${lang}/` }); res.end(); return true; } send(res, 200, 'text/html; charset=utf-8', renderHome(lang), 'no-cache'); return true; }
  let mm;
  if ((mm = rest.match(/^\/destinations\/([a-z0-9-]+)$/))) { const d = catalog.get(mm[1]); if (!d) return notFound(res, lang); send(res, 200, 'text/html; charset=utf-8', renderDestination(lang, d)); return true; }
  if (rest === '/journal') { send(res, 200, 'text/html; charset=utf-8', renderJournal(lang)); return true; }
  if ((mm = rest.match(/^\/journal\/([a-z0-9-]+)$/))) { const a = ARTICLES.find(x => x.slug === mm[1]); if (!a) return notFound(res, lang); send(res, 200, 'text/html; charset=utf-8', renderArticle(lang, a)); return true; }
  if (rest === '/legal') { send(res, 200, 'text/html; charset=utf-8', renderLegal(lang)); return true; }
  return notFound(res, lang);
}
function notFound(res, lang) { send(res, 404, 'text/html; charset=utf-8', page({ lang, title: '404 | Manzil', desc: '404', canonical: `/${lang}/`, pathFor: l => `/${l}/`, body: `<h1>404</h1><p><a class="btn" href="/${lang}/">${esc(t(lang, 'seo_home'))}</a></p>` }), 'no-store'); return true; }

module.exports = { handle, LANGS };
