# Encryption

*How APIWeave protects secret values end to end. Covers the hybrid envelope model (sealed-box client submission plus AES-256-GCM at-rest storage), the `SECRET_ENCRYPTION_KEY` setup, key rotation, the threat model, and the path to workspace-scoped keys in a future release.*

## Prerequisites

- [Security Guide](security.md) for the cross-cutting posture and the deployment security checklist.
- [Environments and Secrets](../features/environments-and-secrets.md) for how secret keys are declared and used in `{{secrets.NAME}}` placeholders.
- [Authentication](authentication.md) for the `SESSION_SECRET_KEY` and `SECRET_KEY` variables that this guide builds on.
- A secret manager (HashiCorp Vault, AWS Secrets Manager, KMS-backed) for the master encryption key.

## Table of Contents

- [The Hybrid Model](#the-hybrid-model)
- [Configuration](#configuration)
- [Rotation](#rotation)
- [Threat Model](#threat-model)
- [Workspace Migration Path](#workspace-migration-path)
- [Troubleshooting](#troubleshooting)
- [Related](#related)

## The Hybrid Model

APIWeave uses a two-layer envelope so that secret values can be submitted over the wire without ever sitting in plaintext on the API surface, and so that the database never holds a value the operator can read without a separate key.

**Client-side submission (sealed box).** When a secret value is submitted over HTTP, the client uses a Libsodium sealed box to encrypt the value against the instance's public key before the request leaves the browser or agent. The backend unwraps the sealed box with the matching private key and hands the plaintext to the envelope layer. The plaintext never appears in a network log or in an intermediate proxy.

**At-rest envelope (AES-256-GCM).** The backend generates a per-environment Data Encryption Key (DEK) and wraps it with a master Key Encryption Key (KEK). Each secret value is then encrypted with the DEK using AES-256-GCM authenticated encryption, and the wrapped DEK is stored alongside the ciphertext. The KEK lives in the deployment environment as `SECRET_ENCRYPTION_KEY` and never touches the database.

```text
client  --[sealed box]-->  backend  --[AES-256-GCM + wrapped DEK]-->  MongoDB
   |                          |
   |                          +-- KEK from SECRET_ENCRYPTION_KEY (env)
   +-- instance public key (rotatable, key_id addressed)
```

Every stored ciphertext carries the `kek_id` of the KEK that wrapped its DEK, so the resolver always knows which key to use. The full placeholder grammar and the order the runner resolves namespaces in is in the [Placeholders Reference](../reference/placeholders.md).

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

## Rotation

Two rotations are supported, and they do not require re-encrypting existing data on the spot.

**KEK rotation (master key).** Set a new `SECRET_ENCRYPTION_KEY` in the deployment secret manager and restart the backend. On startup, the new key is used to wrap any freshly generated DEK. Old ciphertexts keep their `kek_id` and continue to decrypt because the backend keeps the previous keys available through the `EncryptionKey` collection. A batch or lazy re-encryption job then rewrites the wrapped DEK to the new KEK in place; until that job runs, decryption is slower because it walks the key chain.

**DEK rotation (per environment).** Trigger a per-environment DEK rotation from the secret-management MCP tool, or call the rotation endpoint. The new DEK is generated, wrapped by the active KEK, and used for any new ciphertext. Old ciphertexts decrypt against the previous DEK by their `kek_id`. As with KEK rotation, a lazy re-encryption pass overwrites the old wrapped DEK in the background.

Inactive keys are kept deliberately so that reads succeed while a rotation is in progress. Cut inactive keys only after confirming that every stored ciphertext has been rewritten to the new key.

## Threat Model

The encryption defends against a specific set of threats. It is not a substitute for the broader security model in the [Security Guide](security.md).

What the encryption defends against:

- **Database backup leakage.** A backup of the MongoDB collection or a `mongodump` output is unreadable without `SECRET_ENCRYPTION_KEY` from the deployment environment.
- **Filesystem-level offline access.** An attacker with read access to the data directory but no access to the deployment environment sees only ciphertext, wrapped DEKs, and the public half of the sealed-box keypair.
- **Accidental exposure in logs or exports.** The plaintext only exists in the runtime path that resolves `{{secrets.NAME}}` into a request field. Logs, run history, and `.awecollection` exports see only the key name, never the value.

What the encryption does **not** defend against:

- **Full runtime compromise.** An attacker with code execution on the backend can read decrypted values from the resolver path or from the running process memory.
- **Insider with both database and environment access.** A privileged operator with read access to MongoDB and to the deployment secret manager can decrypt any stored value. The audit trail is the mitigation, not the cryptography.
- **Browser-side secret leakage.** If a secret value lands in a request field that is then echoed to a public log or to a third-party service, the encryption does not help. The masking layer in the [Security Guide](security.md) covers the redaction path.

## Workspace Migration Path

The current deployment ships a single instance-wide sealed-box keypair and a single instance-wide KEK. The data model already addresses keys by `key_id`, and the resolver reads `kek_id` from the stored ciphertext, so the move to workspace-scoped keys is an additive change with no placeholder-syntax impact.

When workspace profiles land, the planned path is:

- Add a `key_id` to the workspace record and let each workspace carry its own sealed-box keypair and KEK.
- The resolver looks up the key by `workspace_id` first, then falls back to the instance-wide key for the bootstrap period.
- Existing ciphertexts keep their `kek_id` and decrypt against the instance key until a migration job re-wraps the DEK under the workspace KEK.
- The placeholder syntax does not change. Workflows continue to write `{{secrets.NAME}}` and the runner resolves against the active environment's workspace.

This keeps the migration transparent to workflow authors and to the canvas UI. The contract change is in the backend key-resolution code and in the key-management MCP tools, not in the user-facing placeholder grammar.

## Troubleshooting

- **If the backend refuses to start in production** with a `SECRET_ENCRYPTION_KEY` error, the variable is missing, empty, or does not decode to 32 bytes. Generate a fresh value with `openssl rand -base64 32`, set it in the secret manager, and restart.
- **If a stored secret returns the wrong value after a restart**, the master key changed between the time the value was written and the time it was read. Confirm `SECRET_ENCRYPTION_KEY` matches the value in use when the secret was created, or trigger a lazy re-encryption from the secret-management tool.
- **If `{{secrets.NAME}}` resolves to an empty string at run time**, the key is not declared on the active environment, or the active environment has no stored value for that key. Open the Environment Manager and confirm both the key name and the value.
- **If decryption fails with an authentication-tag error**, the stored ciphertext was tampered with, or the wrong KEK is being used. Restore from a known-good backup or rotate the affected environment's DEK.
- **If the auto-generated development key disappears on restart**, the secret values written against it are unreadable. Set a persistent `SECRET_ENCRYPTION_KEY` in development and re-enter the values.

## Related

- [Security Guide](security.md) for the broader production security model and the deployment checklist.
- [Environments and Secrets](../features/environments-and-secrets.md) for the per-environment secret declaration flow.
- [Authentication](authentication.md) for the related `SECRET_KEY` and `SESSION_SECRET_KEY` setup.
- [Deployment Guide](deployment.md) for the reverse proxy, environment loading, and operational checks.
- [Environment Variables Reference](../reference/environment-variables.md) for the full variable inventory.
