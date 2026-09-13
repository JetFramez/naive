---
title: Uploads
---

`@jetframez/notio/upload` handles `multipart/form-data`: files stream to a temp directory (or stay in memory below a threshold), their type is detected from content rather than trusted from the client, and text fields validate through the ordinary `.body()` schema.

```ts
import { uploads } from "@jetframez/notio/upload";

app.use(uploads({ maxFileSize: "10mb", maxTotalSize: "50mb" }));

router
  .post("/products/:id/images")
  .body(z.object({ caption: z.string() }))
  .uploads({
    cover: { types: ["image/jpeg", "image/png"] },
    gallery: { types: ["image/*"], maxCount: 6, optional: true },
  })
  .handle(async (ctx) => {
    ctx.body.caption;              // validated text field, alongside the files
    ctx.uploads.cover;             // UploadedFile
    ctx.uploads.gallery;           // UploadedFile[] | undefined
    const path = await ctx.uploads.cover.move(`./storage/${ctx.params.id}/cover.jpg`);
    return { path };
  });
```

Calling `uploads(options)` installs the module immediately, as a side effect of the call; the `RequestHandler` it returns is inert and exists so `app.use(uploads())` reads naturally. A route that declares `.uploads()` before the module is installed fails at `createApp`'s `listen()` with an install message, not on the first request.

## Global options

| Option | Default | Meaning |
|---|---|---|
| `tempDir` | a `notio-uploads` directory under the OS temp dir | Where files are written. Each request gets its own subdirectory, named by request id. |
| `maxFileSize` | `"10mb"` | Default per-file limit. A field's own `maxSize` overrides it. |
| `maxTotalSize` | `"50mb"` | Combined limit across every file in one request. |
| `memoryThreshold` | `"0"` | Files at or under this size stay in memory (`buffer`, no `path`); larger files spill to disk. `"0"` means everything goes to disk. |
| `sweepAfter` | `"1h"` | On installation, request directories older than this are removed once (leftovers from a crash, not a running timer). |
| `types` | none | Default allowed MIME types for fields that do not declare their own. |
| `messages` | none | Default messages for fields that do not declare their own. |

All size and time options accept the usual duration and byte strings.

## Field options

```ts
.uploads({
  avatar: { maxSize: "5mb", types: ["image/jpeg", "image/png"] },
  gallery: { maxSize: "5mb", types: ["image/*"], maxCount: 6, optional: true },
})
```

- `maxSize`, `types`, `messages` override the global values for that field only: **field beats global beats built-in default**.
- Without `maxCount`, a field accepts exactly one file; declaring it makes the field an array, up to that count.
- `optional: true` allows the field to be absent; otherwise a missing field is `FILE_REQUIRED`.

## Type detection

`types` is checked against the type `file-type` detects from the file's leading bytes, never the `Content-Type` the client sent with the part. `"image/*"` and similar wildcards match by prefix. A format `file-type` cannot recognise (many plain-text formats) fails an unrestricted-looking check if `types` is set; leave `types` unset to accept anything content-sniffing cannot rule out.

## Issues

A validation failure throws `Unprocessable` (422) with `details: { in: "uploads", issues: [...] }`, the same shape every other section uses. One request can report several issues at once — one per offending field — except `TOTAL_SIZE_EXCEEDED`, which is request-wide and reported alone.

| Code | When |
|---|---|
| `FILE_TOO_LARGE` | A file exceeded its field's (or the global) `maxSize`. The stream is cut mid-write. |
| `FILE_TYPE_NOT_ALLOWED` | The detected type did not match `types`. |
| `TOO_MANY_FILES` | A field received more files than its `maxCount` (or more than one, without `maxCount`). |
| `FILE_REQUIRED` | A non-optional field had no file part at all. |
| `UNEXPECTED_FILE` | A file field was not declared in `.uploads()`. |
| `TOTAL_SIZE_EXCEEDED` | The request's combined file size exceeded `maxTotalSize`. |

`messages` maps these codes to a string or a `(meta) => string` function, where `meta` carries `code`, `field`, `filename`, and whichever of `limit`, `actual`, `allowed`, `detected` applies.

Order relative to the rest of validation: params, query and headers run first since they never depend on the body; then uploads; then `.body()`, since for a multipart request the body is the text fields uploads just collected. The first failing section wins, as everywhere else.

## `UploadedFile`

```ts
interface UploadedFile {
  field: string;
  filename: string;    // sanitised: no path components, no control characters
  mimeType: string;     // detected; "application/octet-stream" when undetectable and unrestricted
  size: number;
  path?: string;        // set when the file is on disk
  buffer?: Buffer;      // set when the file stayed in memory
  stream(): Readable;
  move(to: string): Promise<string>;
  keep(): void;
  discard(): Promise<void>;
}
```

Cleanup deletes every accepted file's temp copy once the response finishes or the connection closes, and removes the now-empty request directory. `move()` relocates the file (across devices if needed) and is exempt from cleanup; `keep()` leaves the file where it is, also exempt; `discard()` deletes it immediately. Files that failed validation are deleted as soon as they are rejected, not held until the end of the request.

## No storage backend, by design

The module has no dependency on any particular storage; `move()` is how a handler hands a file to S3, a database blob column, or permanent local storage. There is no built-in upload-to-cloud step — notio owns the multipart parsing and validation, and you own where the bytes end up. See [Design principles: own the interface, borrow the engine](/guide/about/principles#own-the-interface-borrow-the-engine).
