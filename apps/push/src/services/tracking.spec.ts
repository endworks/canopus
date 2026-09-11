import {
  agrees,
  Departure,
  isArriving,
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

  it('will not step onto the bus behind as its own comes in', () => {
    // The one that never ended: theirs is a minute out, the next 21 is three
    // minutes behind it, and theirs drops off the board as it pulls in. Two
    // minutes of drift would call the next one theirs, re-anchor, and do it
    // again with the one after — a countdown that never arrives.
    const arriving = { ...follow, anchor: at(now, 1), taken: now };
    expect(
      identify(board(['21', 'Rosales', '3 min.']), arriving, at(now, 1)),
    ).toBeNull();
  });

  it('still lets a bus that is nearly here run a little late', () => {
    // Half a minute is always allowed, however short the wait: an estimate
    // that wobbles is not a different bus.
    const arriving = { ...follow, anchor: at(now, 1), taken: now };
    expect(
      identify(board(['21', 'Rosales', '1 min.']), arriving, at(now, 0.5)),
    ).not.toBeNull();
  });

  it('allows a long wait the full drift', () => {
    // Twenty minutes out, and the estimate slips two: still the same bus,
    // because a third of what is left is more than the cap.
    const distant = { ...follow, anchor: at(now, 20), taken: now };
    expect(
      identify(board(['21', 'Rosales', '21 min.']), distant, at(now, 0.75)),
    ).not.toBeNull();
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

  it('tells two buses of one line apart by where they sat', () => {
    // A line running every couple of minutes: both rows are within the drift
    // of the instant this reader's bus was due, so when it is due cannot
    // separate them. Theirs was the second, and the second it stays.
    const second = { ...follow, anchor: at(now, 4), taken: now, position: 1 };
    const reading = identify(
      board(['21', 'Rosales', '3 min.'], ['21', 'Rosales', '4 min.']),
      second,
      at(now, 0.25),
    );
    expect(reading?.words).toBe('4 min.');
    expect(reading?.position).toBe(1);
  });

  it('follows it down the list as the ones in front leave', () => {
    // Same pair, one sweep later, with the bus in front gone: theirs is now
    // the only row, and the position it reports moves with it.
    const second = { ...follow, anchor: at(now, 4), taken: now, position: 1 };
    const reading = identify(
      board(['21', 'Rosales', '3 min.']),
      second,
      at(now, 0.75),
    );
    expect(reading?.words).toBe('3 min.');
    expect(reading?.position).toBe(0);
  });
});

describe('isArriving', () => {
  it('is the words with no number in them', () => {
    // A bus standing at the pole. The tram has no such wording at all, which
    // is why this asks about the number rather than about the words.
    expect(isArriving('En parada')).toBe(true);
    expect(isArriving('Sin estimación')).toBe(true);
  });

  it('is a countdown that has reached nought', () => {
    expect(isArriving('0 min.')).toBe(true);
  });

  it('is not a bus that is still coming', () => {
    expect(isArriving('1 min.')).toBe(false);
    expect(isArriving('12 min.')).toBe(false);
  });

  it('does not depend on a wording the tram never uses', () => {
    // A tram counts to nought and then the row goes; it never prints
    // `En parada`. So nought is the vehicle coming in, and the row
    // disappearing afterwards is the arrival — see `answerLost`.
    expect(isArriving('0 min.')).toBe(true);
  });
});

describe('the limit of one vehicle', () => {
  const now = new Date('2026-09-11T08:00:00Z');
  const follow = {
    line: '21',
    destination: 'Rosales',
    anchor: at(now, 1),
    taken: now,
  };

  it('refuses a leap of four minutes on a bus that was nearly here', () => {
    // One minute becomes five: that is the next one. The reader's was pulling
    // in and has gone, which `answerLost` reads as the arrival it was.
    expect(
      identify(board(['21', 'Rosales', '5 min.']), follow, at(now, 0.5)),
    ).toBeNull();
  });

  it('holds a bus that slipped inside the limit', () => {
    // Two minutes late on a wait of ten is an estimate moving, not a
    // different vehicle: the cap is two minutes and the silence buys the rest.
    const patient = { ...follow, anchor: at(now, 10), taken: now };
    expect(
      identify(board(['21', 'Rosales', '12 min.']), patient, at(now, 0.5)),
    ).not.toBeNull();
  });

  it('refuses a leap past the cap however long the wait', () => {
    // Ten minutes becomes twenty on a fresh reading. Nothing loses ten
    // minutes in thirty seconds; that is the one behind it.
    const patient = { ...follow, anchor: at(now, 10), taken: now };
    expect(
      identify(board(['21', 'Rosales', '20 min.']), patient, at(now, 0.5)),
    ).toBeNull();
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
