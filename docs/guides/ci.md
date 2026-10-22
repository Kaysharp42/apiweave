# Run APIWeave Tests in CI

*How to run a workspace repository, an exported workflow or a project from the command line with `apiweave run`, so a CI pipeline can fail a build on a broken API. For anyone wiring APIWeave tests into GitHub Actions, GitLab CI or any other runner.*

## Prerequisites

- Something to run: a workspace repository (a folder holding `.apiweave/format.json`, see [Keep Tests in a Git Repository](git-workflows.md)), a workflow export (`.json`, from **Export** on the canvas) or a project bundle (`.awecollection`, from the project page). See [Projects](../features/projects.md) for exporting a bundle. A Postman Collection v2.1 runs too, converted on the fly; see [Migrate from Postman](migrating-from-postman.md).
- Node.js 22 or later on the machine that runs the tests.
- A checkout of the APIWeave repository to build the CLI from. It is not published to npm yet.

## How it works

`apiweave run` is a plain Node program: no Electron, no window and no APIWeave data folder. It reads the file or folder you give it, imports it into a temporary in-memory database with the same importer the app uses, runs it with the same runner, prints the result and exits:

| Exit code | Meaning |
|---|---|
| `0` | Every run passed. |
| `1` | A test failed: a node or assertion failed, or the run was cancelled. |
| `2` | Usage or configuration error. Nothing was run. |

A Postman collection is converted exactly as the app's [Postman import](migrating-from-postman.md) converts it, then runs as a project; a Postman environment passed to `--env-file` becomes its environment, named `Postman: <environment name>`.

A project bundle runs as a project run: its enabled workflows, one after another, in the project's order. A workflow that fails stops the project unless its row is set to **Continue**. A workflow export runs that one workflow.

