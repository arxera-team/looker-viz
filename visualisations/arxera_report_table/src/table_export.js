// Copies the report table exactly as drawn: header tiers, line items,
// subtotals and running totals. Looker's own CSV/Excel downloads use the query
// results, so rows the vis adds (subtotals, running totals) are only here, and
// Looker's vis iframe blocks file downloads, so the table goes via the clipboard.

import SSF from 'ssf';

/**
 * Reads a rendered table into a grid of cell texts, repeating merged cells
 * so each row stands on its own in a spreadsheet. A body cell spanning
 * columns (a subtotal or running total label) goes in its first column only,
 * so the columns it spans keep only their own values (e.g. P&L lines).
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
          matrix[r + i][c + j] = j === 0 || cell.tagName === 'TH' ? text : '';
        }
      }
      c += colspan;
    });
  });
  var width = Math.max(0, ...matrix.map(row => row.length));
  return matrix.map(row => Array.from({length: width}, (_, i) => row[i] ?? ''));
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
  return execCopy(text, doc);
};

// Copies from a hidden, selected textarea: some browsers only run the copy
// command (and its copy event) when something is selected
const execCopy = function (text, doc) {
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
 * Reads a rendered table into cells for a formatted copy. Merges are written
 * out cell by cell, as in tableToMatrix, since Excel can ignore pasted
 * rowspan/colspan and shift the row. Headers and subtotal, total and running
 * total rows are marked, and numbers stay numbers when Excel would show them
 * exactly as the table does (Looker value formats are Excel syntax), with
 * plain text Excel reads as that number; anything else is the text shown.
 * @param {HTMLTableElement} table
 * @param {function} valueFormatFor - colid => the column's value format
 * @returns {object[][]} rows of cells
 */
export const tableToSheet = function (table, valueFormatFor = () => '') {
  var texts = tableToMatrix(table);
  var rows = texts.map(() => []);
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
      var out = {
        text: texts[r][c],
        header: cell.tagName === 'TH',
        total: cell.classList.contains('total'),
        align: cell.style.textAlign,
      };
      var datum = cell.__data__;
      if (
        !out.header &&
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
          out.plain = plainNumber(datum.value, out.text);
        }
      }
      for (var i = 0; i < rowspan; i++) {
        filled[r + i] = filled[r + i] || [];
        rows[r + i] = rows[r + i] || [];
        for (var j = 0; j < colspan; j++) {
          filled[r + i][c + j] = true;
          // A body label spanning columns stays in its first column only
          rows[r + i][c + j] =
            j > 0 && !out.header
              ? {text: '', total: out.total, header: false}
              : {...out};
        }
      }
      c += colspan;
    });
  });
  var width = texts.length ? texts[0].length : 0;
  return rows.map(row =>
    Array.from({length: width}, (_, i) => row[i] || {text: ''})
  );
};

// The number as Excel reads it when pasted, whatever it makes of the format:
// thousands separators and the decimals shown, without text such as ' RON'
// around it ('5.1%' is kept, as Excel reads percentages)
const plainNumber = function (value, text) {
  if (/^-?[\d,.]+%$/.test(text)) return text;
  var decimals = (/\.(\d+)/.exec(text) || [])[1] || '';
  return SSF.format(
    '#,##0' + (decimals ? '.' + '0'.repeat(decimals.length) : ''),
    value
  );
};

// Cell texts of a sheet for the plain text copy, numbers as Excel reads them
export const sheetToMatrix = function (rows) {
  return rows.map(row => row.map(cell => cell.plain ?? cell.text));
};

const formatsAs = function (format, value, text) {
  try {
    return SSF.format(format, value) === text;
  } catch (err) {
    return false;
  }
};

