#!/usr/bin/env node
'use strict';
/**
 * Dev vositasi: data/catalog.json ni yaratadi.
 * Manba: public/planner.html dagi 105 manzil + Amalfi va Patagoniya + Wikipedia'dan olingan rasm, muallif, litsenziya va 11 tildagi nomlar.
 *   node scripts/build-catalog.js /path/to/raw.json /path/to/wiki.json
 */
const fs = require('fs');
const path = require('path');
const [rawPath, wikiPath] = process.argv.slice(2);
const RAW = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
const WIKI = fs.existsSync(wikiPath || '') ? JSON.parse(fs.readFileSync(wikiPath, 'utf8')) : [];

RAW.push(
  ['Amalfi sohili', 'Italiya', 'Yevropa', 'world', 40.634, 14.6027, 420, 140, 45, 18, 30, 1250, [5, 6, 9], ['beach', 'nature'], 'Qoyalarga yopishgan rang-barang qishloqlar, limon bog\'lari va Path of the Gods piyoda yo\'li.'],
  ['Patagoniya', 'Argentina va Chili', 'Amerika', 'world', -50.9423, -73.4068, 1300, 110, 35, 30, 45, 2100, [11, 12, 1, 2, 3], ['nature'], 'Torres del Paine minoralari, muzliklar va dunyoning chekkasidagi shamolli dashtlar.']
);
const EN = ['Samarkand', 'Bukhara', 'Khiva (Itchan Kala)', 'Zaamin National Park', 'Chimgan & Amirsoy', 'Charvak Reservoir', 'Shahrisabz', 'Termez & Boysun', 'Nukus & Moynaq (Aral)', 'Kokand & Rishtan', 'Margilan & Fergana', 'Namangan (Chust & Pop)', 'Nurata & Aydar Lake', 'Sentob village (Nurata)', 'Konigil & Urgut', 'Gijduvan & Vobkent', 'Nanay & Yangiobod', 'Sangzor & Bakhmal', 'Denov & Sangardak', 'Tashkent city', 'Langar Ota (Kashkadarya)', 'Andijan & Khonobod', 'Ellikkala (Toprak-Kala)', 'Qarshi & Koson', 'Jizzakh & Tuzkon Lake',
  'Almaty', 'Astana', 'Issyk-Kul (Cholpon-Ata)', 'Bishkek & Ala-Archa', 'Dushanbe & Iskanderkul', 'Ashgabat', 'Istanbul', 'Antalya', 'Cappadocia', 'Bodrum', 'Dubai', 'Abu Dhabi', 'Doha', 'Sharm El Sheikh', 'Cairo & Giza', 'Riyadh', 'Jeddah & Makkah', 'Muscat', 'Amman & Petra', 'Tbilisi & Kazbegi', 'Baku', 'Paris', 'Nice & Côte d\'Azur', 'Rome', 'Venice', 'Milan', 'Barcelona', 'Madrid', 'London', 'Prague', 'Vienna', 'Budapest', 'Berlin', 'Munich', 'Amsterdam', 'Zurich & Interlaken', 'Athens & Santorini', 'Lisbon', 'Warsaw & Kraków', 'Stockholm', 'Oslo & the fjords', 'Reykjavík', 'Dubrovnik', 'Belgrade', 'Montenegro (Kotor)', 'Moscow', 'Saint Petersburg', 'Minsk', 'Kuala Lumpur', 'Langkawi', 'Bangkok', 'Phuket', 'Pattaya', 'Bali (Ubud & Kuta)', 'Singapore', 'Seoul', 'Busan', 'Tokyo', 'Kyoto & Osaka', 'Beijing', 'Shanghai', 'Hainan (Sanya)', 'Hong Kong', 'Hanoi & Ha Long Bay', 'Phu Quoc', 'Delhi, Agra & Jaipur', 'Goa', 'Maldives', 'Colombo & Kandy', 'Kathmandu & Pokhara', 'New York', 'Los Angeles', 'Miami', 'Toronto & Niagara', 'Cancún', 'Rio de Janeiro', 'Casablanca & Marrakesh', 'Zanzibar', 'Cape Town', 'Sydney', 'Amalfi Coast', 'Patagonia'];
