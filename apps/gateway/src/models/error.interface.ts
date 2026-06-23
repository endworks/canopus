/** Error shape every endpoint can return (produced by the services' RpcErrorFilter). */
export class ErrorResponse {
  /**
   * HTTP-style status code.
   * @example 404
   */
  statusCode: number;

  /**
   * Human-readable error message.
   * @example "Resource with ID '123' was not found"
   */
  message: string;

  /**
   * Short error label, when present.
   * @example 'Not Found'
   */
  error?: string;
}
