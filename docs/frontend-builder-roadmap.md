# Frontend Builder — Canonical Roadmap (triple-verified 2026-08-16)

**THE AI-OPERATED BUILDER RULING (founder law, supersedes feature-list reading):**
The feature inventory below is the AI BUILDER's toolbox, not the human's. The human keeps ~9
touches only (select, drag, delete, duplicate, undo/redo, inline text edit, device preview,
open-in-Build, publish) plus the chat. Every other capability ships as a VALIDATED OPERATION the
The AI Builder invokes from natural language — never as human-facing menus/panels. Options held by
the AI are power; options shown to the human are clutter. This is the anti-Wix guarantee and the
2030 product: "The architect describes; the AI Builder designs, arranges, brands, and prepares
to sell; the human approves and earns."

**The Packaging Rule (founder law):** The page is the packaging; the AI's work is the product.
Build exactly enough page for a stranger to TRUST, USE, and BUY the AI's work — not one feature more.
Litmus for every feature: helps a customer use/buy the AI's work → build. Just prettier websites → refuse.

## Built-in doors (founder law)

Every node has an AI entry door and an AI exit door **where translation is needed**. The doors are
ours; the model behind them is a battery we swap forever (one admin setting, platform-wide, no
per-node model choice anywhere). Each door is born knowing its job, so it works even when the
architect knows nothing.

Doors live **inside** the node. They are never canvas nodes, never in the palette, and never a
separate step in the customer-facing preview — at most a sub-line under their own node in the
advanced run log ("Understood the request", "Cleaned the response"). They are on by default; the
only control is one quiet toggle in a node's Advanced settings, "Smart input & output".

Who carries what:

| Family | Doors | Why |
| --- | --- | --- |
| **Hands** — API Call, Send Email, Send SMS, Send WhatsApp, Telegram Message, Check Availability, Book Appointment, Calendly | entry **and** exit | They take a request out to the world and bring a reply back. The entry door fills in the address, the params and the message; the exit door cleans the reply down to what later steps actually need. |
| **Face-out** — Result Viewer | entry only | The last step turns whatever the run produced into what the customer sees: plain words, plus stat cards, a chart or a table when the result really holds numbers or rows. |
| **Face-in** — Prompt Box, Button, Choice, Upload | none | The customer's own words *are* the input. Nothing to translate. |
| **Brains** — AI Brain, voice conversation, image maker | none | They already are doors. |

A door never breaks a node: if it fails, times out, runs past the run's door budget, or returns
something unusable, the step runs exactly as it would have without it. Doors are an enhancement,
never a dependency. They also never read or write a key, token, connection or credential field.

**Consequence for templates and kits:** a shipped template holds only real steps — Face blocks,
Hands, and at most ONE thinking Brain where genuine reasoning is wanted. Hand-placing a brain to
fill in the next step's request or tidy the last step's reply is now forbidden: that is a door, and
doors are not canvas nodes. Image Studio lost its prompt-writing brain this way (7 nodes → 6).

## Shipped
AI Builder (create/restyle/remove components by typing, admin rulebook/HOUSE RULES, validated patches) ·
Product Blocks + Faces (4 live templates, empty-canvas picker + Custom) · full-page Preview with
Desktop/Tablet/Phone switcher · Arrange Editor (free drag, 8px snap, desktop-only layout, mobile auto-stack,
reset) · pin-composer dial · Face/Brain/Hands palette · canvas Tidy button.

## CORE — build next, in order (serves earning directly)
1. Editing hands: click-select, Delete, Duplicate, Undo/Redo, inline text edit, resize width,
   alignment guides + snap-to-siblings, right-click menu, open-in-Build jump (double-click/context), nudge keys.
2. Storytelling organs (minimum): text/heading block, image+logo upload (crop/alt), link buttons.
3. The AI moment: streaming "thinking…" states, designed failure/retry, customizable limit messages.
4. Money loop: on-page checkout (UPI/cards), customer accounts + saved history, guest try-now,
   lead capture + new-customer notifications, architect analytics, genuine review collection.
5. Credibility skin: pretty URLs (name.triven.ai) → custom domain, SEO/share settings (title/OG/favicon),
   draft-vs-published + secret preview link, starter page designs, pre-publish sanity check,
   test-as-customer mode, brand kit (logo+colors once).

## LATER — only when architects demand
Multi-select, group/ungroup, layers panel, z-order, align/distribute toolbar, lock/hide, spacing indicators,
per-component style panel, entrance animations, sticky elements, per-device tweaks, multi-screen pages,
comment pins, stock/AI asset library, FAQ/testimonial/how-it-works/pricing blocks, copy-paste style,
zoom canvas, saved components with instance sync, design version restore, contrast/tap-target guards,
first-run tour, multi-language copy, consent banner/legal links, downloadable results, share buttons.

## NEVER by default — the diversion line
General website building, deep animation systems, arbitrary marketing-page systems.
That is Webflow's war. Architects wanting full sites embed our agent instead.
