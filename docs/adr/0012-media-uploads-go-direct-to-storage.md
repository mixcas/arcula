# Media uploads go direct from the browser to storage

**Status**: accepted

A Collector recording an Artwork could not attach a photograph taken on a
phone. In production any upload over roughly 4.5 MB was refused with
`413 {"message":"Request Entity Too Large"}`, while the product states it
accepts 10 MB for an Artwork photo and 25 MB for an Artwork document. The
`413` was not ours: the app's envelope is `{"error":{code,message}}` and its
own size guard answers a `400` validation error. The ceiling was the request
path's — an HTTP API whose integration is a Lambda, whose synchronous
invocation payload is capped at 6 MB, reached after the multipart body was
base64-inflated by a third. Local development serves the API directly, which
is why the same file uploaded without complaint there. The latent half of the
bug is that the documented 25 MB document cap had never been reachable
either: scanned condition reports and catalogue pages over ~4.5 MB were
already broken and simply had not been hit yet.

The Staged → Promoted lifecycle, the previews, the ordering, the
discard-on-failure behaviour and the authorization boundary all stay exactly
as they were. Only the transport of the bytes changes.

## Decision

**The original goes browser → bucket, and never through the API.** The stage
route becomes a **presign** call: a JSON declaration (`entryId`,
`contentType`, `size`, optionally `name`) in, and a short-lived presigned `PUT`
URL, its method, its required headers, the staged object's proxy path and an
expiry out. The browser PUTs the file straight to that URL
(`apps/web/src/services/mediaService.ts`), with `credentials: "omit"` — the
URL is the whole authority for that one object, and the session cookie belongs
to the app's origin, not the bucket's.

**Validation is split across the two ends, and process is the authority.**
Presign judges the **declaration**: membership, the entry-id shape, the
declared content type against the population's allowlist, the declared size
against the population's cap. It refuses early, so a bad file costs no upload.
Process judges the **object** the server actually has: the stored content type
against the same allowlist, the object's own length against the same cap, and
decodability through the image pipeline. A forged declaration therefore buys
nothing — it can reach a failed process and an object the lifecycle sweep
removes, and no further.

**The URL is a bearer token with the smallest scope that works.** One method
(`PUT`), one staged key, one lifetime: `PRESIGNED_PUT_TTL_SECONDS`, 300 s. The
key is the existing per-uploader staging key, so a member's URL can only write
inside their own prefix. The URL is never logged and never put in an error
message; session replay redacts both the presign call, whose response body
contains it, and the bucket `PUT`
([ADR-0011](0011-session-replay-is-redacted-at-the-client.md)).

**The signature pins the type, the name, and nothing else.** `content-type` is
signed, so the object is stored with the type the media proxy will serve and a
client cannot obtain a URL for `image/jpeg` and upload `text/html`. The
original's filename is signed as `x-amz-meta-name`, because the process body
carries only the entry id and the answer must still name the original. It is a
header rather than a key segment (no user string becomes a path, the key
algebra's invariant) and rather than a query parameter (a filename in the URL
joins the token in every access log and replay). The SDK hoists
`x-amz-meta-*` into the query by default; `unhoistableHeaders` is what keeps
it in the request. `content-length` is deliberately **not** signed: it is a
forbidden header for `fetch`, which sets it or omits it depending on the
protocol, so a signed value would make the upload flaky. The size is enforced
from the declaration at presign and from the stored object's length at
process.

**The bucket admits exactly the signed set.** A CORS rule allows `PUT` from
the configured public origin with `content-type` and `x-amz-meta-name` — the
one hop that needs CORS at all, since the SPA and the API are same-origin by
design. CORS is not the authorization boundary; the URL is. The rule lives in
the CDK stack, so the in-process suite cannot exercise it: the deploy
verification pass asks the deployed bucket the same `OPTIONS` preflight a
browser would and fails honestly when storage refuses the origin, and the CDK
suite pins the rule's header list to the presigned set declared in
`packages/shared/src/stagedUpload.ts`, so a future signed header cannot land
in one place alone.

