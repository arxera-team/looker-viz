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

describe('hideEmptyColumns', () => {
  // A P&L with an actual and two comparison measures: one returns nothing
  // (no comparison period set), the other only has values on some lines.
  const measure = name => ({
    name: name,
    label: name,
    type: 'sum',
    is_numeric: true,
    value_format: '#,##0',
  });
  const query = () => ({
    fields: {
      dimension_like: [
        {name: 'pl.line', label: 'Line', type: 'string', is_numeric: false},
      ],
      measure_like: [
        measure('pl.actual'),
        measure('pl.comparison_empty'),
        measure('pl.comparison_partial'),
      ],
      table_calculations: [],
      pivots: [],
      supermeasure_like: [],
    },
    sorts: [],
  });
  const data = () => [
    {
      'pl.line': {value: 'Rent'},
      'pl.actual': {value: 100, rendered: '100'},
      'pl.comparison_empty': {value: null},
      'pl.comparison_partial': {value: null},
    },
    {
      'pl.line': {value: 'Parking'},
      'pl.actual': {value: 0, rendered: '0'},
      'pl.comparison_empty': {value: null},
      'pl.comparison_partial': {value: 0, rendered: '0'},
    },
  ];
  const visibleIds = model =>
    model.columns.filter(column => !column.hide).map(column => column.id);

  test('hides a measure column with no value in any line, even with subtotals', () => {
    const model = new VisPluginTableModel(data(), query(), {
      hideEmptyColumns: true,
      rowSubtotals: true,
      subtotalDepth: '1',
    });
    expect(visibleIds(model)).toEqual([
      'pl.line',
      'pl.actual',
      'pl.comparison_partial',
    ]);
  });

  test('hides a variance column with its empty column', () => {
    const model = new VisPluginTableModel(data(), query(), {
      hideEmptyColumns: true,
      'comparison|pl.comparison_empty': 'pl.actual',
      'var_num|pl.comparison_empty': true,
    });
    // The absolute and percentage variance columns.
    const variances = model.columns.filter(c => c.isVariance);
    expect(variances.length).toBeGreaterThan(0);
    expect(variances.every(c => c.hide)).toBe(true);
  });

  test('keeps every column when the option is off', () => {
    const model = new VisPluginTableModel(data(), query(), {});
    expect(visibleIds(model)).toEqual([
      'pl.line',
      'pl.actual',
      'pl.comparison_empty',
      'pl.comparison_partial',
    ]);
  });
});
