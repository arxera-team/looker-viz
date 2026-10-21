// Exports the report table exactly as drawn: header tiers, line items,
// subtotals and running totals. Looker's own CSV/Excel downloads use the query
// results, so rows the vis adds (subtotals, running totals) are only here.

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
