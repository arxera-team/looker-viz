const {VisPluginTableModel} = require('./vis_table_plugin');

describe('VisPluginTableModel', () => {
  let mockQueryResponse;
  let mockLookerData;
  let mockConfig;

  beforeEach(() => {
    mockQueryResponse = {
      fields: {
        dimension_like: [],
        measure_like: [],
        pivots: [],
        supermeasure_like: [],
      },
      sorts: [],
      pivots: [],
    };
    mockLookerData = [];
    mockConfig = {};
  });

  test('should render table calculations under pivot when all raw measures are hidden (b/539669056)', () => {
    mockQueryResponse.fields.dimension_like = [
      {name: 'dim_1', label: 'Dimension 1', type: 'string'},
    ];
    mockQueryResponse.fields.pivots = [{name: 'pivot_1', label: 'Pivot 1'}];
    mockQueryResponse.pivots = [
      {
        key: '2021',
        metadata: {pivot_1: {value: '2021'}},
        sort_values: {pivot_1: '2021'},
      },
      {
        key: '2022',
        metadata: {pivot_1: {value: '2022'}},
        sort_values: {pivot_1: '2022'},
      },
    ];
    mockQueryResponse.fields.measure_like = [
      {name: 'measure_1', label: 'Measure 1', type: 'number', hidden: true},
    ];
    mockQueryResponse.fields.supermeasure_like = [
      {
        name: 'table_calc_1',
        label: 'Table Calculation 1',
        type: 'number',
        is_table_calculation: true,
      },
    ];

    mockLookerData = [
      {
        dim_1: {value: 'Val1'},
        table_calc_1: {
          2021: {value: 10, rendered: '10'},
          2022: {value: 20, rendered: '20'},
        },
      },
    ];

    const model = new VisPluginTableModel(
      mockLookerData,
      mockQueryResponse,
      mockConfig
    );
    expect(model).toBeDefined();
    expect(model.measures.length).toBeGreaterThan(0);
    expect(model.columns.length).toBeGreaterThan(0);

    const calcCols = model.columns.filter(
      c => c.modelField.name === 'table_calc_1'
    );
    expect(calcCols.length).toBeGreaterThan(0);
  });

  test('should instantiate successfully with empty data and config', () => {
    const model = new VisPluginTableModel(
      mockLookerData,
      mockQueryResponse,
      mockConfig
    );
    expect(model).toBeDefined();
    expect(model.dimensions).toEqual([]);
  });

  test('should not crash when dimensions are empty (zero dimensions)', () => {
    delete mockQueryResponse.pivots; // Force flat table
    mockQueryResponse.fields.dimension_like = [];
    mockQueryResponse.fields.measure_like = [
      {name: 'measure_1', label: 'M1', type: 'number', is_numeric: true},
    ];
    mockConfig = {
      indexColumn: true,
      rowSubtotals: true,
    };
    mockQueryResponse.subtotals_data = {};

    const model = new VisPluginTableModel(
      mockLookerData,
      mockQueryResponse,
      mockConfig
    );
    expect(model).toBeDefined();
    expect(model.dimensions).toEqual([]);
    expect(model.columns.length).toBeGreaterThan(0);
  });

  test('should not crash when creating variance columns when config.columnOrder is undefined', () => {
    delete mockQueryResponse.pivots; // Force flat table
    mockQueryResponse.fields.dimension_like = [
      {name: 'dim_1', label: 'D1', type: 'string'},
    ];
    mockQueryResponse.fields.measure_like = [
      {name: 'measure_1', label: 'M1', type: 'number', is_numeric: true},
      {name: 'measure_2', label: 'M2', type: 'number', is_numeric: true},
    ];

    mockConfig = {
      'comparison|measure_1': 'measure_2',
      // config.columnOrder is undefined
      'var_num|measure_1': true,
      'var_pct|measure_1': true,
    };

    const model = new VisPluginTableModel(
      mockLookerData,
      mockQueryResponse,
      mockConfig
    );
    expect(model).toBeDefined();

    // Check that variance columns were created
    const varianceCols = model.columns.filter(c => c.isVariance);
    expect(varianceCols.length).toBeGreaterThan(0);

    const absVarCol = varianceCols.find(c => c.variance_type === 'absolute');
    expect(absVarCol).toBeDefined();
    expect(absVarCol.pos).toBeDefined();
  });
});

