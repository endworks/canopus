import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

import { ServiceAlertBase } from './alert.schema';
import { ServiceLineBase } from './line.schema';

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

/** The line shape every network shares, in the bus's own collection. */
@Schema({ collection: 'bus_lines' })
export class BusLine extends ServiceLineBase {}

export const BusLineSchema = SchemaFactory.createForClass(BusLine);

export type BusAlertDocument = BusAlert & Document;

/**
 * A service alteration the bus operator published, in the bus's own
 * collection. An alert is stored whether or not its lines are ones we know —
 * an event line the network never adds to its timetables still has an
 * alteration to show.
 */
@Schema({ collection: 'bus_alerts' })
export class BusAlert extends ServiceAlertBase {}

export const BusAlertSchema = SchemaFactory.createForClass(BusAlert);

interface StationTime {
  destination: string;
  line: string;
  time: string;
}
