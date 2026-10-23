// Exports the report table exactly as drawn: header tiers, line items,
// subtotals and running totals. Looker's own CSV/Excel downloads use the query
// results, so rows the vis adds (subtotals, running totals) are only here.

import SSF from 'ssf';

/**
 * Reads a rendered table into a grid of cell texts, repeating merged cells
 * (rowspan/colspan) so each row stands on its own in a spreadsheet.
 * @param {HTMLTableElement} table
 * @returns {string[][]}
 */
export const tableToMatrix = function (table) {
  var matrix = [];
  Array.from(table.querySelectorAll('tr')).forEach((tr, r) => {
    matrix[r] = matrix[r] || [];
    var c = 0;
    Array.from(tr.children).forEach(cell => {
      while (matrix[r][c] !== undefined) c++;
      // Display swaps '-' for a non-breaking hyphen; restore it so numbers parse
      var text = cell.textContent.replace(/\u2011/g, '-').trim();
      var rowspan = Math.max(
        parseInt(cell.getAttribute('rowspan'), 10) || 1,
        1
      );
      var colspan = Math.max(
        parseInt(cell.getAttribute('colspan'), 10) || 1,
        1
      );
      for (var i = 0; i < rowspan; i++) {
        matrix[r + i] = matrix[r + i] || [];
        for (var j = 0; j < colspan; j++) {
          matrix[r + i][c + j] = text;
        }
      }
      c += colspan;
    });
  });
  var width = Math.max(0, ...matrix.map(row => row.length));
  return matrix.map(row => Array.from({length: width}, (_, i) => row[i] ?? ''));
};

const quoteCsv = function (value) {
  return /[",\n\r]/.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value;
};

export const matrixToCsv = function (matrix) {
  return matrix.map(row => row.map(quoteCsv).join(',')).join('\r\n');
};

// Tab separated, for pasting straight into Excel or Sheets
export const matrixToTsv = function (matrix) {
  return matrix
    .map(row => row.map(value => value.replace(/[\t\r\n]+/g, ' ')).join('\t'))
    .join('\n');
};

/**
 * Copies text to the clipboard. The async Clipboard API can be blocked inside
 * Looker's vis iframe, so fall back to a hidden textarea and execCommand.
 * @returns {Promise<boolean>} whether the copy succeeded
 */
export const copyText = async function (text, doc = document) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (err) {
    // fall through to the textarea copy
  }
  var textarea = doc.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  doc.body.appendChild(textarea);
  textarea.select();
  var copied = false;
  try {
    copied = doc.execCommand('copy');
  } catch (err) {
    copied = false;
  }
  doc.body.removeChild(textarea);
  return copied;
};

/**
 * Saves text as a file. Returns false if the browser refuses (for example a
 * sandboxed iframe without download permission), so the caller can fall back.
 */
export const downloadText = function (text, filename, doc = document) {
  try {
    var blob = new Blob(['﻿' + text], {type: 'text/csv;charset=utf-8'});
    return downloadBlob(blob, filename, doc);
  } catch (err) {
    return false;
  }
};

