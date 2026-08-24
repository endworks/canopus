import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type MovieDocument = Movie & Document;

@Schema({ _id: false })
export class Crew {
  @Prop({ required: true })
  name: string;

  @Prop()
  picture?: string;
}

export const CrewSchema = SchemaFactory.createForClass(Crew);

@Schema({ _id: false })
export class Actor extends Crew {
  @Prop()
  character?: string;
}

export const ActorSchema = SchemaFactory.createForClass(Actor);
@Schema({ _id: false })
export class Session {
  @Prop()
  id?: string;

  @Prop({ required: true })
  time: string;

  @Prop()
  screen?: string;

  @Prop()
  date?: string;

  @Prop()
  type?: string;

  @Prop()
  url?: string;

  @Prop()
  numbered?: boolean;
}

export const SessionSchema = SchemaFactory.createForClass(Session);

@Schema({ collection: 'movies' })
export class Movie extends Document {
  @Prop({ required: true, unique: true })
  id: string;

  @Prop({ required: true })
  name: string;

  @Prop()
  specialEdition?: string;

  @Prop()
  ageRating?: string;

  @Prop()
  minimumAge?: number;

  @Prop()
  sourceId?: string;

  @Prop()
  synopsis?: string;

  @Prop()
  duration?: number;

  @Prop()
  durationReadable?: string;

  @Prop({ type: CrewSchema })
  director?: Crew;

  @Prop({ type: [String], default: [] })
  genres?: string[];

  @Prop({ type: [ActorSchema], default: [] })
  actors?: Actor[];

  @Prop()
  poster?: string;

  @Prop()
  trailer?: string;

  @Prop()
  source?: string;

  // Extended movie fields
  @Prop({ required: true })
  originalName: string;

  @Prop({ type: [CrewSchema], default: [] })
  writers: Crew[];

  @Prop()
  theMovieDbId?: number;

  @Prop()
  imDbId?: string;

  @Prop()
  tagline: string | null;

  @Prop()
  budget: number;

  @Prop()
  revenue: number;

  @Prop()
  year: number;

  @Prop()
  releaseDate: string;

  @Prop()
  originalLanguage: string;

  @Prop()
  popularity: number;

  @Prop()
  voteAverage: number;

  @Prop()
  voteCount: number;
}

export const MovieSchema = SchemaFactory.createForClass(Movie);
