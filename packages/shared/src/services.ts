/**
 * TCP transport facts shared by the gateway and every microservice. Kept as
 * plain data (no @nestjs imports) so this package stays framework-free; each
 * consumer builds the actual ClientsModule / microservice options from these.
 */

/** Port every microservice listens on, and the port the gateway dials. */
export const TCP_PORT = 3000;

/**
 * DI tokens for the gateway's ClientProxy to each backend service. The matching
 * host is read from the `${TOKEN}_HOST` env var
 * (e.g. ZARAGOZA_SERVICE -> ZARAGOZA_SERVICE_HOST).
 */
export const SERVICE_TOKENS = {
  zaragoza: 'ZARAGOZA_SERVICE',
  zine: 'ZINE_SERVICE',
  rae: 'RAE_SERVICE',
  twitterDownloader: 'TWITTER_DOWNLOADER_SERVICE',
} as const;
