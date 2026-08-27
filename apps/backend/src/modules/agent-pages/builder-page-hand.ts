/**
 * THE BUILDER'S PAGE HAND — one employee, one door, one round trip.
 *
 * The founder's ruling (2026-08-27): "It's like the backend and the frontend
 * are done by two people — how can we expect synchronous results?"
 *
 * Before this, one conversation cost THREE calls: the router decided it was
 * a page ask, a second employee ("the AI Builder") changed the screen,
 * and if the ask turned out to be about packaging a THIRD employee handled
 * it. Three briefings, three strangers, none remembering the others — and
 * that is how a Telegram agent, a machine with no page at all, was handed a
 * website screen.
 *
 * Now the Builder owns all of it. He carries the one mind (who he is, the
 * laws, the manners, this architect's lessons), the tools do the mechanical
 * work, and the eyes verify the change actually happened before he claims it.
 */

import { prisma } from "../../lib/prisma";
import { resolveBrainSlot } from "../admin/brain-slot-settings";
import { getBuilderBrainConfig } from "../admin/builder-brain-settings";
import { builderMind } from "../architect/builder-mind";
import { judgeLook, lookAt } from "../architect/builder-looks";
import { verifyDesignChange } from "./designer-eyes";
import { saveProductSpec } from "./product-spec-service";
import { buildProductChatSystemPrompt, summarizeAgentGraph } from "./product-chat";
import {
  PAGE_BOUNDARY_REPLY,
  PAGE_FALLBACK_REPLY,
  buildPageBriefing,
  isPackagingRequest,
  loadComposerContext,
  runComposerBrain
} from "./smart-composer";

export type PageHandResult = {
  reply: string;
  product: unknown;
  /** "packaging" when the ask was outside the product's own screen. */
  boundary: "packaging" | null;
};

