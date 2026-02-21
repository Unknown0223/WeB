/**
 * Excel faylini 100% to'liq o'qish — barcha listlar, qatorlar, ustunlar, formulalar.
 * Natija: docs/excel-full-export.json va docs/excel-full-report.txt
 * Ishga tushirish: node scripts/excel-full-export.js
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
const docsDir = path.join(root, 'docs');

for (const name of possibleNames) {
  const p = path.join(root, name);
  if (fs.existsSync(p)) {
    filePath = p;
    break;
  }
}

if (!filePath) {
  console.log('Excel fayl topilmadi.');
  process.exit(1);
}

if (!fs.existsSync(docsDir)) {
  fs.mkdirSync(docsDir, { recursive: true });
}

function cellToExport(cell) {
  if (cell.formula) {
    return { formula: cell.formula, result: cell.result };
  }
  return cell.value;
}

function sheetToData(worksheet) {
  const rows = [];
  worksheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const cells = [];
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      cells.push({
        col: colNumber,
        value: cellToExport(cell)
      });
    });
    rows.push({ rowNumber, cells });
  });
  return rows;
}

function getColumnLetter(colIndex) {
  let letter = '';
  let n = colIndex;
  while (n >= 0) {
    letter = String.fromCharCode((n % 26) + 65) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
}

async function main() {
  const ExcelJS = require('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const exportData = {
    sourceFile: path.basename(filePath),
    exportedAt: new Date().toISOString(),
    sheets: []
  };

  const reportLines = [];
  reportLines.push('========================================');
  reportLines.push('EXCEL TO\'LIQ EKSPORT — Расход отчет Noyabr 2025');
  reportLines.push('========================================\n');

  for (const ws of workbook.worksheets) {
    const name = ws.name;
    const rowCount = ws.rowCount || 0;
    const colCount = ws.columnCount || 0;

    const rows = sheetToData(ws);
    const maxCol = rows.length ? Math.max(...rows.map(r => r.cells.length)) : 0;

    exportData.sheets.push({
      name,
      rowCount: rows.length,
      columnCount: maxCol,
      rows: rows.map(r => ({
        rowNumber: r.rowNumber,
        cells: r.cells.map(c => ({
          col: c.col,
          colLetter: getColumnLetter(c.col - 1),
          value: c.value
        }))
      }))
    });

    reportLines.push('\n========== LIST: ' + name + ' ==========');
    reportLines.push('Qatorlar: ' + rows.length + ', Ustunlar: ' + maxCol);

    if (rows.length > 0) {
      const headerRow = rows[0];
      reportLines.push('\n--- 1-qator (sarlavhalar) ---');
      headerRow.cells.forEach(c => {
        const v = c.value;
        const disp = v && typeof v === 'object' && 'result' in v ? v.result : v;
        reportLines.push('  ' + getColumnLetter(c.col - 1) + c.col + ': ' + JSON.stringify(disp));
      });

      const formulaList = [];
      rows.forEach(r => {
        r.cells.forEach(c => {
          const v = c.value;
          if (v && typeof v === 'object' && v.formula) {
            formulaList.push({ row: r.rowNumber, col: c.col, formula: v.formula, result: v.result });
          }
        });
      });
      if (formulaList.length > 0) {
        reportLines.push('\n--- Formulalar (' + formulaList.length + ' ta) ---');
        formulaList.forEach(f => {
          reportLines.push('  Q' + f.row + ' ustun' + f.col + ': ' + f.formula + ' => ' + f.result);
        });
      }

      reportLines.push('\n--- Barcha qatorlar (value/formula result) ---');
      rows.forEach(r => {
        const vals = r.cells.map(c => {
          const v = c.value;
          if (v && typeof v === 'object' && 'result' in v) return v.result;
          return v;
        });
        reportLines.push('  Qator ' + r.rowNumber + ': ' + JSON.stringify(vals));
      });
    }
  }

  const jsonPath = path.join(docsDir, 'excel-full-export.json');
  const reportPath = path.join(docsDir, 'excel-full-report.txt');

  fs.writeFileSync(jsonPath, JSON.stringify(exportData, null, 0), 'utf8');
  fs.writeFileSync(reportPath, reportLines.join('\n'), 'utf8');

  console.log('Tayyor.');
  console.log('JSON:', jsonPath);
  console.log('Hisobot:', reportPath);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
