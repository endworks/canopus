import 'reflect-metadata';

import { ApnsService } from './apns/apns.service';
import { FcmService } from './fcm/fcm.service';
import { ClientKeys } from './services/client-keys';

/**
 * What the injector will be asked to build, checked before it is asked.
 *
 * This exists because of an outage. `ApnsService` read its four settings as
 * defaulted constructor parameters — `teamId = process.env.APNS_TEAM_ID ?? ''`
 * and so on — which reads like a default and compiles like a dependency: tsc
 * writes a `design:paramtypes` entry for every constructor parameter, an
 * inferred type lands there as `Object`, and the injector goes looking for a
 * provider registered under `Object`. Nest 11 tolerated it. Nest 12 refuses,
 * nothing catches the refusal, and the process exits at boot — so the service
 * was gone from its network and the gateway answered 500 with ENOTFOUND.
 *
 * The build cannot catch this: the types are valid and the metadata is only
 * read at runtime. So it is asserted here, against the three services that
 * take their configuration from the environment rather than from injection.
 */
describe('providers the injector has to build', () => {
  it.each([[ApnsService], [FcmService], [ClientKeys]])(
    '%p asks for nothing injectable',
    (provider) => {
      const params: unknown[] =
        Reflect.getMetadata('design:paramtypes', provider) ?? [];
      expect(params).toEqual([]);
    },
  );

  it.each([[ApnsService], [FcmService], [ClientKeys]])(
    '%p constructs with nothing configured',
    (provider) => {
      // A machine with no secrets still runs: each of these says so once and
      // turns itself into a no-op rather than refusing to start.
      expect(() => new provider()).not.toThrow();
    },
  );
});
