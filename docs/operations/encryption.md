# Encryption

*How APIWeave 2.0 protects secret values end to end. Covers the per-scope Libsodium keypairs, the write-only sealed-box ingress, the envelope model for at-rest storage, the master KEK, the keyring rotation flow, and the threats the model defends against.*

## Prerequisites

- [Security Guide](security.md) for the cross-cutting posture and the deployment security checklist.
- [Environments and Secrets](../features/environments-and-secrets.md) for the secret scopes, the override chain, and the metadata-only display.
- [Authentication](authentication.md) for the `SESSION_SECRET_KEY` and `SECRET_KEY` variables that this guide builds on.
- A secret manager (HashiCorp Vault, AWS Secrets Manager, KMS-backed) for the master encryption key.

## Table of Contents

- [The Hybrid Model](#the-hybrid-model)
- [Per-Scope Libsodium Keypairs](#per-scope-libsodium-keypairs)
- [Write-Only Ingress](#write-only-ingress)
- [Configuration](#configuration)
- [Rotation and the Keyring](#rotation-and-the-keyring)
- [Threat Model](#threat-model)
- [Related](#related)
- [Troubleshooting](#troubleshooting)

## The Hybrid Model

APIWeave 2.0 uses a two-layer envelope so that secret values can be submitted over the wire without ever sitting in plaintext on the API surface, and so that the database never holds a value the operator can read without a separate key.

**Client-side submission (sealed box).** When a secret value is submitted over HTTP, the client uses a Libsodium sealed box to encrypt the value against the scope's public key before the request leaves the browser or agent. The backend unwraps the sealed box with the matching private key and hands the plaintext to the envelope layer. The plaintext never appears in a network log or in an intermediate proxy. The browser or agent is the only place that ever holds the plaintext before submission.

**At-rest envelope (AES-256-GCM).** The backend generates a per-instance Data Encryption Key (DEK) and wraps it with a master Key Encryption Key (KEK). Each secret value is then encrypted with the DEK using AES-256-GCM authenticated encryption, and the wrapped DEK is stored alongside the ciphertext. The KEK lives in the deployment environment as `SECRET_ENCRYPTION_KEY` and never touches the database.

```text
client  --[sealed box]-->  backend  --[AES-256-GCM + wrapped DEK]-->  MongoDB
   |                          |
   |                          +-- KEK from SECRET_ENCRYPTION_KEY (env)
   +-- scope public key (rotatable, key_id addressed, keyring-backed)
```

Every stored ciphertext carries the `kek_id` of the KEK that wrapped its DEK and the `key_id` of the per-scope Libsodium keypair that protected the sealed box, so the resolver always knows which keys to use. The placeholder grammar and the resolution order the runner uses at run time is in the [Placeholders Reference](../reference/placeholders.md).

## Per-Scope Libsodium Keypairs

Every scope that can hold a secret has its own Libsodium keypair. Scopes are user, organization, workspace, and environment. The private key is held in the database as envelope-encrypted material under the master KEK. The public key is fetched through the scope's `get_public_key` endpoint and is safe to ship to clients.

Per-scope keypairs let you rotate a single scope without disturbing the others. A rotation writes a new keypair, adds the old private key to the keyring so existing ciphertexts can still be opened, and exposes the new public key to subsequent writes. Reads continue to work because the keyring carries the historical keys.

The per-scope design also lets you scope trust. A compromised browser session can write to a single scope; the rest of the surface is untouched. The audit log records the actor, the scope, and the public key fingerprint for every write so an investigator can confirm exactly which scope was touched.

## Write-Only Ingress

The secret service is the only path that accepts a secret value on the wire. The write path is sealed-box only. The backend rejects a plaintext value, a value encrypted against the wrong public key, or a sealed box whose payload is malformed.

```text
1. UI or agent fetches the scope's public key.
2. UI or agent encrypts the value with a Libsodium sealed box.
3. UI or agent POSTs the ciphertext to the secrets write endpoint.
4. Backend opens the sealed box with the scope's private key.
5. Backend re-encrypts the plaintext with the per-instance DEK wrapped by the master KEK.
6. Backend stores the envelope ciphertext. The plaintext is gone from memory.
```

After the write, the UI clears the in-memory value state. There is no read endpoint that returns a stored plaintext value. The list and detail endpoints return metadata only. Treat any tool that claims to return a plaintext value as a security bug.

## Configuration

`SECRET_ENCRYPTION_KEY` is the master KEK. It is a 32-byte value, base64-encoded, and is separate from `SECRET_KEY` and `SESSION_SECRET_KEY` so that the secret store can be rotated without invalidating sessions or breaking the application secret.

```bash
openssl rand -base64 32
```

Set the output in your deployment secret manager and load it into the backend environment. In development, leaving the variable empty makes the backend auto-generate an ephemeral key at startup. The auto-generated value is fine for local testing but is lost on restart, so any secret values set against it become unreadable across restarts.

```env
# Production
SECRET_ENCRYPTION_KEY=<output of openssl rand -base64 32>

# Development (auto-generated, ephemeral)
# SECRET_ENCRYPTION_KEY=
```

The backend rejects the startup in production mode if the variable is missing, empty, or does not decode to exactly 32 bytes. The full environment variable inventory is in the [Environment Variables Reference](../reference/environment-variables.md), and the deployment setup is in the [Deployment Guide](deployment.md).

The `SECRET_KEYRING_BACKEND` setting controls the keyring backend. The default is `mongodb`; the keyring stores the per-scope Libsodium keypairs (active and historical) in a MongoDB collection. Set it to `memory` only for ephemeral dev environments; restarting the backend loses the keyring and strands any ciphertexts that depended on a historical key.

## Rotation and the Keyring

Two rotations are supported, and they do not require re-encrypting existing data on the spot.

**Per-scope Libsodium keypair rotation.** Triggered from the secret-management UI for a single scope. The backend generates a new keypair, marks the old private key as historical, and stores it in the keyring. The new public key is exposed to subsequent writes. Existing ciphertexts keep their `key_id` and continue to decrypt because the resolver reads the keyring before failing.

**KEK rotation (master key).** Set a new `SECRET_ENCRYPTION_KEY` in the deployment secret manager and restart the backend. On startup, the new key is used to wrap any freshly generated DEK. Old ciphertexts keep their `kek_id` and continue to decrypt because the backend keeps the previous keys available through the `EncryptionKey` collection. A batch or lazy re-encryption job then rewrites the wrapped DEK to the new KEK in place; until that job runs, decryption is slower because it walks the key chain.

**DEK rotation (per instance).** Trigger a per-instance DEK rotation from the secret-management UI. The new DEK is generated, wrapped by the active KEK, and used for any new ciphertext. Old ciphertexts decrypt against the previous DEK by their `kek_id`. As with KEK rotation, a lazy re-encryption pass overwrites the old wrapped DEK in the background.

Inactive keys are kept deliberately so that reads succeed while a rotation is in progress. Cut inactive keys only after confirming that every stored ciphertext has been rewritten to the new key.

## Threat Model

The encryption defends against a specific set of threats. It is not a substitute for the broader security model in the [Security Guide](security.md).

What the encryption defends against:

- **Database backup leakage.** A backup of the MongoDB collection or a `mongodump` output is unreadable without `SECRET_ENCRYPTION_KEY` from the deployment environment. Per-scope private keys are also stored as envelope-encrypted material, so a backup alone cannot unseal sealed-box ciphertext either.
- **Filesystem-level offline access.** An attacker with read access to the data directory but no access to the deployment environment sees only ciphertext, wrapped DEKs, scope public keys, and the historical keyring entries (which are themselves sealed under the master KEK).
- **Accidental exposure in logs or exports.** The plaintext only exists in the runtime path that resolves `{{secrets.NAME}}` into a request field. Logs, run history, audit exports, and `.awecollection` v2 bundles see only the secret name and metadata, never the value or ciphertext.
- **Cross-scope blast radius.** Because each scope has its own keypair, a leak of one scope's private key does not unseal the ciphertexts of any other scope.

What the encryption does **not** defend against:

- **Full runtime compromise.** An attacker with code execution on the backend can read decrypted values from the resolver path or from the running process memory.
- **Insider with both database and environment access.** A privileged operator with read access to MongoDB and to the deployment secret manager can decrypt any stored value. The audit trail is the mitigation, not the cryptography.
- **Browser-side secret leakage.** If a secret value lands in a request field that is then echoed to a public log or to a third-party service, the encryption does not help. The masking layer in the [Security Guide](security.md) covers the redaction path.

## Related

- [Security Guide](security.md) for the broader production security model and the deployment checklist.
- [Environments and Secrets](../features/environments-and-secrets.md) for the per-scope secret declaration flow and the override chain.
- [Authentication](authentication.md) for the related `SECRET_KEY` and `SESSION_SECRET_KEY` setup.
- [Deployment Guide](deployment.md) for the reverse proxy, environment loading, and operational checks.
- [Environment Variables Reference](../reference/environment-variables.md) for the full variable inventory.

## Troubleshooting

- **If the backend refuses to start in production** with a `SECRET_ENCRYPTION_KEY` error, the variable is missing, empty, or does not decode to 32 bytes. Generate a fresh value with `openssl rand -base64 32`, set it in the secret manager, and restart.
- **If a stored secret returns the wrong value after a restart**, the master key changed between the time the value was written and the time it was read. Confirm `SECRET_ENCRYPTION_KEY` matches the value in use when the secret was created, or trigger a lazy re-encryption from the secret-management UI.
- **If a sealed-box write is rejected with a key-mismatch error**, the scope's public key rotated between the call to fetch the public key and the call to write. The UI retries automatically with the new public key; if the failure persists, reload the Secrets page to refetch.
- **If `{{secrets.NAME}}` resolves to an empty string at run time**, no scope in the override chain declared the key, or the stored ciphertext cannot be decrypted. Open Secrets for the selected environment, the workspace, and the organization (in that order), and confirm the key exists.
- **If decryption fails with an authentication-tag error**, the stored ciphertext was tampered with, or the wrong KEK is being used. Restore from a known-good backup or rotate the affected scope's keypair.
- **If the auto-generated development key disappears on restart**, the secret values written against it are unreadable. Set a persistent `SECRET_ENCRYPTION_KEY` in development and re-enter the values.
