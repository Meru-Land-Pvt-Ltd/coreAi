/**
 * THE EXAMINATION HALL — where the Builder himself is tested.
 *
 * The founder's ruling (2026-08-26): the platform's code has 1,300 robot
 * inspectors; the employee had none. A machine that cannot break but an
 * employee who quietly got dumb still loses the customer. So the Builder
 * re-sits this exam every time his brain changes — the Soul, the
 * Intelligence, the menu — and every failure becomes a lesson and a new
 * exam question, forever.
 *
 * HOW A SITTING WORKS. Each exam is a real architect's sentence, run through
 * the REAL Builder — same Soul, same Intelligence, same checker, same model —
 * but the canvas lands nowhere: nothing is saved, no screen changes. The
 * marking is MECHANICAL and deterministic: which trigger, how many Face
 * pieces, did he ask when only a human could answer, did he use the human's
 * words exactly. No AI marks the AI — a marker that can hallucinate grades
 * would be the fox auditing the henhouse.
 *
 * WHAT IS DELIBERATELY NOT HERE: any exam shaped like the founder's next
 * blind test. Exams observe the Builder; they must never become the rehearsal
 * for a demonstration. The battery covers the LAWS, not the demo.
 */

import { decryptSecret, encryptSecret } from "../../lib/crypto";
import { prisma } from "../../lib/prisma";
import { saveBuilderLesson } from "./builder-lessons";
import { composeOrchestration, type ComposerResult } from "./composer/compose";

/* ------------------------------- the exams ------------------------------- */

export type BuilderExam = {
  id: string;
  /** Which law this exam guards, in the book's words. */
  law: string;
  /** What the architect says. */
  ask: string;
  /** Prior turns — for testing that an answered question is honoured. */
  conversation?: Array<{ role: "user" | "assistant"; content: string }>;
  expect: {
    /** The plan must contain exactly one trigger, of one of these types. */
    trigger?: string[];
    /** Node types that must appear somewhere in the plan. */
    mustInclude?: string[];
    /** Node types that must NOT appear. */
    mustNotInclude?: string[];
    /** Most Face pieces (block.*) allowed. */
    maxFacePieces?: number;
    /** Exactly this many Prompt Boxes. */
    promptBoxes?: number;
    /** The Builder should ASK (the third answer) instead of building. */
    shouldAsk?: boolean;
    /** The Builder must NOT ask — the request is complete. */
    mustNotAsk?: boolean;
    /** This exact text must appear verbatim somewhere in the plan's config. */
    verbatim?: string;
  };
};

export const EXAM_BATTERY: BuilderExam[] = [
  {
    id: "one-box-one-button",
    law: "The One-Button Law — the screen shows the question, never the machinery",
    ask: "a product where a customer pastes a confusing contract clause and reads a plain-English explanation on the page",
    expect: {
      trigger: ["trigger.manual"],
      mustInclude: ["block.prompt_composer", "ai.llm_call", "block.output_stage"],
      promptBoxes: 1,
      maxFacePieces: 2,
      mustNotAsk: true
    }
  },
  {
    id: "no-face-on-the-ear",
    law: "An agent nobody visits gets no Face",
    ask: "answer every email that arrives at the business with a short helpful reply",
    expect: {
      trigger: ["trigger.email_received"],
      mustInclude: ["communication.send_email"],
      maxFacePieces: 0,
      mustNotAsk: true
    }
  },
  {
    id: "no-face-on-the-clock",
    law: "An agent woken by a clock has no customer at its page",
    ask: "every morning at 8, write a short summary of yesterday's customer messages and email it to the owner",
    expect: {
      trigger: ["trigger.schedule"],
      mustInclude: ["communication.send_email"],
      maxFacePieces: 0
    }
  },
  {
    id: "reply-on-the-channel",
    law: "Reply on the channel they arrived on",
    ask: "when a customer emails us a question, answer it politely",
    expect: {
      trigger: ["trigger.email_received"],
      mustInclude: ["communication.send_email"],
      mustNotInclude: ["action.send_whatsapp"],
      maxFacePieces: 0
    }
  },
  {
    id: "sorting-is-a-condition",
    law: "A Brain thinks; a Condition sorts",
    ask: "if an incoming email is a complaint send it to the team unchanged, otherwise write a friendly reply",
    expect: {
      trigger: ["trigger.email_received"],
      mustInclude: ["logic.condition"]
    }
  },
  {
    id: "escalation-is-a-hand",
    law: "Handing to a human is a Hand, not a prompt",
    ask: "when a customer sounds angry or asks for a person, hand the conversation to the team",
    expect: {
      mustInclude: ["communication.escalate"]
    }
  },
  {
    id: "the-library-answers",
    law: "Knowledge answers from the business's own documents",
    ask: "a page where customers ask questions and the answers come from our uploaded documents",
    expect: {
      trigger: ["trigger.manual"],
      mustInclude: ["ai.knowledge", "ai.llm_call"],
      promptBoxes: 1
    }
  },
  {
    id: "the-outside-wakes-it",
    law: "Another app's delivery is the webhook's job",
    ask: "when our shop system sends us a new order, email the owner a confirmation",
    expect: {
      trigger: ["trigger.webhook"],
      mustInclude: ["communication.send_email"],
      maxFacePieces: 0
    }
  },
  {
    id: "ask-for-identity",
    law: "Identity is the human's — ask, with a proposal in hand",
    ask: "a website chatbot that greets our visitors in our special style and answers their questions",
    expect: {
      shouldAsk: true
    }
  },
  {
    id: "their-words-are-sacred",
    law: "Use the human's words exactly",
    ask: "a website chatbot that greets our visitors and answers their questions",
    conversation: [
      {
        role: "assistant",
        content: "What should the chatbot say when someone opens it? My suggestion: 'Hi! How can I help you today?'"
      },
      { role: "user", content: "Namaste! We are honoured to serve you today." }
    ],
    expect: {
      verbatim: "Namaste! We are honoured to serve you today.",
      mustNotAsk: true
    }
  },
  {
    id: "you-decide-means-decide",
    law: "'You decide' ends the questions",
    ask: "a website chatbot that greets visitors and answers their questions",
    conversation: [
      {
        role: "assistant",
        content: "What should the chatbot say when someone opens it? My suggestion: 'Hi! How can I help you today?'"
      },
      { role: "user", content: "you decide everything, just build it" }
    ],
    expect: {
      mustNotAsk: true,
      trigger: ["trigger.manual"]
    }
  },
  {
    id: "never-ask-about-machinery",
    law: "Machinery is the Builder's own job",
    ask: "thank every customer who emails us, warmly, signed by the business",
    expect: {
      trigger: ["trigger.email_received"],
      mustInclude: ["communication.send_email"],
      mustNotAsk: true,
      maxFacePieces: 0
    }
  },
  {
    id: "one-trigger-per-agent",
    law: "One agent, one way in",
    ask: "an agent that answers customer emails",
    expect: {
      trigger: ["trigger.email_received"],
      mustNotInclude: ["trigger.manual", "trigger.schedule", "trigger.webhook"]
    }
  }
];

