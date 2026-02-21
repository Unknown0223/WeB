/**
 * Sarflar hisoboti (Total) — 3 ta alohida import (OYLIKLAR, RASXODLAR, SAVDO) + Total jadvali.
 * Yangi filial/brend importda bo'lsa avtomatik kerakli joyida ko'rinadi.
 */

const LOG_PREFIX = '[ExpenseTotal]';

function log(msg, data) {
  if (typeof console !== 'undefined' && console.log) {
    const t = new Date().toISOString();
    if (data !== undefined) console.log(t, LOG_PREFIX, msg, data);
    else console.log(t, LOG_PREFIX, msg);
  }
}

// Import qilingan ma'lumotlar (backend ulanganda API dan to'ldiriladi)
let stateOyliklar = [];
let stateRasxodlar = [];
let stateSavdo = [];

// Tanlangan fayllar (jarayon bitta tugma bosilganda ishlatiladi)
let selectedFiles = { oyliklar: null, rasxodlar: null, savdo: null };

const MONTHS = [
  { value: '2025-11', label: 'Noyabr 2025' },
  { value: '2025-10', label: 'Oktabr 2025' },
];

// Excel ИТОГ dagi brend va filial tartibi (formulalardan olingan). Qo'shimcha: AUDIT, DOSTAVKA, KASSA, OFIS oylik, SKLAD, UMUMIY, Meychendayzer
const BREND_ORDER = ['LALAKU', 'GIGA', 'DIELUX', 'MAMA', 'SOF', 'REVEREM', 'ARZONI', 'ECONOM', 'APTEKA', 'MONNO', 'SET', 'AUDIT', 'DOSTAVKA', 'KASSA', 'Meychendayzer', 'OFIS oylik', 'SKLAD', 'UMUMIY'];
const FILIAL_ORDER = ['Yunusobod', 'Sergeli', 'Olmaliq', 'Guliston', 'Andijon', 'NAMANGAN', "Farg'ona", 'QOQON', 'JIZZAX', 'Qarshi', 'Shaxrisabz', 'Termiz', 'Denov', 'SAMARQAND', "Kattaqo'rgon", 'Navoiy', 'Zarafshon', 'BUXORO', 'XORAZM', 'NUKUS', 'Urikzor'];
// Nom qabul qilinadi (0, "0", bo'sh — filial/brend sifatida ko'rsatilmaydi)
function isValidName(s) {
  if (s == null) return false;
  const n = String(s).trim();
  return n.length > 0 && n !== '0';
}

// Oylik turlari (Excel E ustuni) — aniq va qisqa variantlar (match uchun). Faylda ruscha/o'zbekcha bo'lishi mumkin.
const OYLIK_TURI_KOMMANDA = 'Komanda oyligi';
const OYLIK_TURI_DS = 'DS va Qolgan bolimlar oyliklari';
const OYLIK_TURI_OFIS = 'OFIS oylik';
const OYLIK_TURI_BM = 'BRAND MANAGER';
// Excel da boshqacha yozilishi mumkin — o'zbek, rus va qisqa variantlar
const OYLIK_TURI_ALIASES = {
  [OYLIK_TURI_KOMMANDA]: ['komanda oyligi', 'komanda', 'команда оклади', 'команда оклады', 'команда'],
  [OYLIK_TURI_DS]: ['ds va qolgan', 'ds va qolgan bolimlar', 'ds va qolgan bolimlar oyliklari', 'qolgan bolimlar', 'ds va qolgan bo\'limlar oyliklari', 'ds и остальные отделы', 'остальные отделы', 'qolgan bo\'limlar', 'ds va qolgan bo\'limlar'],
  [OYLIK_TURI_OFIS]: ['ofis oylik', 'ofis', 'офис оклади', 'офис оклады', 'офис'],
  [OYLIK_TURI_BM]: ['brand manager', 'brand manager oylik', 'бренд менеджер', 'бренд менеджер оклади'],
};
// Apostrof va bo'shliq — faylda turli Unicode belgilar bo'lishi mumkin (masalan bo'limlar)
function normalizeOylikTuri(turi) {
  if (turi == null) return '';
  const s = String(turi).trim().replace(/\s+/g, ' ');
  const apostrofNorm = s.replace(/[\u2018\u2019\u201A\u02BC\u02BB\u0060]/g, "'");
  return apostrofNorm.toLowerCase();
}

