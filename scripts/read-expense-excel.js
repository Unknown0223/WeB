/**
 * Excel faylidagi "Total" listini o'qish va strukturasini chiqarish.
 * Ishga tushirish: node scripts/read-expense-excel.js
 * Loyiha ildizida "Расход отчет Noyabr 2025.xlsx" yoki "expense-total.xlsx" bo'lishi kerak.
 */

const path = require('path');
const fs = require('fs');

const possibleNames = [
  'Расход отчет Noyabr 2025.xlsx',
  'expense-total.xlsx',
  'rasxod-noyabr-2025.xlsx'
];

let filePath = null;
const root = path.join(__dirname, '..');
for (const name of possibleNames) {
  const p = path.join(root, name);
  if (fs.existsSync(p)) {
    filePath = p;
    break;
  }
}

if (!filePath) {
  console.log('Excel fayl topilmadi. Quyidagi joylardan birida qo\'ying:', possibleNames.map(n => path.join(root, n)));
  process.exit(1);
}

async function main() {
  const ExcelJS = require('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  console.log('Fayl:', filePath);
  console.log('Listlar:', workbook.worksheets.map(ws => ws.name).join(', '));

  const totalSheet = workbook.getWorksheet('Total') || workbook.getWorksheet('total') || workbook.worksheets[0];
  if (!totalSheet) {
    console.log('Total nomli list topilmadi.');
    return;
  }

  console.log('\n--- Total list:', totalSheet.name, '---');
  console.log('Qatorlar soni:', totalSheet.rowCount);
  console.log('Ustunlar soni:', totalSheet.columnCount);

  const rows = [];
  totalSheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const cells = [];
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      let val = cell.value;
      if (cell.formula) {
        val = { formula: cell.formula, result: cell.result };
      }
      cells.push({ col: colNumber, value: val, type: cell.type });
    });
    rows.push({ rowNumber, cells });
  });

  console.log('\nBirinchi qator (sarlavhalar):');
  const headerRow = rows[0];
  if (headerRow) {
    headerRow.cells.forEach(c => {
      const v = c.value && typeof c.value === 'object' && c.value.result !== undefined ? c.value.result : c.value;
      console.log('  Ustun', c.col, ':', v);
    });
  }

  console.log('\nBarcha qatorlar (ma\'lumot + formulalar):');
  rows.slice(0, 25).forEach(r => {
    const vals = r.cells.map(c => {
      const v = c.value;
      if (v && typeof v === 'object' && 'formula' in v) return `[${v.formula}=${v.result}]`;
      return v;
    });
    console.log('  Qator', r.rowNumber, ':', vals);
  });

  if (rows.length > 25) {
    console.log('  ... va yana', rows.length - 25, 'qator');
  }

  // Barcha listlarni ham ko'rsatish
  console.log('\n========== BARCHA LISTLAR ==========');
  for (const ws of workbook.worksheets) {
    if (ws.name === totalSheet.name) continue;
    console.log('\n--- List:', ws.name, '---');
    const out = [];
    ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      const cells = [];
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        let val = cell.value;
        if (cell.formula) val = { formula: cell.formula, result: cell.result };
        cells.push(val);
      });
      out.push({ rowNumber, cells });
    });
    out.slice(0, 15).forEach(r => {
      const vals = r.cells.map(c => {
        if (c && typeof c === 'object' && 'formula' in c) return `[${c.formula}=${c.result}]`;
        return c;
      });
      console.log('  Qator', r.rowNumber, ':', vals);
    });
    if (out.length > 15) console.log('  ... va yana', out.length - 15, 'qator');
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