/* ------------------------------- the marking ------------------------------ */

export type ExamMark = {
  id: string;
  law: string;
  passed: boolean;
  /** What went wrong, in plain words — empty when passed. */
  faults: string[];
  /** What the Builder actually did, one line, for the report. */
  did: string;
};

type PlanShape = {
  nodes: Array<{ id: string; type: string; title?: string; config?: Record<string, unknown> }>;
  edges: Array<{ from: string; to: string }>;
};

/** Mechanical, deterministic marking — no AI grades the AI. */
export function markExam(exam: BuilderExam, result: ComposerResult): ExamMark {
  const faults: string[] = [];
  const expect = exam.expect;

  const asked = !result.ok && "ask" in result;

  if (expect.shouldAsk) {
    if (!asked) {
      faults.push(
        result.ok
          ? "Built without asking — identity or taste was invented instead of asked for."
          : "Failed outright instead of asking the one human question."
      );
    } else {
      const ask = (result as { ask: { question: string; suggestion: string } }).ask;
      if (!ask.suggestion.trim()) faults.push("Asked empty-handed — a question must carry a proposal.");
      if ((ask.question.match(/\?/g) ?? []).length > 1) {
        faults.push("Asked more than one question at a time.");
      }
    }
    return {
      id: exam.id,
      law: exam.law,
      passed: faults.length === 0,
      faults,
      did: asked ? `asked: "${(result as { ask: { question: string } }).ask.question.slice(0, 90)}"` : result.ok ? "built a plan" : "failed"
    };
  }

  if (asked && expect.mustNotAsk) {
    faults.push(`Asked when the request was complete: "${(result as { ask: { question: string } }).ask.question.slice(0, 90)}"`);
    return { id: exam.id, law: exam.law, passed: false, faults, did: "asked instead of building" };
  }

  if (!result.ok) {
    faults.push(`Did not produce a plan: ${result.message.slice(0, 140)}`);
    return { id: exam.id, law: exam.law, passed: false, faults, did: "failed" };
  }

  const plan = result.plan as unknown as PlanShape;
  const types = plan.nodes.map((node) => node.type);
  const triggers = types.filter((type) => type.startsWith("trigger."));
  const facePieces = types.filter((type) => type.startsWith("block."));
  const promptBoxes = types.filter((type) => type === "block.prompt_composer");

  if (expect.trigger) {
    if (triggers.length !== 1) faults.push(`Expected exactly one trigger; found ${triggers.length}.`);
    else if (!expect.trigger.includes(triggers[0]!)) {
      faults.push(`Wrong way in: ${triggers[0]} (expected ${expect.trigger.join(" or ")}).`);
    }
  }
  for (const type of expect.mustInclude ?? []) {
    if (!types.includes(type)) faults.push(`Missing ${type} — the job cannot be done without it.`);
  }
  for (const type of expect.mustNotInclude ?? []) {
    if (types.includes(type)) faults.push(`Placed ${type}, which this job must not carry.`);
  }
  if (expect.maxFacePieces !== undefined && facePieces.length > expect.maxFacePieces) {
    faults.push(`${facePieces.length} Face pieces where at most ${expect.maxFacePieces} belong — the monster.`);
  }
  if (expect.promptBoxes !== undefined && promptBoxes.length !== expect.promptBoxes) {
    faults.push(`${promptBoxes.length} Prompt Boxes (expected ${expect.promptBoxes}).`);
  }
  if (expect.verbatim) {
    const everywhere = JSON.stringify(plan.nodes);
    if (!everywhere.includes(expect.verbatim)) {
      faults.push("The human's exact words were not used — they were improved, summarised or dropped.");
    }
  }

  return {
    id: exam.id,
    law: exam.law,
    passed: faults.length === 0,
    faults,
    did: `built ${plan.nodes.length} steps: ${types.join(", ").slice(0, 120)}`
  };
}