function matchOylikTuri(turi) {
  const n = normalizeOylikTuri(turi);
  if (!n) return null;
  const nNoApos = n.replace(/'/g, ''); // bo'lim -> bolim (qisman match uchun)
  if (normalizeOylikTuri(OYLIK_TURI_KOMMANDA) === n || OYLIK_TURI_ALIASES[OYLIK_TURI_KOMMANDA].some(a => a === n)) return OYLIK_TURI_KOMMANDA;
  if (normalizeOylikTuri(OYLIK_TURI_DS) === n || (OYLIK_TURI_ALIASES[OYLIK_TURI_DS] && OYLIK_TURI_ALIASES[OYLIK_TURI_DS].some(a => a === n))) return OYLIK_TURI_DS;
  if (normalizeOylikTuri(OYLIK_TURI_OFIS) === n || (OYLIK_TURI_ALIASES[OYLIK_TURI_OFIS] && OYLIK_TURI_ALIASES[OYLIK_TURI_OFIS].some(a => a === n))) return OYLIK_TURI_OFIS;
  if (normalizeOylikTuri(OYLIK_TURI_BM) === n || (OYLIK_TURI_ALIASES[OYLIK_TURI_BM] && OYLIK_TURI_ALIASES[OYLIK_TURI_BM].some(a => a === n))) return OYLIK_TURI_BM;
  if (n.includes('komanda') || n.includes('команда')) return OYLIK_TURI_KOMMANDA;
  if ((n.includes('ds') || n.includes('дс')) && (n.includes('qolgan') || nNoApos.includes('bolim') || n.includes('осталь') || n.includes('отдел'))) return OYLIK_TURI_DS;
  if (n.includes('ofis') || n.includes('офис')) return OYLIK_TURI_OFIS;
  if ((n.includes('brand') || n.includes('бренд')) && (n.includes('manager') || n.includes('менеджер'))) return OYLIK_TURI_BM;
  return null;
}

// Filial/sklad/brend nomlarini solishtirish uchun (registrsiz, trim) — ma'lumot to'liq moslashuvi
function keyNorm(s) {
  if (s == null) return '';
  return String(s).trim().toLowerCase();
}
function sameKey(a, b) {
  return keyNorm(a) === keyNorm(b);
}

function formatNumber(num) {
  if (num == null || Number.isNaN(num)) return '—';
  return new Intl.NumberFormat('uz-UZ').format(Math.round(num));
}

function escapeHtml(s) {
  if (s == null) return '';
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

// Brend — faqat SAVDO listidagi savdo yo'nalishlari (LALAKU, GIGA, ...). OYLIKLAR da C ustuni "Bo'lim" (DOSTAVKA, KASSA, SKLAD) bo'lib, ular jadvalda alohida brend qatori sifatida ko'rsatilmaydi.
// Filial — OYLIKLAR (B), RASXODLAR (hudud), SAVDO (sklad) dan.
function getUniqueBrendsAndFilials() {
  const brendByKey = new Map();
  const filialByKey = new Map();
  stateOyliklar.forEach(r => {
    if (isValidName(r.filial)) filialByKey.set(keyNorm(r.filial), r.filial);
  });
  stateRasxodlar.forEach(r => {
    if (isValidName(r.hudud)) filialByKey.set(keyNorm(r.hudud), r.hudud);
  });
  stateSavdo.forEach(r => {
    if (isValidName(r.brend)) brendByKey.set(keyNorm(r.brend), r.brend);
    if (isValidName(r.sklad)) filialByKey.set(keyNorm(r.sklad), r.sklad);
  });
  // Faqat ma'lumot bor filiallarni qoldiramiz (oyliklar yoki savdo bo'lsa)
  const filialsWithData = filialByKey.values();
  const filialKeysWithData = new Set();
  stateOyliklar.forEach(r => { if (isValidName(r.filial)) filialKeysWithData.add(keyNorm(r.filial)); });
  stateSavdo.forEach(r => { if (isValidName(r.sklad)) filialKeysWithData.add(keyNorm(r.sklad)); });
  const filialsFromDataFiltered = [...filialByKey.entries()].filter(([k]) => filialKeysWithData.has(k)).map(([, v]) => v);
  const brendsFromData = [...brendByKey.values()];
  const filialsFromData = filialsFromDataFiltered.length ? filialsFromDataFiltered : [...filialByKey.values()];
  const hasData = stateOyliklar.length > 0 || stateRasxodlar.length > 0 || stateSavdo.length > 0;
  log('getUniqueBrendsAndFilials', {
    oyliklarRows: stateOyliklar.length,
    rasxodlarRows: stateRasxodlar.length,
    savdoRows: stateSavdo.length,
    brendsFromData,
    filialsFromData,
    hasData,
  });
  const brendsSet = new Set(brendsFromData);
  const filialsSet = new Set(filialsFromData);
  const brends = [...brendsSet].sort((a, b) => {
    const ia = BREND_ORDER.indexOf(a);
    const ib = BREND_ORDER.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b);
  });
  const filials = [...filialsSet].sort((a, b) => {
    const ia = FILIAL_ORDER.indexOf(a);
    const ib = FILIAL_ORDER.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b);
  });
  return { brends, filials };
}

