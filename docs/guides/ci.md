# Run APIWeave Tests in CI

*How to run exported workflows and projects from the command line with `apiweave run`, so a CI pipeline can fail a build on a broken API. For anyone wiring APIWeave tests into GitHub Actions, GitLab CI or any other runner.*

## Prerequisites

- A workflow export (`.json`, from **Export** on the canvas) or a project bundle (`.awecollection`, from the project page). See [Projects](../features/projects.md) for exporting a bundle. A Postman Collection v2.1 runs too, converted on the fly; see [Migrate from Postman](migrating-from-postman.md).
- Node.js 22 or later on the machine that runs the tests.
- A checkout of the APIWeave repository to build the CLI from. It is not published to npm yet.

## How it works

`apiweave run` is a plain Node program: no Electron, no window and no APIWeave data folder. It reads the file you give it, imports it into a temporary in-memory database with the same importer the app uses, runs it with the same runner, prints the result and exits:

| Exit code | Meaning |
|---|---|
| `0` | Every run passed. |
| `1` | A test failed: a node or assertion failed, or the run was cancelled. |
| `2` | Usage or configuration error. Nothing was run. |

A Postman collection is converted exactly as the app's [Postman import](migrating-from-postman.md) converts it, then runs as a project; a Postman environment passed to `--env-file` becomes its environment, named `Postman: <environment name>`.

A project bundle runs as a project run: its enabled workflows, one after another, in the project's order. A workflow that fails stops the project unless its row is set to **Continue**. A workflow export runs that one workflow.

## Build the CLI

From the repository's `app/` folder:

```bash
npm ci --ignore-scripts   # --ignore-scripts skips the Electron download the CLI does not need
npm run build:cli         # writes dist/cli/apiweave.cjs
node dist/cli/apiweave.cjs run ../tests/api.awecollection --env Staging
```

During development, `npm run cli -- run <file> ...` builds and runs in one step. `npm link` inside `app/` puts an `apiweave` command on your `PATH`.

## Run a file

```bash
apiweave run api.awecollection --env Staging
apiweave run api.awecollection --workflow "Create order" --env Staging
apiweave run login.json --var baseUrl=http://localhost:8080
```