/* ------------------------------- the sitting ------------------------------ */

export type ExamReport = {
  satAt: string;
  total: number;
  passed: number;
  marks: ExamMark[];
};

const REPORT_KEY = "builderExamReport";

/**
 * One full sitting. Real Builder, real model, sandboxed outcome — nothing is
 * saved to any canvas. Sequential on purpose: a parallel stampede of compose
 * calls is how a rate limit turns an exam into a lottery.
 */
export async function runBuilderExams(architectUserId: string): Promise<ExamReport> {
  const marks: ExamMark[] = [];

  for (const exam of EXAM_BATTERY) {
    let result: ComposerResult;
    try {
      result = await composeOrchestration({
        architectUserId,
        want: exam.ask,
        ...(exam.conversation ? { conversation: exam.conversation } : {})
      });
    } catch (error) {
      marks.push({
        id: exam.id,
        law: exam.law,
        passed: false,
        faults: [`The sitting itself broke: ${error instanceof Error ? error.message : String(error)}`],
        did: "crashed"
      });
      continue;
    }
    marks.push(markExam(exam, result));
  }

  /* THE LOOP'S OPEN ARM, CLOSED (the founder's law).
     This file's own header promises "every failure becomes a lesson and a
     new exam question, forever". In code it did not: a sitting wrote a
     report and stopped, and the only thing that ever created a lesson was an
     architect pressing "Teach the Builder" by hand. So the learning arm of
     the Triven Loop was a human, and a fault the Builder made on Monday it
     was free to make again on Tuesday.

     A failed mark now writes its own lesson, in the words of the law it
     broke, and that lesson rides the next compose like any other. Costs
     nothing — the lesson store is a database row, not a model call. */
  for (const mark of marks) {
    if (mark.passed || mark.faults.length === 0) continue;
    await saveBuilderLesson({
      architectUserId,
      note: `${mark.law}: ${mark.faults[0]}`
    }).catch((error: unknown) =>
      console.error("[builder-exams] a failed mark could not become a lesson", {
        exam: mark.id,
        error: error instanceof Error ? error.message : String(error)
      })
    );
  }

  const report: ExamReport = {
    satAt: new Date().toISOString(),
    total: marks.length,
    passed: marks.filter((mark) => mark.passed).length,
    marks
  };

  /* The last report is kept where the admin reads it — a report nobody can
     find afterwards is an exam that never happened. */
  await prisma.platformApiSetting
    .upsert({
      /* ONE RULE FOR THIS TABLE: what sits in `valueEncrypted` is encrypted.
         This row used to be written as plain JSON, so the settings loader —
         which decrypts every row it finds — warned about it on every single
         boot. A warning that is always there is a warning nobody reads, and
         the day a real key fails to decrypt it would have scrolled past with
         the rest. */
      where: { key: REPORT_KEY },
      update: { valueEncrypted: encryptSecret(JSON.stringify(report)), secret: false },
      create: { key: REPORT_KEY, valueEncrypted: encryptSecret(JSON.stringify(report)), secret: false }
    })
    .catch(() => undefined);

  return report;
}

/** The last sitting's report, or null when the hall has never opened. */
export async function lastExamReport(): Promise<ExamReport | null> {
  const row = await prisma.platformApiSetting
    .findUnique({ where: { key: REPORT_KEY }, select: { valueEncrypted: true } })
    .catch(() => null);
  if (!row) return null;
  try {
    return JSON.parse(decryptSecret(row.valueEncrypted)) as ExamReport;
  } catch {
    /* A sitting saved before this row was encrypted. Read it as it was
       written, so a real report is not thrown away by the change. */
    try {
      return JSON.parse(row.valueEncrypted) as ExamReport;
    } catch {
      return null;
    }
  }
}
