import { Prop } from '@nestjs/mongoose';

/**
 * A service alteration published by an operator, kept as the listing gives it:
 * a headline, the notice that explains it and the lines it names.
 *
 * The fields are here rather than in each mode's schema because an alteration
 * is the same thing whoever publishes it — the bus operator and the tram one
 * both announce a headline, a link, a day and a set of lines, and both have
 * their notices read for dates and stops by the same reader. Two copies of
 * this were two schemas free to drift into disagreeing about what an alert is,
 * which is the thing a client reading both of them cannot cope with.
 *
 * Each mode subclasses it for its own collection; nothing stores this class.
 */
export class ServiceAlertBase {
  @Prop({ required: true, unique: true })
  id: string;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  url: string;

  /** The day it was announced, `YYYY-MM-DD`. The sources publish no end. */
  @Prop()
  date?: string;

  /** The lines the listing names as affected. */
  @Prop({ type: [String], default: [] })
  lines: string[];

  /** The stops the notice names, resolved against the lines' routes. */
  @Prop({ type: [String], default: [] })
  stations: string[];

  /**
   * Provisional stops the alteration puts on, as the notice names them. Text,
   * not ids: a stop that exists only while the works do is on no route.
   */
  @Prop({ type: [String], default: [] })
  addedStations: string[];

  /**
   * Whether the alteration stops at those stops, or reaches the whole of every
   * line it names. Only `'stations'` narrows the notice to some of a line's
   * stops; anything unread, diverted or doubtful stays `'line'`.
   */
  @Prop({ default: 'line' })
  scope?: 'stations' | 'line';

  /** When the alteration starts and ends, as the notice gives them. */
  @Prop()
  startDate?: string;

  @Prop()
  endDate?: string;

  /**
   * The notice as it read when it was last analysed. One whose text has not
   * changed is not read again — the same words cannot yield different dates,
   * and each reading costs a model call.
   */
  @Prop()
  articleHash?: string;

  /**
   * The first update run that saw the alert listed, standing in for a date the
   * listing did not print or that could not be read.
   */
  @Prop()
  firstSeen: string;
}
