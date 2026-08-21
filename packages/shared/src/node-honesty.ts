/**
 * DID THIS STEP DO WHAT IT SAID IT WOULD?
 *
 * The Node Frame made this impossible to get wrong for connectors: a connector
 * declares what it produces, and the engine refuses to record success without
 * it. Everywhere else on the platform the declaration exists and nobody reads
 * it.
 *
 * That is not a theory. The calendar step that answered a real caller with
 * three invented appointment times ALREADY declared five things it produces —
 * appointment.status, appointment.confirmation_id, appointment.date,
 * appointment.time, appointment.calendar_event_id. It returned none of them and
 * was written down as a success. The information needed to catch it was sitting
 * in the registry the whole time.
 *
 * This is the comparison. One function, run in one place, for every node.
 *
 * Three answers, never two:
 *
 *   proven      — it declared something and returned it.
 *   unproven    — it declared something and did not return it. This is the one
 *                 that has been hiding.
 *   cannot-tell — it declares nothing, so no answer is possible.
 *
 * "Cannot tell" is deliberately not folded into "proven". A step nobody can
 * judge is not a step that is fine; it is a blind spot, and counting it as a
 * pass is how the whole platform came to look green.
 */

export type NodeHonesty = {
  verdict: "proven" | "unproven" | "cannot-tell";
  /** Names the step declared and did not return. */
  missing: string[];
  /** Plain words, for whoever has to act on it. */
  message: string;
};

/**
 * Is this value a real answer?
 *
 * An empty LIST is: "no leads matched" and "the provider is broken" must never
 * collapse into the same outcome, and a step that genuinely found nothing did
 * its job. Undefined, null and a blank string are not.
 */
function isRealAnswer(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (typeof value === "object" && !Array.isArray(value)) {
    return Object.keys(value as Record<string, unknown>).length > 0;
  }
  return true;
}

/**
 * Find a declared name in whatever shape the step returned it.
 *
 * Declarations are written with dots — "appointment.status" — but a step may
 * hand back a flat key of that exact name, or a nested object, or park it in
 * the run's variables instead of its output. All three are normal and all three
 * mean the step did its job, so all three are looked for. Being strict about
 * the shape here would produce a wall of false alarms on day one, and a false
 * alarm is how a real one stops being read.
 */
function findDeclared(name: string, sources: Array<Record<string, unknown> | undefined>): unknown {
  for (const source of sources) {
    if (!source) continue;

    if (name in source && isRealAnswer(source[name])) return source[name];

    let current: unknown = source;
    let found = true;
    for (const step of name.split(".")) {
      if (current === null || typeof current !== "object") {
        found = false;
        break;
      }
      current = (current as Record<string, unknown>)[step];
    }
    if (found && isRealAnswer(current)) return current;

    // The last part on its own: a step declaring "appointment.status" that
    // returns { status: "booked" } has plainly done the thing.
    const tail = name.split(".").pop();
    if (tail && tail !== name && tail in source && isRealAnswer(source[tail])) return source[tail];
  }
  return undefined;
}

export function checkNodeOutput(input: {
  /** What the registry says this node type produces. */
  declares: readonly string[] | undefined;
  /**
   * The node type says plainly that it hands on nothing.
   *
   * That is an answer, not a shrug: a trigger fired by a person pressing a
   * button really does produce nothing, and it passes. Only a step nobody has
   * described at all is a blind spot.
   */
  producesNothing?: boolean;
  /** What the step handed back. */
  output?: Record<string, unknown>;
  /** The run's variables, where some steps park their result instead. */
  variables?: Record<string, unknown>;
  /** Only a claim of success is worth checking. */
  status: string;
}): NodeHonesty {
  const status = (input.status ?? "").toLowerCase();

  // A step that already said it failed is being honest. A step that was skipped
  // never ran. Neither is what this is looking for.
  if (status !== "success") {
    return { verdict: "cannot-tell", missing: [], message: "Not a claim of success." };
  }

  if (input.producesNothing) {
    return { verdict: "proven", missing: [], message: "This step hands nothing on, and is not meant to." };
  }

  const declares = (input.declares ?? []).filter((name) => typeof name === "string" && name.trim());
  if (declares.length === 0) {
    return {
      verdict: "cannot-tell",
      missing: [],
      message: "This step does not say what it produces, so nothing can check whether it did."
    };
  }

  const missing = declares.filter(
    (name) => findDeclared(name, [input.output, input.variables]) === undefined
  );

  if (missing.length === 0) {
    return { verdict: "proven", missing: [], message: "Produced everything it said it would." };
  }

  return {
    verdict: "unproven",
    missing,
    message:
      missing.length === declares.length
        ? `This step reported success and returned none of the ${declares.length} things it says it produces.`
        : `This step reported success but did not return ${missing.join(", ")}.`
  };
}
