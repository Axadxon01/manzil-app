'use strict';
/**
 * Baza zaxira nusxalari: har kuni (Toshkent vaqti 03:30) `VACUUM INTO` bilan izchil nusxa, oxirgi 14 tasi saqlanadi.
 * Joylashuv: BACKUP_DIR yoki baza papkasidagi backups/ (Render diskida: /data/backups).
 * Render Persistent Disk o'zi ham kunlik snapshot oladi — bu ikkinchi himoya qatlami.
 * Tiklash: serverni to'xtating, kerakli .db faylni DB_PATH o'rniga nusxalang, qayta ishga tushiring.
 */
const fs = require('fs');
const path = require('path');
const db = require('./db');

const KEEP = Math.max(3, Number(process.env.BACKUP_KEEP) || 14);
const dir = () => process.env.BACKUP_DIR || path.join(db.IN_MEMORY ? require('os').tmpdir() : path.dirname(db.DB_PATH), 'backups');

async function snapshot(tag = 'daily') {
  fs.mkdirSync(dir(), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(dir(), `manzil-${tag}-${stamp}.db`);
  db.raw.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  prune();
  return file;
}
function prune() {
  const files = list();
  for (const f of files.slice(KEEP)) { try { fs.unlinkSync(path.join(dir(), f.name)); } catch (_) {} }
}
function list() {
  try { return fs.readdirSync(dir()).filter(f => /^manzil-.*\.db$/.test(f)).map(name => ({ name, size: fs.statSync(path.join(dir(), name)).size, at: fs.statSync(path.join(dir(), name)).mtime.toISOString() })).sort((a, b) => b.at.localeCompare(a.at)); } catch (_) { return []; }
}
function info() { return { dir: dir(), keep: KEEP, persistent: !db.IN_MEMORY, files: list().slice(0, KEEP) }; }

let lastDay = '';
function schedule() {
  if (process.env.BACKUP_DISABLED === 'true' || db.IN_MEMORY) return;
  setInterval(() => {
    const tz = new Date(Date.now() + 5 * 3600 * 1000); // Toshkent UTC+5
    const day = tz.toISOString().slice(0, 10);
    if (tz.getUTCHours() === 3 && tz.getUTCMinutes() >= 30 && lastDay !== day) {
      lastDay = day;
      snapshot('daily').then(f => console.log('[backup]', path.basename(f))).catch(e => console.error('[backup]', e.message));
    }
  }, 60 * 1000).unref();
}
module.exports = { snapshot, info, schedule };
