import {
  alertCategoryIds,
  alertId,
  categoriesQuery,
  parseLiveAlerts,
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

/**
 * The block the operator's own plugin renders at the top of the front page,
 * in the markup its stylesheet describes: a container, a heading beside the
 * notices, one `_aviso` per alteration, and a hairline between them.
 */
const avisos = (entries: { text: string; slug?: string }[]) => `<html><body>
    <div class="tranvias_dosnet_avisos tranvias_dosnet_avisos_${entries.length} closed">
      <div class="tranvias_dosnet_avisos_inner">
        <div class="tranvias_dosnet_avisos_cerrar"><img src="/close.svg"></div>
        <div class="tranvias_dosnet_avisos_title">
          <h2><img src="/warn.svg"><span>Avisos</span></h2>
        </div>
        <div class="tranvias_dosnet_avisos_list">
          ${entries
            .map(
              ({ text, slug }, index) => `
              ${index ? '<div class="tranvias_dosnet_avisos_sep"></div>' : ''}
              <div class="tranvias_dosnet_avisos_aviso tranvias_dosnet_avisos_aviso_${index + 1}">
                ${
                  slug
                    ? `<a href="https://www.tranviasdezaragoza.es/${slug}/">${text}</a>`
                    : text
                }
              </div>`,
            )
            .join('')}
        </div>
      </div>
    </div>
  </body></html>`;

describe('alertCategoryIds', () => {
  it('keeps the categories an alteration is filed under', () => {
    expect(
      alertCategoryIds([
        // The three the site really has: `home` is the operator's featured
        // set and is where every alteration lands; the other two are not.
        { id: 10, slug: 'home' },
        { id: 11, slug: 'noticias' },
        { id: 12, slug: 'anuncios-oficiales' },
      ]),
    ).toEqual([10]);
  });

  it('finds none in a site that files them somewhere else', () => {
    expect(alertCategoryIds([{ id: 9, slug: 'prensa' }])).toEqual([]);
    expect(alertCategoryIds(undefined)).toEqual([]);
  });
});

describe('the queries the site is asked', () => {
  it('asks the API where this site actually serves it', () => {
    // `/api/`, not `/wp-json/`, which this site answers 404.
    expect(categoriesQuery()).toContain(
      'https://www.tranviasdezaragoza.es/api/wp/v2/categories',
    );
    expect(postsQuery([10])).toContain(
      'https://www.tranviasdezaragoza.es/api/wp/v2/posts',
    );
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

describe('parseLiveAlerts', () => {
  it('reads the alteration the block at the top is showing', () => {
    expect(
      parseLiveAlerts(
        avisos([
          { text: 'Servicio interrumpido entre Plaza España y Gran Vía' },
        ]),
      ),
    ).toEqual([
      {
        id: expect.stringMatching(/^aviso-[0-9a-f]{12}$/),
        title: 'Servicio interrumpido entre Plaza España y Gran Vía',
        // Nothing linked, so the page showing it is where a reader goes.
        url: 'https://www.tranviasdezaragoza.es/',
        lines: ['L1'],
      },
    ]);
  });

  it('keeps the id of a notice steady while its wording is', () => {
    const once = parseLiveAlerts(avisos([{ text: 'Servicio interrumpido' }]));
    const again = parseLiveAlerts(avisos([{ text: 'Servicio interrumpido' }]));
    const other = parseLiveAlerts(avisos([{ text: 'Otra cosa' }]));

    expect(once[0].id).toBe(again[0].id);
    expect(once[0].id).not.toBe(other[0].id);
  });

  it('files a notice under its own article where it links to one', () => {
    // The same alteration is often both the block at the top and the post
    // below it, and keying on the slug is what makes them one alert.
    expect(
      parseLiveAlerts(
        avisos([{ text: 'Obras en la vía', slug: 'obras-en-la-via' }]),
      )[0],
    ).toEqual({
      id: 'obras-en-la-via',
      title: 'Obras en la vía',
      url: 'https://www.tranviasdezaragoza.es/obras-en-la-via/',
      lines: ['L1'],
    });
  });

  it('reads each of several notices, and neither the heading nor the rule', () => {
    const alerts = parseLiveAlerts(
      avisos([{ text: 'Primero' }, { text: 'Segundo' }]),
    );

    expect(alerts.map((alert) => alert.title)).toEqual(['Primero', 'Segundo']);
  });

  it('reads nothing from a page with no alteration in force', () => {
    // Which is most days: the block is rendered only when something is wrong.
    expect(
      parseLiveAlerts(
        '<html><body><div class="et_pb_module et_pb_code et_pb_code_0"></div></body></html>',
      ),
    ).toEqual([]);
  });

  it('leaves a notice linking off the site pointing at the site', () => {
    expect(
      parseLiveAlerts(
        `<div class="tranvias_dosnet_avisos_aviso">
           <a href="https://example.com/elsewhere/">Elsewhere</a>
         </div>`,
      )[0].url,
    ).toBe('https://www.tranviasdezaragoza.es/');
  });
});
