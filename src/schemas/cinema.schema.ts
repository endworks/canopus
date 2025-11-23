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

  @Prop()
  location?: string;

  @Prop()
  website?: string;

  @Prop()
  source?: string;

  @Prop({ required: true })
  lastUpdated: string;

  @Prop({ type: [String], default: [] })
  movies: string[];

  @Prop({ type: Map, of: [SessionSchema], default: {} })
  sessions: Record<string, Session[]>;
}

export const CinemaSchema = SchemaFactory.createForClass(Cinema);
