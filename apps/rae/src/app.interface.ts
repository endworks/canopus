export interface ErrorResponse {
  statusCode: number;
  message: string;
  stack?: string;
}

export interface SearchPayload {
  term: string;
}

export interface SearchResponse {
  term: string;
  etymology: string;
  meanings: Meaning[];
  complexForms: Expression[];
  expressions: Expression[];
}

export interface Meaning {
  number: string;
  type: string;
  country?: string | null;
  definition: string;
}

export interface Expression {
  expression: string;
  meanings: Meaning[];
}
