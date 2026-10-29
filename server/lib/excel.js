'use strict';
const ExcelJS = require('exceljs');
const time = require('./time');

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4ED8' } };
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12, name: 'Calibri' };
const TITLE_FONT = { bold: true, size: 16, color: { argb: 'FF0F172A' }, name: 'Calibri' };
const MONEY = '#,##0.00';

function createWorkbook() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'AdamN NMS';
  wb.lastModifiedBy = 'AdamN NMS';
  wb.created = new Date();
  wb.modified = new Date();
  wb.title = 'AdamN NMS Export';
  return wb;
}

/**
 * Builds one styled, RTL worksheet.
 * columns: [{ header, key, width, money?, align? }]
 */
function addSheet(wb, { name, title, subtitle, columns, rows, totals, notes }) {
  const ws = wb.addWorksheet(name, { views: [{ rightToLeft: true, state: 'frozen', ySplit: 4 }] });
  ws.properties.defaultRowHeight = 22;

  const colCount = columns.length;
  ws.mergeCells(1, 1, 1, colCount);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = title;
  titleCell.font = TITLE_FONT;
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 30;

  ws.mergeCells(2, 1, 2, colCount);
  const subCell = ws.getCell(2, 1);
  subCell.value = subtitle || '';
  subCell.font = { size: 11, color: { argb: 'FF475569' } };
  subCell.alignment = { horizontal: 'center', vertical: 'middle' };

  ws.getRow(3).height = 8;

  const headerRow = ws.getRow(4);
  columns.forEach((col, idx) => {
    const cell = headerRow.getCell(idx + 1);
    cell.value = col.header;
    cell.font = HEADER_FONT;
    cell.fill = HEADER_FILL;
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    };
    ws.getColumn(idx + 1).width = col.width || 18;
  });
  headerRow.height = 28;

  (rows || []).forEach((dataRow, rIdx) => {
    const row = ws.getRow(5 + rIdx);
    columns.forEach((col, cIdx) => {
      const cell = row.getCell(cIdx + 1);
      const value = typeof col.value === 'function' ? col.value(dataRow) : dataRow[col.key];
      cell.value = value === undefined ? '' : value;
      cell.alignment = {
        horizontal: col.align || (col.money ? 'center' : 'right'),
        vertical: 'middle',
        wrapText: Boolean(col.wrap),
      };
      if (col.money && typeof value === 'number') cell.numFmt = MONEY;
      cell.font = { size: 11, name: 'Calibri' };
      cell.border = {
        top: { style: 'hair', color: { argb: 'FFE2E8F0' } },
        left: { style: 'hair', color: { argb: 'FFE2E8F0' } },
        bottom: { style: 'hair', color: { argb: 'FFE2E8F0' } },
        right: { style: 'hair', color: { argb: 'FFE2E8F0' } },
      };
    });
  });

  if (totals && rows && rows.length) {
    const row = ws.getRow(5 + rows.length);
    columns.forEach((col, cIdx) => {
      const cell = row.getCell(cIdx + 1);
      if (cIdx === 0) {
        cell.value = 'الإجمالي';
        cell.font = { bold: true, size: 12 };
      } else if (totals[col.key] !== undefined) {
        cell.value = totals[col.key];
        if (col.money) cell.numFmt = MONEY;
        cell.font = { bold: true, size: 12 };
      }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } };
      cell.border = { top: { style: 'thin', color: { argb: 'FF1D4ED8' } } };
      cell.alignment = { horizontal: 'center' };
    });
  }

  if (notes) {
    const startRow = 7 + (rows ? rows.length : 0);
    ws.mergeCells(startRow, 1, startRow, colCount);
    const cell = ws.getCell(startRow, 1);
    cell.value = notes;
    cell.font = { size: 10, italic: true, color: { argb: 'FF64748B' } };
    cell.alignment = { horizontal: 'right', wrapText: true };
  }

  if (rows && rows.length) {
    ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + rows.length, column: colCount } };
  }
  return ws;
}

async function toBuffer(wb) {
  return wb.xlsx.writeBuffer();
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function subtitleFor(settings, extra) {
  return `${settings.nursery_name} • ${extra || ''} • تم التصدير ${time.formatTimestampUTC(new Date().toISOString(), settings.timezone, settings.locale)}`;
}

module.exports = { createWorkbook, addSheet, toBuffer, stamp, subtitleFor };
