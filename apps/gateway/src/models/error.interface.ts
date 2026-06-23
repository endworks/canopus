/** Error shape every endpoint can return (produced by the services' RpcErrorFilter). */
export class ErrorResponse {
  statusCode: number;
  message: string;
  error?: string;
}
