# NODE 005 — MEMORY

**Status:** Built, deployed, proven in the browser
**Type:** `ai.memory` · **Family:** Brain (what it holds on to)

## Why it is node five

In. Think. Out. Choose. The machine was complete — except that it forgot.

Every run started from nothing. A customer who said *"actually, make it Tuesday"* was talking to a stranger who had never heard of them, thirty seconds after promising them Monday.

Memory is the difference between a calculator and a computer. On this platform it is the difference between a tool and an assistant.

## What it is

The node that remembers what has happened, so the next answer knows about the last one.

It is already the most connected node Triven has after the Brain itself: **eleven agents feed it, sixteen read from it.** It was here before the standard existed. This is the first time it has answered to it.

## The six answers

**1. Called:** Memory

Not "Memory Node". *Node* is a word from our side of the screen — a business owner reading a run log should never meet it.

**2. Does:** Remembers what has happened, so the next answer knows about the last one.

It used to say it *"aggregates node execution history into a compact text memory string."* That sentence was written for engineers, in a product built for a dentist.

**3. Needs:** `text` — what just happened

**4. Gives:** `memory` — everything remembered so far

**5. Settings:** two, both with a working default, so a dropped node is never blank:

> **Always remember** — things worth remembering every time, whatever else happened. *"This customer is on the yearly plan."* Leave it empty and it simply remembers the conversation.
> **How much to keep** — the last few turns · the whole conversation · everything, in detail.

**6. Proof:** drop it, open it, and read three plain sentences instead of a form.

## The exit door, and the one decision inside it

Past the limit, something has to go.

Cutting the end off is the cheap answer and it is the wrong one. Look at how a conversation is actually shaped:

> *"Hi, hope you're well. This is Ana, 07700 900 123. I need Tuesday at 3, and last time you promised to call me back about the crown. Anyway — thanks so much, have a lovely weekend, bye!"*

The **name, the number, the date, the promise** are at the front. The **pleasantries** are at the back. Truncating keeps the pleasantries and throws away the appointment.

So beyond the limit Memory **summarises** instead:

> **Keeps** — who the person is, what they want, any date or amount they named, anything they were promised, anything still unfinished, decisions already made so nobody is asked twice
> **Drops** — greetings, thanks, apologies, repetition, and how the agent phrased things

At **temperature zero**, always. This is remembering, not writing. The same conversation must come back the same way twice, or an agent contradicts itself about what it was told — and there is no bug harder to explain to a customer than that one.

## What it does not do

**Below the limit, nothing at all.** Most runs are short. A model call on every one of them would be a cost with nothing to show for it.

**When the door fails, nothing at all.** The original text is kept and the run carries on. Too much memory is a far smaller problem than none, and an agent must never stop because the optional half of a feature had a bad minute.

**When the summary comes back longer than what it summarised** — which happens — the original is kept. A summary longer than its source is not a summary, and pretending work was done is worse than admitting it was not.

## What the panel used to say

> Memory configuration · Custom context · Output variable · Memory Variable · **[ Copy `{{memory}}` ]**

Five phrases from our side of the screen, and a button asking an architect to paste a variable into a prompt — when memory reaches the next step **on its own**, and always has. The button never had to exist.

It now reads: **Name · Always remember · How much to keep.**

Attachments went where the AI Brain's went — to a File Upload node of their own, rather than living half-built in two places.

## The line that matters

> **An agent that cannot remember is not an assistant. It is a form that talks.**

Five nodes now. Something can get in, be thought about, come out, choose its road — and remember it happened.

That is a machine.