export async function builderPageHand(input: {
  architectUserId: string;
  workflowId: string;
  instruction: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
}): Promise<PageHandResult> {
  const workflow = await prisma.workflowDefinition.findFirst({
    where: { id: input.workflowId, architectUserId: input.architectUserId },
    select: { id: true, name: true, purpose: true, workflowJson: true }
  });
  if (!workflow) {
    return { reply: "That agent could not be found.", product: null, boundary: null };
  }

  const context = await loadComposerContext(workflow as never);

  const brain = resolveBrainSlot(await getBuilderBrainConfig());
  if (!brain) {
    return {
      reply: "No AI service is switched on yet, so nothing can be changed. An admin sets that up in Manage API.",
      product: context.unchangedProduct(),
      boundary: null
    };
  }

  /* ONE MIND. The identity, the laws and the manners come from the same
     place every other hand reads — so the employee designing this screen is
     the same one who built the machine behind it. */
  const mind = await builderMind({
    hand: "design-page",
    architectUserId: input.architectUserId,
    focus: input.instruction
  });

  /* PACKAGING IS A HAND, NOT A REFUSAL (2026-08-27). A sell page, pricing
     or a policy page used to be handed to a THIRD employee in a second
     round trip. The same Builder does it, with the packaging tools that
     survived that employee's deletion. */
  if (isPackagingRequest(input.instruction)) {
    const packaged = await runComposerBrain({
      brain,
      systemPrompt: `${mind}\n\n${buildProductChatSystemPrompt({
        agent: {
          name: context.agent.name,
          tagline: context.agent.tagline ?? null,
          shortDescription: null,
          iconUrl: null,
          priceCents: null,
          pricingModel: null
        } as never,
        graph: summarizeAgentGraph(workflow.workflowJson),
        current: context.stored
      })}`,
      conversationHistory: input.history.map((turn) => ({ role: turn.role, content: turn.content })),
      userMessage: input.instruction,
      declarations: context.declarations,
      graphNodeIds: context.graphNodeIds,
      allowBoundary: false,
      /* A packaging page has no customer questions to place — the buyer
         contract check belongs to the product screen, not to a sell page. */
      validate: () => ({ product: null, violations: [] }),
      task: "builder-packaging-hand",
      workflowId: input.workflowId
    });

    if (packaged.kind === "composed") {
      const saved = await saveProductSpec(context.page.id, packaged.product);
      return { reply: packaged.reply, product: saved ?? packaged.product, boundary: "packaging" };
    }
    return { reply: PAGE_BOUNDARY_REPLY, product: context.unchangedProduct(), boundary: "packaging" };
  }

  const outcome = await runComposerBrain({
    brain,
    systemPrompt: `${mind}\n\n${buildPageBriefing({
      agent: context.agent,
      declarations: context.declarations,
      current: context.stored
    })}`,
    conversationHistory: input.history.map((turn) => ({ role: turn.role, content: turn.content })),
    userMessage: input.instruction,
    declarations: context.declarations,
    graphNodeIds: context.graphNodeIds,
    allowBoundary: true,
    task: "builder-page-hand",
    workflowId: input.workflowId
  });

  if (outcome.kind === "boundary") {
    return { reply: outcome.reply, product: context.unchangedProduct(), boundary: "packaging" };
  }
  if (outcome.kind !== "composed") {
    return { reply: PAGE_FALLBACK_REPLY, product: context.unchangedProduct(), boundary: null };
  }

  /* THE EYES. The page hand once claimed a change three times while nothing
     moved. Every change is LOOKED AT before it is claimed. */
  const before = context.stored ?? context.unchangedProduct();
  const verdict = await verifyDesignChange({
    brain,
    instruction: input.instruction,
    before,
    after: outcome.product,
    workflowId: input.workflowId
  });

  let saved = await saveProductSpec(context.page.id, outcome.product);

  /* THE BUILDER LOOKS AT HIS OWN WORK (the founder's ruling, 2026-08-27).
     Saving is not finishing. The page is rendered in a real browser, the
     picture is judged against what was asked, and a failure gets ONE
     corrective pass with the exact problems — then it is looked at again.
     The Builder only claims what the look confirmed. */
  let claim = outcome.reply;
  const slug = context.page.slug;
  if (slug) {
    const look = await lookAt({ path: `/a/${slug}` });
    if ("image" in look) {
      const judged = await judgeLook({ ask: input.instruction, look });
      if (!judged.works && judged.problems.length > 0) {
        const second = await runComposerBrain({
          brain,
          systemPrompt: `${mind}\n\n${buildPageBriefing({
            agent: context.agent,
            declarations: context.declarations,
            current: outcome.product
          })}`,
          conversationHistory: [],
          userMessage: `You built this and then looked at it. It is not right yet:\n${judged.problems
            .map((problem) => `- ${problem}`)
            .join("\n")}\n\nFix exactly these and return the COMPLETE product.`,
          declarations: context.declarations,
          graphNodeIds: context.graphNodeIds,
          allowBoundary: false,
          task: "builder-page-hand-after-looking",
          workflowId: input.workflowId
        });

        if (second.kind === "composed") {
          saved = await saveProductSpec(context.page.id, second.product);
          claim = second.reply;
          const again = await lookAt({ path: `/a/${slug}` });
          if ("image" in again) {
            const rejudged = await judgeLook({ ask: input.instruction, look: again });
            if (!rejudged.works && rejudged.problems.length > 0) {
              /* Two looks and still wrong: say so. A quiet pass here is the
                 lie this whole loop exists to prevent. */
              claim = `${second.reply} I looked at it twice and one thing is still not right: ${rejudged.problems[0]}`;
            }
          }
        } else {
          claim = `${outcome.reply} I looked at it and it is not right yet: ${judged.problems[0]}`;
        }
      }
    }
  }

  /* Never claim more than the look confirmed — the founder caught this hand
     announcing a change three times while nothing had moved. */
  const honest =
    verdict && !verdict.satisfied && verdict.problems.length > 0
      ? `${claim} One thing I could not get right: ${verdict.problems[0]}`
      : claim;

  return { reply: honest, product: saved ?? outcome.product, boundary: null };
}
