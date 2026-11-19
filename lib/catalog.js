'use strict';
/**
 * 107 ta sayohat manzili (data/catalog.json) va ular uchun namunaviy (demo) gidlar va tur-paketlar.
 * Namunaviy takliflar aniq belgilanadi: ular uchun pul olinmaydi — mijoz so'rov yuboradi, jamoa bog'lanadi.
 * Haqiqiy gidlar va tur operatorlar qo'shilgach, namunalarni admin paneldan o'chirish mumkin.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');

let CATALOG = [];
try { CATALOG = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'catalog.json'), 'utf8')); } catch (e) { console.warn('[catalog] data/catalog.json topilmadi'); }
const BY_SLUG = new Map(CATALOG.map(d => [d.slug, d]));
const get = slug => BY_SLUG.get(slug) || null;

const imgUrl = (d, w = 1280) => {
  if (!d || !d.img) return null;
  if (d.img.startsWith('unsplash:')) return `https://images.unsplash.com/photo-${d.img.slice(9)}?auto=format&fit=crop&w=${w}&q=72`;
  const std = [330, 500, 960, 1280].find(x => x >= w) || 1280; // Wikimedia faqat standart o'lchamlarga ruxsat beradi
  return d.img.replace(/\/(\d+)px-/, `/${std}px-`);
};

// Namunaviy ma'lumotlar uchun barqaror "tasodifiy" son (slug asosida — har deployda bir xil)
const rnd = (seed, n) => parseInt(crypto.createHash('sha256').update(seed).digest('hex').slice(0, 8), 16) % n;
const MUSLIM_FRIENDLY = new Set(['UZ', 'KZ', 'KG', 'TJ', 'TM', 'TR', 'AE', 'QA', 'EG', 'SA', 'OM', 'JO', 'MA', 'AZ', 'MY', 'ID', 'MV']);
const KINDS = ['classic', 'slow', 'food', 'nature', 'history', 'family'];
const round = (v, step) => Math.max(step, Math.round(v / step) * step);

function hostRate(d) { return Math.min(160, Math.max(30, round(d.cost.activities * 2.2 + 20, 5))); }
/** Taxminiy narx (1 kishi uchun, aviachiptasiz): mehmonxona (2 kishiga bo'linadi) + ovqat + transport + faoliyat + gid ulushi (4 kishilik guruh) */
function estimatePackageC(d, days) {
  const perDay = d.cost.hotel / 2 + d.cost.food + d.cost.transport + d.cost.activities + hostRate(d) / 4;
  return round(perDay * days, 10) * 100;
}
function kindsFor(d) {
  const tags = new Set(d.tags || []);
  const pool = ['classic'];
  if (tags.has('history')) pool.push('history');
  if (tags.has('nature') || tags.has('beach')) pool.push('nature');
  pool.push('food', 'slow', 'family');
  const a = pool[rnd(d.slug + 'k1', pool.length)];
  let b = pool[rnd(d.slug + 'k2', pool.length)];
  if (b === a) b = pool[(pool.indexOf(a) + 1) % pool.length];
  return [a, b];
}
const DAYS = { classic: 5, slow: 7, food: 4, nature: 6, history: 5, family: 6 };

function seedSamples() {
  if (process.env.SEED_SAMPLE_OFFERS === 'false' || !CATALOG.length) return { skipped: true };
  if (db.get('SELECT value FROM settings WHERE key=?', 'samples_v2')) return { skipped: true };
  const now = db.now();
  let hosts = 0, pkgs = 0;
  db.tx(() => {
    // Avvalgi versiyadagi 8 ta namunaviy gid: Telegram nomlari o'chiriladi (begona odamlarga tegishli bo'lishi mumkin)
    const OLD = { guide_seed_1: 'samarkand', guide_seed_2: 'bukhara', guide_seed_3: 'nukus-and-moynaq-aral', guide_seed_4: 'istanbul', guide_seed_5: 'tbilisi-and-kazbegi', guide_seed_6: 'dubai', guide_seed_7: 'paris', guide_seed_8: 'seoul' };
    for (const [id, slug] of Object.entries(OLD)) db.run("UPDATE guides SET tg=NULL, dest_slug=?, name='Demo', spec='@history', langs=? WHERE id=? AND is_sample=1", slug, (get(slug) ? [get(slug).localLang, 'en', 'ru'] : ['en']).filter((v, i, a) => a.indexOf(v) === i).join(','), id);
    for (const d of CATALOG) {
      const existing = db.all('SELECT gender FROM guides WHERE dest_slug=?', d.slug).map(g => g.gender);
      const wantBoth = MUSLIM_FRIENDLY.has(d.country) || d.scope === 'uz';
      const genders = wantBoth ? ['female', 'male'] : [rnd(d.slug + 'g', 2) ? 'female' : 'male'];
      for (const g of genders) {
        if (existing.includes(g)) continue;
        const langs = [d.localLang, 'en', d.scope === 'uz' || ['KZ', 'KG', 'TJ', 'TM', 'AZ', 'GE', 'RU', 'BY'].includes(d.country) ? 'ru' : null].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(',');
        const kind = kindsFor(d)[0];
        db.run(`INSERT INTO guides(id,name,city,country,langs,spec,bio,rate,exp,tg,grp,gender,status,verified,is_sample,dest_slug,created_at,updated_at)
                VALUES(?,?,?,?,?,?,?,?,?,NULL,NULL,?,'approved',0,1,?,?,?)`,
          'sg_' + d.slug.slice(0, 40) + '_' + g[0], 'Demo', d.names.uz, d.uzCountry, langs, '@' + kind, '@' + kind, hostRate(d) + rnd(d.slug + g, 3) * 5, 3 + rnd(d.slug + g + 'e', 9), g, d.slug, now, now);
        hosts++;
      }
      if (!db.get('SELECT 1 x FROM packages WHERE dest_slug=? AND is_sample=1', d.slug)) {
        for (const kind of kindsFor(d)) {
          const days = DAYS[kind];
          db.run(`INSERT INTO packages(id,dest_slug,operator_id,guide_id,kind,title,description,itinerary,days,price_c,price_status,max_people,status,is_sample,created_at,updated_at)
                  VALUES(?,?,NULL,NULL,?,NULL,NULL,NULL,?,?,'estimated',8,'approved',1,?,?)`, 'sp_' + d.slug.slice(0, 40) + '_' + kind, d.slug, kind, days, estimatePackageC(d, days), now, now);
          pkgs++;
        }
      }
    }
    db.setSetting('samples_v2', now);
  });
  return { hosts, pkgs };
}

/** Ommaviy ko'rinish (tilga bog'liq matnlar brauzerda tarjima qilinadi) */
function publicDest(d, { full = false } = {}) {
  const base = { slug: d.slug, names: d.names, country: d.country, region: d.region, scope: d.scope, months: d.months, tags: d.tags, img: imgUrl(d, 960), credit: d.credit };
  if (!full) return { ...base, from: Math.round((d.cost.hotel / 2 + d.cost.food + d.cost.transport + d.cost.activities)) };
  return { ...base, lat: d.lat, lng: d.lng, cost: d.cost, descUz: d.descUz, imgLarge: imgUrl(d, 1280), localLang: d.localLang };
}

module.exports = { CATALOG, get, imgUrl, seedSamples, publicDest, estimatePackageC, hostRate, MUSLIM_FRIENDLY };
