/**
 * S06 `cloud-boundary` — Cloud sync accepts structure and named secret
 * references, while secret values, run history and response bodies stay local.
 *
 * There is deliberately no scene here, and this file exists to say so rather
 * than leave the gap looking like an oversight.
 *
 * The claim is about a payload, not about a screen. The desktop app has no view
 * that renders a sync envelope, so any "screenshot" of one would be an invented
 * interface — banned by the media brief and by this tool's own rules. And a
 * raster image is the wrong medium for it anyway: the proof is a dozen lines of
 * mono text that must stay selectable, wrap on a narrow viewport, and be
 * readable with JavaScript disabled.
 *
 * So it ships as HTML from the marketing site, in the Cloud repo's
 * `components/marketing/cloud.tsx` proof callout, with the same fixture
 * vocabulary this tool uses: `secretRefs`, `QA_PASSWORD`, and the validation
 * policy that rejects `secrets` and `runs`. The authority for what Cloud
 * actually accepts is `apiweave-cloud/apps/api/internal/sync`, not a picture.
 */

export const CLOUD_BOUNDARY_HAS_NO_CAPTURE = true;
