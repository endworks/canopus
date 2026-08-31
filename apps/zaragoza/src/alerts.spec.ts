import {
  articleText,
  parseAlertDate,
  parseAlertLines,
  parseAlertsNonce,
  parseAlterations,
} from './alerts';

const pageUrl = 'https://zaragoza.avanzagrupo.com/lineas-y-horarios/';

// One page of the fragment admin-ajax answers with.
const listing = (
  entries: { slug: string; title: string; date: string; lines?: string }[],
) => `<div class="container-allposts">
    ${entries
      .map(
        ({ slug, title, date, lines }, index) => `
        <div class="container-post container-post-${index}">
          <div class="container-post-title">
            <a href="https://zaragoza.avanzagrupo.com/${slug}/">${title}</a>
          </div>
          <div class="container-entry-date">${date}</div>
          ${lines ? `<div class="container-post-lines">Líneas: ${lines}</div>` : ''}
        </div>`,
      )
      .join('')}
  </div>`;

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

describe('parseAlertsNonce', () => {
  it('reads the nonce the alterations endpoint demands', () => {
    expect(
      parseAlertsNonce(
        '<form><input type="hidden" id="avz_alteraciones_ajax_nonce" value="0eb1d9e166" /></form>',
      ),
    ).toBe('0eb1d9e166');
  });

  it('reads nothing from a page that carries none', () => {
    expect(parseAlertsNonce('<main><h1>Líneas</h1></main>')).toBeUndefined();
  });
});

describe('parseAlterations', () => {
  const entries = [
    {
      slug: 'como-ir-al-festival-vive-latino-2026-en-autobus',
      title: 'Cómo ir al Festival Vive Latino España 2026 en autobús',
      date: '25 agosto, 2026',
      lines: '23, 34, 42, Ci1, Ci2, ES7',
    },
    {
      slug: 'ii-fase-obras-coso-lineas-de-autobus-desviadas',
      title: 'III Fase obras Coso – Líneas de autobús desviadas',
      // Months old and still shown, which is the point of reading this and
      // not the archive.
      date: '21 mayo, 2026',
      lines: '21, 22, 28, N1, N5',
    },
  ];

  it('reads every alteration the page is showing', () => {
    expect(parseAlterations(listing(entries), pageUrl)).toEqual([
      {
        id: 'como-ir-al-festival-vive-latino-2026-en-autobus',
        title: 'Cómo ir al Festival Vive Latino España 2026 en autobús',
        url: 'https://zaragoza.avanzagrupo.com/como-ir-al-festival-vive-latino-2026-en-autobus/',
        date: '2026-08-25',
        // An id the network never lists is still the one the alert names.
        lines: ['23', '34', '42', 'Ci1', 'Ci2', 'ES7'],
      },
      {
        id: 'ii-fase-obras-coso-lineas-de-autobus-desviadas',
        title: 'III Fase obras Coso – Líneas de autobús desviadas',
        url: 'https://zaragoza.avanzagrupo.com/ii-fase-obras-coso-lineas-de-autobus-desviadas/',
        date: '2026-05-21',
        lines: ['21', '22', '28', 'N1', 'N5'],
      },
    ]);
  });

  it('reads an alteration printed without its lines', () => {
    const [alert] = parseAlterations(
      listing([
        {
          slug: 'obras-en-gran-via',
          title: 'Obras en Gran Vía',
          date: '20 agosto, 2026',
        },
      ]),
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

  it('ends the walk on the empty page the paginator finishes with', () => {
    expect(
      parseAlterations('<div class="container-allposts"></div>', pageUrl),
    ).toEqual([]);
  });

  it('does not follow a link off the site', () => {
    expect(
      parseAlterations(
        `<div class="container-post">
           <div class="container-post-title"><a href="https://example.com/aviso/">Aviso</a></div>
           <div class="container-post-lines">Líneas: 21</div>
         </div>`,
        pageUrl,
      ),
    ).toEqual([]);
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
