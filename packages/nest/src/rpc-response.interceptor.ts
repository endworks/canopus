import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/**
 * Gateway-side global interceptor. When a backend returns an error-shaped
 * response (`{ statusCode, ... }`), reflect that status onto the outgoing HTTP
 * response, so gateway handlers no longer thread `res` through and set the
 * status by hand.
 */
@Injectable()
export class RpcResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const res = context.switchToHttp().getResponse<{ statusCode: number }>();
    return next.handle().pipe(
      map((body) => {
        const statusCode = (body as { statusCode?: number })?.statusCode;
        if (typeof statusCode === 'number') {
          res.statusCode = statusCode;
        }
        return body;
      }),
    );
  }
}