| Option | What it does |
|---|---|
| `-w, --workflow <name\|id>` | Run one workflow of a project bundle, by name or by its id in the bundle. |
| `-e, --env <name>` | Run against this environment from the file. Without it, each workflow uses the environment it was saved with. |
| `--env-file <file>` | Environment variables from a JSON object or a dotenv file, layered on the environment. For a Postman collection, a Postman environment export. |
| `--var <key=value>` | Set one environment variable (`{{env.key}}`). Repeatable; wins over `--env-file`. |
| `--secret <NAME=value>` | A secret value (`{{secrets.NAME}}`). Repeatable. |
| `--secrets-file <file>` | Secret values from a JSON object or a dotenv file. |
| `-r, --reporter <list>` | `cli`, `junit`, `html`, comma separated. Default `cli`. |
| `--reporter-junit-export <path>` | Where to write JUnit XML (default `apiweave-report.xml`). Naming a path turns the JUnit report on. |
| `--reporter-html-export <path>` | Where to write the HTML report (default `apiweave-report.html`). Naming a path turns the HTML report on. |
| `-d, --iteration-data <file>` | Run once per row of a CSV or JSON array file; each row's values are `{{data.<column>}}`. See [Data-driven runs](#data-driven-runs). |
| `-n, --iteration-count <n>` | Run `n` times; with `--iteration-data`, its first `n` rows. |
| `--bail` | Stop a project run at its first failed workflow, whatever its row says, and a data-driven run at its first failed iteration. |
| `--timeout-request <ms>` | Timeout for every request, replacing each node's own timeout. |
| `-k, --insecure` | Do not verify TLS certificates (self-signed test servers). |
| `--proxy <url>` | Send every request through this proxy. Default: the `HTTPS_PROXY` (or `HTTP_PROXY`) variable. See [Network](#network-proxy-and-certificates). |
| `--ca-cert <file>` | Also trust this CA certificate (PEM). Repeatable. |
| `--use-system-ca` | Also trust the operating system's certificate store. |
| `--client-cert <spec>` | Present a client certificate (mTLS) to a host. Repeatable. See [Network](#network-proxy-and-certificates). |

`--env-file`, `--var` and secret values stay in memory for the run. Nothing is written to disk except the reports you ask for.

The console report lists each workflow, a line per step with its time, and the failure message and failed assertion rules under a failed step, then a summary table. It uses colour only on a terminal, and never when `NO_COLOR` is set. The JUnit and HTML files are the same reports the app exports; see [Run reports](../features/visualization-and-debugging.md#5-run-reports-junit-and-html).

## Data-driven runs

`--iteration-data` runs the file once per row of a data file, the way `newman run -d` does:

```bash
apiweave run api.awecollection --env Staging --iteration-data users.csv --reporter cli,junit
```

A CSV file's header row names the columns; a JSON file is an array of objects. Iterations run one after another, each reading its row as `{{data.<column>}}`; a project bundle runs the whole project per row. The exit code is `1` if any iteration failed, and `--bail` stops at the first one that does. The console report adds an **Iterations** row to its summary, and the JUnit report has one `<testsuite>` per workflow per iteration, named `Health check [iteration 2]`.

Data values are not masked. Keep credentials in secrets (`--secret`, `APIWEAVE_SECRET_<NAME>`), not in the data file. See [Data-Driven Runs](../features/data-driven-runs.md).

## Secrets

Bundles carry secret names only, never values, so CI supplies them. Each `{{secrets.NAME}}`, and each secret a [script](../features/scripting.md) reads with `aw.secrets.get("NAME")`, is read from, in rising priority:

1. `--secrets-file`
2. the environment variable `APIWEAVE_SECRET_NAME`
3. `--secret NAME=value`

```bash
export APIWEAVE_SECRET_API_TOKEN="$TOKEN"
apiweave run api.awecollection --env Staging
```

Before anything is sent, the CLI checks every secret the workflows reference, Call Workflow targets included. If one is missing it exits `2` and names it:

```text
apiweave: missing secret API_TOKEN. Set APIWEAVE_SECRET_API_TOKEN, or pass --secret NAME=value or --secrets-file.
```

Secret values are masked in everything the CLI writes: console output, error messages and report files. As in the app, values shorter than four characters are not masked.

### OAuth 2.0

A client-credentials node runs as in the app: supply its client secret like any other secret. One token is fetched per `apiweave run` and reused by every request and iteration until it nears expiry. Fetched tokens are masked in the output too.

The CLI cannot sign in through a browser, so an authorization-code node takes a refresh token instead: set the node's token secret to it, and the CLI exchanges it for an access token before the first request.

```bash
export APIWEAVE_SECRET_API_OAUTH="$REFRESH_TOKEN"
```

The refreshed tokens are not saved anywhere. If your provider rotates refresh tokens on every use, the one you supplied stops working after one run: use a client-credentials client for CI where you can.

## Network: proxy and certificates

The CLI has the flags for what the app's [Settings > Network](../features/network.md) holds:

```bash
export HTTPS_PROXY=http://user:password@proxy.corp:3128
export NO_PROXY=localhost,.internal
export APIWEAVE_SECRET_CLIENT_PFX_PASSPHRASE="$PFX_PASSPHRASE"
apiweave run api.awecollection --env Staging \
  --ca-cert corp-root.pem \
  --client-cert "api.example.com=client.pem,client.key" \
  --client-cert "*.partner.example=partner.pfx,CLIENT_PFX_PASSPHRASE"
```

- **Proxy.** `--proxy <url>`, or else the `HTTPS_PROXY` / `https_proxy` variable, or else `HTTP_PROXY` / `http_proxy`, carries every request, http and https, through an http(s) proxy with `CONNECT`. Credentials go in the URL. `NO_PROXY` lists the hosts sent directly.
- **CAs.** `--ca-cert` adds a PEM CA certificate to the bundled roots; `--use-system-ca` adds the operating system's store, which is where a CI image usually installs a corporate root. `NODE_EXTRA_CA_CERTS` works too, as it does for any Node program.
- **Client certificates.** `--client-cert host=cert.pem,key.pem[,SECRET]` or `--client-cert host=client.pfx[,SECRET]`. The host may be `*.example.com` and may end in `:port`; the first matching flag is used. `SECRET` names the secret holding the key's or PFX's passphrase, supplied like any other secret (`APIWEAVE_SECRET_<NAME>`, `--secret`, `--secrets-file`), so it is masked in the output.

A file that cannot be read, a key that does not match its certificate or a wrong passphrase exits `2` before any request is sent.

## GitHub Actions

Commit the exported bundle to your repository, store each secret as a repository secret, and add a job:

```yaml
name: API tests
on: [push, pull_request]

jobs:
  api-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/checkout@v4
        with:
          repository: Kaysharp42/apiweave
          ref: main # pin a release tag or commit for repeatable builds
          path: .apiweave
      - uses: actions/setup-node@v4
        with:
          node-version: "24"
      - name: Build the APIWeave CLI
        working-directory: .apiweave/app
        run: npm ci --ignore-scripts && npm run build:cli
      - name: Run API tests
        env:
          APIWEAVE_SECRET_API_TOKEN: ${{ secrets.API_TOKEN }}
        run: >
          node .apiweave/app/dist/cli/apiweave.cjs run tests/api.awecollection
          --env Staging
          --reporter cli,junit,html
          --reporter-junit-export reports/apiweave.xml
          --reporter-html-export reports/apiweave.html
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: apiweave-reports
          path: reports/
```

The run step fails the job on exit code `1` or `2`. `if: always()` keeps the reports when it does. Any JUnit-aware test reporter action can read `reports/apiweave.xml`.

## Troubleshooting

- **If every request fails with an unresolved `{{env.…}}` placeholder**, the run had no environment holding that variable. Pass `--env <name>`, or supply the value with `--var` or `--env-file`.
- **If you get `environment 'X' is not in the file`**, the message lists the environments the file has. A workflow export only carries the environment it was saved with, and only when it was exported with its environment.
- **If a variable shows `<SECRET>` in the request**, the export replaced a secret-looking environment value with a placeholder. Supply the real value with `--var`, or move it to a secret.
- **If the CLI exits `2` with `Unknown option`**, check the spelling against `apiweave --help`.
- **If `npm ci` fails on `@apiweave/proto` with npm 12 or later**, allow the remote tarball: `npm config set allow-remote all` (what `scripts/setup.sh` does).
- **If a Call Workflow node fails with `Call Workflow node has no target workflow configured`**, its target was not in the file. A workflow export carries none of its Call Workflow targets: export the project that holds both workflows instead, and run the caller with `--workflow`.

## Related

- [Projects](../features/projects.md): project runs and `.awecollection` export.
- [Data-Driven Runs](../features/data-driven-runs.md): CSV and JSON data files and `{{data.<column>}}`.
- [Environments and Secrets](../features/environments-and-secrets.md): environments, secrets and how references resolve.
- [Visualization and Debugging](../features/visualization-and-debugging.md#5-run-reports-junit-and-html): what the JUnit and HTML reports contain.
