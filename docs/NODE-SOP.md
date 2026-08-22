# THE NODE SOP

Every node on Triven answers the same six questions. No exceptions.

A node that cannot answer all six is not finished, and does not go on the
palette.

---

## The six questions

**1. What is it called?**
One short name. If it is a company, use the company's name — "Apollo",
"Instantly" — never a description of what the step does.

**2. What does it do?**
One line, in plain words, that a non-technical person understands.

**3. What does it need?**
Every thing it needs, each with a name. **This is the door in.**
A node needing nothing is allowed — that is what a first node looks like.

**4. What does it give?**
Every thing it hands on, each with a name. **This is the door out.**
A node giving nothing is allowed, but it must say so out loud. Silence is not
an answer.

**5. Who fills in what?**
What the architect sets on the canvas, and what the business fills in later on
their own setup screen. Never ask the architect for something only the business
knows, and never invent a phone number, an address or a price.

**6. How do we prove it worked?**
One real run, watched by a person, in a browser. And the node must be able to
say honestly "I did nothing" — a node that cannot report its own failure is
worse than a node that fails.

---

## Two extra doors — only for nodes that touch the outside world

**7. AI entry door** — turns what arrived into exactly what this node needs to
be given. It may only fill in the settings listed on its door in, and it leaves
everything else exactly as the architect saved it.

**8. AI exit door** — cleans what came back into the smallest useful thing later
nodes can read.

A node that touches nothing outside does not get these doors. There is nothing
to translate.

---

## The rules that follow

- **Nothing travels without a wire.** No guessing at names, no hidden lists of
  words that happen to match. If it is not wired, it does not arrive — and the
  canvas says so in red, before publish, not at 2am to somebody's customer.

- **Written down once.** A node's two doors live in one place. The canvas reads
  that place, the engine reads it, the AI composer reads it, the admin Nodes
  page reads it. One fact, one home.

  Every bug on this platform on 2026-08-21 was the same fact written in two
  places and drifting apart: node appearance in the palette *and* the composer,
  the node list in the registry *and* a hand-typed catalogue, login in the
  shared helper *and* by hand in one panel. Four symptoms, one disease.

- **A node can be tested alone.** Give it its door in, check its door out. What
  passes on its own passes everywhere.

- **If a node cannot say what it gives, it is not finished.**

---

## Node Frame is not the SOP

`packages/shared/src/node-frame.ts` describes **a service on the internet with a
key and a URL** — Apollo, Instantly, Notion. It answers questions 3, 4, 7 and 8
for that one kind of node, and it answers them very well.

It does not fit, and must not be forced onto:

- **triggers** — there is no API to call; the world calls us
- **Face nodes** (Prompt Box, Result Viewer) — no API at all, no key, no URL
- **AI nodes** — they call our own brain, not somebody's REST endpoint
- **logic** (condition, end) — pure arithmetic

Those nodes still answer all six questions. Node Frame is one way of answering
some of them, not the standard itself.

---

## Worked example: the Prompt Box

The first node. The switch. Nothing on this platform runs until something from
outside gets into the machine, and for a person typing, this is that door.

| | |
|---|---|
| **1. Called** | Prompt Box |
| **2. Does** | Gives your customer a box to type in. |
| **3. Needs** | Nothing. It is the first node. |
| **4. Gives** | `text` — the words your customer typed. |
| **5. Fills in** | Architect: the faint grey hint text. Business: nothing. |
| **6. Proof** | Type a real word on the live page; that exact word arrives at the next node. |
| **7. Entry door** | None — nothing arrives to translate. |
| **8. Exit door** | None — it calls nothing, so there is no reply to clean. |

### What it looked like before this SOP existed

- **No door out.** It declared nothing at all.
- **A guessing game instead of a wire.** What the customer typed reached the AI
  only if the AI node happened to ask for something named one of eight
  hard-coded words: `latestmessage, prompt, message, input, query, question,
  text, request`. An architect who named it `userQuestion` got silence.
- **Two halves of the platform disagreeing.** The canvas drew handles on it and
  warned "Nothing leads to this step, so it will never run", while the
  declaration layer held that "blocks are placed, not wired".
- **Never proven.** No run had ever been watched carrying a typed word from the
  page to the next node.