// Oylik turi bo'yicha yig'indi (Excel: D=Komanda, E=DS, F=OFIS, G=BRAND MANAGER, H=SUM). Oylik turi aniq yoki alias orqali moslashtiriladi. eqFn — optional (a,b)=>boolean filial/brend solishtirish (default ===).
function sumOylikByTuri(list, filter = {}, eqFn = (a, b) => a === b) {
  const f = (r) => {
    if (filter.filial != null && !eqFn(r.filial, filter.filial)) return false;
    if (filter.brend != null && !eqFn(r.brend, filter.brend)) return false;
    return true;
  };
  const sum = (key) => list.filter(f).filter(r => matchOylikTuri(r.oylikTuri || r.oylik_turi || '') === key).reduce((s, r) => s + (Number(r.summa) || 0), 0);
  const komanda = sum(OYLIK_TURI_KOMMANDA);
  const ds = sum(OYLIK_TURI_DS);
  const ofis = sum(OYLIK_TURI_OFIS);
  const brandManager = sum(OYLIK_TURI_BM);
  const jami = komanda + ds + ofis + brandManager;
  return { komanda, ds, ofis, brandManager, jami };
}

// Total qatorlari: Excel formulalari bo'yicha — respublika (barcha brendlar) + har bir filial bloki
function computeTotalRows() {
  const { brends, filials } = getUniqueBrendsAndFilials();
  log('computeTotalRows boshlandi', { brendsCount: brends.length, filialsCount: filials.length, brends, filials });
  if (brends.length === 0 && filials.length === 0) {
    log('computeTotalRows: brend va filial yo\'q, bo\'sh qatorlar');
    return [];
  }

  const rows = [];
  const getSum = (list, key) => list.reduce((s, r) => s + (Number(r[key]) || 0), 0);
  const jamiSavdo = getSum(stateSavdo, 'summa');
  const jamiRasxodResp = getSum(stateRasxodlar, 'jami');
  // ——— РЕСПУБЛИКА bloki (faqat SAVDO brendlari) ———
  rows.push({ type: 'header', label: 'РЕСПУБЛИКА', filial: null });
  let sumOylikResp = 0;
  let sumKomandaResp = 0;
  let sumDsResp = 0;
  let sumOfisResp = 0;
  let sumBmResp = 0;
  let sumRasxodResp = 0;
  let sumSarflarResp = 0;

  brends.forEach(brend => {
    const o = sumOylikByTuri(stateOyliklar, { brend }, sameKey);
    const savdo = stateSavdo.filter(r => sameKey(r.brend, brend)).reduce((s, r) => s + (Number(r.summa) || 0), 0);
    const savdoPct = jamiSavdo ? savdo / jamiSavdo : 0;
    const filialSarflari = jamiRasxodResp * savdoPct; // Excel: RASXODLAR!$AN$34*P
    const podarkalar = 0;
    const sarflarJami = o.jami + filialSarflari + podarkalar;
    sumOylikResp += o.jami;
    sumKomandaResp += o.komanda;
    sumDsResp += o.ds;
    sumOfisResp += o.ofis;
    sumBmResp += o.brandManager;
    sumRasxodResp += filialSarflari;
    sumSarflarResp += sarflarJami;
    rows.push({
      type: 'data',
      filial: null,
      brendHudud: brend,
      komandaOyligi: o.komanda,
      dsOylik: o.ds,
      ofisOylik: o.ofis,
      brandManager: o.brandManager,
      oyliklarJami: o.jami,
      filialSarflari,
      podarkalar,
      sarflarJami,
      savdo,
      savdoPct,
      rentPct: savdo ? sarflarJami / savdo : 0,
    });
  });

  // "Boshqa (bo'limlar)" qatori ko'rsatilmaydi — faqat SAVDO brendlari va ularning ИТОГО si

  if (brends.length > 0) {
    rows.push({
      type: 'itogo',
      filial: null,
      brendHudud: 'ИТОГО',
      komandaOyligi: sumKomandaResp,
      dsOylik: sumDsResp,
      ofisOylik: sumOfisResp,
      brandManager: sumBmResp,
      oyliklarJami: sumOylikResp,
      filialSarflari: sumRasxodResp,
      podarkalar: 0,
      sarflarJami: sumSarflarResp,
      savdo: jamiSavdo,
      savdoPct: 1,
      rentPct: jamiSavdo ? sumSarflarResp / jamiSavdo : 0,
    });
  }

  // ——— Hudud bloklari: faqat SAVDO dagi brendlar (DOSTAVKA/KASSA/SKLAD va b. bo'limlar alohida qator ko'rsatilmaydi)
  filials.forEach(filial => {
    const filialBrendByKey = new Map();
    stateSavdo.filter(r => sameKey(r.sklad, filial)).forEach(r => { if (isValidName(r.brend)) filialBrendByKey.set(keyNorm(r.brend), r.brend); });
    if (filialBrendByKey.size === 0) {
      log('computeTotalRows: filialda brend yo\'q, blok o\'tkazib yuborildi', { filial });
      return;
    }
    rows.push({ type: 'header', label: filial, filial });
    const filialBrends = [...filialBrendByKey.values()].sort((a, b) => {
      const ia = BREND_ORDER.indexOf(a);
      const ib = BREND_ORDER.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.localeCompare(b);
    });
    const filialSavdoJami = getSum(stateSavdo.filter(r => sameKey(r.sklad, filial)), 'summa');
    const rasxodFilialJami = getSum(stateRasxodlar.filter(r => sameKey(r.hudud, filial)), 'jami');

    let itogoKomanda = 0;
    let itogoDs = 0;
    let itogoOfis = 0;
    let itogoBm = 0;
    let itogoOylik = 0;
    let itogoRasxod = 0;
    let itogoSarflar = 0;

    filialBrends.forEach(brend => {
      const o = sumOylikByTuri(stateOyliklar, { filial, brend }, sameKey);
      itogoKomanda += o.komanda;
      itogoDs += o.ds;
      itogoOfis += o.ofis;
      itogoBm += o.brandManager;
      const savdo = stateSavdo
        .filter(r => sameKey(r.sklad, filial) && sameKey(r.brend, brend))
        .reduce((s, r) => s + (Number(r.summa) || 0), 0);
      const savdoPctFilial = filialSavdoJami ? savdo / filialSavdoJami : 0; // Excel: N18/$N$28 (hudud ichida %)
      const filialSarflari = rasxodFilialJami * savdoPctFilial; // Excel: SUMIF(RASXOD...,filial)*P
      const podarkalar = 0;
      const sarflarJami = o.jami + filialSarflari + podarkalar;
      itogoOylik += o.jami;
      itogoRasxod += filialSarflari;
      itogoSarflar += sarflarJami;
      rows.push({
        type: 'data',
        filial,
        brendHudud: brend,
        komandaOyligi: o.komanda,
        dsOylik: o.ds,
        ofisOylik: o.ofis,
        brandManager: o.brandManager,
        oyliklarJami: o.jami,
        filialSarflari,
        podarkalar,
        sarflarJami,
        savdo,
        savdoPct: filialSavdoJami ? savdo / filialSavdoJami : 0,
        rentPct: savdo ? sarflarJami / savdo : 0,
      });
    });

    const itogoSarflarJami = itogoOylik + itogoRasxod;
    log('computeTotalRows: filial blok qo\'shildi', { filial, filialBrendsCount: filialBrends.length, filialBrends, itogoOylik, itogoRasxod, filialSavdoJami });
    rows.push({
      type: 'itogo',
      filial,
      brendHudud: 'ИТОГО',
      komandaOyligi: itogoKomanda,
      dsOylik: itogoDs,
      ofisOylik: itogoOfis,
      brandManager: itogoBm,
      oyliklarJami: itogoOylik,
      filialSarflari: itogoRasxod,
      podarkalar: 0,
      sarflarJami: itogoSarflarJami,
      savdo: filialSavdoJami,
      savdoPct: jamiSavdo ? filialSavdoJami / jamiSavdo : 0,
      rentPct: filialSavdoJami ? itogoSarflarJami / filialSavdoJami : 0,
    });
  });

  return rows;
}