**The local stand-in proves usability, not refusal.** SeaweedFS runs
anonymous and does not verify signatures; it accepts a PUT with a mismatched
content type, a tampered signature, or none at all. The integration suite
therefore proves the URL our client mints is usable and that process re-derives
the truth from the stored object. Real S3's refusals are asserted where they
can be: on the URL's signed-header set, on the bucket's rule, and in the one
deployed preflight.

**Nothing else moves.** The save/promotion transaction, the media proxy's
per-request read authorization, the media namespace and the per-uploader
staging prefix are untouched; a transfer still moves no bytes. The `staging/`
lifecycle rule still expires abandoned uploads, including anything rejected
after it reached storage. There is no schema change, so the forward-only
migration rules are not triggered.

## Rejected alternatives

- **Raise the proxy ceiling, or move the API off Lambda** (Fargate, an ALB
  target, EC2). Lambda's synchronous payload limit is not a setting, and the
  one-Lambda-behind-one-HTTP-API shape is what makes the SPA and the API
  same-origin and cheap to run. Replacing the runtime to raise one limit is a
  new deploy shape and a new bill for a problem the browser can already solve.
- **Keep the multipart route and shrink files client-side.** Out of scope, and
  dishonest: it discards the original the product promises to keep, re-encoding
  degrades the photograph, and a scanned 25 MB PDF cannot be shrunk at all — the
  document cap would stay decorative.
- **Multipart-upload to storage for the big files.** S3 multipart needs a part
  plan, one presigned URL per part and bookkeeping to resume or abort. Under a
  25 MB ceiling a single presigned `PUT` is one URL and one request. Resumable
  uploads are the right answer when the caps grow, not before.
- **Stream the body through the Lambda.** The integration buffers the request
  and the payload cap applies before the handler runs; there is no streaming
  request body to hand Sharp. It would not remove the ceiling.
- **A presigned `POST` policy instead of a `PUT`.** A POST policy expresses
  size ranges and conditions, but it is an HTML-form protocol: it would mean a
  second encoding of the declaration and a form construction in the client, for
  the same guarantees the signed headers already give.
- **Put the filename in the query string.** The simplest signing story, and it
  puts user content in every access log, in history and in the session replay,
  beside a token that must not leak. A signed, unhoistable metadata header is
  the same information with a much smaller blast radius.
- **Sign `content-length` so storage refuses an oversize object.** It is a
  forbidden header for `fetch`; a browser cannot honour it. The cap is checked
  at presign over the declaration and again at process over the stored length,
  which is the only measurement that counts.
- **Check only at process.** A refused type or size would cost the user a full
  upload before the refusal arrived. The declaration check is free and answers
  in one round trip.

## Consequences

- **The declaration is not a measurement.** Presign answers without seeing a
  byte; everything the form records about the original — dimensions, stored
  size, stored type, name — comes from the process answer, which reads the
  object. A screen that trusts the declaration would be showing the client's
  claim.
- **The upload's four facts are now spread across two calls and one header.**
  The type and size are re-checked; the name is recorded on the object; the
  entry id is in both bodies. `media/stagedName.ts` owns the name's encoding
  and its tolerant default, and the shared signed-header list
  (`stagedUpload.ts`) owns the header names, so the route, the presigner and
  the bucket's rule cannot disagree.
- **CORS is deployment state, and it is tested where it lives.** The
  in-process suite cannot send a real preflight, so `deploy-verify.ts` probes
  the deployed bucket and reports "the check did not run" on a refusal rather
  than passing quietly, and `test:cdk` pins the rule to the signed set.
- **The refusal half of the signature is real-S3-only.** The local suite is
  green against a stand-in that verifies nothing; the deploy is where a wrong
  or missing signed header is refused. That asymmetry is recorded in the test
  headers rather than papered over.
- **The caps become real.** A 6 MB phone photo and a 20 MB scanned document
  now upload in production, which is what the 10 MB and 25 MB caps always
  promised.
- **Not built here.** Resumable or multipart-to-storage uploads, client-side
  resizing or re-encoding, a CDN in front of media, and any change to the media
  proxy's read authorization. The caps stay where they are.
