/**
 * Sarflar hisoboti (Total) — Excel fayllarini parse qilish API.
 * OYLIKLAR, RASXODLAR, SAVDO listlarini o'qiydi va JSON qaytaradi.
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const { isAuthenticated } = require('../middleware/auth.js');
const { createLogger } = require('../utils/logger.js');

const log = createLogger('EXPENSE_TOTAL');

// Matnni normalizatsiya: trim, ortiqcha bo'shliqlar bitta qilib. Apostrof: Unicode -> ASCII ' (oylik turi match uchun).
function normalizeStr(val) {
  if (val == null) return '';
  const s = String(val).trim().replace(/\s+/g, ' ');
  return s.replace(/[\u2018\u2019\u201A\u02BC\u02BB\u0060]/g, "'");
}

function isValidPlaceName(val) {
  if (val == null) return false;
  const s = normalizeStr(val);
  return s.length > 0 && s !== '0';
}

// Faylda hudud kirillcha yozilganda SAVDO/OYLIKLAR dagi lotin nomiga moslashtirish (filial sarflari to'g'ri yig'ilishi uchun)
const CYRILLIC_HUDUD_TO_LATIN = {
  'юнусабад': 'Yunusobod', 'сергели': 'Sergeli', 'олмалик': 'Olmaliq', 'гулистон': 'Guliston',
  'андижон': 'Andijon', 'наманган': 'NAMANGAN', 'фаргона': "Farg'ona",
  'фарго\'на': "Farg'ona", 'қўқон': 'QOQON', 'қоқон': 'QOQON', 'джизақ': 'JIZZAX', 'қарши': 'Qarshi',
  'шахрисабз': 'Shaxrisabz', 'термиз': 'Termiz', 'денов': 'Denov', 'самарқанд': 'SAMARQAND',
  'каттақўрғон': "Kattaqo'rgon", 'навоий': 'Navoiy', 'зарафшон': 'Zarafshon', 'бухоро': 'BUXORO',
  'хоразм': 'XORAZM', 'нукус': 'NUKUS', 'урикзор': 'Urikzor',
};

function normalizeHududToLatin(val) {
  if (val == null) return '';
  const s = normalizeStr(val);
  if (!s) return '';
  const lower = s.toLowerCase();
  return CYRILLIC_HUDUD_TO_LATIN[lower] || s;
}

// Lotin yozuvdagi variantlarni bitta nomga (SAVDO dagi sklad nomiga) bog'lash
const LATIN_HUDUD_ALIASES = {
  chimkent: 'Shimkent', toshkent: 'Toshkent', fargona: "Farg'ona", qashqadaryo: 'Qashqadaryo',
  surxandaryo: 'Surxandaryo', kattaqorgon: "Kattaqo'rgon",
};

function keyNormHudud(val) {
  if (val == null) return '';
  return String(val).trim().toLowerCase();
}
function canonicalHududName(keyNorm) {
  if (!keyNorm) return '';
  const fromCyrillic = CYRILLIC_HUDUD_TO_LATIN[keyNorm];
  if (fromCyrillic) return fromCyrillic;
  if (LATIN_HUDUD_ALIASES[keyNorm]) return LATIN_HUDUD_ALIASES[keyNorm];
  return keyNorm.charAt(0).toUpperCase() + keyNorm.slice(1);
}

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
});

// OYLIKLAR: B=filial(1), C=bolim/brend(2), E=oylik turi(4), F=summa(5), J=brend(9). Sarlavha orqali ustun aniqlanadi.
function findColByHeader(headerRow, patterns, defaultIndex) {
  if (!headerRow || !Array.isArray(headerRow)) return defaultIndex;
  for (let c = 0; c < headerRow.length; c++) {
    const cell = normalizeStr(headerRow[c]);
    if (!cell) continue;
    const lower = cell.toLowerCase();
    if (patterns.some(p => typeof p === 'string' ? lower.includes(p.toLowerCase()) : p.test(lower))) return c;
  }
  return defaultIndex;
}

function parseOyliklar(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheetName = wb.SheetNames.find(n => /oyliklar|oylik/i.test(n)) || wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  log.info('[parseOyliklar] list=%s qatorlar=%s', sheetName, rows.length);

  if (rows.length < 2) return [];
  const header = rows[0];
  const colFilial = findColByHeader(header, ['filial', 'sklad', 'филиал', 'склад'], 1);
  const colOylikTuri = findColByHeader(header, ['oylik turi', 'oylikturi', 'тип', 'оклад', 'turi', 'oylik'], 4);
  const colSumma = findColByHeader(header, ['summa', 'сумма', 'jami', 'итого'], 5);
  const colC = findColByHeader(header, ['bo\'lim', 'bolim', 'отдел'], 2);
  const colJ = 9; // J=Brend (Excel), C=Bo'lim — sarlavhada ikkalasi "brend" bo‘lishi mumkin, J=9 qotib qoladi
  if (colOylikTuri !== 4 || colSumma !== 5 || colFilial !== 1) {
    log.info('[parseOyliklar] sarlavha bo\'yicha ustunlar: filial=%s oylikTuri=%s summa=%s C=%s J=%s', colFilial, colOylikTuri, colSumma, colC, colJ);
  }

  const out = [];
  const seenOylikTuri = new Set();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const filialRaw = normalizeStr(row[colFilial]);
    const filial = normalizeHududToLatin(filialRaw) || filialRaw;
    const oylikTuri = normalizeStr(row[colOylikTuri]);
    let summa = row[colSumma];
    if (summa == null || summa === '') continue;
    summa = Number(summa);
    if (Number.isNaN(summa)) continue;
    const brendJ = row[colJ] != null ? normalizeStr(row[colJ]) : '';
    const brendC = row[colC] != null ? normalizeStr(row[colC]) : '';
    const brend = brendJ || brendC;
    if (oylikTuri) seenOylikTuri.add(oylikTuri);
    if (!filial && !brend && !oylikTuri) continue;
    if (!isValidPlaceName(filial) && !isValidPlaceName(brend)) continue;
    out.push({ filial: isValidPlaceName(filial) ? filial : null, brend: isValidPlaceName(brend) ? brend : null, oylikTuri: oylikTuri || null, summa });
  }
  const uniqueFilial = [...new Set(out.map(r => r.filial).filter(Boolean))];
  const uniqueBrend = [...new Set(out.map(r => r.brend).filter(Boolean))];
  log.info('[parseOyliklar] chiqdi qatorlar=%s | filiallar=%s | brendlar=%s | oylikTurlari=%s', out.length, uniqueFilial.length, uniqueBrend.length, [...seenOylikTuri]);
  if (seenOylikTuri.size > 0 && seenOylikTuri.size <= 2) {
    log.warn('[parseOyliklar] Faylda faqat %s ta oylik turi topildi. Agar OFIS oylik / BRAND MANAGER 0 bo\'lsa, ular faylda boshqa nomda yoki boshqa ustunda bo\'lishi mumkin.', seenOylikTuri.size);
  }
  log.debug('[parseOyliklar] filiallar=%j brendlar=%j oylikTurlari=%j', uniqueFilial, uniqueBrend, [...seenOylikTuri]);
  return out;
}

// RASXODLAR: 1-2 sarlavha, 3-qatordan. Hudud: A(0) yoki F(5) — Excel SUMIF(RASXODLAR!F:F,...) da F ishlatiladi. Jami: AN(39), agar yo'q bo'lsa ustun 2.
function parseRasxodlar(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheetName = wb.SheetNames.find(n => /rasxod|расход/i.test(n)) || wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  log.info('[parseRasxodlar] list=%s qatorlar=%s', sheetName, rows.length);

  if (rows.length < 3) return [];
  const byHudud = {};
  for (let i = 2; i < rows.length; i++) {
    const row = rows[i];
    const hududF = normalizeStr(row[5]);
    const hududA = normalizeStr(row[0]);
    const hududRaw = hududF || hududA;
    const hududLatin = normalizeHududToLatin(hududRaw) || hududRaw;
    const keyNorm = keyNormHudud(hududLatin);
    const groupKey = (LATIN_HUDUD_ALIASES[keyNorm] && keyNormHudud(LATIN_HUDUD_ALIASES[keyNorm])) || keyNorm;
    const jami = row[39] != null ? Number(row[39]) : (row[2] != null ? Number(row[2]) : 0);
    if (Number.isNaN(jami)) continue;
    if (!isValidPlaceName(hududLatin) && jami === 0) continue;
    const finalKey = groupKey || '—';
    if (!byHudud[finalKey]) byHudud[finalKey] = 0;
    byHudud[finalKey] += jami;
  }
  const out = Object.entries(byHudud)
    .filter(([k]) => k !== '—')
    .map(([keyNorm, jami]) => ({ hudud: canonicalHududName(keyNorm), jami }));
  const hududlar = out.map(r => r.hudud).filter(Boolean);
  log.info('[parseRasxodlar] chiqdi qatorlar=%s | hududlar=%s', out.length, hududlar.length);
  log.debug('[parseRasxodlar] hududlar=%j', hududlar);
  return out;
}

// SAVDO: A=brend(0), C=sklad(2), D=summa(3)
function parseSavdo(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheetName = wb.SheetNames.find(n => /savdo|савдо/i.test(n)) || wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  log.info('[parseSavdo] list=%s qatorlar=%s', sheetName, rows.length);

  if (rows.length < 2) return [];
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const brend = normalizeStr(row[0]);
    const sklad = normalizeStr(row[2]);
    let summa = row[3];
    if (summa == null || summa === '') continue;
    summa = Number(summa);
    if (Number.isNaN(summa)) continue;
    if (!isValidPlaceName(brend) && !isValidPlaceName(sklad)) continue;
    out.push({ brend: isValidPlaceName(brend) ? brend : null, sklad: isValidPlaceName(sklad) ? sklad : null, summa });
  }
  const uniqueBrend = [...new Set(out.map(r => r.brend).filter(Boolean))];
  const uniqueSklad = [...new Set(out.map(r => r.sklad).filter(Boolean))];
  log.info('[parseSavdo] chiqdi qatorlar=%s | brendlar=%s | skladlar=%s', out.length, uniqueBrend.length, uniqueSklad.length);
  log.debug('[parseSavdo] brendlar=%j skladlar=%j', uniqueBrend, uniqueSklad);
  return out;
}

router.post('/parse', isAuthenticated, upload.fields([
  { name: 'oyliklar', maxCount: 1 },
  { name: 'rasxodlar', maxCount: 1 },
  { name: 'savdo', maxCount: 1 },
]), (req, res) => {
  try {
    const oyliklarFile = req.files?.oyliklar?.[0];
    const rasxodlarFile = req.files?.rasxodlar?.[0];
    const savdoFile = req.files?.savdo?.[0];

    log.info('[parse] fayllar: oyliklar=%s rasxodlar=%s savdo=%s',
      !!oyliklarFile, !!rasxodlarFile, !!savdoFile);

    let oyliklar = [];
    let rasxodlar = [];
    let savdo = [];

    if (oyliklarFile?.buffer) {
      try {
        oyliklar = parseOyliklar(oyliklarFile.buffer);
      } catch (e) {
        log.warn('[parse] OYLIKLAR parse xato: %s', e.message);
      }
    }
    if (rasxodlarFile?.buffer) {
      try {
        rasxodlar = parseRasxodlar(rasxodlarFile.buffer);
      } catch (e) {
        log.warn('[parse] RASXODLAR parse xato: %s', e.message);
      }
    }
    if (savdoFile?.buffer) {
      try {
        savdo = parseSavdo(savdoFile.buffer);
      } catch (e) {
        log.warn('[parse] SAVDO parse xato: %s', e.message);
      }
    }

    log.info('[parse] natija: oyliklar=%s rasxodlar=%s savdo=%s', oyliklar.length, rasxodlar.length, savdo.length);
    if (oyliklar.length) {
      const filials = [...new Set(oyliklar.map(r => r.filial).filter(Boolean))];
      const brends = [...new Set(oyliklar.map(r => r.brend).filter(Boolean))];
      const turi = [...new Set(oyliklar.map(r => r.oylikTuri).filter(Boolean))];
      log.info('[parse] OYLIKLAR: filiallar=%j brendlar=%j oylikTurlari=%j', filials, brends, turi);
    }
    if (rasxodlar.length) log.info('[parse] RASXODLAR: hududlar=%j', rasxodlar.map(r => r.hudud));
    if (savdo.length) {
      log.info('[parse] SAVDO: brendlar=%j skladlar=%j', [...new Set(savdo.map(r => r.brend).filter(Boolean))], [...new Set(savdo.map(r => r.sklad).filter(Boolean))]);
    }

    res.json({
      success: true,
      oyliklar,
      rasxodlar,
      savdo,
    });
  } catch (err) {
    log.error('[parse] xatolik: %s', err);
    res.status(500).json({ success: false, message: err.message || 'Parse xatolik' });
  }
});

module.exports = router;