describe('subtotalDrillLinks', () => {
  const subtotalDrillLinks = VisPluginTableModel.prototype.subtotalDrillLinks;
  const lineItem = level2 => ({
    links: [
      {
        type: 'measure_default',
        label_prefix: 'Show All',
        url: `/explore/m/v?fields=a,b&f[level_1]=Rent&f[level_2]=${level2}&f[period]=202606&limit=500`,
      },
    ],
  });

  test('drills into every line item the subtotal adds up', () => {
    const [link] = subtotalDrillLinks(
      [lineItem('Rent'), lineItem('Back+Rent')],
      '£3.0'
    );

    expect(link.url).toBe(
      '/explore/m/v?fields=a,b&f[level_1]=Rent&f[period]=202606&limit=500'
    );
    expect(link.label).toBe('Show All £3.0');
  });

  test('offers no drill when the line items have none', () => {
    expect(subtotalDrillLinks([{links: []}, {}], '£0.0')).toEqual([]);
  });
});

describe('hideColumnsWithoutFilter', () => {
  // An actual and two comparison measures, which return 0 when no comparison
  // period is set.
  const measure = name => ({
    name: name,
    label: name,
    type: 'sum',
    is_numeric: true,
    value_format: '#,##0',
  });
  const query = appliedFilters => ({
    fields: {
      dimension_like: [
        {name: 'pl.line', label: 'Line', type: 'string', is_numeric: false},
      ],
      measure_like: [
        measure('pl.actual'),
        measure('pl.actual_comparison_month'),
        measure('pl.actual_comparison_ytd'),
      ],
      table_calculations: [],
      pivots: [],
      supermeasure_like: [],
    },
    sorts: [],
    applied_filters: appliedFilters,
  });
  const data = () => [
    {
      'pl.line': {value: 'Rent'},
      'pl.actual': {value: 100, rendered: '100'},
      'pl.actual_comparison_month': {value: 0, rendered: '0'},
      'pl.actual_comparison_ytd': {value: 0, rendered: '0'},
    },
  ];
  const option = 'pl.comparison_period_filter > comparison';
  const comparisonFilter = value => ({
    'pl.comparison_period_filter': {
      field: {name: 'pl.comparison_period_filter'},
      value: value,
    },
  });
  const visibleIds = model =>
    model.columns.filter(column => !column.hide).map(column => column.id);

  test('hides matching columns when the filter is missing or blank', () => {
    [undefined, {}, comparisonFilter(''), comparisonFilter(null)].forEach(
      applied => {
        const model = new VisPluginTableModel(data(), query(applied), {
          hideColumnsWithoutFilter: option,
        });
        expect(visibleIds(model)).toEqual(['pl.line', 'pl.actual']);
      }
    );
  });

  test('keeps matching columns when the filter is set', () => {
    const model = new VisPluginTableModel(
      data(),
      query(comparisonFilter('202509')),
      {hideColumnsWithoutFilter: option}
    );
    expect(visibleIds(model)).toEqual([
      'pl.line',
      'pl.actual',
      'pl.actual_comparison_month',
      'pl.actual_comparison_ytd',
    ]);
  });

  test('hides variance columns of a hidden column', () => {
    const model = new VisPluginTableModel(data(), query({}), {
      hideColumnsWithoutFilter: option,
      'comparison|pl.actual_comparison_month': 'pl.actual',
      'var_num|pl.actual_comparison_month': true,
    });
    const variances = model.columns.filter(c => c.isVariance);
    expect(variances.length).toBeGreaterThan(0);
    expect(variances.every(c => c.hide)).toBe(true);
  });

  test('changes nothing when the option is empty', () => {
    const model = new VisPluginTableModel(data(), query({}), {});
    expect(visibleIds(model)).toEqual([
      'pl.line',
      'pl.actual',
      'pl.actual_comparison_month',
      'pl.actual_comparison_ytd',
    ]);
  });

  test('ignores malformed entries', () => {
    expect(
      VisPluginTableModel.parseFilterColumns(
        'no arrow; > comparison; pl.filter >; a > b > c'
      )
    ).toEqual([]);
    expect(
      VisPluginTableModel.parseFilterColumns(
        'pl.filter > Comparison, , ytd;\npl.other > budget'
      )
    ).toEqual([
      {filter: 'pl.filter', texts: ['comparison', 'ytd']},
      {filter: 'pl.other', texts: ['budget']},
    ]);
  });
});

