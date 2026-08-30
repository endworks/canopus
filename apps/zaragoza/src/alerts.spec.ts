import {
  articleText,
  parseAlertDate,
  parseAlertLines,
  parseAlerts,
} from './alerts';

const pageUrl =
  'https://zaragoza.avanzagrupo.com/category/alteraciones-del-servicio/';

// The listing, as a WordPress archive renders one post per entry.
const listing = (
  entries: { slug: string; title: string; date: string; lines: string }[],
) => `<main>
    ${entries
      .map(
        ({ slug, title, date, lines }) => `
        <article>
          <h2><a href="https://zaragoza.avanzagrupo.com/${slug}/">${title}</a></h2>
          <p>${date}</p>
          <p><em>Líneas: ${lines}</em></p>
        </article>`,
      )
      .join('')}
    <a href="https://zaragoza.avanzagrupo.com/category/alteraciones-del-servicio/page/2/">Siguientes »</a>
  </main>`;

describe('parseAlertDate', () => {
  it.each([
    ['25 agosto, 2026', '2026-08-25'],
    ['24 de agosto de 2026', '2026-08-24'],
    ['1 enero, 2027', '2027-01-01'],
  ])('reads %s', (input, expected) => {
    expect(parseAlertDate(input)).toBe(expected);
  });

  it('leaves a date it cannot read undefined', () => {
    expect(parseAlertDate('proximamente')).toBeUndefined();
  });
});

describe('parseAlertLines', () => {
  it('reads the ids the listing names', () => {
    expect(parseAlertLines('Líneas: 23, 34, 42, Ci1, Ci2, ES7')).toEqual([
      '23',
      '34',
      '42',
      'Ci1',
      'Ci2',
      'ES7',
    ]);
  });

  it.each([
    ['Línea: 21', ['21']],
    ['Líneas afectadas: 22 y 30', ['22', '30']],
    // The feed pads the number; the network calls that line N6.
    ['Líneas: N06, N07', ['N6', 'N7']],
    // Nothing here is an id, and a word is not one either.
    ['Líneas: todas las líneas', []],
    ['Sin alteraciones', []],
  ])('reads %s', (input, expected) => {
    expect(parseAlertLines(input)).toEqual(expected);
  });
});

describe('parseAlerts', () => {
  const entries = [
    {
      slug: 'como-ir-al-festival-vive-latino-2026-en-autobus',
      title: 'Cómo ir al Festival Vive Latino España 2026 en autobús',
      date: '25 agosto, 2026',
      lines: '23, 34, 42, Ci1, Ci2, ES7',
    },
    {
      slug: 'fiestas-en-miralbueno-afecciones-en-el-bus-urbano',
      title: 'Fiestas en Miralbueno – Afecciones en el bus urbano',
      date: '24 agosto, 2026',
      lines: '21, 52, 53',
    },
  ];

  it('reads every entry the listing publishes', () => {
    expect(parseAlerts(listing(entries), pageUrl)).toEqual([
      {
        id: 'como-ir-al-festival-vive-latino-2026-en-autobus',
        title: 'Cómo ir al Festival Vive Latino España 2026 en autobús',
        url: 'https://zaragoza.avanzagrupo.com/como-ir-al-festival-vive-latino-2026-en-autobus/',
        date: '2026-08-25',
        // An id the network never lists is still the one the alert names.
        lines: ['23', '34', '42', 'Ci1', 'Ci2', 'ES7'],
      },
      {
        id: 'fiestas-en-miralbueno-afecciones-en-el-bus-urbano',
        title: 'Fiestas en Miralbueno – Afecciones en el bus urbano',
        url: 'https://zaragoza.avanzagrupo.com/fiestas-en-miralbueno-afecciones-en-el-bus-urbano/',
        date: '2026-08-24',
        lines: ['21', '52', '53'],
      },
    ]);
  });

  it('reads an entry the listing prints without its lines', () => {
    const [alert] = parseAlerts(
      `<article>
         <h2><a href="/obras-en-gran-via/">Obras en Gran Vía</a></h2>
         <p>20 agosto, 2026</p>
       </article>`,
      pageUrl,
    );

    // Still an alteration, and its article is there to be read.
    expect(alert).toEqual({
      id: 'obras-en-gran-via',
      title: 'Obras en Gran Vía',
      url: 'https://zaragoza.avanzagrupo.com/obras-en-gran-via/',
      date: '2026-08-20',
      lines: [],
    });
  });

  it("does not take the listing's own pages for alterations", () => {
    // The "Siguientes »" link at the foot of the archive, and the archive
    // itself, are not alterations.
    expect(parseAlerts(listing(entries), pageUrl)).toHaveLength(2);
  });

  it('ignores a listing with nothing in it', () => {
    expect(
      parseAlerts('<main><h1>Sin alteraciones</h1></main>', pageUrl),
    ).toEqual([]);
  });

  it('does not follow a link off the site', () => {
    const alerts = parseAlerts(
      `<article>
         <h2><a href="https://example.com/aviso/">Aviso</a></h2>
         <p>Líneas: 21</p>
       </article>`,
      pageUrl,
    );

    expect(alerts).toEqual([]);
  });
});

describe('articleText', () => {
  it('keeps the article and drops the furniture around it', () => {
    const text = articleText(
      `<html><head><style>p { color: red }</style></head><body>
         <nav>Líneas y horarios</nav>
         <article><h1>Fiestas</h1><p>Del 24 al 26 de agosto.</p></article>
         <footer>Avanza</footer>
       </body></html>`,
    );

    expect(text).toBe('Fiestas Del 24 al 26 de agosto.');
  });

  it('falls back to the page when there is no article element', () => {
    expect(articleText('<body><p>Sin alteraciones</p></body>')).toBe(
      'Sin alteraciones',
    );
  });
});
