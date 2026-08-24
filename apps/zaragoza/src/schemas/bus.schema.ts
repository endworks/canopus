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

interface StationTime {
  destination: string;
  line: string;
  time: string;
}
