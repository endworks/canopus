import {
  agrees,
  Departure,
  hasArrived,
  identify,
  minutesUntilDeparture,
  shownMinutes,
  slackFor,
} from './tracking';

const board = (...rows: [string, string, string][]): Departure[] =>
  rows.map(([line, destination, time]) => ({ line, destination, time }));

const at = (base: Date, minutes: number) =>
  new Date(base.getTime() + minutes * 60_000);

describe('minutesUntilDeparture', () => {
  it('reads the operator’s own words', () => {
    expect(minutesUntilDeparture('4 min.')).toBe(4);
    expect(minutesUntilDeparture(' 12 min.')).toBe(12);
  });

  it('has no answer where the operator gave no number', () => {
    // A bus standing at the stop is not nought minutes away in any sense the
    // caller can act on: nought is a bus that is here, and this cannot tell
    // the difference. See the same rule in Time.kt.
    expect(minutesUntilDeparture('En parada')).toBeNull();
    expect(minutesUntilDeparture('Sin estimación')).toBeNull();
  });

  it('refuses a number that meant something else', () => {
    expect(minutesUntilDeparture('120 min.')).toBeNull();
  });
});

describe('identify', () => {
  const now = new Date('2026-09-10T08:00:00Z');
  const follow = {
    line: '21',
    destination: 'Rosales',
    anchor: at(now, 4),
    taken: now,
  };

  it('follows the same bus as its wait comes down', () => {
    const reading = identify(
      board(['21', 'Rosales', '3 min.'], ['21', 'Rosales', '11 min.']),
      follow,
      at(now, 1),
    );
    expect(reading?.words).toBe('3 min.');
    expect(reading?.nextWords).toBe('11 min.');
  });

  it('holds a bus standing at the stop', () => {
    const reading = identify(
      board(['21', 'Rosales', 'En parada']),
      follow,
      at(now, 4),
    );
    expect(reading?.words).toBe('En parada');
  });

  it('calls it gone when the next one has taken its place', () => {
    // Two minutes ago it was four minutes away; now the soonest 21 is eight.
    // That is not ours running late, it is the one behind it.
    expect(
      identify(board(['21', 'Rosales', '8 min.']), follow, at(now, 2)),
    ).toBeNull();
  });

  it('calls it gone when the board stops listing it', () => {
    expect(
      identify(board(['23', 'Parque Goya', '2 min.']), follow, at(now, 1)),
    ).toBeNull();
  });

  it('allows a bus to lose time while nobody was reading', () => {
    // Ten minutes without a reading buys five minutes of lateness: a bus can
    // lose time in traffic, just never faster than the clock runs.
    expect(slackFor(10 * 60_000)).toBe(5 * 60_000);

    // Due at :12, and ten minutes later the soonest is six minutes out — :16,
    // four minutes late. Inside what the gap bought, so it is still ours.
    const quiet = { ...follow, anchor: at(now, 12), taken: now };
    expect(
      identify(board(['21', 'Rosales', '6 min.']), quiet, at(now, 10)),
    ).not.toBeNull();

    // The same jump between two readings a quarter of a minute apart is the
    // next bus: nothing loses six minutes in fifteen seconds.
    const fresh = { ...follow, anchor: at(now, 12), taken: at(now, 9.75) };
    expect(
      identify(board(['21', 'Rosales', '6 min.']), fresh, at(now, 10)),
    ).toBeNull();
  });

  it('follows the second of two, and not the one in front of it', () => {
    // The reader was at the pole as the first 21 pulled out, so theirs is the
    // one due at :12. A minute later the board still has both.
    const second = { ...follow, anchor: at(now, 12), taken: now };
    const reading = identify(
      board(['21', 'Rosales', '3 min.'], ['21', 'Rosales', '11 min.']),
      second,
      at(now, 1),
    );
    expect(reading?.words).toBe('11 min.');
    // And what is behind theirs is nothing, rather than their own bus.
    expect(reading?.nextWords).toBeUndefined();
  });

  it('keeps the second one once it becomes the first', () => {
    // The bus in front has gone and the board lists one 21. It is still due
    // when theirs was due, so it is still theirs.
    const second = { ...follow, anchor: at(now, 12), taken: now };
    const reading = identify(
      board(['21', 'Rosales', '8 min.']),
      second,
      at(now, 4),
    );
    expect(reading?.words).toBe('8 min.');
  });

  it('calls the second one gone when it leaves in its turn', () => {
    // Due at :12 and left; what the board lists now is the one after it.
    const second = { ...follow, anchor: at(now, 12), taken: at(now, 12) };
    expect(
      identify(board(['21', 'Rosales', '20 min.']), second, at(now, 13)),
    ).toBeNull();
  });

  it('names the bus behind the followed one, not the second on the board', () => {
    const second = { ...follow, anchor: at(now, 12), taken: now };
    const reading = identify(
      board(
        ['21', 'Rosales', '3 min.'],
        ['21', 'Rosales', '11 min.'],
        ['21', 'Rosales', '25 min.'],
      ),
      second,
      at(now, 1),
    );
    expect(reading?.words).toBe('11 min.');
    expect(reading?.nextWords).toBe('25 min.');
  });

  it('refuses a bus that is suddenly far sooner than the one followed', () => {
    // Theirs was due at :12 and the board now offers one four minutes out.
    // A bus does not arrive eight minutes early: that is a different one, and
    // taking it would move the reader's countdown onto a bus in front of them.
    const second = { ...follow, anchor: at(now, 12), taken: now };
    expect(
      identify(board(['21', 'Rosales', '3 min.']), second, at(now, 1)),
    ).toBeNull();
  });

  it('calls it gone after a silence it cannot have survived', () => {
    // Due at :04, read again at :10 with the soonest three minutes out. Ours
    // came and went while the phone was in a pocket; the countdown must not
    // quietly transfer itself to the next one.
    const quiet = { ...follow, anchor: at(now, 4), taken: now };
    expect(
      identify(board(['21', 'Rosales', '3 min.']), quiet, at(now, 10)),
    ).toBeNull();
  });
});

