import {
  alertCategoryIds,
  alertId,
  categoriesQuery,
  parseIncidentListing,
  parseWordPressAlerts,
  postArticle,
  postsQuery,
  WordPressPost,
} from './tram-alerts';

const post = (
  slug: string,
  title: string,
  date = '2026-09-04T10:12:31',
  content?: string,
): WordPressPost => ({
  slug,
  link: `https://www.tranviasdezaragoza.es/${slug}/`,
  date,
  title: { rendered: title },
  ...(content ? { content: { rendered: content } } : {}),
});

// The listing page, as a WordPress theme renders one post per entry.
const listing = (
  entries: { slug: string; title: string; datetime?: string; date?: string }[],
) => `<main>
    ${entries
      .map(
        ({ slug, title, datetime, date }) => `
        <article class="post type-post">
          <h2 class="entry-title">
            <a href="https://www.tranviasdezaragoza.es/${slug}/">${title}</a>
          </h2>
          ${
            datetime
              ? `<time class="entry-date" datetime="${datetime}">whenever</time>`
              : `<span class="entry-date">${date ?? ''}</span>`
          }
        </article>`,
      )
      .join('')}
  </main>`;

describe('alertCategoryIds', () => {
  it('keeps the categories an alteration is filed under', () => {
    expect(
      alertCategoryIds([
        { id: 4, slug: 'incidencias' },
        { id: 9, slug: 'noticias' },
        { id: 12, slug: 'avisos' },
      ]),
    ).toEqual([4, 12]);
  });

  it('finds none in a site that files them somewhere else', () => {
    expect(alertCategoryIds([{ id: 9, slug: 'home' }])).toEqual([]);
    expect(alertCategoryIds(undefined)).toEqual([]);
  });
});

describe('the queries the site is asked', () => {
  it('asks for every slug an alteration might be filed under at once', () => {
    expect(categoriesQuery()).toContain('slug=incidencias,avisos,alteraciones');
  });

  it('asks only for the categories that are alterations', () => {
    expect(postsQuery([4, 12])).toContain('categories=4,12');
  });
});

describe('alertId', () => {
  it('is the slug the site gives the post', () => {
    expect(
      alertId('https://www.tranviasdezaragoza.es/Corte-Coso/', 'corte-coso'),
    ).toBe('corte-coso');
  });

  it('falls back to the last segment of the link', () => {
    expect(alertId('https://www.tranviasdezaragoza.es/Corte-Coso/')).toBe(
      'corte-coso',
    );
  });

  it('reads nothing from something that is not a link', () => {
    expect(alertId('not a url')).toBeUndefined();
  });
});

describe('parseWordPressAlerts', () => {
  it('reads a notice the API hands over', () => {
    expect(
      parseWordPressAlerts([
        post('corte-en-plaza-espana', 'Corte en Plaza España'),
      ]),
    ).toEqual([
      {
        id: 'corte-en-plaza-espana',
        title: 'Corte en Plaza España',
        url: 'https://www.tranviasdezaragoza.es/corte-en-plaza-espana/',
        date: '2026-09-04',
        // The network runs one line, so there is nothing else it is about,
        // and it is called what the operator calls it.
        lines: ['L1'],
      },
    ]);
  });

  it('undoes the entities WordPress renders into a headline', () => {
    expect(
      parseWordPressAlerts([post('obras', 'Obras &amp; desv&iacute;os')])[0]
        .title,
    ).toBe('Obras & desvíos');
  });

  it('drops a post that is not on this site', () => {
    expect(
      parseWordPressAlerts([
        { ...post('a', 'A'), link: 'https://example.com/a/' },
        { ...post('b', 'B'), link: 'not a url' },
        { ...post('c', 'C'), link: undefined },
        { ...post('d', ''), title: { rendered: '' } },
      ]),
    ).toEqual([]);
  });

  it('reads nothing from an endpoint that answered with nothing', () => {
    expect(parseWordPressAlerts(undefined)).toEqual([]);
    expect(parseWordPressAlerts([])).toEqual([]);
  });
});

describe('postArticle', () => {
  it('takes the words of a notice the listing already carried', () => {
    expect(
      postArticle(
        post(
          'corte',
          'Corte',
          '2026-09-04T10:12:31',
          '<p>Del 24 al 26 de agosto</p><script>ignore()</script>',
        ),
      ),
    ).toBe('Del 24 al 26 de agosto');
  });

  it('has nothing to say about a listing that carried no words', () => {
    expect(postArticle(post('corte', 'Corte'))).toBe('');
    expect(postArticle(undefined)).toBe('');
  });
});

describe('parseIncidentListing', () => {
  it('reads the notices a listing page shows', () => {
    const alerts = parseIncidentListing(
      listing([
        {
          slug: 'servicio-interrumpido',
          title: 'Servicio interrumpido',
          datetime: '2026-09-04T10:12:31+02:00',
        },
      ]),
    );

    expect(alerts).toEqual([
      {
        id: 'servicio-interrumpido',
        title: 'Servicio interrumpido',
        url: 'https://www.tranviasdezaragoza.es/servicio-interrumpido/',
        date: '2026-09-04',
        lines: ['L1'],
      },
    ]);
  });

  it('reads the day a theme prints in words', () => {
    expect(
      parseIncidentListing(
        listing([
          { slug: 'obras', title: 'Obras', date: '4 septiembre, 2026' },
        ]),
      )[0].date,
    ).toBe('2026-09-04');
  });

  it('leaves the day undated when the theme prints nothing readable', () => {
    expect(
      parseIncidentListing(
        listing([{ slug: 'obras', title: 'Obras', date: 'próximamente' }]),
      )[0].date,
    ).toBeUndefined();
  });

  it('drops an entry linking anywhere but this site', () => {
    expect(
      parseIncidentListing(
        `<article class="post">
           <h2><a href="https://example.com/elsewhere/">Elsewhere</a></h2>
         </article>
         <article class="post"><h2>No link at all</h2></article>`,
      ),
    ).toEqual([]);
  });

  it('reads nothing from a page it does not recognise', () => {
    expect(parseIncidentListing('<div><h2>Incidencias</h2></div>')).toEqual([]);
  });
});
