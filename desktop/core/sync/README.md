# Sync Seams

This directory hosts the seams that keep the door open for a future cloud-sync
layer without building the cloud side itself (YAGNI until the hosted app
exists). All seams here are no-ops in the desktop app — see
`LocalOnlySyncProvider`. A future cloud provider plugs in via the service
locator (`desktop/core/services-locator.ts`) without re-architecting the
Wave 3 services below.

## Seams

### Stable client-generated IDs

Every syncable row has a stable `id` column generated up-front by the caller.
`desktop/core/id.ts` exposes `generateId()` returning a 26-character ULID
(Crockford base32, 10-char millisecond time prefix + 16-char random suffix of
80 cryptographic bits). ULIDs sort lexicographically on time-of-birth, so a
later sync engine can stream ids without re-hashing. There are no
auto-increment PKs as the identity of a syncable entity — that would break
conflict-resolution. The repository layer (`desktop/core/repositories/`)
fills these in on `create`.

### `rev` / `createdAt` / `updatedAt`

Every aggregate root carries these three audit columns (the `Record`
interface in `shared/types/Record.ts`). The repository layer bumps `rev` on
every UPDATE and resets `updatedAt` to wall-clock ISO; `createdAt` never
changes after insert. A future sync engine reads these without per-aggregate
branching.

### `SyncProvider` interface + `LocalOnlySyncProvider`

`SyncProvider` declares a `pull()` and `push()` pair. `LocalOnlySyncProvider`
no-ops both. The service-locator singleton hosts the active instance; services
that ought to participate in sync resolve it via DI (`getSyncProvider()`)
rather than calling the network directly. A cloud provider reconciles
out-of-band; outbox / CRDT / OT are out of scope and explicitly not built
(YAGNI until the hosted app exists).

### `Workspace.origin` / `Workspace.syncMode`

`origin ∈ { 'local' | 'cloud' | 'team' }` and
`syncMode ∈ { 'none' | 'push' | 'bi-directional' }` are carried on the
`Workspace` aggregate (schema defaults: `'local'` / `'none'`). Future wire
operations consume these fields without a schema migration. They are
introduced fresh in Wave 1 of the refactor (not landscape-existing —
Metis flagged and corrected the strategy doc's phrasing about sync fields
"already being first-class").

## What this is NOT

- **Not a sync engine.** No outbox, no CRDT, no OT, no replay queue, no
  network client. The fields + the no-op interface are the entire surface
  built for now.
- **Not a real-time collab surface.** Live canvas edits are a later concern
  addressed by the executor's field-level JSON-patch writes (refactor
  decision #6: per-node class (b)+(c) writes).
- **Not a secret propagation path.** Secrets stay device-local by default;
  the keyfile under `userData` is never exported. Re-entered on a new device.

## Adding a cloud provider later

1. Implement `SyncProvider` against your cloud wire.
2. Register it via `setSyncProvider(provider)` at bootstrap
   (`desktop/electron/main.ts`), or rely on the lazy default of
   `LocalOnlySyncProvider`.
3. Wave 3 services already call `getSyncProvider()` and never branch on the
   concrete impl, so swapping is one line at the bootstrap site.

## Why no `rev` strict-etag yet

The `rev` column is written today and visible to future sync layers, but no
read path currently asserts rev equality (i.e., nobody inspects
"optimistic-lock mismatch" yet). Wire an `If-Match: <rev>` precondition check
in the repository `update` paths only once the cloud provider ships —
today it would only reject local edits and add zero correctness.
