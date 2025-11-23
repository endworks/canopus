import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

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
    default: []
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

interface StationTime {
  destination: string;
  line: string;
  time: string;
}
