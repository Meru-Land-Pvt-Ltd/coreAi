# NODE 004 — CONDITION

**Status:** Built, deployed, proven in the browser
**Type:** `logic.condition` · **Family:** Logic (how it chooses)

## Why it is node four

Three nodes made a machine that could think. It could only ever do one thing, though — the same thing, every single time, to everybody.

A real receptionist does not treat a complaint and a booking the same way. The moment a machine can *choose*, it stops being a tool and starts being an employee. That is this node.

Switch, circuit, lamp — and now a **fork in the wire**.

## What it is

A Condition reads what arrived, asks one question about it, and sends the work down one road out of several.

Not "true or false". Roads, with names the architect chose:

> **Complaint** → apologise and fetch a manager
> **Question** → answer it
> **Spam** → stop, quietly
> **Anything else** → the road that always exists

## The six answers

**1. Called:** Condition

**2. Does:** Reads what arrived, asks one question about it, and picks the road that fits.

**3. Needs:** `text`

**4. Gives:** `choice` — the name of the road it took · `why` — one line explaining it

**5. Settings:** the question it asks, and the roads out.

**6. Proof:** drop it on a canvas, name three roads, and watch three roads plus *Anything else* draw themselves — then send a real message down it and see it arrive in the right place.

## The two doors

**Entry door.** A rule is only as good as the value it tests. Asking *"is this a complaint?"* of a paragraph of prose used to need **two nodes** — an AI Brain to squeeze the paragraph into one word, and a Condition to test that word. That is the architect doing the machine's homework.

Now the door does it. When the rule is about **meaning**, the Condition reads whatever arrived itself and answers with one of the architect's own road names. One node, not two.

**Exit door.** The next node is never handed a paragraph to make sense of. It gets the road name and one short line of why — a sentence an architect and a business owner can both read in a log without asking anyone what it means.

## The rule that pays for itself

The door **only wakes for meaning.**

*"Are we open?"* is a clock. *"Is the total over £500?"* is arithmetic. Those are the commonest rules on the platform, and putting an AI call and its cost on every one of them would be indefensible. They stay instant and free.

## What the founder changed

The node was designed with two roads: **Yes** and **No**.

> *"shall we don't limit that one word to yes or no. Shall we allow to customisable words"*

That was the right call, and it is what shipped. Roads are words the architect types. **Anything else** is the one road that cannot be removed — because a customer who fits none of the roads must still go somewhere, and *nowhere* is how agents strand real people.

## What was rejected, and why

**Nested conditions inside one node.** A second question hiding inside the first is a node lying about what it does. Two questions, two nodes, both visible on the canvas.

**Making the door decide when there are no roads.** If the architect named nothing, the node takes *Anything else* and says so. A door that invents a road is worse than one that admits it could not choose.

## The line that matters

> **A wrong road sends a real customer somewhere nobody meant them to go.**

Which is why, when nothing honestly fits, the door is instructed to say *Anything else* rather than force the nearest answer. A machine that admits it does not know is worth more than one that is confidently wrong.