function updateImportStatus(listKey, text, count) {
  const el = document.getElementById(`expense-import-status-${listKey}`);
  if (el) el.textContent = count != null ? `${text}: ${formatNumber(count)} qator` : text;
}

// Excel ИТОГ dagi ustun sarlavhalari — har bir guruh jadvalida takrorlanadi
const TOTAL_TABLE_HEADERS = [
  { class: 'col-brend', text: 'Brend / Hudud' },
  { class: 'col-num', text: 'Komanda oyligi' },
  { class: 'col-num', text: 'DS va qolgan oyliklar' },
  { class: 'col-num', text: 'OFIS oylik' },
  { class: 'col-num', text: 'BRAND MANAGER' },
  { class: 'col-num', text: 'Oyliklar jami' },
  { class: 'col-num', text: 'Filial sarflari' },
  { class: 'col-num', text: 'Podarkalar' },
  { class: 'col-num', text: 'Sarflar jami' },
  { class: 'col-num', text: 'Savdo' },
  { class: 'col-pct', text: 'САВДО %' },
  { class: 'col-pct', text: 'Рент %' },
  { class: 'col-pct', text: 'Рент РЕСП %' },
];

function renderTotalTable(rows) {
  const tablesContainer = document.getElementById('expense-total-tables');
  const emptyEl = document.getElementById('expense-total-empty');
  const wrapper = document.querySelector('.expense-total-table-wrapper');

  if (!tablesContainer) return;

  const filterFilial = document.getElementById('expense-total-filial')?.value || '';
  const filterBrend = document.getElementById('expense-total-brend')?.value || '';

  let filtered = rows;
  if (filterFilial) {
    filtered = filtered.filter(r =>
      (r.type === 'header' && sameKey(r.label, filterFilial)) ||
      (r.filial != null && sameKey(r.filial, filterFilial)) ||
      (r.type === 'itogo' && r.filial != null && sameKey(r.filial, filterFilial))
    );
  }
  if (filterBrend) {
    filtered = filtered.filter(r => r.type === 'header' || r.type === 'itogo' || sameKey(r.brendHudud, filterBrend));
  }

  if (filtered.length === 0) {
    tablesContainer.innerHTML = '';
    if (emptyEl) emptyEl.classList.remove('hidden');
    if (wrapper) wrapper.classList.add('hidden');
    return;
  }

  if (emptyEl) emptyEl.classList.add('hidden');
  if (wrapper) wrapper.classList.remove('hidden');

  const pctCell = (pct, isWarning) => {
    if (pct == null || Number.isNaN(pct)) return '<span>—</span>';
    const cls = isWarning ? ' expense-pct-warning' : '';
    return `<span class="${cls}">${(pct * 100).toFixed(2)}%</span>`;
  };

  const rowToTr = (row) => {
    if (row.type === 'itogo') {
      const rentRespCell = row.filial != null && row.rentPct != null
        ? (row.rentPct * 100).toFixed(2) + '%'
        : '—';
      return `<tr class="expense-total-itogo-row">
        <td class="fw-600">${escapeHtml(row.brendHudud)}</td>
        <td class="text-right">${formatNumber(row.komandaOyligi)}</td>
        <td class="text-right">${formatNumber(row.dsOylik)}</td>
        <td class="text-right">${formatNumber(row.ofisOylik)}</td>
        <td class="text-right">${formatNumber(row.brandManager)}</td>
        <td class="fw-600 text-right">${formatNumber(row.oyliklarJami)}</td>
        <td class="fw-600 text-right">${formatNumber(row.filialSarflari)}</td>
        <td class="text-right">${formatNumber(row.podarkalar)}</td>
        <td class="fw-600 text-right">${formatNumber(row.sarflarJami)}</td>
        <td class="fw-600 text-right">${formatNumber(row.savdo)}</td>
        <td class="text-right">${row.savdoPct != null ? pctCell(row.savdoPct, row.savdoPct > 1) : '—'}</td>
        <td class="text-right">${row.rentPct != null ? (row.rentPct * 100).toFixed(2) + '%' : '—'}</td>
        <td class="text-right">${rentRespCell}</td>
      </tr>`;
    }
    const rentRespCell = row.filial != null && row.rentPct != null
      ? (row.rentPct * 100).toFixed(2) + '%'
      : '—';
    return `<tr>
      <td>${escapeHtml(row.brendHudud)}</td>
      <td class="text-right">${formatNumber(row.komandaOyligi)}</td>
      <td class="text-right">${formatNumber(row.dsOylik)}</td>
      <td class="text-right">${formatNumber(row.ofisOylik)}</td>
      <td class="text-right">${formatNumber(row.brandManager)}</td>
      <td class="text-right">${formatNumber(row.oyliklarJami)}</td>
      <td class="text-right">${formatNumber(row.filialSarflari)}</td>
      <td class="text-right">${formatNumber(row.podarkalar)}</td>
      <td class="text-right">${formatNumber(row.sarflarJami)}</td>
      <td class="text-right">${formatNumber(row.savdo)}</td>
      <td class="text-right">${pctCell(row.savdoPct, row.savdoPct > 1)}</td>
      <td class="text-right">${(row.rentPct * 100).toFixed(2)}%</td>
      <td class="text-right">${rentRespCell}</td>
    </tr>`;
  };

  // Guruhlarga ajratish: har bir "header" dan keyingi qatorlar shu guruhga (keyingi header gacha)
  const groups = [];
  let current = null;
  for (const row of filtered) {
    if (row.type === 'header') {
      current = { label: row.label, rows: [] };
      groups.push(current);
    } else if (current) {
      current.rows.push(row);
    }
  }

  const theadRow = '<tr>' + TOTAL_TABLE_HEADERS.map(h => `<th class="${h.class}">${escapeHtml(h.text)}</th>`).join('') + '</tr>';

  tablesContainer.innerHTML = groups.map(g => {
    const tbodyRows = g.rows.map(rowToTr).join('');
    return `<table class="expense-total-table expense-total-table-itog expense-total-group">
      <caption class="expense-total-group-caption">${escapeHtml(g.label)}</caption>
      <thead>${theadRow}</thead>
      <tbody>${tbodyRows}</tbody>
    </table>`;
  }).join('');

  if (typeof feather !== 'undefined') feather.replace();
}