describe('hasArrived', () => {
  it('is the words with no number in them', () => {
    // A bus standing at the pole is the thing the reader was waiting for, and
    // the end of the follow rather than a stage of it.
    expect(hasArrived('En parada')).toBe(true);
    expect(hasArrived('Sin estimación')).toBe(true);
  });

  it('is a countdown that has reached nought', () => {
    expect(hasArrived('0 min.')).toBe(true);
  });

  it('is not a bus that is still coming', () => {
    expect(hasArrived('1 min.')).toBe(false);
    expect(hasArrived('12 min.')).toBe(false);
  });
});

describe('agrees', () => {
  const now = new Date('2026-09-10T08:00:00Z');

  it('says nothing when the board still says what the phone shows', () => {
    // A phone counting down to 3:15 is showing "4 minutes", and a board that
    // still says 4 min. has not contradicted it. Re-anchoring on that would
    // put the countdown back to 4:00 on every poll and it would never move.
    const follow = { anchor: at(now, 4), words: '4 min.' };
    expect(
      agrees(
        follow,
        { arrival: at(now, 4.75), words: '4 min.' },
        at(now, 0.75),
      ),
    ).toBe(true);
  });

  it('speaks up when the minutes have moved', () => {
    const follow = { anchor: at(now, 4), words: '4 min.' };
    expect(
      agrees(follow, { arrival: at(now, 2), words: '2 min.' }, at(now, 0.5)),
    ).toBe(false);
  });

  it('speaks up when the bus reaches the stop', () => {
    const follow = { anchor: at(now, 1), words: '1 min.' };
    expect(
      agrees(follow, { arrival: now, words: 'En parada' }, at(now, 0.5)),
    ).toBe(false);
  });

  it('speaks up when the one behind it changes', () => {
    const follow = {
      anchor: at(now, 4),
      words: '4 min.',
      nextWords: '11 min.',
    };
    expect(
      agrees(
        follow,
        { arrival: at(now, 4), words: '4 min.', nextWords: '9 min.' },
        now,
      ),
    ).toBe(false);
  });
});

describe('shownMinutes', () => {
  it('reads a countdown the way the reader does', () => {
    const now = new Date('2026-09-10T08:00:00Z');
    expect(shownMinutes(at(now, 3.25), now)).toBe(4);
    expect(shownMinutes(at(now, 0.5), now)).toBe(1);
    expect(shownMinutes(at(now, -2), now)).toBe(0);
  });
});
