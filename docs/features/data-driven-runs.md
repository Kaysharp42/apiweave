# Data-Driven Runs

*Run one workflow once per row of a CSV or JSON data file, with each row's values available as `{{data.<column>}}`. This is how you build a test matrix: the same requests against many users, ids or payloads, with a pass or fail per row. For anyone testing an API against a table of inputs, in the app or in CI.*

## Prerequisites

- A workflow that runs on its own. See [Workflows and Nodes](workflows-and-nodes.md).
- The placeholder syntax. See [Placeholders](../reference/placeholders.md).

## How it works

A data-driven run is a series of ordinary runs, one per data row, run one after another. Each run is called an **iteration**. Every iteration:

- reads its row's values as `{{data.<column>}}` placeholders, anywhere a placeholder works;
- is a normal run with its own History entry, timeline and report, labelled **Iteration 3/10**;
- runs against the same environment, and starts from the workflow's own variables. Variables extracted in one iteration do not carry into the next.

The data is supplied when the run starts. It is never saved with the workflow, and the row values are never stored in run history; a History entry records only which iteration it was.

## The data file

**CSV.** The first row names the columns; every other row is one iteration. Values are text. Fields follow RFC 4180: a value in double quotes may hold commas and line breaks, and `""` inside quotes is one quote. A UTF-8 byte-order mark and blank lines are ignored. Every row must have as many fields as the header.

```csv
user,orderId,note
ann,1001,"first order, gift wrapped"
bob,1002,
```

**JSON.** An array of objects; each object is one iteration. Values keep their JSON type, and a nested object or array is inserted as JSON.

```json
[
  { "user": "ann", "orderId": 1001, "address": { "city": "Oslo" } },
  { "user": "bob", "orderId": 1002, "address": { "city": "Lyon" } }
]
```

A file is read as JSON when its name ends in `.json`, and as CSV otherwise. A data set holds at most 10,000 rows, and the app reads files up to 5 MB.

## Use the values

```text
{{env.BASE_URL}}/users/{{data.user}}/orders/{{data.orderId}}
```

In a JSON body, a placeholder inside quotes is JSON-escaped and a standalone one is inserted as its JSON value:

```json
{ "orderId": {{data.orderId}}, "shipTo": {{data.address}}, "note": "{{data.note}}" }
```

A column the row does not have stays as literal `{{data.name}}` text and is listed in the node's unresolved placeholders, as for any other namespace. A Call Workflow node's target reads the same row.

## Run with data in the app

1. Open the workflow.
2. Click **Run with data** (the spreadsheet icon beside **Run**) and pick a `.csv` or `.json` file.
3. The canvas narrates each iteration in turn; the toolbar shows **Iteration 3/10** while one runs.
4. When the last iteration ends, a notice says how many passed: `Data run finished: 9 of 10 iterations passed`.

A failed iteration does not stop the next one. **Cancel** stops the iteration that is running and the ones after it. Each iteration appears in **History** with its place, and exports its own JUnit or HTML report. History retention counts the whole data-driven run as one run, so a large data file pushes no more earlier runs out of History than a single run would.

## Run with data in CI

```bash
apiweave run api.awecollection --env Staging --iteration-data users.csv
apiweave run login.json -d users.json --bail --reporter cli,junit
apiweave run smoke.json --iteration-count 5
```

| Option | What it does |
|---|---|
| `-d, --iteration-data <file>` | Run once per row of a CSV or JSON file. |
| `-n, --iteration-count <n>` | Run `n` times. With `--iteration-data`, run its first `n` rows. |
| `--bail` | Stop at the first failed iteration (and, in a project, at the first failed workflow). |

A project bundle runs the whole project once per row: every workflow of iteration 1, then every workflow of iteration 2. A workspace repository holds several projects, and a data run is one project's, so pick it with `--project <name|id>`; without it, a repository with more than one project to run exits `2` and names the flag. The exit code is `1` if any iteration failed. The console report lists every iteration's steps and adds an **Iterations** row to the summary; the JUnit and HTML reports have one test suite per workflow per iteration, named `Health check [iteration 2]`. See [Run APIWeave Tests in CI](../guides/ci.md).

## Agents

An agent runs a data set one row at a time: `runs_create` takes an optional `data` object, the row the run reads as `{{data.<column>}}`. Each such run waits for the user's approval to send secrets exactly like any other run an agent starts.

## Keep secrets out of data files

Masking applies only to declared secrets. Data values are sent as they are and can appear in the request evidence kept in History and in the URLs listed in reports. Put credentials in the secret store and reference them as `{{secrets.NAME}}`; in CI, pass them with `--secret` or `APIWEAVE_SECRET_<NAME>`.

## Troubleshooting

- **If the app says `CSV row 3 has 2 fields; the header has 3`**, a row is missing a comma or has an unquoted comma in a value. Quote values that contain commas.
- **If a request goes out with literal `{{data.user}}`**, the column name differs from the header (names are case-sensitive), or the run was started with **Run** rather than **Run with data**.
- **If only some iterations ran**, one was cancelled, or `--bail` stopped at a failed one.

## Related

- [Placeholders](../reference/placeholders.md): every namespace and the substitution order.
- [Run APIWeave Tests in CI](../guides/ci.md): `apiweave run` and its reports.
- [Visualization and Debugging](visualization-and-debugging.md#5-run-reports-junit-and-html): what the reports contain.