export const downloadBlob = function (blob, filename, doc = document) {
  try {
    var url = URL.createObjectURL(blob);
    var link = doc.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    doc.body.appendChild(link);
    link.click();
    doc.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch (err) {
    return false;
  }
};

const XLSX_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Reads a rendered table into spreadsheet cells. Merged cells stay merged,
 * subtotal, total and running total rows are bold, and numbers stay numbers
 * when Excel would show them exactly as the table does (Looker value formats
 * are Excel syntax); anything else is exported as the text shown.
 * @param {HTMLTableElement} table
 * @param {function} valueFormatFor - colid => the column's value format
 * @returns {{rows: object[][], merges: object[], headerRows: number}}
 */
export const tableToSheet = function (table, valueFormatFor = () => '') {
  var texts = tableToMatrix(table);
  var rows = texts.map(row => row.map(text => ({text})));
  var merges = [];
  var filled = [];
  Array.from(table.querySelectorAll('tr')).forEach((tr, r) => {
    filled[r] = filled[r] || [];
    var c = 0;
    Array.from(tr.children).forEach(cell => {
      while (filled[r][c]) c++;
      var rowspan = Math.max(
        parseInt(cell.getAttribute('rowspan'), 10) || 1,
        1
      );
      var colspan = Math.max(
        parseInt(cell.getAttribute('colspan'), 10) || 1,
        1
      );
      for (var i = 0; i < rowspan; i++) {
        filled[r + i] = filled[r + i] || [];
        for (var j = 0; j < colspan; j++) {
          filled[r + i][c + j] = true;
          // Only the top left cell of a merge holds the value
          if (i || j) rows[r + i][c + j] = {text: ''};
        }
      }
      if (rowspan > 1 || colspan > 1) {
        merges.push({r, c, rowspan, colspan});
      }
      var out = rows[r][c];
      out.bold = cell.tagName === 'TH' || cell.classList.contains('total');
      var datum = cell.__data__;
      if (
        cell.tagName === 'TD' &&
        datum &&
        typeof datum.value === 'number' &&
        Number.isFinite(datum.value)
      ) {
        var format = [valueFormatFor(datum.colid), guessFormat(out.text)].find(
          f => f && formatsAs(f, datum.value, out.text)
        );
        if (format) {
          out.value = datum.value;
          out.format = format;
        }
      }
      c += colspan;
    });
  });
  return {
    rows,
    merges,
    headerRows: table.querySelectorAll('thead tr').length,
  };
};

const formatsAs = function (format, value, text) {
  try {
    return SSF.format(format, value) === text;
  } catch (err) {
    return false;
  }
};

// For cells rendered by Looker without a value format: a plain number with
// optional thousands separators and decimals
const guessFormat = function (text) {
  var match = /^-?\d{1,3}(,\d{3})*(\.(\d+))?$|^-?\d+(\.(\d+))?$/.exec(text);
  if (!match) return null;
  var decimals = (match[3] || match[5] || '').length;
  var fraction = decimals ? '.' + '0'.repeat(decimals) : '';
  return (match[1] ? '#,##0' : '0') + fraction;
};

const escapeXml = function (value) {
  // Control characters are not allowed in XML
  return (
    String(value)
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  );
};

const columnName = function (index) {
  var name = '';
  for (var n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name;
};

/**
 * Builds the files of a one sheet .xlsx workbook from tableToSheet output.
 * Header rows are frozen, as in the table.
 * @returns {Object<string, string>} path in the zip => XML
 */
export const sheetToXlsxFiles = function (sheet) {
  // One style per (format, bold) pair; style 0 is the default
  var numFmts = [];
  var styles = [{numFmtId: 0, bold: false}];
  var styleFor = function (format, bold) {
    var numFmtId = 0;
    if (format && format !== 'General') {
      var f = numFmts.indexOf(format);
      if (f < 0) f = numFmts.push(format) - 1;
      numFmtId = 164 + f;
    }
    var s = styles.findIndex(x => x.numFmtId === numFmtId && x.bold === bold);
    return s >= 0 ? s : styles.push({numFmtId, bold}) - 1;
  };

  var widths = [];
  var sheetRows = sheet.rows
    .map((row, r) => {
      var cells = row
        .map((cell, c) => {
          widths[c] = Math.max(
            widths[c] || 8,
            Math.min(cell.text.length + 2, 50)
          );
          var ref = columnName(c) + (r + 1);
          var s = styleFor(cell.format, Boolean(cell.bold));
          var attrs = ' r="' + ref + '"' + (s ? ' s="' + s + '"' : '');
          if (cell.value !== undefined) {
            return '<c' + attrs + '><v>' + cell.value + '</v></c>';
          }
          if (cell.text === '') return s ? '<c' + attrs + '/>' : '';
          return (
            '<c' +
            attrs +
            ' t="inlineStr"><is><t xml:space="preserve">' +
            escapeXml(cell.text) +
            '</t></is></c>'
          );
        })
        .join('');
      return '<row r="' + (r + 1) + '">' + cells + '</row>';
    })
    .join('');

  var pane = sheet.headerRows
    ? '<pane ySplit="' +
      sheet.headerRows +
      '" topLeftCell="A' +
      (sheet.headerRows + 1) +
      '" activePane="bottomLeft" state="frozen"/>'
    : '';
  var cols = widths.length
    ? '<cols>' +
      widths
        .map(
          (w, i) =>
            '<col min="' +
            (i + 1) +
            '" max="' +
            (i + 1) +
            '" width="' +
            w +
            '" customWidth="1"/>'
        )
        .join('') +
      '</cols>'
    : '';
  var mergeCells = sheet.merges.length
    ? '<mergeCells count="' +
      sheet.merges.length +
      '">' +
      sheet.merges
        .map(
          m =>
            '<mergeCell ref="' +
            columnName(m.c) +
            (m.r + 1) +
            ':' +
            columnName(m.c + m.colspan - 1) +
            (m.r + m.rowspan) +
            '"/>'
        )
        .join('') +
      '</mergeCells>'
    : '';

  var ns = 'http://schemas.openxmlformats.org/';
  var head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  return {
    '[Content_Types].xml':
      head +
      '<Types xmlns="' +
      ns +
      'package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '</Types>',
    '_rels/.rels':
      head +
      '<Relationships xmlns="' +
      ns +
      'package/2006/relationships">' +
      '<Relationship Id="rId1" Type="' +
      ns +
      'officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>',
    'xl/workbook.xml':
      head +
      '<workbook xmlns="' +
      ns +
      'spreadsheetml/2006/main" xmlns:r="' +
      ns +
      'officeDocument/2006/relationships">' +
      '<sheets><sheet name="Report" sheetId="1" r:id="rId1"/></sheets>' +
      '</workbook>',
    'xl/_rels/workbook.xml.rels':
      head +
      '<Relationships xmlns="' +
      ns +
      'package/2006/relationships">' +
      '<Relationship Id="rId1" Type="' +
      ns +
      'officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Type="' +
      ns +
      'officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>',
    'xl/styles.xml':
      head +
      '<styleSheet xmlns="' +
      ns +
      'spreadsheetml/2006/main">' +
      (numFmts.length
        ? '<numFmts count="' +
          numFmts.length +
          '">' +
          numFmts
            .map(
              (f, i) =>
                '<numFmt numFmtId="' +
                (164 + i) +
                '" formatCode="' +
                escapeXml(f) +
                '"/>'
            )
            .join('') +
          '</numFmts>'
        : '') +
      '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
      '<fills count="2"><fill><patternFill patternType="none"/></fill>' +
      '<fill><patternFill patternType="gray125"/></fill></fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="' +
      styles.length +
      '">' +
      styles
        .map(
          x =>
            '<xf numFmtId="' +
            x.numFmtId +
            '" fontId="' +
            (x.bold ? 1 : 0) +
            '" fillId="0" borderId="0" xfId="0"' +
            (x.numFmtId ? ' applyNumberFormat="1"' : '') +
            (x.bold ? ' applyFont="1"' : '') +
            '/>'
        )
        .join('') +
      '</cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      '</styleSheet>',
    'xl/worksheets/sheet1.xml':
      head +
      '<worksheet xmlns="' +
      ns +
      'spreadsheetml/2006/main">' +
      '<sheetViews><sheetView workbookViewId="0">' +
      pane +
      '</sheetView></sheetViews>' +
      cols +
      '<sheetData>' +
      sheetRows +
      '</sheetData>' +
      mergeCells +
      '</worksheet>',
  };
};

const CRC_TABLE = Array.from({length: 256}, (_, n) => {
  var c = n;
  for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

const crc32 = function (bytes) {
  var crc = 0xffffffff;
  for (var i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

/**
 * Packs files into an uncompressed zip, which is all an .xlsx needs, so the
 * vis carries no zip or spreadsheet library.
 * @param {Object<string, string>} files - path => text
 * @returns {Uint8Array}
 */
export const zipFiles = function (files) {
  var encoder = new TextEncoder();
  var local = [];
  var central = [];
  var offset = 0;
  var header = function (size, fields) {
    var bytes = new Uint8Array(size);
    var view = new DataView(bytes.buffer);
    fields.forEach(([at, value, width]) =>
      width === 4
        ? view.setUint32(at, value, true)
        : view.setUint16(at, value, true)
    );
    return bytes;
  };
  Object.keys(files).forEach(path => {
    var name = encoder.encode(path);
    var data = encoder.encode(files[path]);
    var crc = crc32(data);
    // version 2.0, stored, date 1980-01-01
    var common = [
      [0, 20, 2],
      [2, 0, 2],
      [4, 0, 2],
      [6, 0, 2],
      [8, 0x21, 2],
      [10, crc, 4],
      [14, data.length, 4],
      [18, data.length, 4],
      [22, name.length, 2],
      [24, 0, 2],
    ];
    local.push(
      header(
        30,
        [[0, 0x04034b50, 4]].concat(common.map(([at, v, w]) => [at + 4, v, w]))
      ),
      name,
      data
    );
    central.push(
      header(
        46,
        [
          [0, 0x02014b50, 4],
          [4, 20, 2],
        ]
          .concat(common.map(([at, v, w]) => [at + 6, v, w]))
          .concat([[42, offset, 4]])
      ),
      name
    );
    offset += 30 + name.length + data.length;
  });
  var centralSize = central.reduce((n, part) => n + part.length, 0);
  var count = Object.keys(files).length;
  var end = header(22, [
    [0, 0x06054b50, 4],
    [8, count, 2],
    [10, count, 2],
    [12, centralSize, 4],
    [16, offset, 4],
  ]);
  var parts = local.concat(central, [end]);
  var out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  var at = 0;
  parts.forEach(part => {
    out.set(part, at);
    at += part.length;
  });
  return out;
};

export const downloadXlsx = function (sheet, filename, doc = document) {
  try {
    var blob = new Blob([zipFiles(sheetToXlsxFiles(sheet))], {type: XLSX_TYPE});
    return downloadBlob(blob, filename, doc);
  } catch (err) {
    return false;
  }
};
