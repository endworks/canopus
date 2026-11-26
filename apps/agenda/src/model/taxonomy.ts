/**
 * The codes every kind, place kind and notice kind is written in.
 *
 * Dotted and open (docs/agenda/README.md, decision 8): a client that meets
 * `music.cumbia` and knows only `music` draws a concert. A code is never
 * renamed or reused; one that has to go is marked deprecated with what
 * replaces it.
 *
 * `icon` is a Phosphor name, the set both apps already draw with.
 */
export interface TaxonomyEntry {
  code: string;
  label: { es: string; en: string };
  icon: string;
  deprecated?: true;
  replacedBy?: string;
}

const entry = (
  code: string,
  es: string,
  en: string,
  icon: string,
): TaxonomyEntry => ({ code, label: { es, en }, icon });

export const KINDS: TaxonomyEntry[] = [
  entry('music', 'Música', 'Music', 'music-notes'),
  entry('music.concert', 'Concierto', 'Concert', 'microphone-stage'),
  entry('stage', 'Artes escénicas', 'Performing arts', 'mask-happy'),
  entry('stage.theatre', 'Teatro', 'Theatre', 'mask-happy'),
  entry('stage.musical', 'Musical', 'Musical', 'mask-happy'),
  entry('stage.comedy', 'Humor', 'Comedy', 'smiley'),
  entry('dance', 'Danza', 'Dance', 'person-simple-tai-chi'),
  entry('circus', 'Magia y circo', 'Magic and circus', 'sparkle'),
  entry('exhibition', 'Exposición', 'Exhibition', 'frame-corners'),
  entry('film', 'Cine', 'Film', 'film-slate'),
  entry('family', 'En familia', 'For families', 'baby'),
  entry('tradition', 'Tradición', 'Tradition', 'flag-banner'),
  entry('tradition.parade', 'Desfile', 'Parade', 'flag-banner'),
  entry('festivity', 'Fiestas', 'Festivities', 'confetti'),
  entry('festivity.fireworks', 'Fuegos artificiales', 'Fireworks', 'fire'),
  entry('festival', 'Festival', 'Festival', 'ticket'),
  entry('religious', 'Acto religioso', 'Religious', 'church'),
  entry('bullfighting', 'Toros', 'Bullfighting', 'flag-pennant'),
  entry('market', 'Ferias y mercados', 'Fairs and markets', 'storefront'),
  entry('food', 'Gastronomía', 'Food and drink', 'fork-knife'),
  entry('sport', 'Deporte', 'Sport', 'soccer-ball'),
  entry('talk', 'Charlas', 'Talks', 'chats-circle'),
  entry('tour', 'Visitas', 'Tours', 'map-trifold'),
  entry('outdoors', 'Aire libre', 'Outdoors', 'tree'),
  entry('leisure', 'Ocio y juegos', 'Leisure and games', 'puzzle-piece'),
  entry(
    'course',
    'Cursos y talleres',
    'Courses and workshops',
    'chalkboard-teacher',
  ),
  entry('other', 'Otros', 'Other', 'calendar-blank'),
];

export const PLACE_KINDS: TaxonomyEntry[] = [
  entry('venue', 'Lugar', 'Venue', 'map-pin'),
  entry('venue.museum', 'Museo', 'Museum', 'bank'),
  entry('venue.theatre', 'Teatro', 'Theatre', 'mask-happy'),
  entry('venue.concert-hall', 'Auditorio', 'Concert hall', 'music-notes'),
  entry('venue.cinema', 'Cine', 'Cinema', 'film-slate'),
  entry('venue.library', 'Biblioteca', 'Library', 'books'),
  entry('venue.civic-centre', 'Centro cívico', 'Civic centre', 'buildings'),
  entry('venue.church', 'Iglesia', 'Church', 'church'),
  entry('venue.sports', 'Instalación deportiva', 'Sports venue', 'soccer-ball'),
  entry('venue.club', 'Discoteca', 'Club', 'disco-ball'),
  entry('landmark', 'Monumento', 'Landmark', 'castle-turret'),
  entry('area.square', 'Plaza', 'Square', 'map-pin-area'),
  entry('area.park', 'Parque', 'Park', 'tree'),
  entry('area.fairground', 'Recinto ferial', 'Fairground', 'ferris-wheel'),
  entry('stage.temporary', 'Escenario', 'Stage', 'speaker-high'),
];

export const NOTICE_KINDS: TaxonomyEntry[] = [
  entry(
    'mobility.street-closure',
    'Corte de calle',
    'Street closure',
    'traffic-cone',
  ),
  entry('mobility.diversion', 'Desvío', 'Diversion', 'arrow-bend-up-right'),
  entry(
    'mobility.special-service',
    'Servicio especial',
    'Special service',
    'bus',
  ),
  entry('discount', 'Descuento', 'Discount', 'tag'),
  entry(
    'accessibility.relaxed',
    'Horario sin ruido',
    'Quiet hours',
    'ear-slash',
  ),
  entry('info', 'Aviso', 'Notice', 'info'),
];

const known = new Set(
  [...KINDS, ...PLACE_KINDS, ...NOTICE_KINDS].map((e) => e.code),
);

/** A code we know, or its nearest known parent, or `other`. */
export const knownCode = (code: string): string => {
  for (
    let c = code;
    c;
    c = c.includes('.') ? c.slice(0, c.lastIndexOf('.')) : ''
  ) {
    if (known.has(c)) return c;
  }
  return 'other';
};
