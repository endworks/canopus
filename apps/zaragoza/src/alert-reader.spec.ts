import Anthropic from '@anthropic-ai/sdk';
import { AlertReader, alertReader } from './alert-reader';
import { ScrapedAlert } from './alerts';

const alert: ScrapedAlert = {
  id: 'fiestas-en-miralbueno',
  title: 'Fiestas en Miralbueno',
  url: 'https://zaragoza.avanzagrupo.com/fiestas-en-miralbueno/',
  date: '2026-08-24',
  lines: ['21'],
};

// The SDK call, answering with whatever the model is said to have returned.
const reader = (parsed: unknown) => {
  const parse = jest.fn(async () => ({ parsed_output: parsed }));
  const client = { messages: { parse } } as unknown as Anthropic;
  return { reader: new AlertReader(client), parse };
};

const stations = new Set(['1234', '1235']);

describe('AlertReader.articleText', () => {
  it('keeps the article and drops the furniture around it', () => {
    const text = AlertReader.articleText(
      `<html><head><style>p { color: red }</style></head><body>
         <nav>Líneas y horarios</nav>
         <article><h1>Fiestas</h1><p>Del 24 al 26 de agosto.</p></article>
         <footer>Avanza</footer>
       </body></html>`,
    );

    expect(text).toBe('Fiestas Del 24 al 26 de agosto.');
  });

  it('falls back to the page when there is no article element', () => {
    expect(
      AlertReader.articleText('<body><p>Sin alteraciones</p></body>'),
    ).toBe('Sin alteraciones');
  });
});

describe('AlertReader.read', () => {
  it('keeps what the article turned out to say', async () => {
    const { reader: subject } = reader({
      startDate: '2026-08-24',
      endDate: '2026-08-26',
      lines: ['21', 'ES7'],
      stations: ['1234'],
    });

    expect(
      await subject.read(alert, 'Del 24 al 26 de agosto.', stations),
    ).toEqual({
      startDate: '2026-08-24',
      endDate: '2026-08-26',
      lines: ['21', 'ES7'],
      stations: ['1234'],
    });
  });

  it('drops a stop the network does not have', async () => {
    const { reader: subject } = reader({
      startDate: null,
      endDate: null,
      // 9999 is not a stop; putting it through would badge whichever stop
      // ends up with that number.
      lines: [],
      stations: ['1234', '9999', 'la parada de la esquina'],
    });

    const details = await subject.read(alert, 'texto', stations);

    expect(details.stations).toEqual(['1234']);
  });

  it('drops anything that is not a line id', async () => {
    const { reader: subject } = reader({
      startDate: null,
      endDate: null,
      lines: ['21', 'todas las líneas', 'N06'],
      stations: [],
    });

    const details = await subject.read(alert, 'texto', stations);

    // Padding is dropped the way it is everywhere else.
    expect(details.lines).toEqual(['21', 'N6']);
  });

  it.each([
    ['an end before the start', '2026-08-24', '2026-08-20'],
    ['a year read wrong', '2026-08-24', '2027-08-26'],
    ['a date that is not one', '2026-08-24', 'el martes'],
  ])('ignores %s', async (_case, startDate, endDate) => {
    const { reader: subject } = reader({
      startDate,
      endDate,
      lines: [],
      stations: [],
    });

    const details = await subject.read(alert, 'texto', stations);

    expect(details.startDate).toBe('2026-08-24');
    expect(details.endDate).toBeUndefined();
  });

  it('gives up on an alert it cannot read rather than failing the run', async () => {
    const parse = jest.fn(async () => {
      throw new Error('overloaded');
    });
    const subject = new AlertReader({
      messages: { parse },
    } as unknown as Anthropic);

    expect(await subject.read(alert, 'texto', stations)).toBeUndefined();
  });

  it('reads nothing when the model returned nothing usable', async () => {
    const { reader: subject } = reader(null);

    expect(await subject.read(alert, 'texto', stations)).toBeUndefined();
  });
});

describe('alertReader', () => {
  it('is disabled without a key, and reads nothing', async () => {
    const subject = alertReader({});

    expect(subject.enabled).toBe(false);
    expect(await subject.read(alert, 'texto', stations)).toBeUndefined();
  });

  it('is enabled with one', () => {
    expect(alertReader({ ANTHROPIC_API_KEY: 'sk-ant-test' }).enabled).toBe(
      true,
    );
  });
});
