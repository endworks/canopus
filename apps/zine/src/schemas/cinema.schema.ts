import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { Session, SessionSchema } from './movie.schema';

export type CinemaDocument = Cinema & Document;

@Schema({ collection: 'cinemas' })
export class Cinema extends Document {
  @Prop({ required: true, unique: true })
  id: string;

  @Prop({ required: true })
  name: string;

  @Prop()
  address?: string;

  /**
   * `[longitude, latitude]`, as strings.
   *
   * The order and the type are what the clients already index into, so neither
   * is up for debate here. Filled at update time for any venue that arrives
   * without them — the listings carry no coordinates at all — and left alone
   * afterwards, because a cinema does not move.
   */
  @Prop({ type: [String], default: undefined })
  coordinates?: string[];

  @Prop()
  location?: string;

  @Prop()
  postalCode?: string;

  @Prop()
  town?: string;

  @Prop()
  website?: string;

  @Prop()
  source?: string;

  @Prop()
  lastUpdated?: string;

  @Prop({ type: [String], default: [] })
  movies: string[];

  @Prop({ type: Map, of: [SessionSchema], default: {} })
  sessions: Record<string, Session[]>;
}

export const CinemaSchema = SchemaFactory.createForClass(Cinema);