describe('sortColumnsBy pivot0Measures', () => {
  const build = sortColumnsBy => {
    const pv = (col, colSort, cur, curSort) => ({
      key: `${col}|FIELD|${cur}`,
      metadata: {col: {value: col}, cur: {value: cur}},
      sort_values: {col: colSort, cur: curSort},
    });
    const queryResponse = {
      fields: {
        dimension_like: [{name: 'line', label: 'Line', type: 'string'}],
        measure_like: [
          {name: 'actual', label: 'Actual', type: 'number', is_numeric: true},
          {name: 'budget', label: 'Budget', type: 'number', is_numeric: true},
        ],
        pivots: [
          {name: 'col', label: 'Report Column'},
          {name: 'cur', label: 'Currency'},
        ],
        supermeasure_like: [],
      },
      sorts: [
        {name: 'col', desc: false},
        {name: 'cur', desc: false},
      ],
      pivots: [
        pv('Month', 1, 'RON', 1),
        pv('Month', 1, 'EUR', 2),
        pv('YTD', 2, 'RON', 1),
        pv('YTD', 2, 'EUR', 2),
      ],
    };
    const cell = v => ({value: v, rendered: String(v)});
    const vals = {};
    queryResponse.pivots.forEach(p => (vals[p.key] = cell(1)));
    const data = [{line: cell('Rent'), actual: vals, budget: {...vals}}];
    return new VisPluginTableModel(data, queryResponse, {sortColumnsBy});
  };
  const order = model => model.columns.filter(c => c.pivoted).map(c => c.id);

  test('puts the measures between the two pivots', () => {
    expect(order(build('pivot0Measures'))).toEqual([
      'Month|FIELD|RON.actual',
      'Month|FIELD|EUR.actual',
      'Month|FIELD|RON.budget',
      'Month|FIELD|EUR.budget',
      'YTD|FIELD|RON.actual',
      'YTD|FIELD|EUR.actual',
      'YTD|FIELD|RON.budget',
      'YTD|FIELD|EUR.budget',
    ]);
    expect(build('pivot0Measures').headers.map(h => h.type)).toEqual([
      'pivot0',
      'field',
      'pivot1',
    ]);
  });

  test('keeps the default pivots order unchanged', () => {
    expect(order(build('pivots'))).toEqual([
      'Month|FIELD|RON.actual',
      'Month|FIELD|RON.budget',
      'Month|FIELD|EUR.actual',
      'Month|FIELD|EUR.budget',
      'YTD|FIELD|RON.actual',
      'YTD|FIELD|RON.budget',
      'YTD|FIELD|EUR.actual',
      'YTD|FIELD|EUR.budget',
    ]);
  });

  test('puts the dimension label on the bottom header row', () => {
    const line = build('pivot0Measures').columns.find(c => c.id === 'line');
    expect(line.levels.map(l => l.label)).toEqual(['', '', 'Line']);
  });

  test('keeps the dimension label on the field row by default', () => {
    const line = build('pivots').columns.find(c => c.id === 'line');
    line.setHeaderCellLabels();
    expect(line.levels.map(l => l.label)).toEqual(['', '', 'Line']);
  });

  test('keeps the dimension label on the measures row when sorting by measures', () => {
    const line = build('measures').columns.find(c => c.id === 'line');
    expect(line.levels.map(l => l.label)).toEqual(['Line', '', '']);
  });

  test('names the dimension in the cell tooltip', () => {
    const model = build('pivot0Measures');
    const tip = model.getCellToolTip(
      model.data[0].id,
      'Month|FIELD|RON.actual'
    );
    expect(tip).toContain('<em>Line:</em>');
  });
});
