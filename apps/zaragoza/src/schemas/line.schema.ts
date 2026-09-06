import { Prop } from '@nestjs/mongoose';

/**
 * A line of one of the city's networks: what it is called, where it calls, and
 * the shape it traces on the ground.
 *
 * The fields are here rather than in each mode's schema for the same reason
 * the alert's are: a bus line and a tram line are the same thing to everyone
 * downstream — a name, two legs of stops and two shapes — and a client drawing
 * one on a map should not have to learn which network it came from to read it.
 *
 * Each mode subclasses it for its own collection; nothing stores this class.
 */
export class ServiceLineBase {
  @Prop({ required: true, unique: true })
  id: string;

  @Prop({ required: true })
  name: string;

  @Prop()
  color?: string;

  /** The stops of the outbound leg, in the order the route runs them. */
  @Prop({ type: [String], default: [] })
  stations: string[];

  /**
   * The stops of the return leg, in the order that leg runs them.
   *
   * Not the outbound list reversed: a stop on the other side of the road, or
   * the far platform of a tram stop, is a different stop with a different
   * number, and a traveller sent to the wrong one watches their ride go past.
   */
  @Prop({ type: [String], default: [] })
  stationsReturn?: string[];

  /**
   * The shape the line traces on the ground, each leg its own, as
   * `[longitude, latitude]` pairs in the order the route runs them.
   *
   * Where a route file publishes one — every bus line has one — it is the
   * drawn shape, which is not the stops joined up: joining the stops draws a
   * line through whatever the bus drives around.
   */
  @Prop({ type: [[Number]], default: [] })
  path?: number[][];

  @Prop({ type: [[Number]], default: [] })
  pathReturn?: number[][];

  /**
   * The source stopped offering this line: it has been withdrawn from the
   * network. Distinct from having no route to draw, which is derived from
   * `stations` — one recovers when the source lists the line again, the other
   * the moment a route parses.
   */
  @Prop({ default: false })
  withdrawn: boolean;

  @Prop({ required: true })
  lastUpdated: string;
}
