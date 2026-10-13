// The public half of the Ed25519 key that signs APIWeave's update manifests.
// The release workflow signs with the private half (the
// UPDATE_SIGNING_PRIVATE_KEY secret), and the updater refuses to install any
// update this key does not verify. See docs/reference/release-and-updates.md.
//
// PLACEHOLDER: no key has been generated yet, so a build carrying this value
// refuses every update, and the release workflow refuses to publish one.
// Run `node scripts/generate-update-signing-key.mjs` from app/ to replace it.
export const UPDATE_SIGNING_PUBLIC_KEY: string = "PLACEHOLDER"
