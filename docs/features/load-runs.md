# Load Runs

*Run one workflow many times at once and measure how the API holds up: per-step latency percentiles, error rate and throughput, with thresholds that fail a CI build. For anyone checking that an endpoint stays fast and correct under concurrent use, in the app or in CI.*

## Prerequisites

- A workflow that runs on its own. See [Workflows and Nodes](workflows-and-nodes.md).
- Optional: a CSV or JSON data file. See [Data-Driven Runs](data-driven-runs.md).

## How it works

A load run is a set of **iterations**, as in a data-driven run: each is an ordinary run that reads its row as `{{data.<column>}}` and starts from the workflow's own variables. Unlike a data-driven run, iterations overlap:

| Setting | What it does |
|---|---|
| Iterations | Total runs to start. With a data file and no number, one per row; with fewer rows than iterations, rows are reused in order. At most 100,000. |
| Concurrency | Iterations in flight at once. Starting a load run raises the scheduler's usual limit of 4 runs to at least this number, so iterations are not queued. |
| Duration | Optional. Stop starting iterations after this long; those in flight finish. With no iteration count, the duration alone sets the length. |
| Ramp-up | Optional. Grow from 1 to the concurrency over this long, instead of starting a full batch at once. |
| Thresholds | Optional gates, described below. |

Every iteration is still a run with its own History entry; History retention counts the whole load run as one. Cancelling the running iteration stops the load run.

## What it records

Per step (node) that ran: the count, how many iterations failed it, the error rate, latency min, mean, p50, p90, p95, p99 and max in milliseconds (nearest-rank percentiles) and the throughput in executions per second over the load run's wall time.

A load run **does not keep every iteration's results**. Each finished iteration's per-step results and stored response bodies are folded into the aggregates and then deleted. What stays is the aggregates and the **first failure of each step**, masked like any run. That keeps a run of thousands of iterations small, and means the individual iterations in History show only their status and timing.

## Thresholds

A threshold is `<metric><operator><number>`, with `<`, `<=`, `>`, `>=` or `==`:

- Latency in milliseconds: `min`, `mean`, `p50`, `p90`, `p95`, `p99`, `max`, for example `p95<500`.
- `errors<1%` is the error rate in percent; `errors<5` without `%` is a count of failed iterations.
- `throughput>20` is executions per second.

Each is checked against every step, so one slow step breaches `p95<500` for the whole run. A step that never ran has nothing to compare and passes.

## Run a load run in the app

1. Open the workflow and choose **Run options → Load run…** (the arrow beside **Run**).
2. Fill in the iterations or pick a data file, the concurrency and any duration, ramp-up and thresholds (one per line).
3. Click **Start load run**. The canvas follows the first iteration.
4. When the load run ends, a notice says how it went and offers **Save report**, an HTML report with the latency table.

The result is kept until the app closes, for the last 20 load runs.

## Run a load run in CI

```bash
apiweave run api.aweproject --workflow "Search" \
  --concurrency 20 --iteration-count 500 --threshold "p95<500"
apiweave run search.json -c 5 --duration 30s --ramp-up 5s --reporter cli,html
```

| Option | What it does |
|---|---|
| `-c, --concurrency <n>` | Turns on load mode. |
| `-n, --iteration-count <n>` | Iterations to start. |
| `-d, --iteration-data <file>` | Data rows; without `-n`, one iteration per row. |
| `--duration <time>` | `30s`, `500ms`, `2m`; a bare number is seconds. |
| `--ramp-up <time>` | Same format. |
| `--threshold <expr>` | Repeatable. |

Load mode needs `--iteration-count`, `--iteration-data` or `--duration`, and runs one workflow (`--workflow`, or a single-workflow file). The exit code is `1` when any step failed in any iteration or a threshold is breached, `2` for a usage error. The console and HTML reports end with the latency table, and the JUnit report has a test case per step plus a `Thresholds` case. See [Run APIWeave Tests in CI](../guides/ci.md).

## Troubleshooting

- **If latencies look too good**, check the target is not caching: every iteration sends the same request unless it reads `{{data.<column>}}`.
- **If throughput is lower than expected**, the app or CI machine is the limit: a load run shares one process with its own request handling, so very high concurrency measures the client too.
- **If a threshold never trips**, it is compared per step and latencies are rounded to whole milliseconds, so `p95<1` fails any step that took 1 ms or more.

## Related

- [Data-Driven Runs](data-driven-runs.md): iterations one after another.
- [Run APIWeave Tests in CI](../guides/ci.md): `apiweave run` and its reports.
