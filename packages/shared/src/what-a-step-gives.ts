/**
 * WHAT A STEP HANDS ON, IN THE ARCHITECT'S WORDS.
 *
 * The founder's ruling, 2026-08-28. The Telegram trigger printed twenty-four
 * raw names on its card — `trigger.telegram.callback.data`,
 * `trigger.telegram.sender.lastName` — and asked a non-technical architect to
 * make something of them. His question was the right one: what does a paying
 * architect DO with that? Almost nothing. They never type those names; the
 * doors wire the steps. The one real use is dropping a single field into a
 * prompt, and a wall of twenty-four is a terrible way to find one.
 *
 * The cost is not the wasted space. A three-step agent read as a control
 * panel, and the platform was speaking OUR words on THEIR screen — the same
 * law we hold for a customer's page, broken on the architect's.
 *
 * Measured before writing this: across 53 nodes the average card lists 3
 * names. Telegram lists 24. So the pattern was never wrong — one node was,
 * and it happens to be the first node most architects ever touch.
 *
 * This groups the raw names into the few things a person actually means, and
 * is deliberately MECHANICAL — no AI, no per-node table to maintain. A node
 * shipped next year is summarised the day its row exists.
 */

/** One idea an architect recognises, and the names that belong to it. */
const IDEAS: Array<{ words: string; matches: RegExp }> = [
  { words: "the message", matches: /(^|\.)(text|message\.text|body|caption|transcript|prompt)$/i },
  { words: "who sent it", matches: /(^|\.)(sender|contact|caller|from|user_id|username|customer)(\.|$)/i },
  { words: "the conversation", matches: /(^|\.)(chat|thread|conversation|chat_id)(\.|$)/i },
  { words: "any photo or file", matches: /(^|\.)(media|file|attachment|image|photo|document)(\.|$)/i },
  { words: "where they are", matches: /(^|\.)(location|latitude|longitude|address|timezone)(\.|$)/i },
  { words: "what they tapped", matches: /(^|\.)(callback|button|choice|action)(\.|$)/i },
  { words: "the booking", matches: /(^|\.)(event|appointment|booking|invitee|slot)(\.|$)/i },
  { words: "the answer", matches: /(^|\.)(output|answer|result|reply|completion)(\.|$)/i },
  { words: "the email", matches: /(^|\.)(email|mail|subject)(\.|$)/i },
  { words: "the lead", matches: /(^|\.)(lead|contact_id|crm)(\.|$)/i }
];

/** Turn one raw name into something readable, when no idea claims it. */
function readable(name: string): string {
  const last = name.split(".").pop() ?? name;
  return last
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .trim();
}

/**
 * The few things this step hands on, in plain words.
 *
 * Never more than `limit` — a card that needs a scrollbar has stopped being a
 * card. Anything beyond it is counted, not listed, so the architect knows
 * there is more without being buried in it.
 */
export function whatAStepGives(
  producedVariables: readonly string[] | undefined,
  limit = 3
): { words: string[]; more: number } {
  const names = (producedVariables ?? []).filter((name) => typeof name === "string" && name.trim());
  if (names.length === 0) return { words: [], more: 0 };

  const found: string[] = [];
  const claimed = new Set<string>();

  for (const idea of IDEAS) {
    if (!names.some((name) => idea.matches.test(name))) continue;
    found.push(idea.words);
    for (const name of names) if (idea.matches.test(name)) claimed.add(name);
  }

  /* Anything no idea claimed still deserves a word, in the order it was
     declared — a node we have never seen before is summarised, not ignored. */
  for (const name of names) {
    if (claimed.has(name)) continue;
    const word = readable(name);
    if (word && !found.includes(word)) found.push(word);
  }

  return { words: found.slice(0, limit), more: Math.max(0, found.length - limit) };
}
