import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type BiziStationDocument = BiziStation & Document;

@Schema({ collection: 'bizi_stations' })
export class BiziStation {
  @Prop({ required: true, unique: true })
  id: string;

  @Prop({ required: true })
  street: string;

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

export const BiziStationSchema = SchemaFactory.createForClass(BiziStation);
