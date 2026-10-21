/**
 * @jest-environment jsdom
 */

import {
  copyText,
  downloadText,
  matrixToCsv,
  matrixToTsv,
  tableToMatrix,
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
