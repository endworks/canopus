export class Meaning {
  /**
   * Sense number.
   * @example '1'
   */
  number: string;

  /**
   * Grammatical category / usage label.
   * @example 'f.'
   */
  type: string;

  /**
   * Country / region label, when the sense is localised.
   * @example 'Esp.'
   */
  country?: string | null;

  /**
   * The definition text.
   * @example 'Edificio para habitar.'
   */
  definition: string;
}

export class Expression {
  /**
   * The complex form or fixed expression.
   * @example 'casa de citas'
   */
  expression: string;

  /** Meanings of the expression. */
  meanings: Meaning[];
}

export class SearchResult {
  /**
   * The searched term.
   * @example 'casa'
   */
  term: string;

  /**
   * Etymology note, when present.
   * @example 'Del lat. casa "choza".'
   */
  etymology: string;

  /** Senses of the term. */
  meanings: Meaning[];

  /** Complex forms built on the term. */
  complexForms: Expression[];

  /** Fixed expressions using the term. */
  expressions: Expression[];
}
