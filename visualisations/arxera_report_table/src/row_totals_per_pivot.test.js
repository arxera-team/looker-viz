const {VisPluginTableModel} = require('./vis_table_plugin');

// Property > Currency, as in a P&L compared across properties in RON and EUR.
// Looker's single row total adds RON and EUR together.
const ROW_TOTAL = '$$$_row_total_$$$';
const pv = (prop, propSort, cur, curSort) => ({
  key: `${prop}|FIELD|${cur}`,
  data: {prop: prop, cur: cur},
  metadata: {prop: {value: prop}, cur: {value: cur, rendered: cur}},
  sort_values: {prop: propSort, cur: curSort},
});
const pivots = [
  pv('Mall A', 1, 'RON', 1),
  pv('Mall A', 1, 'EUR', 2),
  pv('Mall B', 2, 'RON', 1),
  pv('Mall B', 2, 'EUR', 2),
  {key: ROW_TOTAL, is_total: true, data: {}, metadata: {}, sort_values: {}},
];

const queryResponse = () => ({
  fields: {
    dimension_like: [
      {name: 'section', label: 'Section', type: 'string'},
      {name: 'line', label: 'Line', type: 'string'},
    ],
    measure_like: [
      {
        name: 'actual',
        label: 'Actual',
        type: 'sum',
        is_numeric: true,
        value_format: '#,##0',
      },
      {
        name: 'rate',
        label: 'Rate',
        type: 'average',
        is_numeric: true,
        value_format: '#,##0',
      },
    ],
    table_calculations: [],
    pivots: [
      {name: 'prop', label: 'Property'},
      {name: 'cur', label: 'Currency'},
    ],
    supermeasure_like: [],
  },
  sorts: [
    {name: 'prop', desc: false},
    {name: 'cur', desc: false},
  ],
  pivots: pivots,
  has_row_totals: true,
});

// [section, line, Mall A RON, Mall A EUR, Mall B RON, Mall B EUR]
const lines = [
  ['Rental Income', 'Rent', 100, 20, 50, 10],
  ['Rental Income', 'Turnover rent', 10, 2, 5, null],
  ['Direct Costs', 'Insurance', -40, -8, -20, -4],
];
const cell = v => ({value: v, rendered: v === null ? null : String(v)});
const data = () =>
  lines.map(([section, line, ...values]) => {
    const pivoted = {};
    values.forEach((v, i) => (pivoted[pivots[i].key] = cell(v)));
    pivoted[ROW_TOTAL] = cell(values.reduce((a, b) => a + (b || 0), 0));
    return {
      section: cell(section),
      line: cell(line),
      actual: pivoted,
      rate: {...pivoted},
    };
  });

const build = config =>
  new VisPluginTableModel(data(), queryResponse(), config);
const totalIds = model =>
  model.columns.filter(c => c.isRowTotal).map(c => c.id);
const valueOf = (model, rowId, colId) =>
  model.data.find(r => r.id === rowId).data[colId].value;
const RON = '$$$_row_total_$$$.RON.actual';
const EUR = '$$$_row_total_$$$.EUR.actual';

