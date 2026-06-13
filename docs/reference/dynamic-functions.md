# Dynamic Functions Reference

*Reference for the 13 dynamic functions you can call inside APIWeave placeholders. This is a lookup page, not a tutorial: find the function you need, copy the signature, and drop it into a value field.*

## Prerequisites

None. This is a reference doc. Read [Concepts](../getting-started/concepts.md) if you need a refresher on how placeholders are resolved at run time.

## Note on Function Count

APIWeave exposes 13 dynamic functions for use in placeholders. Two additional internal helpers (`get_function`, `get_all_functions`) exist for runtime resolution but are not part of the public API. You will not see the internal helpers in the function picker, and you should not reference them in workflow configuration.

## Table of Contents

- [String Generators](#string-generators)
  - [randomString](#randomstringlength-int--10---str)
  - [randomAlpha](#randomalphalength-int--10---str)
  - [randomNumeric](#randomnumericlength-int--10---str)
  - [randomHex](#randomhexlength-int--16---str)
  - [randomEmail](#randomemail---str)
- [Number Generators](#number-generators)
  - [randomNumber](#randomnumbersize-int--6---str)
- [Time and Date](#time-and-date)
  - [uuid](#uuid---str)
  - [timestamp](#timestamp---str)
  - [iso_timestamp](#iso_timestamp---str)
  - [date](#dateformat-str--y-m-d---str)
  - [futureDate](#futuredatedays-int--1-format-str--y-m-d---str)
  - [pastDate](#pastdatedays-int--1-format-str--y-m-d---str)
- [Selection](#selection)
  - [randomChoice](#randomchoiceoptions-str---str)

## String Generators

### `randomString(length: int = 10) -> str`

Returns a random alphanumeric string of the given length (letters and digits).

```text
{{randomString(12)}}
# Example output: aB3xQ7pLm2nK
```

### `randomAlpha(length: int = 10) -> str`

Returns a random alphabetic string (letters only, no digits) of the given length.

```text
{{randomAlpha(8)}}
# Example output: hTqLpZmN
```

### `randomNumeric(length: int = 10) -> str`

Returns a random numeric string (digits only, no letters) of the given length.

```text
{{randomNumeric(6)}}
# Example output: 482910
```

### `randomHex(length: int = 16) -> str`

Returns a random hexadecimal string of the given length, useful for tokens, nonces, and correlation identifiers.

```text
{{randomHex(16)}}
# Example output: 4f8a2b1c9d3e7a05
```

### `randomEmail() -> str`

Returns a randomly generated email address you can use when a test needs a unique recipient per run.

```text
{{randomEmail()}}
# Example output: user_a8f2k9x@apiweave.test
```

## Number Generators

### `randomNumber(size: int = 6) -> str`

Returns a string of random digits of the given size. Use it where you need a short numeric identifier (order IDs, account numbers, OTPs).

```text
{{randomNumber(6)}}
# Example output: 384920
```

## Time and Date

### `uuid() -> str`

Returns a fresh UUID v4 as a string. Use it as a request id, a correlation header, or a unique resource name.

```text
{{uuid()}}
# Example output: 7f3c1a92-8b4d-4e6f-9c12-1ab2c3d4e5f6
```

### `timestamp() -> str`

Returns the current Unix timestamp in seconds. Use it for epoch-based fields, signature inputs, or freshness checks.

```text
{{timestamp()}}
# Example output: 1718281902
```

### `iso_timestamp() -> str`

Returns the current time formatted as an ISO 8601 string in UTC. Use it when an API expects `2024-06-13T14:25:00Z` style values.

```text
{{iso_timestamp()}}
# Example output: 2026-06-13T14:25:00Z
```

### `date(format: str = "%Y-%m-%d") -> str`

Returns today's date in the given `strftime` format. The default is `YYYY-MM-DD`.

```text
{{date()}}
# Example output: 2026-06-13

{{date("%Y/%m/%d")}}
# Example output: 2026/06/13
```

### `futureDate(days: int = 1, format: str = "%Y-%m-%d") -> str`

Returns the date `days` days from now, formatted with the given `strftime` pattern. Use it to populate end dates, expiration fields, or scheduled run times.

```text
{{futureDate(7)}}
# Example output: 2026-06-20
```

### `pastDate(days: int = 1, format: str = "%Y-%m-%d") -> str`

Returns the date `days` days before today, formatted with the given `strftime` pattern. Use it for start dates, "since" filters, and lookback windows.

```text
{{pastDate(30)}}
# Example output: 2026-05-14
```

## Selection

### `randomChoice(options: str) -> str`

Returns one item picked at random from a comma-separated list of options. Use it to vary input data across runs (test accounts, regions, sort orders).

```text
{{randomChoice("staging,production,local")}}
# Example output: production
```

## Troubleshooting

- **If a function output looks like the raw call text** (you see `{{uuid()}}` in the response), the placeholder was not evaluated. Check that the field supports template substitution and that the function name is spelled correctly.
- **If a function returns the same value across runs**, it is not being re-evaluated. Placeholders are resolved at run time, so the value changes only when the workflow actually runs. Re-run the workflow to get a fresh value.
- **If `randomChoice` returns an empty string**, the `options` argument was empty. Pass a non-empty comma-separated list, for example `red,green,blue`.
- **If a date format string is ignored**, verify the format uses `strftime` directives (`%Y`, `%m`, `%d`, `%H`, `%M`, `%S`). Literal characters outside those directives are passed through.

## Related

- [Concepts](../getting-started/concepts.md)
- [Placeholders Reference](placeholders.md)
- [Architecture](architecture.md)
