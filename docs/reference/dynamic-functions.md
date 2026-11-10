# Dynamic Functions Reference

*Reference for the 13 dynamic functions you can call inside APIWeave placeholders. This is a lookup page, not a tutorial: find the function you need, copy the signature, and drop it into a value field.*

## Prerequisites

None. This is a reference doc. Read [Concepts](../getting-started/concepts.md) if you need a refresher on how placeholders are resolved at run time.

## Note on Function Count

APIWeave exposes 13 dynamic functions for use in placeholders. The resolver itself is a single class with internal `getFunction`/`getAllFunctions` methods for runtime lookup; those are not placeholder-callable and are not part of the public API. You will not see the internal helpers in the function picker, and you should not reference them in workflow configuration.

## Calling a Function

Every function returns a string. Arguments are separated by commas, and surrounding quotes are optional: `{{date("%Y/%m/%d")}}` and `{{date(%Y/%m/%d)}}` are the same call. Because commas separate arguments, an argument cannot itself contain a comma. A missing, non-numeric or less-than-one number argument falls back to the default shown in the signature.

## Table of Contents

- [String Generators](#string-generators)
  - [randomString](#randomstringlength--10)
  - [randomAlpha](#randomalphalength--10)
  - [randomNumeric](#randomnumericlength--10)
  - [randomHex](#randomhexlength--16)
  - [randomEmail](#randomemail)
- [Number Generators](#number-generators)
  - [randomNumber](#randomnumbersize--6)
- [Time and Date](#time-and-date)
  - [uuid](#uuid)
  - [timestamp](#timestamp)
  - [iso_timestamp](#iso_timestamp)
  - [date](#dateformat--y-m-d)
  - [futureDate](#futuredatedays--1-format--y-m-d)
  - [pastDate](#pastdatedays--1-format--y-m-d)
  - [Format Directives](#format-directives)
- [Selection](#selection)
  - [randomChoice](#randomchoiceoptions)

## String Generators

### `randomString(length = 10)`

Returns a random alphanumeric string of the given length (letters and digits).

```text
{{randomString(12)}}
# Example output: aB3xQ7pLm2nK
```

### `randomAlpha(length = 10)`

Returns a random alphabetic string (letters only, no digits) of the given length.

```text
{{randomAlpha(8)}}
# Example output: hTqLpZmN
```

### `randomNumeric(length = 10)`

Returns a random numeric string (digits only, no letters) of the given length. It may start with `0`.

```text
{{randomNumeric(6)}}
# Example output: 048291
```

### `randomHex(length = 16)`

Returns a random lowercase hexadecimal string of the given length, useful for tokens, nonces, and correlation identifiers.

```text
{{randomHex(16)}}
# Example output: 4f8a2b1c9d3e7a05
```

### `randomEmail()`

Returns a random address at `example.com`: ten random letters and digits, then `@example.com`. Use it when a test needs a unique recipient per run.

```text
{{randomEmail()}}
# Example output: a8f2k9xZqL@example.com
```

## Number Generators

### `randomNumber(size = 6)`

Returns a string of `size` random digits that never starts with `0`, so it reads as a number of exactly that many digits. Use it where you need a short numeric identifier (order IDs, account numbers, OTPs).

```text
{{randomNumber(6)}}
# Example output: 384920
```

## Time and Date

`timestamp()` and `iso_timestamp()` are in UTC. `date()`, `futureDate()` and `pastDate()` use the local time zone of the machine running the workflow, so a run near midnight on a machine in another time zone can produce a different date than `iso_timestamp()` shows.

### `uuid()`

Returns a fresh UUID v4 as a string. Use it as a request id, a correlation header, or a unique resource name.

```text
{{uuid()}}
# Example output: 7f3c1a92-8b4d-4e6f-9c12-1ab2c3d4e5f6
```

### `timestamp()`

Returns the current Unix timestamp in whole seconds. Use it for epoch-based fields, signature inputs, or freshness checks.

```text
{{timestamp()}}
# Example output: 1718281902
```

### `iso_timestamp()`

Returns the current time as an ISO 8601 string in UTC, with milliseconds. Use it when an API expects `2026-06-13T14:25:00.000Z` style values.

```text
{{iso_timestamp()}}
# Example output: 2026-06-13T14:25:00.123Z
```

### `date(format = "%Y-%m-%d")`

Returns today's local date in the given format. The default is `YYYY-MM-DD`. See [Format Directives](#format-directives).

```text
{{date()}}
# Example output: 2026-06-13

{{date("%Y/%m/%d")}}
# Example output: 2026/06/13

{{date("%a %d %b %Y %H:%M")}}
# Example output: Sat 13 Jun 2026 16:25
```

### `futureDate(days = 1, format = "%Y-%m-%d")`

Returns the local date `days` days from now (`days` × 24 hours), in the given format. Use it to populate end dates, expiration fields, or scheduled run times.

```text
{{futureDate(7)}}
# Example output: 2026-06-20

{{futureDate(30, "%d/%m/%Y")}}
# Example output: 13/07/2026
```

### `pastDate(days = 1, format = "%Y-%m-%d")`

Returns the local date `days` days before now (`days` × 24 hours), in the given format. Use it for start dates, "since" filters, and lookback windows.

```text
{{pastDate(30)}}
# Example output: 2026-05-14
```

### Format Directives

`date()`, `futureDate()` and `pastDate()` accept these `strftime`-style directives. Names are in English.

| Directive | Meaning | Example |
| --- | --- | --- |
| `%Y` | Four-digit year | `2026` |
| `%y` | Two-digit year | `26` |
| `%m` | Month, `01`–`12` | `06` |
| `%B` | Month name | `June` |
| `%b` | Abbreviated month name | `Jun` |
| `%d` | Day of the month, `01`–`31` | `13` |
| `%A` | Weekday name | `Saturday` |
| `%a` | Abbreviated weekday name | `Sat` |
| `%H` | Hour, `00`–`23` | `16` |
| `%M` | Minute, `00`–`59` | `25` |
| `%S` | Second, `00`–`59` | `07` |
| `%%` | A literal `%` | `%` |

Any other `%` pair (for example `%j` or `%Z`) is kept as written, and characters outside directives are passed through.

## Selection

### `randomChoice(...options)`

Returns one item picked at random from the comma-separated options. Surrounding spaces are trimmed and empty items are ignored. Use it to vary input data across runs (test accounts, regions, sort orders).

```text
{{randomChoice(staging,production,local)}}
# Example output: production
```

## Troubleshooting

- **If a function output looks like the raw call text** (you see `{{uuid()}}` in the response), the placeholder was not evaluated. Check that the field supports template substitution and that the function name is spelled correctly.
- **If a function returns the same value across runs**, it is not being re-evaluated. Placeholders are resolved at run time, so the value changes only when the workflow actually runs. Re-run the workflow to get a fresh value.
- **If a node fails with "exceeds the maximum length of 10000"**, a generator (`randomString`, `randomAlpha`, `randomNumeric`, `randomHex`, `randomNumber`) was asked for more than 10,000 characters. Use a smaller length.
- **If `randomChoice` returns an empty string**, the options were empty. Pass a non-empty comma-separated list, for example `red,green,blue`.
- **If a date shows a `%` pair literally**, that directive is not supported. Use one from [Format Directives](#format-directives).
- **If a date format is cut short or ignored**, it contains a comma, which ends the argument. Use another separator.
- **If a date is one day off**, the run used the machine's local time zone. Use `iso_timestamp()` when you need UTC.

## Related

- [Concepts](../getting-started/concepts.md)
- [Placeholders Reference](placeholders.md)
- [Architecture](architecture.md)
