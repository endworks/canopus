import Anthropic from '@anthropic-ai/sdk';
import { AlertReader, alertReader } from './alert-reader';
import { ScrapedAlert } from './alerts';

// What the last call put in front of the model.
let sent = '';

const alert: ScrapedAlert = {
  id: 'fiestas-en-miralbueno',
  title: 'Fiestas en Miralbueno',
  url: 'https://zaragoza.avanzagrupo.com/fiestas-en-miralbueno/',
  date: '2026-08-24',
  lines: ['21'],
};

// The SDK call, answering with whatever the model is said to have returned.
const reader = (parsed: unknown) => {
  const parse = jest.fn(async (params: { messages: { content: string }[] }) => {
    sent = params.messages[0].content;
    return { parsed_output: parsed };
  });
  const client = { messages: { parse } } as unknown as Anthropic;
  return { reader: new AlertReader(client), parse };
};

// The route the model is given to resolve the article against.
const routes = [
  {
    line: '21',
    stations: [
      { id: '1234', street: 'Gran Vía' },
      { id: '1235', street: 'Plaza España' },
      { id: '1236', street: 'Coso' },
    ],
  },
];

describe('AlertReader.read', () => {
  it('keeps what the article turned out to say', async () => {
    const { reader: subject } = reader({
      startDate: '2026-08-24',
      endDate: '2026-08-26',
      stations: ['1234'],
      scope: 'stations',
    });

    expect(
      await subject.read(alert, 'Del 24 al 26 de agosto.', routes),
    ).toEqual({
      startDate: '2026-08-24',
      endDate: '2026-08-26',
      stations: ['1234'],
      scope: 'stations',
    });
  });

  it('drops a stop that was never offered to it', async () => {
    const { reader: subject } = reader({
      startDate: null,
      endDate: null,
      // 9999 is not on any affected route; putting it through would badge
      // whichever stop happens to have that number.
      stations: ['1234', '9999', 'la parada de la esquina'],
      scope: 'stations',
    });

    const details = await subject.read(alert, 'texto', routes);

    expect(details.stations).toEqual(['1234']);
  });

  it.each([
    ['an end before the start', '2026-08-24', '2026-08-20'],
    ['a year read wrong', '2026-08-24', '2027-08-26'],
    ['a date that is not one', '2026-08-24', 'el martes'],
  ])('ignores %s', async (_case, startDate, endDate) => {
    const { reader: subject } = reader({
      startDate,
      endDate,
      stations: [],
      scope: 'line',
    });

    const details = await subject.read(alert, 'texto', routes);

    expect(details.startDate).toBe('2026-08-24');
    expect(details.endDate).toBeUndefined();
  });

  it.each([
    ['it named no stops', []],
    ['every stop it named was invented', ['4321']],
  ])(
    'keeps a stop-level notice on the whole line when %s',
    async (_case, stations) => {
      const { reader: subject } = reader({
        startDate: null,
        endDate: null,
        stations,
        scope: 'stations',
      });

      // Narrowing to nothing would silence the notice at every stop.
      const details = await subject.read(alert, 'texto', routes);

      expect(details).toMatchObject({ scope: 'line', stations: [] });
    },
  );

  it('will not narrow a notice when a route did not fit in the prompt', async () => {
    // More stops than the prompt has room for: the second line is dropped
    // whole rather than cut in half.
    const crowded = [
      {
        line: '21',
        stations: Array.from({ length: 500 }, (_, index) => ({
          id: `${1000 + index}`,
          street: 'Av. de Navarra',
        })),
      },
      ...routes,
    ];
    const { reader: subject } = reader({
      startDate: null,
      endDate: null,
      stations: ['1000'],
      scope: 'stations',
    });

    const details = await subject.read(alert, 'texto', crowded);

    // A notice narrowed to the stops of the lines that fitted would go silent
    // at the stops of the line that did not.
    expect(details).toMatchObject({ scope: 'line' });
    expect(sent).not.toContain('Línea 21: 1000 Av. de Navarra; 1001');
  });

  it('offers the model the route of every affected line, in order', async () => {
    const { reader: subject } = reader({
      startDate: null,
      endDate: null,
      stations: [],
      scope: 'line',
    });

    await subject.read(alert, 'No efectuará parada en Coso.', routes);

    expect(sent).toContain(
      'Línea 21: 1234 Gran Vía; 1235 Plaza España; 1236 Coso',
    );
    expect(sent).toContain('No efectuará parada en Coso.');
  });

  it('gives up on an alert it cannot read rather than failing the run', async () => {
    const parse = jest.fn(async () => {
      throw new Error('overloaded');
    });
    const subject = new AlertReader({
      messages: { parse },
    } as unknown as Anthropic);

    expect(await subject.read(alert, 'texto', routes)).toBeUndefined();
  });

  it('reads nothing when the model returned nothing usable', async () => {
    const { reader: subject } = reader(null);

    expect(await subject.read(alert, 'texto', routes)).toBeUndefined();
  });
});

describe('alertReader', () => {
  it('is disabled without a key, and reads nothing', async () => {
    const subject = alertReader({});

    expect(subject.enabled).toBe(false);
    expect(await subject.read(alert, 'texto', routes)).toBeUndefined();
  });

  it('is enabled with one', () => {
    expect(alertReader({ ANTHROPIC_API_KEY: 'sk-ant-test' }).enabled).toBe(
      true,
    );
  });
});
