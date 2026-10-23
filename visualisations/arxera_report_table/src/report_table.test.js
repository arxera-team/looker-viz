/**
 * @jest-environment jsdom
 */

// Mock global looker object before importing report_table
const mockAdd = jest.fn();
global.looker = {
  plugins: {
    visualizations: {
      add: mockAdd,
    },
  },
};

// Mock CSS imports required by report_table.js
jest.mock('./theme_traditional.css', () => ({ use: jest.fn(), unuse: jest.fn() }), { virtual: true });
jest.mock('./theme_looker.css', () => ({ use: jest.fn(), unuse: jest.fn() }), { virtual: true });
jest.mock('./theme_contemporary.css', () => ({ use: jest.fn(), unuse: jest.fn() }), { virtual: true });
jest.mock('./layout_fixed.css', () => ({ use: jest.fn(), unuse: jest.fn() }), { virtual: true });
jest.mock('./layout_auto.css', () => ({ use: jest.fn(), unuse: jest.fn() }), { virtual: true });

require('./report_table');

describe('report_table visualization plugin', () => {
  let vizPlugin;
  let element;
  let mockDone;
  let mockTrigger;

  beforeEach(() => {
    expect(mockAdd).toHaveBeenCalled();
    vizPlugin = mockAdd.mock.calls[0][0];
    
    element = document.createElement('div');
    element.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      width: 800,
      height: 600,
      top: 0,
      left: 0,
      right: 800,
      bottom: 600,
    });
    
    // Create visualization container elements
    vizPlugin.create(element, {});

    mockDone = jest.fn();
    mockTrigger = jest.fn();
    vizPlugin.clearErrors = jest.fn();
    vizPlugin.addError = jest.fn();
    vizPlugin.trigger = mockTrigger;
  });

  describe('defensive done() callback execution', () => {
    test('should call done() when queryResponse has pivots but no measures', async () => {
      const queryResponse = {
        fields: {
          pivots: [{ name: 'p1' }],
          measure_like: [],
          dimension_like: [{ name: 'd1' }],
        },
      };
      const data = [{ 'd1': { value: 'val1' } }];

      await vizPlugin.updateAsync(data, element, {}, queryResponse, {}, mockDone);

      expect(vizPlugin.addError).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Empty Pivot(s)' })
      );
      expect(mockDone).toHaveBeenCalledTimes(1);
    });

    test('should call done() when pivots count exceeds 2', async () => {
      const queryResponse = {
        fields: {
          pivots: [{ name: 'p1' }, { name: 'p2' }, { name: 'p3' }],
          measure_like: [{ name: 'm1' }],
          dimension_like: [{ name: 'd1' }],
        },
      };
      const data = [{ 'd1': { value: 'val1' } }];

      await vizPlugin.updateAsync(data, element, {}, queryResponse, {}, mockDone);

      expect(vizPlugin.addError).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Max Two Pivots' })
      );
      expect(mockDone).toHaveBeenCalledTimes(1);
    });

    test('should call done() when data is empty', async () => {
      const queryResponse = {
        fields: {
          pivots: [],
          measure_like: [{ name: 'm1' }],
          dimension_like: [{ name: 'd1' }],
        },
      };

      await vizPlugin.updateAsync([], element, {}, queryResponse, {}, mockDone);

      expect(vizPlugin.addError).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'No Results' })
      );
      expect(mockDone).toHaveBeenCalledTimes(1);
    });

    test('should call done() when queryResponse has no valid fields', async () => {
      const queryResponse = {
        fields: {
          pivots: [],
          measure_like: [],
          dimension_like: [],
        },
      };
      const data = [{ 'd1': { value: 'val1' } }];

      await vizPlugin.updateAsync(data, element, {}, queryResponse, {}, mockDone);

      expect(vizPlugin.addError).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'No Fields' })
      );
      expect(mockDone).toHaveBeenCalledTimes(1);
    });

    test('should call done() on successful render with valid data and fields', async () => {
      const queryResponse = {
        fields: {
          pivots: [],
          dimension_like: [
            { name: 'dim1', label: 'Dimension 1', type: 'string' }
          ],
          measure_like: [
            { name: 'meas1', label: 'Measure 1', type: 'number', is_numeric: true }
          ],
        },
        sorts: [],
        pivots: [],
      };
      const data = [
        {
          dim1: { value: 'Category A', rendered: 'Category A' },
          meas1: { value: 100, rendered: '$100' },
        },
      ];

      await vizPlugin.updateAsync(data, element, { theme: 'traditional' }, queryResponse, {}, mockDone);

      expect(mockDone).toHaveBeenCalledTimes(1);
      expect(element.querySelector('#reportTable')).not.toBeNull();
    });

    test('should call done() even if an exception occurs during table rendering', async () => {
      const queryResponse = {
        fields: {
          pivots: [],
          dimension_like: [
            { name: 'dim1', label: 'Dimension 1', type: 'string' }
          ],
          measure_like: [
            { name: 'meas1', label: 'Measure 1', type: 'number', is_numeric: true }
          ],
        },
        sorts: [],
        pivots: [],
      };
      const data = [
        {
          dim1: { value: 'Category A' },
          meas1: { value: 100 },
        },
      ];

      // Break element.querySelector to simulate an unexpected runtime error
      const brokenElement = {
        ...element,
        querySelector: () => { throw new Error('Simulated DOM failure'); },
        getBoundingClientRect: element.getBoundingClientRect,
      };

      await vizPlugin.updateAsync(data, brokenElement, { theme: 'traditional' }, queryResponse, {}, mockDone);

      expect(vizPlugin.addError).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Rendering Error' })
      );
      expect(mockDone).toHaveBeenCalledTimes(1);
    });

    test('should render cleanly and call done() when details.print is set (PDF export mode)', async () => {
      const queryResponse = {
        fields: {
          pivots: [],
          dimension_like: [
            { name: 'dim1', label: 'Dimension 1', type: 'string' }
          ],
          measure_like: [
            { name: 'meas1', label: 'Measure 1', type: 'number', is_numeric: true }
          ],
        },
        sorts: [],
        pivots: [],
      };
      const data = [
        {
          dim1: { value: 'PDF Test', rendered: 'PDF Test' },
          meas1: { value: 500, rendered: '$500' },
        },
      ];
      const details = { print: true };

      await vizPlugin.updateAsync(
        data,
        element,
        { theme: 'traditional', customTheme: 'animate' },
        queryResponse,
        details,
        mockDone
      );

      expect(mockDone).toHaveBeenCalledTimes(1);
      expect(element.querySelector('#reportTable')).not.toBeNull();
    });
  });

  describe('freeze header rows', () => {
    const queryResponse = {
      fields: {
        pivots: [],
        dimension_like: [{name: 'dim1', label: 'Dimension 1', type: 'string'}],
        measure_like: [
          {name: 'meas1', label: 'Measure 1', type: 'number', is_numeric: true},
        ],
      },
      sorts: [],
      pivots: [],
    };
    const data = [
      {
        dim1: {value: 'Category A', rendered: 'Category A'},
        meas1: {value: 100, rendered: '100'},
      },
    ];

    test('option exists and is off by default', () => {
      expect(vizPlugin.options.freezeHeaders).toEqual(
        expect.objectContaining({type: 'boolean', default: false})
      );
    });

    test('header cells are sticky when enabled', async () => {
      await vizPlugin.updateAsync(
        data,
        element,
        {theme: 'traditional', freezeHeaders: true},
        queryResponse,
        {},
        mockDone
      );
      const headerCells = element.querySelectorAll('#reportTable thead th');
      expect(headerCells.length).toBeGreaterThan(0);
      headerCells.forEach(th => {
        expect(th.style.position).toBe('sticky');
        expect(th.style.top).toBe('0px');
        expect(th.style.backgroundColor).not.toBe('');
      });
    });

    test('pivoted header rows stack below each other', async () => {
      const rowRect = HTMLTableRowElement.prototype.getBoundingClientRect;
      HTMLTableRowElement.prototype.getBoundingClientRect = () => ({
        height: 24,
      });
      const pivotResponse = {
        fields: {
          pivots: [{name: 'piv1', label: 'Year'}],
          dimension_like: [
            {name: 'dim1', label: 'Dimension 1', type: 'string'},
          ],
          measure_like: [
            {
              name: 'meas1',
              label: 'Measure 1',
              type: 'number',
              is_numeric: true,
            },
          ],
        },
        sorts: [],
        pivots: [
          {
            key: '2021',
            metadata: {piv1: {value: '2021'}},
            sort_values: {piv1: '2021'},
          },
          {
            key: '2022',
            metadata: {piv1: {value: '2022'}},
            sort_values: {piv1: '2022'},
          },
        ],
      };
      const pivotData = [
        {
          dim1: {value: 'Category A', rendered: 'Category A'},
          meas1: {
            2021: {value: 100, rendered: '100'},
            2022: {value: 200, rendered: '200'},
          },
        },
      ];
      try {
        await vizPlugin.updateAsync(
          pivotData,
          element,
          {theme: 'traditional', freezeHeaders: true},
          pivotResponse,
          {},
          mockDone
        );
      } finally {
        HTMLTableRowElement.prototype.getBoundingClientRect = rowRect;
      }
      const rows = element.querySelectorAll('#reportTable thead tr');
      expect(rows.length).toBeGreaterThan(1);
      rows.forEach((row, i) => {
        row.querySelectorAll('th').forEach(th => {
          expect(th.style.top).toBe(i * 24 + 'px');
        });
      });
    });

    test('header cells are not sticky when disabled', async () => {
      await vizPlugin.updateAsync(
        data,
        element,
        {theme: 'traditional'},
        queryResponse,
        {},
        mockDone
      );
      const headerCells = element.querySelectorAll('#reportTable thead th');
      expect(headerCells.length).toBeGreaterThan(0);
      headerCells.forEach(th => {
        expect(th.style.position).toBe('');
      });
    });
  });
  describe('export buttons', () => {
    const field = (name, label, extra) => ({
      name,
      label,
      type: 'string',
      is_numeric: false,
      value_format: null,
      ...extra,
    });
    const plQuery = {
      fields: {
        dimension_like: [
          field('pl.section', 'Section'),
          field('pl.line', 'Line'),
        ],
        measure_like: [
          field('pl.amount', 'Amount', {
            type: 'sum',
            is_numeric: true,
            value_format: '#,##0',
          }),
        ],
        table_calculations: [],
        pivots: [],
        supermeasure_like: [],
      },
      sorts: [],
    };
    const plData = [
      ['Rental Income', 'Rent', 100],
      ['Direct Costs', 'Insurance', -8],
    ].map(([section, line, amount]) => ({
      'pl.section': {value: section, rendered: section},
      'pl.line': {value: line, rendered: line},
      'pl.amount': {value: amount, rendered: String(amount)},
    }));

    test('are off by default', async () => {
      expect(vizPlugin.options.exportButtons).toEqual(
        expect.objectContaining({type: 'boolean', default: false})
      );
      await vizPlugin.updateAsync(
        plData,
        element,
        {theme: 'traditional'},
        plQuery,
        {},
        mockDone
      );
      expect(element.querySelector('#exportToolbar')).toBeNull();
    });

    test('copy the table as shown, running totals included', async () => {
      await vizPlugin.updateAsync(
        plData,
        element,
        {
          theme: 'traditional',
          exportButtons: true,
          rowSubtotals: true,
          subtotalDepth: '1',
          runningTotals: 'NOI > Direct Costs',
        },
        plQuery,
        {},
        mockDone
      );
      expect(element.querySelector('#exportToolbar')).not.toBeNull();
      let copied = '';
      Object.defineProperty(navigator, 'clipboard', {
        value: {writeText: async text => (copied = text)},
        configurable: true,
      });
      element.querySelector('#copyTable').dispatchEvent(new Event('click'));
      await new Promise(resolve => setTimeout(resolve, 0));
      const lines = copied.split('\n');
      expect(lines.some(l => l.includes('NOI') && l.includes('92'))).toBe(true);
      expect(lines.some(l => l.includes('Rent') && l.includes('100'))).toBe(
        true
      );
    });

    test('include an Excel download', async () => {
      await vizPlugin.updateAsync(
        plData,
        element,
        {theme: 'traditional', exportButtons: true},
        plQuery,
        {},
        mockDone
      );
      expect(element.querySelector('#downloadXlsx').textContent).toBe(
        'Download Excel'
      );
    });

    test('are left out of PDF and image downloads', async () => {
      await vizPlugin.updateAsync(
        plData,
        element,
        {theme: 'traditional', exportButtons: true},
        plQuery,
        {print: true},
        mockDone
      );
      expect(element.querySelector('#reportTable')).not.toBeNull();
      expect(element.querySelector('#exportToolbar')).toBeNull();
    });
  });
});
