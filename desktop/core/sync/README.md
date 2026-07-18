# Sync Seams

This directory hosts the sync abstraction the desktop app uses to keep local
data and optional APIWeave Cloud data reconciled. The default active instance is
`LocalOnlySyncProvider`, a no-op used when no Cloud account is connected. When a
Cloud account is connected, the durable cloud transport in
`desktop/electron/cloud/CloudSyncProvider` is registered via the service locator
(`desktop/core/services-locator.ts`) and drives `pull()` and `push()` against
APIWeave Cloud. The Wave 3 services below resolve the active provider through DI
(`getSyncProvider()`) rather than calling the network directly, so swapping the
provider is a single line at the bootstrap site.

## Seams

### Stable client-generated IDs

Every syncable row has a stable `id` column generated up-front by the caller.
`desktop/core/id.ts` exposes `generateId()` returning a 26-character ULID
(Crockford base32, 10-char millisecond time prefix + 16-char random suffix of
80 cryptographic bits). ULIDs sort lexicographically on time-of-birth, so the
sync transport can stream ids without re-hashing. There are no auto-increment
PKs as the identity of a syncable entity — that would break conflict resolution.
The repository layer (`desktop/core/repositories/`) fills these in on `create`.

### `rev` / `createdAt` / `updatedAt`

Every aggregate root carries these three audit columns (the `Record` interface
in `shared/types/Record.ts`). The repository layer bumps `rev` on every UPDATE
and resets `updatedAt` to wall-clock ISO; `createdAt` never changes after
insert. The cloud provider reads these without per-aggregate branching.

### `SyncProvider` interface + `LocalOnlySyncProvider`

`SyncProvider` declares a `pull()` and `push()` pair. `LocalOnlySyncProvider`
no-ops both and is the default. The service-locator singleton hosts the active
instance; services that participate in sync resolve it via DI
(`getSyncProvider()`) rather than calling the network directly.
`CloudSyncProvider` reconciles out-of-band through the durable outbox and
cursor-based pull. Outbox / CRDT / OT remain out of scope: the wire uses
`expected_rev` precondition reconciliation, not CRDT or OT.

### `Workspace.origin` / `Workspace.syncMode`

`origin ∈ { 'local' | 'cloud' | 'team' }` and
`syncMode ∈ { 'none' | 'push' | 'bi-directional' }` are carried on the
`Workspace` aggregate (schema defaults: `'local' / 'none'`). Wire operations
consume these fields without a schema migration.

## What this is NOT

- **Not a real-time collab surface.** Live canvas edits are not a sync concern;
  the desktop canvas is single-user on the machine it runs on. The executor's
  field-level JSON-patch writes (refactor decision #6: per-node class (b)+(c)
  writes) handle local edits.
- **Not a secret propagation path.** Secret values stay device-local; the
  keyfile under `userData` is never exported and never synced. The cloud
  transport independently rejects payloads with `secrets` or `runs` fields, and
  secret values are re-entered on a new device. Cloud carries only secret
  references and structure.

## Registering the cloud provider

1. `CloudSyncProvider` in `desktop/electron/cloud/` implements `SyncProvider`
   with a durable outbox, cursor-based pagination, a Connect protocol client,
   encrypted device-token storage, and full-resync protocol.
2. It is registered via `setSyncProvider(provider)` at bootstrap
   (`desktop/electron/main.ts`) when a Cloud account is connected; otherwise
   the lazy default `LocalOnlySyncProvider` is used.
3. Wave 3 services already call `getSyncProvider()` and never branch on the
   concrete impl, so swapping is one line at the bootstrap site.
4. See `desktop/electron/cloud/README.md` for the transport, the outbox
   lifecycle, cursor semantics, and forbidden-payload rejection.

## Why no `rev` strict-etag yet

The `rev` column is written and consumed by the cloud transport's
`expected_rev` precondition on push, but no local read path asserts rev equality
(i.e., no local "optimistic-lock mismatch" check). Wire an `If-Match: <rev>`
precondition in the repository `update` paths only if a local-edit collision
case needs rejecting — today that would only reject local edits and add zero
correctness, since local edits are single-user on this machine.