# The sandbox

This is the only place on the platform where code somebody else wrote is
executed. Everything about it is arranged on one assumption: **the code will
escape the language sandbox.**

That is not pessimism, it is the documented state of the art. `node:vm` is not a
security boundary — the escapes are public and there are many — and no amount of
deleting globals inside a Python process makes it a jail. Anyone who tells you
otherwise has not read the CVEs.

So the language sandbox is not the wall. **The container is the wall**, and the
language sandbox is only there to stop the accidents.

## What holds if the code escapes into the container

- **No network.** The container sits on a Docker network created with
  `internal: true`, so there is no gateway and no route off the box. Not a
  firewall rule that can be misconfigured — an absent road.
- **No secrets.** The service is given exactly one environment variable, a
  shared token, and the child process that runs the code is given none at all.
  There is no platform key here to steal because none was ever sent.
- **No other business's data.** The only thing that crosses the wire is the one
  input the architect's own node was handed. The sandbox has no database
  credentials and does not know what a business is.
- **No filesystem.** Root is read-only; `/tmp` is a small tmpfs that dies with
  the process.
- **No privileges.** Runs as a non-root user with every Linux capability
  dropped and `no-new-privileges`, so nothing inside can become root even if it
  finds a setuid binary.
- **No forking away.** `pids_limit` caps the process count, so a fork bomb hits
  a wall instead of the host.
- **No waiting forever.** Two timers: the child is killed at the limit, and the
  request gives up shortly after in case the kill itself was blocked.
- **No memory.** Capped at the container and again per child.

## What still needs a human's judgement

The code the architect writes can compute anything. It cannot reach out, and it
cannot see anyone else — but a slow regular expression will still spend the CPU
it is given, which is why the CPU is capped too.
