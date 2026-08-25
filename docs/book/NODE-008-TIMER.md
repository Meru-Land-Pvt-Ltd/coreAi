# NODE 008 — TIMER

**Status:** Built, deployed — the last core stone
**Type:** `trigger.schedule` · **Family:** Trigger (how the world reaches it)

## Why it is node eight, and why it is the last

Seven nodes made a complete machine: in, out, think, choose, remember, repeat,
receive. And every one of them only ever acted **when spoken to**.

The clock is what turned computers from tools into workers — the machine that
acts when nobody is there. The morning report, the hourly watch, the Monday
sweep: every one starts with the words "every Monday at 9", and no core node
could say them.

The founder closed the set himself: the wire to the outside world is **not** a
ninth node — every SMS, email and Apollo is the same wire in different
clothes, built FROM the eight. The Hands are a family, not a stone. **Eight
is the machine.**

## The six answers

**1. Called:** Timer
**2. Does:** Wakes your agent by itself — every hour, every day, or every
week. Nobody presses anything.
**3. Needs:** nothing — time itself is the caller
**4. Gives:** `schedule` — when and why it fired, so a later step can say
"your Monday report" without guessing the day
**5. Settings:** *Runs* (hour/day/week) · *On* (which day) · *Hour* ·
*Minute* — four plain choices; an architect never meets a cron expression
**6. Proof:** the clock has ticked in production since August — Postgres is
the clock, the claim is the lock, and a failed tick is recorded, never
retried into a paid API loop

## The engineering it stands on (built earlier, now declared)

- **Postgres is the clock, not a queue.** One `nextRunAt` column cannot drift
  from the row it lives on; a cancelled customer's agent cannot keep running.
- **The claim is the lock.** Two sweeps racing produce exactly one run.
- **Times are wall-clock in the business's own zone** — "every day at 9" means
  their 9, and never drifts an hour across a DST change.
- **Five failures in a row and the clock stops and says why.**

## The admin's half

Nodes → Timer → Limits: **the fastest wake-up** — no Timer on the platform may
run faster than this floor, whatever an architect picks. Default one hour;
never below 15 minutes. An agent waking every minute is a bill nobody watches.

## The line that matters

> **A machine that acts when nobody is there is no longer a tool. Eight
> stones, and the foundation is closed.**
