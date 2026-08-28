import { prisma } from "../../lib/prisma";

/**
 * THE BUILDER REMEMBERS THE CONVERSATION.
 *
 * It never did. Every message an architect and the AI Builder exchanged
 * lived in one React state object and nowhere else, so closing the tab or
 * logging out erased the lot. The founder found it the honest way: he closed
 * Chrome, signed back in, and the Builder had forgotten an hour of work —
 * including what it had told him he still needed to do.
 *
 * The conversation IS the record of how an agent came to be what it is. It
 * is kept.
 *
 * Two rules here. Writing must never break the thing it records — a
 * conversation that cannot be saved is a shame, a build that dies because
 * of it is a disaster. And reading is bounded: an architect who has been at
 * one agent for months does not want ten thousand messages poured into a
 * panel, so the most recent page comes back and older ones are asked for.
 */

/** How many messages one page of history carries. */
export const BUILDER_HISTORY_PAGE = 60;

export type BuilderTurn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  hand: string | null;
  at: string;
};

/**
 * Write one turn down. Best-effort by design: it is wrapped, it logs loudly,
 * and it never throws into the caller. Losing the record of a message must
 * never cost the architect the message itself.
 */
export async function rememberBuilderTurn(input: {
  workflowId: string;
  architectUserId: string;
  role: "user" | "assistant";
  content: string;
  hand?: string | null;
}): Promise<void> {
  const content = (input.content ?? "").trim();
  if (!content) return;

  try {
    await prisma.builderMessage.create({
      data: {
        workflowId: input.workflowId,
        architectUserId: input.architectUserId,
        role: input.role,
        content: content.slice(0, 20_000),
        hand: input.hand ?? null
      }
    });
  } catch (error) {
    console.error("[builder-conversation] a turn could not be remembered", {
      workflowId: input.workflowId,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * The conversation, newest page first but returned in reading order.
 *
 * `before` walks backwards through time for the scrollback, so an architect
 * can read their way to the beginning without the panel ever loading a whole
 * year at once.
 */
export async function readBuilderConversation(input: {
  workflowId: string;
  architectUserId: string;
  before?: string;
}): Promise<{ turns: BuilderTurn[]; more: boolean }> {
  const rows = await prisma.builderMessage.findMany({
    where: {
      workflowId: input.workflowId,
      architectUserId: input.architectUserId,
      ...(input.before ? { at: { lt: new Date(input.before) } } : {})
    },
    orderBy: { at: "desc" },
    take: BUILDER_HISTORY_PAGE + 1
  });

  const more = rows.length > BUILDER_HISTORY_PAGE;
  const page = more ? rows.slice(0, BUILDER_HISTORY_PAGE) : rows;

  return {
    turns: page
      .map((row) => ({
        id: row.id,
        role: row.role === "user" ? ("user" as const) : ("assistant" as const),
        content: row.content,
        hand: row.hand,
        at: row.at.toISOString()
      }))
      .reverse(),
    more
  };
}
