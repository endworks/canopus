import { LoggerModule } from 'nestjs-pino';

/**
 * Shared structured-logging module (pino). JSON by default so logs are
 * machine-parseable in production; set LOG_PRETTY=true locally for
 * human-readable output and LOG_LEVEL to tune verbosity. Each service imports
 * this and calls `app.useLogger(app.get(Logger))` in main.ts so Nest's own
 * logs (including the RpcErrorFilter) route through pino too.
 */
export const LoggingModule = LoggerModule.forRoot({
  pinoHttp: {
    level: process.env.LOG_LEVEL ?? 'info',
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie'],
      remove: true,
    },
    transport:
      process.env.LOG_PRETTY === 'true'
        ? { target: 'pino-pretty', options: { singleLine: true } }
        : undefined,
  },
});
