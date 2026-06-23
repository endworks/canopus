import {
  ArgumentsHost,
  Catch,
  HttpException,
  Logger,
  RpcExceptionFilter,
} from '@nestjs/common';
import { ErrorResponse } from '@canopus/shared';
import { Observable, of } from 'rxjs';

/**
 * Service-side global filter. Turns a thrown HttpException (or any error) into
 * the `{ statusCode, message }` response the gateway expects, so RPC handlers
 * no longer each need a `.catch` that formats the error. It RETURNS the value
 * (rather than re-throwing over RPC), preserving the existing wire contract:
 * the gateway reads `response.statusCode` from a normal reply.
 */
@Catch()
export class RpcErrorFilter implements RpcExceptionFilter {
  private readonly logger = new Logger('Rpc');

  catch(exception: unknown, _host: ArgumentsHost): Observable<ErrorResponse> {
    const response: ErrorResponse =
      exception instanceof HttpException
        ? (exception.getResponse() as ErrorResponse)
        : {
            statusCode: 500,
            message:
              exception instanceof Error
                ? exception.message
                : String(exception),
          };
    this.logger.error(response.message);
    return of(response);
  }
}
