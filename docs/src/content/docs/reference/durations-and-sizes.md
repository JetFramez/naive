---
title: Durations and sizes
---

Wherever notio takes a time or a byte size — `maxAge`, TTLs, windows, deadlines, body limits, file size limits — it accepts a plain number or a string in one of these grammars. Both are exported utilities, in case you want to parse the same strings yourself: `parseDuration(value, name?)` and `parseBytes(value, name?)`.

## Durations

A bare number, or a number as a string, is milliseconds. A unit suffix converts:

| Unit | Meaning | Example |
|---|---|---|
| `ms` | milliseconds | `"250ms"` |
| `s` | seconds | `"5s"` |
| `m` | minutes | `"5m"` |
| `h` | hours | `"1.5h"` |
| `d` | days | `"30d"` |
| `w` | weeks | `"2w"` |

Decimals are allowed (`"1.5h"`); the result is rounded to the nearest millisecond. A negative number, `NaN`, or a string that does not match this grammar throws `TypeError` at the point the option is resolved — for most options, that means at startup.

## Byte sizes

A bare number, or a number as a string, is bytes. A unit suffix converts, using binary (1024-based) units:

| Unit | Meaning | Example |
|---|---|---|
| `b` | bytes | `"512b"` |
| `kb` | kibibytes (1024 B) | `"64kb"` |
| `mb` | mebibytes (1024 KB) | `"10mb"` |
| `gb` | gibibytes (1024 MB) | `"1.5gb"` |
| `tb` | tebibytes (1024 GB) | `"1tb"` |

Decimals are allowed (`"1.5gb"`); the result is rounded to the nearest byte. A negative number, `NaN`, or a string that does not match this grammar throws `TypeError`.

## Where these are used

Every option documented as accepting "milliseconds or a duration string" or "bytes or a size string" throughout the guide uses these two parsers — `createApp`'s `body.json.limit` and `shutdown.deadline`, cookie `maxAge`, cache `ttl`, rate-limit `window`, upload `maxFileSize`/`maxTotalSize`, auth strategy `ttl`/`absolute`, and config's `env.duration()`/`env.bytes()` leaves among them.
