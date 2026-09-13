import {
  contentState,
  endPayload,
  epoch,
  startPayload,
  updatePayload,
} from './payloads';

const reading = (arrival: Date, words = '5 min.') => ({ arrival, words });

const aps = (payload: ReturnType<typeof updatePayload>) =>
  payload.aps as unknown as Record<string, unknown>;

describe('stale-date', () => {
  it('is dated from the reading, not from the arrival it names', () => {
    const taken = new Date('2026-09-13T10:00:00Z');
    const arrival = new Date('2026-09-13T10:20:00Z');
    const state = contentState(reading(arrival), taken);

    // Twenty minutes of countdown ahead of it, and the words are worth
    // repeating for two and a half minutes of that — not for all of it.
    expect(aps(updatePayload(state))['stale-date']).toBe(epoch(taken) + 150);
    expect(aps(updatePayload(state))['stale-date']).toBeLessThan(state.arrival);
  });
});

describe('an alert', () => {
  it('is carried only when there is something to say out loud', () => {
    const now = new Date();
    const state = contentState(reading(new Date(now.getTime() + 60_000)), now);

    expect(aps(updatePayload(state)).alert).toBeUndefined();
    expect(aps(updatePayload(state))['interruption-level']).toBeUndefined();

    const said = { title: 'Plaza de España', body: 'Line L1 is at the stop' };
    expect(aps(updatePayload(state, said)).alert).toEqual(said);
    expect(aps(updatePayload(state, said))['interruption-level']).toBe(
      'time-sensitive',
    );
    expect(aps(endPayload(state, said)).alert).toEqual(said);
  });
});

describe('startPayload', () => {
  it('names the app’s own attributes type, which ActivityKit matches on', () => {
    const now = new Date();
    const state = contentState(reading(new Date(now.getTime() + 300_000)), now);
    const attributes = {
      stop: 'Plaza de España',
      stopKey: 'bus:669',
      stopId: '669',
      kindKey: 'bus',
      line: '21',
      destination: 'Parque Goya',
    };

    const payload = aps(
      startPayload(attributes, state) as ReturnType<typeof updatePayload>,
    );
    expect(payload.event).toBe('start');
    // Spelled as the Swift struct is spelled: a miss here is silent.
    expect(payload['attributes-type']).toBe('DepartureAttributes');
    expect(payload.attributes).toEqual(attributes);
    expect(payload['content-state']).toEqual(state);
    expect(payload['stale-date']).toBe(state.taken + 150);
  });
});
