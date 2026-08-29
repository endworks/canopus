import {
  mergeAlerts,
  parseAlertDate,
  parseAlertLines,
  parseAlerts,
} from './alerts';

const pageUrl = 'https://zaragoza.avanzagrupo.com/';

// The block the site publishes under "Últimas alteraciones del servicio". The
// theme's own markup is not something we can pin down, so the entries here are
// wrapped the way the page renders them — a heading that links to the article,
// a date, and a "Líneas:" row — and the parser is asked to find them by those
// rather than by any class name.
const listing = (
  entries: { slug: string; title: string; date: string; lines: string }[],
) => `<section>
    <h2>Últimas alteraciones del servicio.</h2>
    ${entries
      .map(
        ({ slug, title, date, lines }) => `
        <article>
          <h3><a href="https://zaragoza.avanzagrupo.com/${slug}/">${title}</a></h3>
          <p>${date}</p>
          <p><em>Líneas: ${lines}</em></p>
        </article>`,
      )
      .join('')}
    <a href="https://zaragoza.avanzagrupo.com/avisos/">Avisos anteriores »</a>
  </section>`;

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
    const alerts = parseAlerts(listing(entries), pageUrl);

    expect(alerts).toEqual([
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

  it('does not take the link out of the entry below it', () => {
    // One entry whose own markup carries no link at all: pairing it with the
    // next entry's article would put the wrong lines under the wrong headline,
    // so it is left out instead.
    const alerts = parseAlerts(
      `<section>
         <article><p>Líneas: 44</p></article>
         ${listing(entries).replace('<section>', '').replace('</section>', '')}
       </section>`,
      pageUrl,
    );

    expect(alerts.map((alert) => alert.lines)).toEqual([
      ['23', '34', '42', 'Ci1', 'Ci2', 'ES7'],
      ['21', '52', '53'],
    ]);
  });

  it('reads an entry whose title is not itself the link', () => {
    const alerts = parseAlerts(
      `<div>
         <h3>Fiestas en Las Fuentes</h3>
         <p>Líneas: 22, 30, 38, 44</p>
         <a href="/fiestas-en-las-fuentes/">Fiestas en Las Fuentes</a>
       </div>`,
      pageUrl,
    );

    expect(alerts).toEqual([
      {
        id: 'fiestas-en-las-fuentes',
        title: 'Fiestas en Las Fuentes',
        url: 'https://zaragoza.avanzagrupo.com/fiestas-en-las-fuentes/',
        date: undefined,
        lines: ['22', '30', '38', '44'],
      },
    ]);
  });

  it('ignores a listing with nothing in it', () => {
    expect(
      parseAlerts('<section><h2>Sin alteraciones</h2></section>', pageUrl),
    ).toEqual([]);
  });

  it('does not follow a link off the site', () => {
    const alerts = parseAlerts(
      `<article>
         <a href="https://example.com/aviso/">Aviso</a>
         <p>Líneas: 21</p>
       </article>`,
      pageUrl,
    );

    expect(alerts).toEqual([]);
  });
});

describe('mergeAlerts', () => {
  it('keeps one entry per alert and every line either page named', () => {
    const alert = {
      id: 'fiestas',
      title: 'Fiestas',
      url: 'https://zaragoza.avanzagrupo.com/fiestas/',
      lines: ['21'],
    };

    expect(
      mergeAlerts([
        { ...alert, date: undefined, lines: ['52'] },
        { ...alert, date: '2026-08-24' },
      ]),
    ).toEqual([{ ...alert, date: '2026-08-24', lines: ['21', '52'] }]);
  });
});
