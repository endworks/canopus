import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

import { ServiceAlertBase } from './alert.schema';
import { ServiceLineBase } from './line.schema';

export type TramStationDocument = TramStation & Document;

@Schema({ collection: 'tram_stations' })
export class TramStation {
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

export const TramStationSchema = SchemaFactory.createForClass(TramStation);

export type TramLineDocument = TramLine & Document;

/**
 * The tram's line, in the tram's own collection.
 *
 * One document today, and stored rather than worked out on every read for the
 * same reason the bus's lines are: the stops it is built from change once an
 * update, and a reader asking for the line should not pay for the arithmetic
 * that put them in order.
 */
@Schema({ collection: 'tram_lines' })
export class TramLine extends ServiceLineBase {}

export const TramLineSchema = SchemaFactory.createForClass(TramLine);

export type TramAlertDocument = TramAlert & Document;

/** A service alteration the tram operator published, in its own collection. */
@Schema({ collection: 'tram_alerts' })
export class TramAlert extends ServiceAlertBase {}

export const TramAlertSchema = SchemaFactory.createForClass(TramAlert);

interface StationTime {
  destination: string;
  line: string;
  time: string;
}