A workspace repository runs every one of its projects the same way, one after another, as one report named after the workspace (see [Run a workspace repository](#run-a-workspace-repository)). Git is never involved: the CLI reads the files of a checkout and does not need git installed.

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
apiweave run ./tests --env Staging
apiweave run api.awecollection --env Staging
apiweave run api.awecollection --workflow "Create order" --env Staging
apiweave run login.json --var baseUrl=http://localhost:8080
```

| Option | What it does |
|---|---|
| `--project <name\|id>` | Run one project of a workspace repository, by name or id. Without it, every project runs. |
| `-w, --workflow <name\|id>` | Run one workflow of a repository (of the `--project` when given, else of the whole repository) or of a bundle, by name or by id. |
| `-e, --env <name>` | Run against this environment from the repository or file. Without it, each workflow uses the environment it was saved with. |
| `--env-file <file>` | Environment variables from a JSON object or a dotenv file, layered on the environment. For a Postman collection, a Postman environment export. |
| `--var <key=value>` | Set one environment variable (`{{env.key}}`). Repeatable; wins over `--env-file`. |
| `--secret <NAME=value>` | A secret value (`{{secrets.NAME}}`). Repeatable. |
| `--secrets-file <file>` | Secret values from a JSON object or a dotenv file. |
| `-r, --reporter <list>` | `cli`, `junit`, `html`, comma separated. Default `cli`. |
| `--reporter-junit-export <path>` | Where to write JUnit XML (default `apiweave-report.xml`). Naming a path turns the JUnit report on. |
| `--reporter-html-export <path>` | Where to write the HTML report (default `apiweave-report.html`). Naming a path turns the HTML report on. |
| `-d, --iteration-data <file>` | Run once per row of a CSV or JSON array file; each row's values are `{{data.<column>}}`. See [Data-driven runs](#data-driven-runs). |
| `-n, --iteration-count <n>` | Run `n` times; with `--iteration-data`, its first `n` rows. |
| `--bail` | Stop a project run at its first failed workflow, whatever its row says, a repository run at the first project that did not complete, and a data-driven run at its first failed iteration. |
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

A CSV file's header row names the columns; a JSON file is an array of objects. Iterations run one after another, each reading its row as `{{data.<column>}}`; a project bundle runs the whole project per row. A workspace repository runs one project per row, so with more than one project to run, pick it with `--project` (without it the CLI exits `2` and names the flag). The exit code is `1` if any iteration failed, and `--bail` stops at the first one that does. The console report adds an **Iterations** row to its summary, and the JUnit report has one `<testsuite>` per workflow per iteration, named `Health check [iteration 2]`.

Data values are not masked. Keep credentials in secrets (`--secret`, `APIWEAVE_SECRET_<NAME>`), not in the data file. See [Data-Driven Runs](../features/data-driven-runs.md).

## Secrets

Repositories and bundles carry secret names only, never values, so CI supplies them. Each `{{secrets.NAME}}`, and each secret a [script](../features/scripting.md) reads with `aw.secrets.get("NAME")`, is read from, in rising priority:

1. `--secrets-file`
2. the environment variable `APIWEAVE_SECRET_NAME`
3. `--secret NAME=value`

```bash
export APIWEAVE_SECRET_API_TOKEN="$TOKEN"
apiweave run api.awecollection --env Staging
```

Before anything is sent, the CLI checks every secret the workflows that will run reference, Call Workflow targets included. If one is missing it exits `2` and names it:

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

### AWS Signature V4

Signed requests run as in the app. Supply the secret access key (and the session token for temporary credentials) as secrets, for example from the credentials your CI's AWS role provides:

```bash
export APIWEAVE_SECRET_AWS_SECRET_ACCESS_KEY="$AWS_SECRET_ACCESS_KEY"
export APIWEAVE_SECRET_AWS_SESSION_TOKEN="$AWS_SESSION_TOKEN"
```

### Digest and JWT Bearer

Supply the Digest password or the JWT signing key like any other secret, `APIWEAVE_SECRET_<NAME>`. A PEM private key can be passed with real line breaks or with `\n` in their place:

```bash
export APIWEAVE_SECRET_JWT_SIGNING_KEY="$(cat signing-key.pem)"
```

Signed JWTs are masked in the output like secrets.

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

## Run a workspace repository

A workspace repository is a folder holding `.apiweave/format.json`, with one JSON file per project, workflow and environment (the layout is in [Keep Tests in a Git Repository](git-workflows.md)). Give `apiweave run` its path:

```bash
apiweave run ./tests --env Staging                        # every project
apiweave run ./tests --project "Shop API" --env Staging   # one project, by name or id
apiweave run ./tests --workflow "Login" --env Staging     # one workflow, in any project or none
```

- **Every project by default**, one after another, in the repository's own order (projects by id), as one report: the console summary has a **Projects** row, and the JUnit suites are always named `<project>: <workflow>`, because two projects can both hold a "Login" and a suite keeps its name whether or not the other projects ran. A project with no enabled workflow is skipped, with a line on stderr saying so. A workflow in no project is not part of a default run; `--workflow` reaches it.
- **`--project <name|id>`** runs one project. An unknown or ambiguous name exits `2` and lists the projects in the repository. A project with no enabled workflow exits `2` too, saying `project 'X' has no enabled workflows to run`. A single project reports as that project, and its suites are named after its workflows alone.
- **`--workflow <name|id>`** runs one workflow, of the `--project` when given and of the whole repository otherwise. An unknown or ambiguous name exits `2` and lists the candidates.
- **`--env`** names one of the repository's environments; `--env-file`, `--var` and secrets work as for any other file.
- **`--bail`** stops at the first project that did not complete, on top of stopping a project at its first failed workflow.
- **Exit codes** are the same: `0` passed, `1` a test failed in any project, `2` usage or configuration. An unreadable or invalid file exits `2` with its path in the message, and a folder without `.apiweave/format.json` exits `2` saying that file is missing.

A literal credential the repository withheld (`<SECRET>`) cannot authenticate a request; the CLI prints a warning on stderr for each workflow that holds one, whether or not it runs, and the fix is a `{{secrets.NAME}}` reference.

## GitHub Actions

Check out the repository the workspace is connected to (or a `.awecollection` bundle), store each secret as a repository secret, and add a job. The app pushes every commit to the connected remote, so the pipeline checks out the same repository you connected in [Connect a remote](git-workflows.md#connect-a-remote) — see [Get a repository into CI](git-workflows.md#get-a-repository-into-ci) for how that repository is kept up to date:

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
          path: .apiweave-cli
      - uses: actions/setup-node@v4
        with:
          node-version: "24"
      - name: Build the APIWeave CLI
        working-directory: .apiweave-cli/app
        run: npm ci --ignore-scripts && npm run build:cli
      - name: Run API tests
        env:
          APIWEAVE_SECRET_API_TOKEN: ${{ secrets.API_TOKEN }}
        run: >
          node .apiweave-cli/app/dist/cli/apiweave.cjs run .
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
- **If you get `environment 'X' is not in the file` (or `in the repository`)**, the message lists the environments it has. A workflow export only carries the environment it was saved with, and only when it was exported with its environment.
- **If the CLI exits `2` with `workflow 'X' is saved with environment '…', which is not in the repository`**, the workflow was saved with an environment a repository does not hold (a user-scoped one is never written). Pass `--env <name>` to run it against one of the repository's.
- **If the CLI exits `2` naming a file as `must be a plain file` or `must be a plain folder`**, a link or something that is not a regular file stands where the format expects a file or folder; the CLI never follows a link out of the repository. A file it does not know under `projects/`, `workflows/` or `environments/` (a subfolder, `x.json.orig`, `X.JSON`) is refused by name the same way, so a test that cannot run never passes silently.
- **If the CLI exits `2` with `.apiweave/format.json is missing`**, the folder is not a workspace repository: point `apiweave run` at the folder that holds `.apiweave/`.
- **If a variable shows `<SECRET>` in the request**, the export replaced a secret-looking environment value with a placeholder. Supply the real value with `--var`, or move it to a secret.
- **If the CLI exits `2` with `Unknown option`**, check the spelling against `apiweave --help`.
- **If a Call Workflow node fails with `Call Workflow node has no target workflow configured`**, its target was not in the file. A workflow export carries none of its Call Workflow targets: export the project that holds both workflows instead, and run the caller with `--workflow`.

## Related

- [Projects](../features/projects.md): project runs and `.awecollection` export.
- [Keep Tests in a Git Repository](git-workflows.md): the workspace repository layout and what this release does with it.
- [Data-Driven Runs](../features/data-driven-runs.md): CSV and JSON data files and `{{data.<column>}}`.
- [Environments and Secrets](../features/environments-and-secrets.md): environments, secrets and how references resolve.
- [Visualization and Debugging](../features/visualization-and-debugging.md#5-run-reports-junit-and-html): what the JUnit and HTML reports contain.
