/**
 * @jest-environment jsdom
 */

import {TextEncoder} from 'util';
import {
  copyText,
  downloadText,
  downloadXlsx,
  matrixToCsv,
  matrixToTsv,
  sheetToXlsxFiles,
  tableToMatrix,
  tableToSheet,
  zipFiles,
} from './table_export';

// jsdom has no TextEncoder; browsers do
global.TextEncoder = TextEncoder;

const buildTable = html => {
  const table = document.createElement('table');
  table.innerHTML = html;
  return table;
};

describe('tableToMatrix', () => {
  test('repeats merged cells so every row stands alone', () => {
    const table = buildTable(`
      <thead>
        <tr><th rowspan="2">Line</th><th colspan="2">2026</th></tr>
        <tr><th>Jan</th><th>Feb</th></tr>
      </thead>
      <tbody>
        <tr><td rowspan="2">Rent</td><td>10</td><td>20</td></tr>
        <tr><td>1</td><td>2</td></tr>
        <tr><td>NOI</td><td>11</td><td>22</td></tr>
      </tbody>`);
    expect(tableToMatrix(table)).toEqual([
      ['Line', '2026', '2026'],
      ['Line', 'Jan', 'Feb'],
      ['Rent', '10', '20'],
      ['Rent', '1', '2'],
      ['NOI', '11', '22'],
    ]);
  });

  test('restores minus signs the display swapped for non-breaking hyphens', () => {
    const table = buildTable('<tbody><tr><td>‑1,250.00</td></tr></tbody>');
    expect(tableToMatrix(table)).toEqual([['-1,250.00']]);
  });
});

describe('text formats', () => {
  test('CSV quotes commas, quotes and new lines', () => {
    expect(
      matrixToCsv([
        ['Line', 'Amount'],
        ['Rent, net', '1,000 RON'],
        ['Say "hi"', 'a\nb'],
      ])
    ).toBe('Line,Amount\r\n"Rent, net","1,000 RON"\r\n"Say ""hi""","a\nb"');
  });

  test('TSV flattens tabs and new lines inside cells', () => {
    expect(matrixToTsv([['a\tb', 'c\nd']])).toBe('a b\tc d');
  });
});

describe('copy and download', () => {
  test('copy falls back to execCommand when the Clipboard API is missing', async () => {
    const original = navigator.clipboard;
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      configurable: true,
    });
    document.execCommand = jest.fn(() => true);
    await expect(copyText('x')).resolves.toBe(true);
    expect(document.execCommand).toHaveBeenCalledWith('copy');
    Object.defineProperty(navigator, 'clipboard', {
      value: original,
      configurable: true,
    });
  });

  test('download reports failure instead of throwing', () => {
    const create = URL.createObjectURL;
    URL.createObjectURL = () => {
      throw new Error('blocked');
    };
    expect(downloadText('a,b', 'x.csv')).toBe(false);
    URL.createObjectURL = create;
  });
});

describe('Excel export', () => {
  // Cells carry their data the way d3 binds it on the rendered table
  const bind = (table, data) => {
    table.querySelectorAll('td').forEach((td, i) => {
      td.__data__ = data[i];
    });
    return table;
  };
  const plTable = () =>
    bind(
      buildTable(`
        <thead>
          <tr><th rowspan="2">Line</th><th colspan="2">2026</th></tr>
          <tr><th>Rent</th><th>Yield</th></tr>
        </thead>
        <tbody>
          <tr><td>Asset A</td><td>1,250</td><td>5.1%</td></tr>
          <tr><td class="total">NOI</td><td class="total">‑8</td><td class="total">n/a</td></tr>
        </tbody>`),
      [
        {value: 'Asset A'},
        {value: 1250, colid: 'rent'},
        {value: 0.051, colid: 'yield'},
        {value: 'NOI'},
        {value: -8, colid: 'rent'},
        {value: 3, colid: 'yield'},
      ]
    );
  const formats = {rent: '#,##0', yield: '0.0%'};

  test('keeps merges, bold totals and numbers in their Looker format', () => {
    const sheet = tableToSheet(plTable(), colid => formats[colid]);
    expect(sheet.headerRows).toBe(2);
    expect(sheet.merges).toEqual([
      {r: 0, c: 0, rowspan: 2, colspan: 1},
      {r: 0, c: 1, rowspan: 1, colspan: 2},
    ]);
    expect(sheet.rows[0].map(c => c.text)).toEqual(['Line', '2026', '']);
    expect(sheet.rows[1][0].text).toBe('');
    expect(sheet.rows[2][1]).toEqual(
      expect.objectContaining({value: 1250, format: '#,##0', bold: false})
    );
    expect(sheet.rows[2][2]).toEqual(
      expect.objectContaining({value: 0.051, format: '0.0%'})
    );
    expect(sheet.rows[3][1]).toEqual(
      expect.objectContaining({value: -8, bold: true})
    );
  });

  test('exports the text shown when Excel would display the number differently', () => {
    const sheet = tableToSheet(plTable(), colid => formats[colid]);
    expect(sheet.rows[3][2].value).toBeUndefined();
    expect(sheet.rows[3][2].text).toBe('n/a');
  });

  test('falls back to a plain number format when the column has none', () => {
    const table = bind(
      buildTable('<tbody><tr><td>1,234.50</td><td>£9</td></tr></tbody>'),
      [{value: 1234.5}, {value: 9}]
    );
    const sheet = tableToSheet(table);
    expect(sheet.rows[0][0]).toEqual(
      expect.objectContaining({value: 1234.5, format: '#,##0.00'})
    );
    expect(sheet.rows[0][1].value).toBeUndefined();
  });

  test('writes a workbook with frozen headers, merges and styles', () => {
    const files = sheetToXlsxFiles(
      tableToSheet(plTable(), colid => formats[colid])
    );
    const sheetXml = files['xl/worksheets/sheet1.xml'];
    expect(sheetXml).toContain('ySplit="2"');
    expect(sheetXml).toContain('<mergeCell ref="A1:A2"/>');
    expect(sheetXml).toContain('<mergeCell ref="B1:C1"/>');
    expect(sheetXml).toMatch(/<c r="B3" s="\d+"><v>1250<\/v><\/c>/);
    expect(files['xl/styles.xml']).toContain('formatCode="0.0%"');
    expect(files['xl/styles.xml']).toContain('<b/>');
  });

  test('escapes text for XML', () => {
    const files = sheetToXlsxFiles({
      rows: [[{text: 'A & B <c>'}]],
      merges: [],
      headerRows: 0,
    });
    expect(files['xl/worksheets/sheet1.xml']).toContain('A &amp; B &lt;c&gt;');
  });

  test('zips files with valid headers', () => {
    const zip = zipFiles({'a.txt': 'hello'});
    const view = new DataView(zip.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    // CRC-32 of 'hello'
    expect(view.getUint32(14, true)).toBe(0x3610a686);
    expect(view.getUint32(zip.length - 22, true)).toBe(0x06054b50);
  });

  test('download reports failure instead of throwing', () => {
    const create = URL.createObjectURL;
    URL.createObjectURL = () => {
      throw new Error('blocked');
    };
    expect(downloadXlsx({rows: [], merges: [], headerRows: 0}, 'x.xlsx')).toBe(
      false
    );
    URL.createObjectURL = create;
  });
});
