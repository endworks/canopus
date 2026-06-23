import { Controller, Get } from '@nestjs/common';
import { Transport } from '@nestjs/microservices';
import {
  HealthCheck,
  HealthCheckService,
  MicroserviceHealthIndicator,
} from '@nestjs/terminus';
import { ApiTags } from '@nestjs/swagger';
import { SERVICE_TOKENS, TCP_PORT } from '@canopus/shared';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly microservice: MicroserviceHealthIndicator,
  ) {}

  // Readiness: the gateway is only healthy if it can reach every backend over
  // TCP. (Container liveness is a separate, dependency-free Docker HEALTHCHECK.)
  @Get()
  @HealthCheck()
  check() {
    return this.health.check(
      Object.values(SERVICE_TOKENS).map(
        (token) => () =>
          this.microservice.pingCheck(token, {
            transport: Transport.TCP,
            options: { host: process.env[`${token}_HOST`], port: TCP_PORT },
            timeout: 3000,
          }),
      ),
    );
  }
}
