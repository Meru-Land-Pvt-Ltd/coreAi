/**
 * READING A VAPI CALL'S OWN ENVELOPE.
 *
 * Both the business dashboard and the analytics call list need the same two
 * facts off a stored call: which way it went, and which Triven number carried
 * it. The dashboard had these; analytics had its own guess at them, reading
 * root keys that the envelope does not contain — so every row on the analytics
 * screen showed a dash. They live here now so the two screens cannot drift,
 * and so neither module has to import the other.
 */

/** "inbound" | "outbound" from the stored Vapi webhook body; inbound when unknown. */
export function vapiCallDirection(metadataJson: unknown): "inbound" | "outbound" {
  if (!metadataJson || typeof metadataJson !== "object" || Array.isArray(metadataJson)) return "inbound";
  const body = metadataJson as Record<string, unknown>;

  const candidates: unknown[] = [];
  const message = body.message;
  if (message && typeof message === "object" && !Array.isArray(message)) {
    candidates.push((message as Record<string, unknown>).call);
  }
  candidates.push(body.call, body);

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const type = (candidate as Record<string, unknown>).type;
    if (typeof type === "string" && /outbound/i.test(type)) return "outbound";
  }
  return "inbound";
}

/**
 * The Triven number that actually received/placed this call, frozen into the
 * webhook envelope at call time. After a number reassignment the dashboard's
 * "current number" tile changes, but each history row keeps naming the number
 * that really handled it.
 */
export function vapiCallBusinessNumber(metadataJson: unknown): string | null {
  if (!metadataJson || typeof metadataJson !== "object" || Array.isArray(metadataJson)) return null;
  const body = metadataJson as Record<string, unknown>;

  const candidates: unknown[] = [];
  const message = body.message;
  if (message && typeof message === "object" && !Array.isArray(message)) {
    const messageRecord = message as Record<string, unknown>;
    const call = messageRecord.call;
    if (call && typeof call === "object" && !Array.isArray(call)) {
      candidates.push((call as Record<string, unknown>).metadata);
    }
  }
  const topCall = body.call;
  if (topCall && typeof topCall === "object" && !Array.isArray(topCall)) {
    candidates.push((topCall as Record<string, unknown>).metadata);
  }
  candidates.push(body.metadata, body);

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const value = (candidate as Record<string, unknown>).assignedPhoneNumber;
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}
