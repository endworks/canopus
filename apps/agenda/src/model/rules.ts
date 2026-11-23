import { addDays, weekday } from './time';

/**
 * When a series' next edition is expected, from the calendar it keeps.
 *
 * docs/agenda/data-model.md, "Predicting the next edition". A rule is two date
 * expressions, evaluated for a year. Each is small, and they compose: Pilar is
 * "the Monday on or before 12 October, two days back", which no single kind
 * says by itself.
 */
export type DateExpr =
  | { fixed: { month: number; day: number }; yearOffset?: number }
  | { easter: number }
  | { weekday: number; onOrBefore?: DateExpr; onOrAfter?: DateExpr }
  | { offset: number; of: DateExpr }
  | { last: { weekday: number; month: number } }
  | {
      ifWeekday: { of: DateExpr; is: number[] };
      then: DateExpr;
      else: DateExpr;
    };

export interface DateRule {
  start: DateExpr;
  end: DateExpr;
}

export type Precision = 'day' | 'weekend' | 'month' | 'season';

const pad = (n: number) => String(n).padStart(2, '0');

/** Western Easter Sunday: the anonymous Gregorian algorithm. */
export const easterSunday = (year: number): string => {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${pad(month)}-${pad(day)}`;
};

export const evaluate = (expr: DateExpr, year: number): string => {
  if ('fixed' in expr) {
    return `${year + (expr.yearOffset ?? 0)}-${pad(expr.fixed.month)}-${pad(expr.fixed.day)}`;
  }
  if ('easter' in expr) return addDays(easterSunday(year), expr.easter);
  if ('offset' in expr) return addDays(evaluate(expr.of, year), expr.offset);
  if ('last' in expr) {
    const { month } = expr.last;
    const firstOfNext =
      month === 12 ? `${year + 1}-01-01` : `${year}-${pad(month + 1)}-01`;
    let date = addDays(firstOfNext, -1);
    while (weekday(date) !== expr.last.weekday) date = addDays(date, -1);
    return date;
  }
  if ('ifWeekday' in expr) {
    const date = evaluate(expr.ifWeekday.of, year);
    return evaluate(
      expr.ifWeekday.is.includes(weekday(date)) ? expr.then : expr.else,
      year,
    );
  }
  if ('weekday' in expr) {
    if (expr.onOrBefore) {
      let date = evaluate(expr.onOrBefore, year);
      while (weekday(date) !== expr.weekday) date = addDays(date, -1);
      return date;
    }
    if (expr.onOrAfter) {
      let date = evaluate(expr.onOrAfter, year);
      while (weekday(date) !== expr.weekday) date = addDays(date, 1);
      return date;
    }
  }
  throw new Error(`Not a date expression: ${JSON.stringify(expr)}`);
};

/** The rule's dates for the edition that starts in `year`. */
export const datesFor = (
  rule: DateRule,
  year: number,
): { startDate: string; endDate: string } => ({
  startDate: evaluate(rule.start, year),
  endDate: evaluate(rule.end, year),
});

/** The next edition by the rule that has not ended by `today`. */
export const nextByRule = (
  rule: DateRule,
  today: string,
): { startDate: string; endDate: string } => {
  const year = +today.slice(0, 4);
  // A year back too: Navidad's edition of one year ends in the next.
  for (const candidate of [year - 1, year, year + 1, year + 2]) {
    const dates = datesFor(rule, candidate);
    if (dates.endDate >= today) return dates;
  }
  throw new Error('A rule with no edition in three years');
};
