/**
 * @jest-environment jsdom
 */

import {
  copyRich,
  copyText,
  matrixToTsv,
  sheetToHtml,
  sheetToMatrix,
  tableToMatrix,
  tableToSheet,
} from './table_export';

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

  test('puts a body label spanning columns in its first column only', () => {
    const table = buildTable(`
      <thead><tr><th>Section</th><th>P&amp;L Line</th><th>Actual</th></tr></thead>
      <tbody>
        <tr><td>Rental Income</td><td>Rent</td><td>10</td></tr>
        <tr><td colspan="2">Rental Income Total</td><td>10</td></tr>
      </tbody>`);
    expect(tableToMatrix(table)).toEqual([
      ['Section', 'P&L Line', 'Actual'],
      ['Rental Income', 'Rent', '10'],
      ['Rental Income Total', '', '10'],
    ]);
  });

  test('restores minus signs the display swapped for non-breaking hyphens', () => {
    const table = buildTable('<tbody><tr><td>‑1,250.00</td></tr></tbody>');
    expect(tableToMatrix(table)).toEqual([['-1,250.00']]);
  });
});

describe('text formats', () => {
  test('TSV flattens tabs and new lines inside cells', () => {
    expect(matrixToTsv([['a\tb', 'c\nd']])).toBe('a b\tc d');
  });
});

