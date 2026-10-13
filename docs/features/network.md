# Network: Proxy, Certificates and mTLS

*Settings > Network controls how every request leaves your machine: through a proxy, trusting extra certificate authorities, and presenting a client certificate to servers that require one (mutual TLS). The same options exist on the CLI as flags.*

## Prerequisites

- The proxy address your network requires, if any.
- Certificate files on disk: a CA certificate (PEM) for a private CA, and for mTLS a client certificate and key (PEM) or a PFX/PKCS#12 file.

## Table of Contents

- [What the settings apply to](#what-the-settings-apply-to)
- [Proxy](#proxy)
- [Trusted certificate authorities](#trusted-certificate-authorities)
- [Client certificates (mTLS)](#client-certificates-mtls)
- [Where the settings are stored](#where-the-settings-are-stored)
- [On the CLI](#on-the-cli)

## What the settings apply to

The settings are machine-wide: every HTTP Request and SSE Stream node in every workspace, OAuth 2.0 token requests, and OpenAPI imports from a URL. They are not part of any workflow, project bundle or export, so a bundle runs anywhere with that machine's network settings.

**Save** checks everything before it stores anything: each file is read, each certificate parsed, each key matched to its certificate and each passphrase tried. A problem is shown under the form and nothing changes. The new settings apply to the next request; requests already in flight finish on the old connections.

If a saved file later disappears or stops loading (a certificate moved, a key replaced), APIWeave starts with no network settings applied and the Network page shows why.

## Proxy

| Field | What it does |
| --- | --- |
| Proxy URL | `http://proxy.example.com:8080` or `https://…`. Every request, http and https, is tunnelled through it with `CONNECT`. Empty connects directly |
| Bypass the proxy for | Hosts sent directly, comma-separated in `NO_PROXY` syntax: `localhost`, `.example.com` (and its subdomains), `10.0.0.1`. Defaults to `localhost,127.0.0.1,[::1]` |
| Username / Password | Sent to the proxy as Basic `Proxy-Authorization`. Put them here, not in the URL |

The app ignores the `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` variables of its own process; only these settings decide. A SOCKS proxy, and NTLM or Kerberos proxy authentication, are not supported.

## Trusted certificate authorities

**Trust the operating system's certificates** is on by default: a server signed by a CA installed in the system store (Keychain, the Windows certificate store, `/etc/ssl` on Linux), such as a corporate root, is accepted on top of the CAs that ship with APIWeave. This is the way to trust a corporate CA in the packaged app, which ignores `NODE_EXTRA_CA_CERTS` (see [Release and updates](../reference/release-and-updates.md)).

**Add CA certificate (PEM)** trusts one more CA from a file, for a private CA that is not installed in the system store. A file can hold several certificates.

An HTTP node's **verify SSL** toggle still turns verification off for that node alone.

## Client certificates (mTLS)

Each entry presents a certificate to the hosts it names:

| Field | What it does |
| --- | --- |
| Host | `api.example.com`, or `*.example.com` for its subdomains, optionally with a port: `api.example.com:8443`. Without a port it matches every port |
| Certificate and Key (PEM) | The client certificate and its private key |
| Or PFX / PKCS#12 | Certificate and key in one `.pfx`/`.p12` file, in place of the two PEM files |
| Passphrase | For an encrypted key or PFX |

The first entry whose host matches the request's URL is used, per redirect hop. Files are chosen with the system file picker and referenced by path, so updating a file in place takes effect on the next save or launch.

## Where the settings are stored

The settings live in the app's local database. The proxy password and the certificate passphrases are encrypted with the secrets key (see [Environments and Secrets](environments-and-secrets.md)), each bound to its own entry, and are never sent back to the window: the form only says one is saved. Typing a new one replaces it; clearing the proxy username, or removing a certificate, deletes it.

The settings can only be changed from the Settings page. They are not reachable over [MCP](mcp-integration.md): an agent cannot point the runner at a proxy or change which servers it trusts.

## On the CLI

`apiweave run` takes the same options as flags (see [Running in CI](../guides/ci.md#network-proxy-and-certificates)):

```bash
apiweave run api.awecollection \
  --proxy http://proxy.corp:3128 \
  --ca-cert corp-root.pem \
  --client-cert "api.example.com=client.pem,client.key"
```

Without `--proxy`, the CLI uses the `HTTPS_PROXY` (or `HTTP_PROXY`) variable and honours `NO_PROXY`. Trusting the system store is off unless `--use-system-ca` is given.

## Related

- [Workflows and Nodes](workflows-and-nodes.md): the per-node **verify SSL** and **follow redirects** toggles.
- [Running in CI](../guides/ci.md): every `apiweave run` option.
