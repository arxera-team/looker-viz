const {VisPluginTableModel} = require('./vis_table_plugin');

// Line items whose html adds a currency symbol to a number-only value_format,
// as LookML currency html does. The vis calculates the subtotals itself.
const section = {
  name: 'pl.section',
  label: 'Section',
  type: 'string',
  is_numeric: false,
  value_format: null,
};
const line = {
  name: 'pl.line',
  label: 'Line',
  type: 'string',
  is_numeric: false,
  value_format: null,
};
const amount = {
  name: 'pl.amount',
  label: 'Amount',
  type: 'sum',
  is_numeric: true,
  value_format: '[>=0]#,##0;(#,##0)',
};

const html = (symbol, rendered) => {
  const negative = rendered.startsWith('(');
  const number = rendered.replace(/[()]/g, '');
  const shown = symbol === 'RON' ? `${number} RON` : `${symbol}${number}`;
  return `<a class="cell-clickable-content">\n  ${
    negative ? `(${shown})` : shown
  }\n</a>`;
};

const dataOf = lines =>
  lines.map(([s, l, a, symbol]) => {
    const rendered = a < 0 ? `(${Math.abs(a)})` : String(a);
    return {
      'pl.section': {value: s},
      'pl.line': {value: l},
      'pl.amount': {
        value: a,
        rendered: rendered,
        html: symbol ? html(symbol, rendered) : undefined,
      },
    };
  });

const query = () => ({
  fields: {
    dimension_like: [section, line],
    measure_like: [amount],
    table_calculations: [],
    pivots: [],
    supermeasure_like: [],
  },
  sorts: [],
});

const config = (extra = {}) => ({
  rowSubtotals: true,
  subtotalDepth: '1',
  ...extra,
});

const subtotalsOf = model =>
  model.data
    .filter(row => row.type === 'subtotal' && !row.hide)
    .map(row => [row.data['pl.section'].value, row.data['pl.amount'].rendered]);

describe('currencyAffix', () => {
  test('reads a symbol before or after the number', () => {
    expect(
      VisPluginTableModel.currencyAffix({
        rendered: '11,580',
        html: html('£', '11,580'),
      })
    ).toEqual({prefix: '£', suffix: ''});
    expect(
      VisPluginTableModel.currencyAffix({
        rendered: '836',
        html: html('RON', '836'),
      })
    ).toEqual({prefix: '', suffix: ' RON'});
  });

  test('ignores brackets around negative values', () => {
    expect(
      VisPluginTableModel.currencyAffix({
        rendered: '(1,135)',
        html: html('£', '(1,135)'),
      })
    ).toEqual({prefix: '£', suffix: ''});
  });

  test('gives null without html, or when the html hides the value', () => {
    expect(VisPluginTableModel.currencyAffix({rendered: '120'})).toBeNull();
    expect(
      VisPluginTableModel.currencyAffix({rendered: '120', html: '<b>n/a</b>'})
    ).toBeNull();
  });
});

describe('sharedCurrencyAffix', () => {
  const cell = (symbol, rendered) => ({rendered, html: html(symbol, rendered)});

  test('returns the symbol every member shares, skipping cells without html', () => {
    expect(
      VisPluginTableModel.sharedCurrencyAffix([
        cell('£', '100'),
        {rendered: '∅', value: null},
        cell('£', '(20)'),
      ])
    ).toEqual({prefix: '£', suffix: ''});
  });

  test('returns null for members in different currencies', () => {
    expect(
      VisPluginTableModel.sharedCurrencyAffix([
        cell('£', '100'),
        cell('RON', '20'),
      ])
    ).toBeNull();
  });
});

describe('withCurrencyAffix', () => {
  test('keeps brackets and minus signs outside the symbol', () => {
    const pound = {prefix: '£', suffix: ''};
    expect(VisPluginTableModel.withCurrencyAffix('(1,135.6)', pound)).toBe(
      '(£1,135.6)'
    );
    expect(VisPluginTableModel.withCurrencyAffix('-1,135.6', pound)).toBe(
      '-£1,135.6'
    );
    expect(
      VisPluginTableModel.withCurrencyAffix('836.6', {
        prefix: '',
        suffix: ' RON',
      })
    ).toBe('836.6 RON');
    expect(VisPluginTableModel.withCurrencyAffix('836.6', null)).toBe('836.6');
  });
});

describe('row subtotals', () => {
  test('carry the currency symbol of their line items', () => {
    const model = new VisPluginTableModel(
      dataOf([
        ['Rental Income', 'Rent', 100, '£'],
        ['Rental Income', 'Back rent', 20, '£'],
        ['Direct Costs', 'Repairs', -40, '£'],
        ['Direct Costs', 'Insurance', -8, '£'],
      ]),
      query(),
      config()
    );
    expect(subtotalsOf(model)).toEqual([
      ['Rental Income', '£120'],
      ['Direct Costs', '(£48)'],
    ]);
  });

  test('use each group its own currency', () => {
    const model = new VisPluginTableModel(
      dataOf([
        ['UK', 'Rent', 100, '£'],
        ['UK', 'Back rent', 20, '£'],
        ['Romania', 'Rent', 50, 'RON'],
        ['Romania', 'Turnover rent', 5, 'RON'],
      ]),
      query(),
      config()
    );
    expect(subtotalsOf(model)).toEqual([
      ['UK', '£120'],
      ['Romania', '55 RON'],
    ]);
  });

  test('get no symbol when their line items mix currencies', () => {
    const model = new VisPluginTableModel(
      dataOf([
        ['Rental Income', 'Rent', 100, '£'],
        ['Rental Income', 'Rent (Romania)', 50, 'RON'],
      ]),
      query(),
      config()
    );
    expect(subtotalsOf(model)).toEqual([['Rental Income', '150']]);
  });

  test('stay plain when the line items have no currency html', () => {
    const model = new VisPluginTableModel(
      dataOf([
        ['Rental Income', 'Rent', 100],
        ['Rental Income', 'Back rent', 20],
      ]),
      query(),
      config()
    );
    expect(subtotalsOf(model)).toEqual([['Rental Income', '120']]);
  });

  test('drill menu label shows the symbol too', () => {
    const data = dataOf([
      ['Rental Income', 'Rent', 100, '£'],
      ['Rental Income', 'Back rent', 20, '£'],
    ]);
    data.forEach(row => {
      row['pl.amount'].links = [
        {
          type: 'measure_default',
          label_prefix: 'Show All',
          url: `/explore/m/v?fields=x&f[pl.line]=${row['pl.line'].value}&f[pl.section]=Rental+Income`,
        },
      ];
    });
    const model = new VisPluginTableModel(data, query(), config());
    const subtotal = model.data.find(row => row.type === 'subtotal');
    expect(subtotal.data['pl.amount'].links[0].label).toBe('Show All £120');
  });
});

describe('running totals', () => {
  test('carry the shared currency symbol', () => {
    const model = new VisPluginTableModel(
      dataOf([
        ['Rental Income', 'Rent', 100, '£'],
        ['Direct Costs', 'Repairs', -40, '£'],
      ]),
      query(),
      config({runningTotals: 'NOI > Direct Costs'})
    );
    const noi = model.data.find(row => row.runningTotal);
    expect(noi.data['pl.amount'].rendered).toBe('£60');
  });
});