describe('formatted copy', () => {
  // Cells carry their data the way d3 binds it on the rendered table
  const bind = (table, data) => {
    table.querySelectorAll('td').forEach((td, i) => {
      td.__data__ = data[i];
    });
    return table;
  };
  // Section merged down over its lines, as the tile draws it, and a pivot
  // header merged across its measures
  const plTable = () =>
    bind(
      buildTable(`
        <thead>
          <tr><th rowspan="2">Section</th><th rowspan="2">P&amp;L Line</th><th colspan="2">2026</th></tr>
          <tr><th>Actual</th><th>Yield</th></tr>
        </thead>
        <tbody>
          <tr><td rowspan="2">Rental Income</td><td>Rent</td><td style="text-align: right">2,618,497 RON</td><td>5.1%</td></tr>
          <tr><td>Discounts</td><td>-755,949 RON</td><td>5.3%</td></tr>
          <tr><td class="total" colspan="2">Rental Income Total</td><td class="total">1,862,548</td><td class="total">n/a</td></tr>
        </tbody>`),
      [
        {value: 'Rental Income'},
        {value: 'Rent'},
        {value: 2618497.4, colid: 'actual'},
        {value: 0.051, colid: 'yield'},
        {value: 'Discounts'},
        {value: -755949, colid: 'actual'},
        {value: 0.053, colid: 'yield'},
        {value: 'Rental Income Total'},
        {value: 1862548.4, colid: 'actual'},
        {value: 3, colid: 'yield'},
      ]
    );
  const formats = {actual: '', yield: '0.0%'};
  const texts = rows => rows.map(row => row.map(cell => cell.text));

  test('writes merges out cell by cell, so no row shifts', () => {
    const rows = tableToSheet(plTable(), colid => formats[colid]);
    expect(texts(rows)).toEqual([
      ['Section', 'P&L Line', '2026', '2026'],
      ['Section', 'P&L Line', 'Actual', 'Yield'],
      ['Rental Income', 'Rent', '2,618,497 RON', '5.1%'],
      ['Rental Income', 'Discounts', '-755,949 RON', '5.3%'],
      ['Rental Income Total', '', '1,862,548', 'n/a'],
    ]);
    expect(rows.every(row => row.length === 4)).toBe(true);
  });

  test('marks headers and totals, keeps numbers with their format', () => {
    const rows = tableToSheet(plTable(), colid => formats[colid]);
    expect(rows[0][0].header).toBe(true);
    expect(rows[2][2]).toEqual(
      expect.objectContaining({
        value: 2618497.4,
        format: '#,##0" RON"',
        plain: '2,618,497',
        total: false,
        align: 'right',
      })
    );
    expect(rows[3][2]).toEqual(
      expect.objectContaining({value: -755949, plain: '-755,949'})
    );
    expect(rows[2][3]).toEqual(
      expect.objectContaining({value: 0.051, format: '0.0%', plain: '5.1%'})
    );
    expect(rows[4][0].total).toBe(true);
    expect(rows[4][1]).toEqual({text: '', total: true, header: false});
    expect(rows[4][2]).toEqual(
      expect.objectContaining({
        value: 1862548.4,
        plain: '1,862,548',
        total: true,
      })
    );
  });

  test('keeps the text shown when Excel would display the number differently', () => {
    const rows = tableToSheet(plTable(), colid => formats[colid]);
    expect(rows[4][3].value).toBeUndefined();
    expect(rows[4][3].text).toBe('n/a');
  });

  test('reads currency and decimals from the text when the column has no format', () => {
    const table = bind(
      buildTable(
        '<tbody><tr><td>1,234.50</td><td>-£9</td><td>0 RON</td></tr></tbody>'
      ),
      [{value: 1234.5}, {value: -9}, {value: 0}]
    );
    const rows = tableToSheet(table, () => '#,##0');
    expect(rows[0].map(cell => [cell.format, cell.plain])).toEqual([
      ['#,##0.00', '1,234.50'],
      ['"£"#,##0', '-9'],
      ['#,##0" RON"', '0'],
    ]);
  });

  test('keeps years and IDs shown without separators as they are', () => {
    const table = bind(
      buildTable('<tbody><tr><td>2024</td><td>40100</td></tr></tbody>'),
      [{value: 2024}, {value: 40100}]
    );
    const rows = tableToSheet(table, () => '#,##0');
    expect(rows[0].map(cell => [cell.format, cell.plain])).toEqual([
      ['0', '2024'],
      ['0', '40100'],
    ]);
  });

  test('plain text has every cell, amounts as plain numbers', () => {
    const rows = tableToSheet(plTable(), colid => formats[colid]);
    expect(matrixToTsv(sheetToMatrix(rows)).split('\n')).toEqual([
      'Section\tP&L Line\t2026\t2026',
      'Section\tP&L Line\tActual\tYield',
      'Rental Income\tRent\t2,618,497\t5.1%',
      'Rental Income\tDiscounts\t-755,949\t5.3%',
      'Rental Income Total\t\t1,862,548\tn/a',
    ]);
  });

  test('HTML has no merges, bold headers and totals, plain numbers and Excel hints', () => {
    const html = sheetToHtml(tableToSheet(plTable(), colid => formats[colid]));
    expect(html).not.toMatch(/rowspan|colspan/);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const rows = Array.from(doc.querySelectorAll('tr'));
    expect(rows.map(tr => tr.children.length)).toEqual([4, 4, 4, 4, 4]);
    const header = rows[0].children[0].getAttribute('style');
    expect(header).toContain('font-weight:700');
    expect(header).toContain('mso-number-format:"\\@"');
    expect(rows[3].children[0].textContent).toBe('Rental Income');
    const amount = rows[2].children[2];
    expect(amount.textContent).toBe('2,618,497');
    expect(amount.getAttribute('x:num')).toBe('2618497.4');
    // " RON" becomes Excel's \ escapes, then punctuation is CSS escaped
    expect(amount.getAttribute('style')).toContain(
      String.raw`mso-number-format:"\#\,\#\#0\\\ \\R\\O\\N"`
    );
    expect(amount.getAttribute('style')).toContain('text-align:right');
    expect(rows[2].children[0].getAttribute('style')).not.toContain(
      'font-weight'
    );
    const total = rows[4].children[0].getAttribute('style');
    expect(total).toContain('font-weight:700');
    expect(total).toContain('border-top');
    expect(rows[4].children[1].getAttribute('style')).toContain('border-top');
    expect(rows[4].children[3].textContent).toBe('n/a');
    expect(rows[4].children[3].hasAttribute('x:num')).toBe(false);
  });

  test('HTML escapes cell text', () => {
    const html = sheetToHtml([[{text: "A & B <c> 'd'"}]]);
    expect(html).toContain('A &amp; B &lt;c&gt; &#39;d&#39;');
  });
});

describe('copy', () => {
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

  test('formatted copy puts HTML and plain text on the clipboard', async () => {
    const data = {};
    document.execCommand = jest.fn(() => {
      const event = new Event('copy', {cancelable: true});
      event.clipboardData = {setData: (type, value) => (data[type] = value)};
      document.dispatchEvent(event);
      return true;
    });
    await expect(copyRich('<table></table>', 'a\tb')).resolves.toBe(true);
    expect(data).toEqual({
      'text/html': '<table></table>',
      'text/plain': 'a\tb',
    });
  });

  test('formatted copy falls back to plain text when the copy event is blocked', async () => {
    let written = null;
    document.execCommand = jest.fn(() => false);
    Object.defineProperty(navigator, 'clipboard', {
      value: {writeText: async text => (written = text)},
      configurable: true,
    });
    await expect(copyRich('<table></table>', 'a\tb')).resolves.toBe(true);
    expect(written).toBe('a\tb');
  });
});
