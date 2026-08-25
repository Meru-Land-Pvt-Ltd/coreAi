# NODE 006 — LOOP

**Status:** Built, deployed, proven in the browser
**Type:** `logic.loop` · **Family:** Logic (how it repeats)

## Why it is node six

Every computer ever built stands on three legs: do things in order, choose,
and repeat. The wires were the order. The Condition was the choice. And the
platform had no repeat — an agent could serve one customer at a time but never
work through a list. "For each of these fifty leads, score it" was impossible
on the canvas.

The founder asked the question that found it: *"go back to when the computer
was born — are we missing anything?"* This was the first missing leg.

## The six answers

**1. Called:** Loop
**2. Does:** Runs the steps after it once for every item in a list, then hands
on all the answers together.
**3. Needs:** `text` — whatever arrived
**4. Gives:** `results` — every round's answer, in order (and `item` /
`itemNumber` to the steps inside each round)
**5. Settings:** *How the list arrives* (by commas · one per line · let AI
find the items) · *Most rounds* — both declared, both defaulted
**6. Proof:** typed `red, green, yellow` on the live page; the page answered
**apple, lime, lemon** — one answer per item, in order. The engine's own log:
one run, exactly three Brain calls, all inside the Loop.

## The rules it lives by

**Rounds run one after another, never in parallel.** Order survives, and no
provider is hammered by fifty simultaneous calls.

**Only "let AI find the items" costs a model call.** Commas and lines are
free — the same law as the Condition: meaning costs, arithmetic doesn't.

**A Loop inside a Loop is refused with a sentence.** "Use two agents" is a
better answer than a canvas nobody can reason about.

**The admin owns the ceiling.** Nodes → Loop → Limits, default 25 rounds.
Every round can be an AI call, and a pasted spreadsheet must never become an
invoice.

## The line that matters

> **Sequence, choice, repetition. With this node, the canvas speaks the whole
> language computers have ever spoken.**