const ISO = { "O'zbekiston": 'UZ', "Qozog'iston": 'KZ', "Qirg'iziston": 'KG', 'Tojikiston': 'TJ', 'Turkmaniston': 'TM', 'Turkiya': 'TR', 'BAA': 'AE', 'Qatar': 'QA', 'Misr': 'EG', 'Saudiya Arabistoni': 'SA', 'Ummon': 'OM', 'Iordaniya': 'JO', 'Gruziya': 'GE', 'Ozarbayjon': 'AZ', 'Fransiya': 'FR', 'Italiya': 'IT', 'Ispaniya': 'ES', 'Buyuk Britaniya': 'GB', 'Chexiya': 'CZ', 'Avstriya': 'AT', 'Vengriya': 'HU', 'Germaniya': 'DE', 'Niderlandiya': 'NL', 'Shveytsariya': 'CH', 'Gretsiya': 'GR', 'Portugaliya': 'PT', 'Polsha': 'PL', 'Shvetsiya': 'SE', 'Norvegiya': 'NO', 'Islandiya': 'IS', 'Xorvatiya': 'HR', 'Serbiya': 'RS', 'Chernogoriya': 'ME', 'Rossiya': 'RU', 'Belarus': 'BY', 'Malayziya': 'MY', 'Tailand': 'TH', 'Indoneziya': 'ID', 'Singapur': 'SG', 'Janubiy Koreya': 'KR', 'Yaponiya': 'JP', 'Xitoy': 'CN', 'Vyetnam': 'VN', 'Hindiston': 'IN', 'Maldiv': 'MV', 'Shri-Lanka': 'LK', 'Nepal': 'NP', 'AQSH': 'US', 'Kanada': 'CA', 'Meksika': 'MX', 'Braziliya': 'BR', 'Marokash': 'MA', 'Tanzaniya': 'TZ', 'JAR': 'ZA', 'Avstraliya': 'AU', 'Argentina va Chili': 'AR' };
const REGION = { "O'zbekiston": 'uzbekistan', 'Markaziy Osiyo': 'central_asia', 'Yaqin Sharq': 'middle_east', 'Yevropa': 'europe', 'Osiyo': 'asia', 'Amerika': 'americas', 'Afrika va Okeaniya': 'africa_oceania' };
// Asosiy tillar (gid tillari namunasi uchun ISO kodlar)
const LOCAL_LANG = { UZ: 'uz', KZ: 'kk', KG: 'ky', TJ: 'tg', TM: 'tk', TR: 'tr', AE: 'ar', QA: 'ar', EG: 'ar', SA: 'ar', OM: 'ar', JO: 'ar', MA: 'ar', GE: 'ka', AZ: 'az', FR: 'fr', IT: 'it', ES: 'es', GB: 'en', CZ: 'cs', AT: 'de', HU: 'hu', DE: 'de', NL: 'nl', CH: 'de', GR: 'el', PT: 'pt', PL: 'pl', SE: 'sv', NO: 'no', IS: 'is', HR: 'hr', RS: 'sr', ME: 'sr', RU: 'ru', BY: 'ru', MY: 'ms', TH: 'th', ID: 'id', SG: 'en', KR: 'ko', JP: 'ja', CN: 'zh', VN: 'vi', IN: 'hi', MV: 'dv', LK: 'si', NP: 'ne', US: 'en', CA: 'en', MX: 'es', BR: 'pt', TZ: 'sw', ZA: 'en', AU: 'en', AR: 'es' };
const slugify = s => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const stripHtml = s => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 120);
const FALLBACK_IMG = { // Wikimedia rasmi bo'lmasa yoki mos kelmasa — tekshirilgan Unsplash suratlari
  'samarkand': 'unsplash:1715824633691-1fd2bfd3a1ac', 'kyoto-and-osaka': 'unsplash:1545569341-9eb8b30979d9', 'amalfi-coast': 'unsplash:1760867333704-872f5ff51cdd', 'casablanca-and-marrakesh': 'unsplash:1597212618440-806262de4f6b',
  'patagonia': 'unsplash:1681951002470-06ad64d8e39c', 'reykjavik': 'unsplash:1476610182048-b716b8518aae', 'istanbul': 'unsplash:1541432901042-2d8bd64b4a9b', 'dubai': 'unsplash:1512453979798-5ea266f8880c',
  'paris': 'unsplash:1502602898657-3e91760cbb34', 'seoul': 'unsplash:1538485399081-7191377e8241', 'bali-ubud-and-kuta': 'unsplash:1518548419970-58e3b4079ab2', 'hanoi-and-ha-long-bay': 'unsplash:1528127269322-539801943592',
  'venice': 'unsplash:1523906834658-6e24ef2386f9', 'athens-and-santorini': 'unsplash:1533105079780-92b9be482077', 'phuket': 'unsplash:1534008897995-27a23e859048', 'cappadocia': 'unsplash:1530789253388-582c481c54b0'
};
// Wikipedia sahifa rasmi bayroq yoki xarita bo'lgan joylar uchun tekshirilgan muqobil Wikimedia suratlari
const T = (path, w = 1280) => `https://thumb.wikimedia.org/wikipedia/commons/thumb/${path}/${w}px-${path.split('/').pop()}`;
const OVERRIDE = {
  3: { img: T('e/ea/Zomin_shahri.jpg'), file: 'Zomin_shahri.jpg', license: 'CC0', artist: 'Wikimedia Commons' },
  8: { img: T('f/f9/Moynaq.jpg'), file: 'Moynaq.jpg', license: 'CC BY 2.0', artist: 'Wikimedia Commons' },
  17: { img: T('3/3c/Mountains_located_South_of_Isfana.JPG'), file: 'Mountains_located_South_of_Isfana.JPG', license: 'CC BY-SA 3.0', artist: 'Wikimedia Commons' },
  79: { img: T('c/c7/Marina_Bay_Sands_%28I%29.jpg'), file: 'Marina_Bay_Sands_(I).jpg', license: 'CC BY 4.0', artist: 'Wikimedia Commons' },
  87: { img: T('a/a4/Hong_Kong_Island_Skyline_201108.jpg'), file: 'Hong_Kong_Island_Skyline_201108.jpg', license: 'CC BY 3.0', artist: 'Wikimedia Commons' },
  92: { img: T('8/83/Mal%C3%A9.jpg'), file: 'Malé.jpg', license: 'CC BY-SA 3.0', artist: 'Wikimedia Commons' },
  102: { img: T('7/73/Zanzibar_sultan_palace.jpg'), file: 'Zanzibar_sultan_palace.jpg', license: 'CC BY-SA 3.0', artist: 'Wikimedia Commons' }
};
const BAD = new Set([61, 106, ...(process.env.BAD_WIKI || '').split(',').filter(Boolean).map(Number)]);
const out = RAW.map((r, i) => {
  const slug = slugify(EN[i]);
  const w = WIKI.find(x => x.i === i) || {};
  const names = { uz: r[0], en: EN[i] };
  for (const [l, v] of Object.entries(w.names || {})) if (l !== 'uz') names[l] = v.replace(/\s*\(.*?\)\s*$/, '');
  let img = null, credit = null;
  if (w.img && !BAD.has(i)) { img = w.img; credit = { artist: stripHtml(w.artist) || 'Wikimedia Commons', license: w.license || 'see source', source: 'https://commons.wikimedia.org/wiki/File:' + encodeURIComponent(String(w.file || '').replace(/ /g, '_')) }; }
  if (OVERRIDE[i]) { const o = OVERRIDE[i]; img = o.img; credit = { artist: o.artist, license: o.license, source: 'https://commons.wikimedia.org/wiki/File:' + encodeURIComponent(o.file.replace(/ /g, '_')) }; }
  if ((!img || BAD.has(i)) && FALLBACK_IMG[slug]) { img = FALLBACK_IMG[slug]; credit = { artist: 'Unsplash', license: 'Unsplash License', source: 'https://unsplash.com' }; }
  if (FALLBACK_IMG[slug] && process.env.PREFER_UNSPLASH === '1') { img = FALLBACK_IMG[slug]; credit = { artist: 'Unsplash', license: 'Unsplash License', source: 'https://unsplash.com' }; }
  const iso = ISO[r[1]] || null;
  return {
    slug, names, uzCountry: r[1], country: iso, region: REGION[r[2]] || 'world', scope: r[3], lat: r[4], lng: r[5],
    cost: { flight: r[6], hotel: r[7], food: r[8], transport: r[9], activities: r[10], tour5d: r[11] },
    months: r[12], tags: r[13], descUz: r[14], localLang: LOCAL_LANG[iso] || 'en', img, credit
  };
});
fs.mkdirSync(path.join(__dirname, '..', 'data'), { recursive: true });
fs.writeFileSync(path.join(__dirname, '..', 'data', 'catalog.json'), JSON.stringify(out));
console.log('catalog:', out.length, 'with images:', out.filter(x => x.img).length, 'names>=8:', out.filter(x => Object.keys(x.names).length >= 8).length);
