export class Meaning {
  number: string;
  type: string;
  country?: string | null;
  definition: string;
}

export class Expression {
  expression: string;
  meanings: Meaning[];
}

export class SearchResult {
  term: string;
  etymology: string;
  meanings: Meaning[];
  complexForms: Expression[];
  expressions: Expression[];
}
