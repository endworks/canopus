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

  /**
   * The same rack's number in the operator's own feed, worked out by position
   * when the stations were last updated. Stored rather than derived because
   * pairing needs every station of both sources at once, and a reader asking
   * after one station has neither.
   */
  @Prop()
  gbfsId?: string;

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
