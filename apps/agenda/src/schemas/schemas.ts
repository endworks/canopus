import { Schema } from 'mongoose';

/**
 * Every collection the agenda keeps (docs/agenda/data-model.md).
 *
 * Plain schemas rather than decorated classes: the documents are wide, mostly
 * nested, and typed once in `model/types.ts`. What a schema adds here is the
 * collection name, the string ids and the indexes every route depends on.
 * `strict: false` so a field the spec adds later is stored before its index is.
 */
const options = (collection: string) =>
  ({ collection, strict: false, timestamps: true, versionKey: false }) as const;

export const RAW_RECORD = 'RawRecord';
export const RawRecordSchema = new Schema(
  {
    source: { type: String, required: true },
    ref: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, required: true },
    hash: { type: String, required: true },
    firstSeenAt: Date,
    lastSeenAt: Date,
    goneAt: Date,
  },
  options('raw_records'),
);
RawRecordSchema.index({ source: 1, ref: 1 }, { unique: true });
RawRecordSchema.index({ source: 1, lastSeenAt: 1 });

export const IDENTITY = 'Identity';
export const IdentitySchema = new Schema(
  {
    source: { type: String, required: true },
    ref: { type: String, required: true },
    collection: { type: String, required: true },
    entityId: { type: String, required: true },
    method: { type: String, required: true },
  },
  { ...options('identities'), suppressReservedKeysWarning: true },
);
IdentitySchema.index({ source: 1, ref: 1, collection: 1 }, { unique: true });
IdentitySchema.index({ entityId: 1 });

export const SERIES = 'Series';
export const SeriesSchema = new Schema({ _id: String }, options('series'));
SeriesSchema.index({ slug: 1 }, { unique: true });

export const EVENT = 'Event';
export const EventSchema = new Schema({ _id: String }, options('events'));
EventSchema.index({ slug: 1 }, { unique: true });
EventSchema.index({ parentId: 1 });
EventSchema.index({ ancestorIds: 1 });
EventSchema.index({ seriesId: 1, 'span.starts': -1 });
EventSchema.index({ type: 1, 'span.ends': 1 });
EventSchema.index({ kinds: 1 });
EventSchema.index({ placeIds: 1 });
EventSchema.index({ visibility: 1, 'span.ends': 1 });

export const OCCURRENCE = 'Occurrence';
export const OccurrenceSchema = new Schema(
  { _id: String },
  options('occurrences'),
);
OccurrenceSchema.index({ localDate: 1, status: 1 });
OccurrenceSchema.index({ starts: 1 });
OccurrenceSchema.index({ ends: 1 });
OccurrenceSchema.index({ eventId: 1, starts: 1 });
OccurrenceSchema.index({ ancestorIds: 1, localDate: 1 });
OccurrenceSchema.index({ placeId: 1, starts: 1 });
OccurrenceSchema.index({ eventId: 1, sourceKey: 1 }, { unique: true });

export const PLACE = 'Place';
export const PlaceSchema = new Schema({ _id: String }, options('places'));
PlaceSchema.index({ slug: 1 }, { unique: true });
PlaceSchema.index({ geo: '2dsphere' }, { sparse: true });
PlaceSchema.index({ kinds: 1 });

export const RUN = 'Run';
export const RunSchema = new Schema(
  {
    source: String,
    startedAt: Date,
    finishedAt: Date,
    counts: Schema.Types.Mixed,
    errors: [Schema.Types.Mixed],
  },
  { ...options('runs'), suppressReservedKeysWarning: true },
);
RunSchema.index({ source: 1, startedAt: -1 });

/**
 * What people write (docs/agenda/content.md): one document per key and
 * collection, with the state it is in. Only `published` reaches the merge.
 */
export const EDITORIAL = 'EditorialDoc';
export const EditorialSchema = new Schema(
  {
    collection: { type: String, required: true },
    key: { type: String, required: true },
    state: { type: String, required: true },
    doc: { type: Schema.Types.Mixed, required: true },
    verified: Schema.Types.Mixed,
    reason: String,
    by: String,
    version: { type: Number, default: 1 },
  },
  { ...options('editorial'), suppressReservedKeysWarning: true },
);
EditorialSchema.index({ collection: 1, key: 1 }, { unique: true });
EditorialSchema.index({ collection: 1, state: 1 });

/** Every change a person made, whole: before and after, who, when and why. */
export const REVISION = 'Revision';
export const RevisionSchema = new Schema(
  {
    collection: { type: String, required: true },
    key: { type: String, required: true },
    op: { type: String, required: true },
    before: Schema.Types.Mixed,
    after: Schema.Types.Mixed,
    by: String,
    reason: String,
    at: { type: Date, required: true },
  },
  { ...options('revisions'), suppressReservedKeysWarning: true },
);
RevisionSchema.index({ collection: 1, key: 1, at: -1 });
RevisionSchema.index({ at: -1 });

/** What a person has to decide: a record that vanished, an edition gone stale. */
export const REVIEW = 'Review';
export const ReviewSchema = new Schema(
  {
    kind: { type: String, required: true },
    subject: { type: Schema.Types.Mixed, required: true },
    subjectKey: { type: String, required: true },
    detail: Schema.Types.Mixed,
    status: { type: String, required: true, default: 'open' },
    resolution: Schema.Types.Mixed,
  },
  options('reviews'),
);
ReviewSchema.index({ status: 1, kind: 1, createdAt: -1 });
ReviewSchema.index({ kind: 1, subjectKey: 1, status: 1 });

export const ALL_SCHEMAS = [
  { name: RAW_RECORD, schema: RawRecordSchema },
  { name: IDENTITY, schema: IdentitySchema },
  { name: SERIES, schema: SeriesSchema },
  { name: EVENT, schema: EventSchema },
  { name: OCCURRENCE, schema: OccurrenceSchema },
  { name: PLACE, schema: PlaceSchema },
  { name: RUN, schema: RunSchema },
  { name: EDITORIAL, schema: EditorialSchema },
  { name: REVISION, schema: RevisionSchema },
  { name: REVIEW, schema: ReviewSchema },
];
