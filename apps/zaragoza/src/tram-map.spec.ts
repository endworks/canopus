import {
  mapDataLinks,
  parseMapPath,
  scriptPaths,
  tramMapPages,
} from './tram-map';

const site = 'https://www.tranviasdezaragoza.es';

/** A run of points down the corridor, as many as a widget would draw. */
const route = (count = 20): [number, number][] =>
  Array.from({ length: count }, (_, i) => [
    Number((41.687 - i * 0.003).toFixed(5)),
    Number((-0.902 + i * 0.0008).toFixed(5)),
  ]);

const asLatLngObjects = (points: [number, number][]) =>
  points.map(([lat, lng]) => `{lat: ${lat}, lng: ${lng}}`).join(',');

const asLatLngCalls = (points: [number, number][]) =>
  points
    .map(([lat, lng]) => `new google.maps.LatLng(${lat}, ${lng})`)
    .join(',');

const page = (script: string) =>
  `<html><body><div id="map"></div><script>${script}</script></body></html>`;

describe('tramMapPages', () => {
  it('looks at the line page before the front page', () => {
    expect(tramMapPages(site)).toEqual([`${site}/nuestra-linea/`, `${site}/`]);
  });
});

describe('scriptPaths', () => {
  it('reads a path written as object literals', () => {
    const points = route();

    const [path] = scriptPaths(
      `var line = new google.maps.Polyline({path: [${asLatLngObjects(points)}]});`,
    );

    expect(path).toHaveLength(points.length);
    // Longitude first, which is how this service stores a point and the
    // reverse of how the widget writes one.
    expect(path[0]).toEqual([points[0][1], points[0][0]]);
  });

  it('reads a path written as constructed points', () => {
    const points = route();

    const [path] = scriptPaths(`setPath([${asLatLngCalls(points)}]);`);

    expect(path).toHaveLength(points.length);
  });

  it('reads a path written as JSON', () => {
    const points = route();
    const json = points
      .map(([lat, lng]) => `{"lat":${lat},"lng":${lng}}`)
      .join(',');

    expect(scriptPaths(`var data = {"points":[${json}]};`)[0]).toHaveLength(
      points.length,
    );
  });

  it('does not read a scattering of markers as a route', () => {
    // Each point buried in its own marker's configuration, which is what
    // separates a pin from the line the pins sit on.
    const markers = route()
      .map(
        ([lat, lng], i) =>
          `new google.maps.Marker({position: {lat: ${lat}, lng: ${lng}}, title: "Parada ${i}", icon: "/pin.png"})`,
      )
      .join(';');

    expect(scriptPaths(markers)).toEqual([]);
  });

  it('ignores numbers that are not places in Zaragoza', () => {
    const elsewhere = Array.from(
      { length: 20 },
      (_, i) => `{lat: ${40.4 + i * 0.001}, lng: ${-3.7 + i * 0.001}}`,
    ).join(',');

    expect(scriptPaths(`[${elsewhere}]`)).toEqual([]);
  });

  it('reads nothing from a run too short to be a route', () => {
    expect(scriptPaths(`[${asLatLngObjects(route(4))}]`)).toEqual([]);
  });

  it('keeps two shapes drawn one after another apart', () => {
    // Three characters between the last point of one and the first of the
    // next, and they are still two shapes: a route beside an outline of the
    // city is not one run of points that is neither.
    const paths = scriptPaths(
      `[${asLatLngObjects(route(20))}];[${asLatLngObjects(route(16))}];`,
    );

    expect(paths.map((path) => path.length)).toEqual([20, 16]);
  });
});

describe('parseMapPath', () => {
  it('takes the longest shape the page draws', () => {
    const long = route(30);
    const short = route(14);

    const path = parseMapPath(
      page(
        `var area = [${asLatLngObjects(short)}];
         var line = [${asLatLngObjects(long)}];`,
      ),
    );

    expect(path).toHaveLength(long.length);
  });

  it('reads nothing from a page with no map on it', () => {
    expect(
      parseMapPath('<html><body><h1>Nuestra línea</h1></body></html>'),
    ).toEqual([]);
  });
});

describe('mapDataLinks', () => {
  it("finds the operator's own map files", () => {
    expect(
      mapDataLinks(
        `<script>
           map.load("${site}/wp-content/uploads/linea1.kml");
           extra("${site}/wp-content/uploads/paradas.geojson");
         </script>`,
        `${site}/nuestra-linea/`,
      ),
    ).toEqual([
      `${site}/wp-content/uploads/linea1.kml`,
      `${site}/wp-content/uploads/paradas.geojson`,
    ]);
  });

  it("leaves somebody else's files where they are", () => {
    expect(
      mapDataLinks(
        `<script src="https://maps.googleapis.com/maps/api/config.json"></script>`,
        `${site}/nuestra-linea/`,
      ),
    ).toEqual([]);
  });

  it('leaves alone a link that is not a map file', () => {
    expect(
      mapDataLinks(
        `<a href="${site}/nuestra-linea/plano.pdf">Plano</a>`,
        `${site}/nuestra-linea/`,
      ),
    ).toEqual([]);
  });
});