function updateSummaryAndFilters() {
  const { brends, filials } = getUniqueBrendsAndFilials();
  log('updateSummaryAndFilters', { brendsCount: brends.length, filialsCount: filials.length, brends, filials });
  const rows = computeTotalRows();
  log('computeTotalRows', { rowsCount: rows.length });

  const totalOylik = stateOyliklar.reduce((s, r) => s + (Number(r.summa) || 0), 0);
  const totalRasxod = stateRasxodlar.reduce((s, r) => s + (Number(r.jami) || 0), 0);
  const totalSavdo = stateSavdo.reduce((s, r) => s + (Number(r.summa) || 0), 0);

  document.getElementById('expense-summary-oylik-value').textContent = formatNumber(totalOylik) + ' so\'m';
  document.getElementById('expense-summary-rasxod-value').textContent = formatNumber(totalRasxod) + ' so\'m';
  document.getElementById('expense-summary-savdo-value').textContent = formatNumber(totalSavdo) + ' so\'m';

  const filialSel = document.getElementById('expense-total-filial');
  const brendSel = document.getElementById('expense-total-brend');
  if (filialSel) {
    const cur = filialSel.value;
    filialSel.innerHTML = '<option value="">Barchasi</option>' + filials.map(f => `<option value="${escapeHtml(f)}">${escapeHtml(f)}</option>`).join('');
    if (filials.includes(cur)) filialSel.value = cur;
  }
  if (brendSel) {
    const cur = brendSel.value;
    brendSel.innerHTML = '<option value="">Barchasi</option>' + brends.map(b => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`).join('');
    if (brends.includes(cur)) brendSel.value = cur;
  }

  renderTotalTable(rows);
}

// Mock ma'lumot — Excel filial/brend va oylik turlariga mos (backend/Excel parse ulanganda o'rniga haqiqiy)
function getMockOyliklar() {
  return [
    { filial: 'Yunusobod', brend: 'LALAKU', oylikTuri: OYLIK_TURI_KOMMANDA, summa: 209994000 },
    { filial: 'Yunusobod', brend: 'LALAKU', oylikTuri: OYLIK_TURI_DS, summa: 183348447 },
    { filial: 'Yunusobod', brend: 'LALAKU', oylikTuri: OYLIK_TURI_OFIS, summa: 58020567 },
    { filial: 'Yunusobod', brend: 'LALAKU', oylikTuri: OYLIK_TURI_BM, summa: 12163677 },
    { filial: 'Yunusobod', brend: 'GIGA', oylikTuri: OYLIK_TURI_KOMMANDA, summa: 92254000 },
    { filial: 'Yunusobod', brend: 'GIGA', oylikTuri: OYLIK_TURI_DS, summa: 38218838 },
    { filial: 'Yunusobod', brend: 'GIGA', oylikTuri: OYLIK_TURI_OFIS, summa: 12094341 },
    { filial: 'Yunusobod', brend: 'GIGA', oylikTuri: OYLIK_TURI_BM, summa: 2535509 },
    { filial: 'Sergeli', brend: 'LALAKU', oylikTuri: OYLIK_TURI_KOMMANDA, summa: 272700000 },
    { filial: 'Sergeli', brend: 'LALAKU', oylikTuri: OYLIK_TURI_DS, summa: 179304636 },
    { filial: 'Sergeli', brend: 'LALAKU', oylikTuri: OYLIK_TURI_OFIS, summa: 21233345 },
    { filial: 'Sergeli', brend: 'LALAKU', oylikTuri: OYLIK_TURI_BM, summa: 4451448 },
    { filial: 'Sergeli', brend: 'GIGA', oylikTuri: OYLIK_TURI_KOMMANDA, summa: 47787000 },
    { filial: 'Sergeli', brend: 'GIGA', oylikTuri: OYLIK_TURI_DS, summa: 62797935 },
    { filial: 'Sergeli', brend: 'GIGA', oylikTuri: OYLIK_TURI_OFIS, summa: 7436563 },
    { filial: 'Sergeli', brend: 'GIGA', oylikTuri: OYLIK_TURI_BM, summa: 1559032 },
    { filial: 'Olmaliq', brend: 'LALAKU', oylikTuri: OYLIK_TURI_KOMMANDA, summa: 64562000 },
    { filial: 'Olmaliq', brend: 'GIGA', oylikTuri: OYLIK_TURI_KOMMANDA, summa: 59748000 },
    { filial: 'Guliston', brend: 'LALAKU', oylikTuri: OYLIK_TURI_KOMMANDA, summa: 84889000 },
    { filial: 'Guliston', brend: 'GIGA', oylikTuri: OYLIK_TURI_KOMMANDA, summa: 28557000 },
    { filial: 'Andijon', brend: 'LALAKU', oylikTuri: OYLIK_TURI_KOMMANDA, summa: 98305000 },
    { filial: 'Andijon', brend: 'GIGA', oylikTuri: OYLIK_TURI_KOMMANDA, summa: 78584000 },
  ];
}
function getMockRasxodlar() {
  return [
    { hudud: 'Yunusobod', jami: 243815500 },
    { hudud: 'Sergeli', jami: 393514000 },
    { hudud: 'Olmaliq', jami: 21989007 },
    { hudud: 'Guliston', jami: 17099132 },
    { hudud: 'Andijon', jami: 84336094 },
  ];
}
function getMockSavdo() {
  return [
    { brend: 'LALAKU', sklad: 'Yunusobod', summa: 4514210100 },
    { brend: 'GIGA', sklad: 'Yunusobod', summa: 940983500 },
    { brend: 'LALAKU', sklad: 'Sergeli', summa: 4140147900 },
    { brend: 'GIGA', sklad: 'Sergeli', summa: 578591500 },
    { brend: 'LALAKU', sklad: 'Olmaliq', summa: 1653177600 },
    { brend: 'GIGA', sklad: 'Olmaliq', summa: 883918000 },
    { brend: 'LALAKU', sklad: 'Guliston', summa: 859432000 },
    { brend: 'GIGA', sklad: 'Guliston', summa: 520572500 },
    { brend: 'LALAKU', sklad: 'Andijon', summa: 879354300 },
    { brend: 'GIGA', sklad: 'Andijon', summa: 1902798300 },
  ];
}

function setupFileInput(listKey) {
  const input = document.getElementById(`expense-file-${listKey}`);
  const btn = document.getElementById(`expense-btn-${listKey}`);
  const nameEl = document.getElementById(`expense-file-name-${listKey}`);
  if (!input || !btn) return;

  btn.addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    selectedFiles[listKey] = file || null;
    if (nameEl) nameEl.textContent = file ? file.name : '';
    updateImportStatus(listKey, file ? 'Fayl tanlandi' : 'Import qilinmagan', null);
  });
}

// Bitta tugma: tanlangan fayllar bilan jarayonni boshlash
function runProcess() {
  const hasOyliklar = selectedFiles.oyliklar != null;
  const hasRasxodlar = selectedFiles.rasxodlar != null;
  const hasSavdo = selectedFiles.savdo != null;
  log('runProcess boshlandi', { hasOyliklar, hasRasxodlar, hasSavdo });

  if (!hasOyliklar && !hasRasxodlar && !hasSavdo) {
    log('runProcess: hech qanday fayl tanlanmagan');
    if (typeof window.showToast === 'function') {
      window.showToast('Kamida bitta fayl tanlang.', 'warning');
    } else {
      alert('Kamida bitta fayl tanlang.');
    }
    return;
  }

  // Tanlangan fayllar bo‘yicha ma’lumotlarni yuklash (hozircha mock; kelajakda Excel parse yoki API)
  const useApi = hasOyliklar && hasRasxodlar && hasSavdo;
  if (useApi) {
    log('runProcess: API orqali Excel parse so\'ralmoqda');
    parseExcelViaApi()
      .then((ok) => {
        if (ok) {
          log('runProcess: API dan ma\'lumot olindi', { oyliklar: stateOyliklar.length, rasxodlar: stateRasxodlar.length, savdo: stateSavdo.length });
          updateSummaryAndFilters();
          if (typeof window.showToast === 'function') window.showToast('Jarayon bajarildi. Total hisoblandi.', 'success');
        } else {
          log('runProcess: API muvaffaqiyatsiz, mock ishlatiladi');
          applyMockData(hasOyliklar, hasRasxodlar, hasSavdo);
          updateSummaryAndFilters();
          if (typeof window.showToast === 'function') window.showToast('Fayllar o\'qilmadi; namuna ma\'lumot bilan hisoblandi.', 'warning');
        }
      })
      .catch((err) => {
        log('runProcess: API xatosi', err);
        applyMockData(hasOyliklar, hasRasxodlar, hasSavdo);
        updateSummaryAndFilters();
        if (typeof window.showToast === 'function') window.showToast('Fayllar o\'qilmadi; namuna ma\'lumot bilan hisoblandi.', 'warning');
      });
    return;
  }

  log('runProcess: faqat mock (barcha 3 fayl tanlanmagan)');
  applyMockData(hasOyliklar, hasRasxodlar, hasSavdo);
  updateSummaryAndFilters();
  if (typeof window.showToast === 'function') window.showToast('Jarayon bajarildi. Total hisoblandi.', 'success');
}

function applyMockData(hasOyliklar, hasRasxodlar, hasSavdo) {
  if (hasOyliklar) {
    stateOyliklar = getMockOyliklar();
    updateImportStatus('oyliklar', 'Yuklandi', stateOyliklar.length);
  } else {
    stateOyliklar = [];
    updateImportStatus('oyliklar', 'Import qilinmagan', null);
  }
  if (hasRasxodlar) {
    stateRasxodlar = getMockRasxodlar();
    updateImportStatus('rasxodlar', 'Yuklandi', stateRasxodlar.length);
  } else {
    stateRasxodlar = [];
    updateImportStatus('rasxodlar', 'Import qilinmagan', null);
  }
  if (hasSavdo) {
    stateSavdo = getMockSavdo();
    updateImportStatus('savdo', 'Yuklandi', stateSavdo.length);
  } else {
    stateSavdo = [];
    updateImportStatus('savdo', 'Import qilinmagan', null);
  }
}

async function parseExcelViaApi() {
  const formData = new FormData();
  if (selectedFiles.oyliklar) formData.append('oyliklar', selectedFiles.oyliklar);
  if (selectedFiles.rasxodlar) formData.append('rasxodlar', selectedFiles.rasxodlar);
  if (selectedFiles.savdo) formData.append('savdo', selectedFiles.savdo);
  const res = await fetch('/api/expense-total/parse', { method: 'POST', body: formData, credentials: 'same-origin' });
  if (!res.ok) {
    const text = await res.text();
    log('parseExcelViaApi: server javobi noto\'g\'ri', { status: res.status, body: text });
    return false;
  }
  const data = await res.json();
  if (!data.success) {
    log('parseExcelViaApi: API success=false', data);
    return false;
  }
  stateOyliklar = Array.isArray(data.oyliklar) ? data.oyliklar : [];
  stateRasxodlar = Array.isArray(data.rasxodlar) ? data.rasxodlar : [];
  stateSavdo = Array.isArray(data.savdo) ? data.savdo : [];
  updateImportStatus('oyliklar', 'Yuklandi', stateOyliklar.length);
  updateImportStatus('rasxodlar', 'Yuklandi', stateRasxodlar.length);
  updateImportStatus('savdo', 'Yuklandi', stateSavdo.length);
  const filials = [...new Set(stateOyliklar.map(r => r.filial).filter(Boolean))];
  const brendsO = [...new Set(stateOyliklar.map(r => r.brend).filter(Boolean))];
  const oylikTurlari = [...new Set(stateOyliklar.map(r => r.oylikTuri).filter(Boolean))];
  const hududlar = [...new Set(stateRasxodlar.map(r => r.hudud).filter(Boolean))];
  const brendsS = [...new Set(stateSavdo.map(r => r.brend).filter(Boolean))];
  const sklads = [...new Set(stateSavdo.map(r => r.sklad).filter(Boolean))];
  log('parseExcelViaApi: state to\'ldirildi', {
    oyliklar: stateOyliklar.length,
    rasxodlar: stateRasxodlar.length,
    savdo: stateSavdo.length,
    filiallar: filials,
    brendlar_oyliklar: brendsO,
    oylikTurlari,
    hududlar_rasxodlar: hududlar,
    brendlar_savdo: brendsS,
    skladlar_savdo: sklads,
  });
  return true;
}

export function setupExpenseTotal() {
  setupFileInput('oyliklar');
  setupFileInput('rasxodlar');
  setupFileInput('savdo');

  const startBtn = document.getElementById('expense-total-start-btn');
  if (startBtn) startBtn.addEventListener('click', runProcess);

  document.getElementById('expense-total-filial')?.addEventListener('change', () => {
    updateSummaryAndFilters();
  });
  document.getElementById('expense-total-brend')?.addEventListener('change', () => {
    updateSummaryAndFilters();
  });

  updateSummaryAndFilters();
  if (typeof feather !== 'undefined') feather.replace();
}
