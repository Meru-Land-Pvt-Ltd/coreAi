/**
 * "Can I talk to a person?"
 *
 * This file used to hold a whole second AI that answered text messages on its
 * own — its own prompt, its own knowledge lookup, its own rules. That belonged
 * to the missed-call product, which is closed, and the agents an architect
 * builds now answer through the engine instead. Nothing called it, so it went.
 *
 * What is left is the one line that is still true on every channel: hearing a
 * customer ask for a human. The channel runtimes ask this before they let the
 * AI reply, so a person who wants a person is never talked at by a machine.
 */

const HUMAN_REQUEST_PATTERN =
  /\b(talk|speak|connect)\s+(to|with)\s+(a\s+|the\s+)?(human|person|someone|agent|manager|staff|receptionist)\b|\b(real|actual)\s+(person|human)\b|\bstop\s+the\s+bot\b|\bare you a (bot|robot)\b.*\bhuman\b/i;

export function detectHumanRequest(text: string): boolean {
  return HUMAN_REQUEST_PATTERN.test(text);
}
