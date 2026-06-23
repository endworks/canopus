/**
 * Shared RPC contract used across the Canopus gateway and microservices.
 * Keep this package decorator-free so any service can depend on it without
 * pulling in framework-specific packages (e.g. @nestjs/swagger).
 */

export * from './config';
export * from './patterns';
export * from './services';

/** Request payload for the message patterns that look up a record by id. */
export interface IdPayload {
  id: string;
}

/** Error half of a service's RPC response union. */
export interface ErrorResponse {
  statusCode: number;
  message: string;
  error?: string;
}
