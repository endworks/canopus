# Media

Images, served by canopus itself: a new service, `apps/media`, deployed like
the others. It is built for the agenda, but it serves any service that wants
its pictures kept. zine's posters could move to it later.

## Why our own

- **The city's images expire with its records.** An archived edition whose
  pictures 404 is not an archive.
- **Sources' images are the wrong size.** Programme posters are portrait
  JPEGs of several megabytes, and a card wants 800 px of WebP.
- **One service in canopus is one more container,** deployed by the same
  workflow, on the same host. It needs no second provider, account or bill.

## What it does

```
 agenda ──TCP──▶ media.ingest(url | bytes, credit, licence)
                   │ fetch, hash, decode, strip metadata, make variants
                   ▼
                 store (GridFS or a volume)  ──▶  { id: 'med_<hash>', width, height }

 app ──HTTPS──▶ gateway GET /media/v1/{id}?w=800  ──TCP──▶ media.get  ──▶ bytes + immutable headers
```

## Ingest

- **Identity is the content hash.** The id is `med_` plus the first 32 hex
  characters of the original's SHA-256. The same picture from two sources
  is stored once. An id never points at different bytes, so a URL never
  changes meaning.
- **Fetch.** It follows at most three redirects, accepts up to 25 MB, and
  only `image/jpeg`, `png`, `webp`, `avif` and `gif` (first frame).
  Anything else is refused and logged in the caller's run.
- **Process with `sharp`:**
  - rotate by the EXIF orientation, then strip all metadata, location
    included;
  - convert to sRGB;
  - keep the original's dimensions for the record.
- **Variants, made at ingest, not on request:**
  - widths of 320, 800 and 1600 px, never upscaled;
  - each as WebP and as JPEG, for any client that cannot decode WebP.

  Six files per picture, made once, so a small host never resizes under
  load.
- **A record per picture,** in the `media` collection of the media
  service's own database:

  ```ts
  {
    _id: 'med_…', sha256: string
    mime: string, width: number, height: number, bytes: number
    variants: { w: number, format: 'webp' | 'jpeg', bytes: number, key: string }[]
    originalUrl?: string, credit?: string, licence?: string
    dominantColor: string        // '#c8102e': a placeholder while it loads
    blurhash?: string
    createdAt: Date, lastUsedAt: Date
  }
  ```

The original is kept too, for a future variant: a new width becomes a
backfill job, not a re-fetch from a source that may be gone.

## Serve

`GET /media/v1/{id}?w=320|800|1600&format=webp|jpeg`

- **Defaults:**
  - `w=800`;
  - `format` from `Accept` (WebP when the client accepts it, else JPEG);
  - a width that is not one of the three snaps up to the next.
- **Headers:**
  - `Cache-Control: public, max-age=31536000, immutable`;
  - an `ETag` equal to the variant's key;
  - `Vary: Accept` when the format was negotiated.
- **Unknown id:** `404`, with the same error envelope as the agenda.
- **The gateway streams the bytes** from the service. Gzip is off for
  these, since the images are compressed already.

The agenda's `Media.url` is this path, relative, so the API's host or a CDN
in front of it can change without touching stored data.

## Storage

The service uses a storage interface with two drivers:

| Driver | Where | When |
|---|---|---|
| `gridfs` | The existing MongoDB, bucket `media` | The default: no new infrastructure, and the MongoDB backups cover it |
| `volume` | A Docker volume on the host, `/data/media`, files named by key | When the MongoDB plan's storage is small or charged by the gigabyte |

The size to plan for, at the volume the agenda expects (about 5,000 new
pictures a year):

| | Per picture | Per year |
|---|---|---|
| Original | ~600 kB | ~3 GB |
| Six variants | ~250 kB | ~1.2 GB |

About 4 GB a year, all of it kept. That fits GridFS on any paid MongoDB.
It does not fit a free 512 MB tier: if the database is on one, use
`volume` from the start.

`MEDIA_STORAGE=gridfs|volume` chooses, and moving between them is a copy by
key: the ids, the URLs and the agenda's data do not change.

Moving to S3 or R2 later is a third driver behind the same interface, with
the same guarantee.

## Deploy

- **A new entry in `deploy.yml`'s service matrix:**

  ```
  media: {service:"media", image:"canopus-media", container:"canopus-media", port:"8882:3000", db:true, dockerfile:"Dockerfile"}
  ```

  With `volume` storage, its `docker run` also takes
  `-v canopus-media:/data/media`.
- **The same entry in `docker-compose.yml`.** Its header asks for both, and
  this service is one more reason to generate one from the other.
- **`sharp` is a native dependency.** The shared Dockerfile's build stage
  needs its prebuilt `linux-x64` binary, which `pnpm install` fetches on the
  runner. The runtime image must be glibc-based, not Alpine with musl,
  unless sharp's musl build is installed instead.

## A CDN in front

This is not required. Without it, the host serves every image itself, with
headers that let phones cache them for a year.

With Cloudflare in front of the gateway's domain on the free plan:

- the immutable image URLs are cached at the edge on the first request, and
  the host serves each variant about once per region;
- the agenda's feed is cached for its `max-age=300`.

It is a DNS change, not a code change, and it is worth making before Pilar
2027, when every phone in the city opens the same edition at once.

## Housekeeping

- **`lastUsedAt` is touched when the agenda publishes a reference.**
- **Nothing is deleted automatically,** because archived editions keep
  their pictures for good.
- **An admin route lists media no published document references.** A
  person decides what to remove.
