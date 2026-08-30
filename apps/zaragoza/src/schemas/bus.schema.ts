import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type BusStationDocument = BusStation & Document;

@Schema({ collection: 'bus_stations' })
export class BusStation {
  @Prop({ required: true, unique: true })
  id: string;

  @Prop({ required: true })
  street: string;

  @Prop({ type: [String], default: [] })
  lines: string[];

  @Prop({
    type: [{ destination: String, line: String, time: String }],
    default: [],
  })
  times?: StationTime[];

  @Prop({ type: [String], default: [] })
  coordinates: string[];

  @Prop()
  source?: string;

  @Prop()
  sourceUrl?: string;

  @Prop()
  lastUpdated?: string;

  @Prop()
  type?: string;
}

export const BusStationSchema = SchemaFactory.createForClass(BusStation);

export type BusLineDocument = BusLine & Document;

@Schema({ collection: 'bus_lines' })
export class BusLine {
  @Prop({ required: true, unique: true })
  id: string;

  @Prop({ required: true })
  name: string;

  @Prop()
  color?: string;

  @Prop({ type: [String], default: [] })
  stations: string[];

  @Prop({ type: [String], default: [] })
  stationsReturn?: string[];

  /**
   * The source stopped offering this line: it has been withdrawn from the
   * network. Distinct from having no route to draw, which is derived from
   * `stations` — one recovers when the dropdown lists the line again, the
   * other the moment a route file parses.
   */
  @Prop({ default: false })
  withdrawn: boolean;

  @Prop({ required: true })
  lastUpdated: string;
}

export const BusLineSchema = SchemaFactory.createForClass(BusLine);

export type BusAlertDocument = BusAlert & Document;

/**
 * A service alteration published by the operator, kept as the listing gives
 * it: a headline, the article that explains it and the lines it names. An
 * alert is stored whether or not its lines are ones we know — an event line
 * the network never adds to its timetables still has an alteration to show.
 */
@Schema({ collection: 'bus_alerts' })
export class BusAlert {
  @Prop({ required: true, unique: true })
  id: string;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  url: string;

  /** The day it was announced, `YYYY-MM-DD`. The source publishes no end. */
  @Prop()
  date?: string;

  /** The lines the listing names as affected. */
  @Prop({ type: [String], default: [] })
  lines: string[];

  /** The stops the article names, resolved against the lines' routes. */
  @Prop({ type: [String], default: [] })
  stations: string[];

  /**
   * Whether the alteration stops at those stops, or reaches the whole of every
   * line it names. Only `'stations'` narrows the notice to some of a line's
   * stops; anything unread, diverted or doubtful stays `'line'`.
   */
  @Prop({ default: 'line' })
  scope?: 'stations' | 'line';

  /** When the alteration starts and ends, as the article gives them. */
  @Prop()
  startDate?: string;

  @Prop()
  endDate?: string;

  /**
   * The article as it read when it was last analysed, and when that was. An
   * article whose text has not changed is not read again — the same words
   * cannot yield different dates, and each reading costs a model call.
   */
  @Prop()
  articleHash?: string;

  @Prop()
  analyzedAt?: string;

  /**
   * The first update run that saw the alert listed, standing in for a date the
   * listing did not print or that could not be read.
   */
  @Prop()
  firstSeen: string;
}

export const BusAlertSchema = SchemaFactory.createForClass(BusAlert);

interface StationTime {
  destination: string;
  line: string;
  time: string;
}