// For cells rendered by Looker without a matching value format: a number with
// optional thousands separators, decimals and text either side ('£', ' RON')
const guessFormat = function (text) {
  var match = /^-?([^\d-]*?)(\d{1,3}(,\d{3})+|\d+)(\.(\d+))?(\D*)$/.exec(text);
  if (!match) return null;
  var [, prefix, integer, grouped, , decimals = '', suffix] = match;
  // Separators unless the number is long and shown without them
  var number =
    (grouped || integer.length <= 3 ? '#,##0' : '0') +
    (decimals ? '.' + '0'.repeat(decimals.length) : '');
  var quote = literal => (literal ? '"' + literal.replace(/"/g, '') + '"' : '');
  return suffix === '%'
    ? quote(prefix) + number + '%'
    : quote(prefix) + number + quote(suffix);
};

const escapeHtml = function (value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

// Excel reads a cell's number format from the mso-number-format style. Quoted
// text in the format ("£") is rewritten with Excel's other escape (\£), then
// punctuation is CSS escaped the way Excel writes it in its own HTML
const msoNumberFormat = function (format) {
  var excel = format.replace(/"([^"]*)"/g, (_, literal) =>
    Array.from(literal)
      .map(ch => '\\' + ch)
      .join('')
  );
  var css = Array.from(excel)
    .map(ch => (/[A-Za-z0-9\u0080-\uffff]/.test(ch) ? ch : '\\' + ch))
    .join('');
  return 'mso-number-format:"' + css + '"';
};

/**
 * Builds the HTML table Excel and Sheets paste as formatted cells: bold
 * headers and totals with rules above and below, and numbers as plain numbers
 * Excel reads on its own. Where Excel honours its own hints (x:num, and
 * mso-number-format, which Chrome may strip), numbers also get full precision
 * and the column's format, and text stays text so labels aren't made dates.
 */
export const sheetToHtml = function (rows) {
  var border = '.5pt solid #000000';
  var body = rows
    .map(row => {
      var cells = row
        .map(cell => {
          var tag = cell.header ? 'th' : 'td';
          var style = [];
          if (cell.header || cell.total) style.push('font-weight:700');
          if (cell.header) style.push('border-bottom:' + border);
          if (cell.total) style.push('border-top:' + border);
          if (cell.align) style.push('text-align:' + cell.align);
          style.push(
            cell.value !== undefined
              ? msoNumberFormat(cell.format)
              : msoNumberFormat('@')
          );
          // Excel takes the exact value from x:num, as in its own copied HTML;
          // Sheets ignores it and reads the formatted text
          var num =
            cell.value !== undefined ? ' x:num="' + cell.value + '"' : '';
          return (
            '<' +
            tag +
            num +
            // Single quoted, so quotes in the format stay literal as Excel writes them
            " style='" +
            style.join(';').replace(/&/g, '&amp;').replace(/'/g, '&#39;') +
            "'>" +
            escapeHtml(cell.plain ?? cell.text) +
            '</' +
            tag +
            '>'
          );
        })
        .join('');
      return '<tr>' + cells + '</tr>';
    })
    .join('');
  return (
    '<html xmlns:x="urn:schemas-microsoft-com:office:excel">' +
    '<head><meta charset="utf-8"></head><body>' +
    '<table style="border-collapse:collapse;font-family:Calibri,sans-serif;font-size:11pt">' +
    body +
    '</table></body></html>'
  );
};

/**
 * Copies a formatted table with plain text alongside, for apps that don't take
 * HTML. Tries the copy event first (works in Looker's vis iframe), then the
 * async Clipboard API, then plain text only.
 * @returns {Promise<boolean>} whether the copy succeeded
 */
export const copyRich = async function (html, text, doc = document) {
  var copied = false;
  var onCopy = event => {
    event.clipboardData.setData('text/html', html);
    event.clipboardData.setData('text/plain', text);
    event.preventDefault();
    copied = true;
  };
  doc.addEventListener('copy', onCopy);
  try {
    execCopy(text, doc);
  } finally {
    doc.removeEventListener('copy', onCopy);
  }
  if (copied) return true;
  try {
    if (
      navigator.clipboard &&
      navigator.clipboard.write &&
      typeof ClipboardItem !== 'undefined'
    ) {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], {type: 'text/html'}),
          'text/plain': new Blob([text], {type: 'text/plain'}),
        }),
      ]);
      return true;
    }
  } catch (err) {
    // fall back to plain text
  }
  return copyText(text, doc);
};
