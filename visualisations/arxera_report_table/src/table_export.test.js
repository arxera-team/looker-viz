/**
 * @jest-environment jsdom
 */

import {
  copyRich,
  copyText,
  matrixToTsv,
  sheetToHtml,
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
  const plTable = () =>
    bind(
      buildTable(`
        <thead>
          <tr><th rowspan="2">Line</th><th colspan="2">2026</th></tr>
          <tr><th>Rent</th><th>Yield</th></tr>
        </thead>
        <tbody>
          <tr><td>Asset A</td><td style="text-align: right">£1,250</td><td>5.1%</td></tr>
          <tr><td class="total">NOI</td><td class="total">(£8)</td><td class="total">n/a</td></tr>
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
  const formats = {rent: '"£"#,##0;("£"#,##0)', yield: '0.0%'};

  test('keeps merges, marks headers and totals, keeps numbers in their Looker format', () => {
    const rows = tableToSheet(plTable(), colid => formats[colid]);
    expect(rows[0][0]).toEqual(
      expect.objectContaining({text: 'Line', rowspan: 2, header: true})
    );
    expect(rows[0][1]).toEqual(
      expect.objectContaining({text: '2026', colspan: 2})
    );
    expect(rows[0][2]).toEqual({covered: true});
    expect(rows[1][0]).toEqual({covered: true});
    expect(rows[2][1]).toEqual(
      expect.objectContaining({
        value: 1250,
        format: formats.rent,
        total: false,
        align: 'right',
      })
    );
    expect(rows[2][2]).toEqual(
      expect.objectContaining({value: 0.051, format: '0.0%'})
    );
    expect(rows[3][1]).toEqual(
      expect.objectContaining({value: -8, total: true})
    );
  });

  test('keeps the text shown when Excel would display the number differently', () => {
    const rows = tableToSheet(plTable(), colid => formats[colid]);
    expect(rows[3][2].value).toBeUndefined();
    expect(rows[3][2].text).toBe('n/a');
  });

  test('splits subtotal labels spanning columns, keeping the total styling', () => {
    const table = bind(
      buildTable(`
        <tbody>
          <tr><td>Rental Income</td><td>Rent</td><td>10</td></tr>
          <tr><td class="total" colspan="2">Rental Income Total</td><td class="total">10</td></tr>
        </tbody>`),
      [{}, {}, {value: 10, colid: 'a'}, {}, {value: 10, colid: 'a'}]
    );
    const rows = tableToSheet(table);
    expect(rows[1][0]).toEqual(
      expect.objectContaining({text: 'Rental Income Total', colspan: 1})
    );
    expect(rows[1][1]).toEqual({text: '', total: true, header: false});
    const html = sheetToHtml(rows);
    expect(html).not.toContain('colspan');
  });

  test('keeps numbers with a unit or currency around them as numbers', () => {
    const table = bind(
      buildTable(
        '<tbody><tr><td>2,618,497 RON</td><td>-755,949 RON</td><td>0 RON</td><td>-£80</td></tr></tbody>'
      ),
      [{value: 2618497.4}, {value: -755949}, {value: 0}, {value: -80}]
    );
    const rows = tableToSheet(table, () => '#,##0');
    expect(rows[0].map(cell => [cell.value, cell.format])).toEqual([
      [2618497.4, '#,##0" RON"'],
      [-755949, '#,##0" RON"'],
      [0, '#,##0" RON"'],
      [-80, '"£"#,##0'],
    ]);
  });

  test('falls back to a plain number format when the column has none', () => {
    const table = bind(
      buildTable('<tbody><tr><td>1,234.50</td><td>£9</td></tr></tbody>'),
      [{value: 1234.5}, {value: 9}]
    );
    const rows = tableToSheet(table);
    expect(rows[0][0]).toEqual(
      expect.objectContaining({value: 1234.5, format: '#,##0.00'})
    );
    expect(rows[0][1]).toEqual(
      expect.objectContaining({value: 9, format: '"£"#,##0'})
    );
  });

  test('HTML has merges, bold headers and totals, Excel formats and text cells', () => {
    const html = sheetToHtml(tableToSheet(plTable(), colid => formats[colid]));
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const rows = doc.querySelectorAll('tr');
    expect(rows[0].children).toHaveLength(2);
    expect(rows[0].children[0].getAttribute('rowspan')).toBe('2');
    expect(rows[0].children[1].getAttribute('colspan')).toBe('2');
    expect(rows[1].children).toHaveLength(2);
    const header = rows[0].children[0].getAttribute('style');
    expect(header).toContain('font-weight:700');
    expect(header).toContain('mso-number-format:"\\@"');
    const rent = rows[2].children[1];
    expect(rent.textContent).toBe('£1,250');
    expect(rent.getAttribute('x:num')).toBe('1250');
    // "£" becomes Excel's \£ escape, then punctuation is CSS escaped
    expect(rent.getAttribute('style')).toContain(
      String.raw`mso-number-format:"\\£\#\,\#\#0\;\(\\£\#\,\#\#0\)"`
    );
    expect(rent.getAttribute('style')).toContain('text-align:right');
    expect(rows[2].children[0].getAttribute('style')).not.toContain(
      'font-weight'
    );
    const noi = rows[3].children[0].getAttribute('style');
    expect(noi).toContain('font-weight:700');
    expect(noi).toContain('border-top');
    expect(rows[3].children[2].textContent).toBe('n/a');
    expect(rows[3].children[2].hasAttribute('x:num')).toBe(false);
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