describe('rowTotalsPerPivot', () => {
  test("keeps Looker's single row total by default", () => {
    const model = build({});
    expect(totalIds(model)).toEqual([
      `${ROW_TOTAL}.actual`,
      `${ROW_TOTAL}.rate`,
    ]);
    expect(valueOf(model, 'Rental Income|Rent', `${ROW_TOTAL}.actual`)).toBe(
      180
    );
  });

  test('adds one row total per second pivot value in place of it', () => {
    const model = build({rowTotalsPerPivot: true});
    expect(totalIds(model)).toEqual([RON, EUR]);
    expect(valueOf(model, 'Rental Income|Rent', RON)).toBe(150);
    expect(valueOf(model, 'Rental Income|Rent', EUR)).toBe(30);
    expect(valueOf(model, 'Direct Costs|Insurance', EUR)).toBe(-12);
  });

  test('skips nulls, as Looker does', () => {
    const model = build({rowTotalsPerPivot: true});
    expect(valueOf(model, 'Rental Income|Turnover rent', EUR)).toBe(2);
  });

  test('adds up subtotal rows too', () => {
    const model = build({
      rowTotalsPerPivot: true,
      rowSubtotals: true,
      subtotalDepth: '1',
    });
    const subtotal = model.data.find(
      r => r.type === 'subtotal' && r.id.includes('Rental Income')
    );
    expect(subtotal.data[RON].value).toBe(165);
    expect(subtotal.data[EUR].value).toBe(32);
    expect(subtotal.data[RON].cell_style).toContain('subtotal');
  });

  test('labels the columns Row Total > value', () => {
    const model = build({rowTotalsPerPivot: true});
    const column = model.columns.find(c => c.id === EUR);
    column.setHeaderCellLabels();
    expect(column.levels.map(l => [l.type, l.label])).toEqual([
      ['pivot0', 'Row Total'],
      ['pivot1', 'EUR'],
      ['field', 'Actual'],
    ]);
  });

  test('puts the row totals after the pivoted columns, in the same order', () => {
    const measuresBetween = build({
      rowTotalsPerPivot: true,
      sortColumnsBy: 'pivot0Measures',
      'runningTotal|rate': true,
    });
    expect(
      measuresBetween.columns.filter(c => c.isRowTotal).map(c => c.id)
    ).toEqual([
      RON,
      EUR,
      '$$$_row_total_$$$.RON.rate',
      '$$$_row_total_$$$.EUR.rate',
    ]);
    expect(measuresBetween.columns.slice(-4).every(c => c.isRowTotal)).toBe(
      true
    );

    const byPivots = build({
      rowTotalsPerPivot: true,
      'runningTotal|rate': true,
    });
    expect(byPivots.columns.filter(c => c.isRowTotal).map(c => c.id)).toEqual([
      RON,
      '$$$_row_total_$$$.RON.rate',
      EUR,
      '$$$_row_total_$$$.EUR.rate',
    ]);
  });

  test('gives measures that are not added up no row total', () => {
    const model = build({rowTotalsPerPivot: true});
    expect(totalIds(model).some(id => id.endsWith('.rate'))).toBe(false);
  });

  test('drills into the line items of that value only', () => {
    const rows = data();
    const link = (prop, cur) => ({
      type: 'measure_default',
      label_prefix: 'Show All',
      url: `/explore/m/e?fields=x&f[prop]=${prop}&f[cur]=${cur}`,
    });
    rows[0].actual['Mall A|FIELD|RON'].links = [link('Mall A', 'RON')];
    rows[0].actual['Mall B|FIELD|RON'].links = [link('Mall B', 'RON')];
    const model = new VisPluginTableModel(rows, queryResponse(), {
      rowTotalsPerPivot: true,
    });
    const links = model.data.find(r => r.id === 'Rental Income|Rent').data[RON]
      .links;
    expect(links).toHaveLength(1);
    expect(links[0].url).toBe('/explore/m/e?fields=x&f[cur]=RON');
  });

  test('does nothing with one pivot or without row totals', () => {
    const onePivot = queryResponse();
    onePivot.fields.pivots = [onePivot.fields.pivots[0]];
    const model = new VisPluginTableModel(data(), onePivot, {
      rowTotalsPerPivot: true,
    });
    expect(model.rowTotalsPerPivot).toBe(false);

    const noTotals = queryResponse();
    noTotals.has_row_totals = false;
    noTotals.pivots = pivots.slice(0, 4);
    expect(
      new VisPluginTableModel(data(), noTotals, {rowTotalsPerPivot: true})
        .rowTotalsPerPivot
    ).toBe(false);
  });

  test('works with a transposed table', () => {
    const model = build({rowTotalsPerPivot: true, transposeTable: true});
    expect(totalIds(model)).toEqual([RON, EUR]);
    expect(model.transposed_columns.length).toBeGreaterThan(0);
  });
});
