/**
 * SALES TUNING — the dials behind a voice agent's behaviour.
 *
 * Every number in this file comes from measured data on real sales calls, not
 * from taste. The sources are named on each control so that when someone moves
 * a slider away from the default they can see what they are arguing with.
 *
 * Principal sources:
 *  - Gong, "9 Secret Elements of Highly Effective Cold Calls" — 100,000 recorded
 *    cold calls. Talk ratio, monologue length, opener lifts, closing question.
 *  - Gong Labs, objection handling — 67,149 recorded calls from a 1M+ database.
 *    Top performers pause ~5x longer after an objection and hold their pace;
 *    weak reps speed up from 173 to 188 wpm and rebut for 21 seconds straight.
 *  - Gong Labs, pricing — 11,331 opportunities: 42% win rate when price is
 *    discussed on the first call, 5% when it is never mentioned.
 *  - Invoca, 60M+ real phone calls: only 35% of agents ever ask for the sale.
 *  - Benki/Conrad et al. (Univ. of Michigan ISR), 1,380 recorded introductory
 *    calls by 100 interviewers: a moderately fast pace with FREQUENT SHORT
 *    PAUSES beat both slow speech and perfectly fluent speech.
 *  - Stivers et al., PNAS 2009: human turn-taking gaps peak at 0–200ms across
 *    ten languages. That is the bar a voice agent is measured against.
 *  - Gollwitzer & Sheeran meta-analysis (94 tests): naming when/where/how an
 *    action will happen ("implementation intention") beats an open-ended ask.
 *  - Carpenter/Dolinski BYAF meta-analyses (42 and 52 studies, g = 0.44):
 *    "you're completely free to say no" reliably increases compliance.
 *
 * One source of truth: the editor renders these controls, and the Vapi deploy
 * reads the same definitions. A slider that does not change the call is worse
 * than no slider at all.
 */

export type SalesTuningControl = {
  key: string;
  /** Plain-English label for a non-technical operator. */
  label: string;
  /** What moving it actually does, in one sentence. */
  help: string;
  min: number;
  max: number;
  step: number;
  /** Research-backed starting point. */
  default: number;
  /** Words shown at the low and high end of the track. */
  lowLabel: string;
  highLabel: string;
  /** Rendered under the slider so the operator sees the real value. */
  format: (value: number) => string;
  /** The evidence for the default. Shown as a tooltip/footnote. */
  evidence: string;
};

const seconds = (value: number) => `${value.toFixed(2)}s`;
const scale4 = (labels: [string, string, string, string]) => (value: number) =>
  labels[Math.max(0, Math.min(3, Math.round(value)))];

export const SALES_TUNING_CONTROLS: SalesTuningControl[] = [
  {
    key: "responseDelay",
    label: "Answer speed",
    help: "How long she waits after you stop talking before she starts. Lower feels human; too low and she jumps on the end of your sentence.",
    min: 0,
    max: 1.5,
    step: 0.05,
    default: 0.2,
    lowLabel: "Instant",
    highLabel: "Thoughtful",
    format: seconds,
    evidence:
      "Human conversation gaps peak at 0–200ms (Stivers, PNAS 2009). Production voice agents sit near 700ms; anything past 1.2s and callers interrupt or hang up."
  },
  {
    key: "interruptSensitivity",
    label: "Stops when you speak",
    help: "How readily she goes quiet the moment you start talking. High means she stops on your first word. Low means she finishes her sentence first.",
    min: 0,
    max: 3,
    step: 1,
    default: 1,
    lowLabel: "Finishes her point",
    highLabel: "Stops instantly",
    format: scale4(["Finishes her sentence", "Stops after a few words", "Stops quickly", "Stops on your first word"]),
    evidence:
      "The maximum setting sounds worse than the minimum. On a live test every sound stopped her mid-word and she restarted over and over, saying 'I'm here' five times in one call. A real person finishes the short phrase they are in the middle of and stops for a real interruption — so a single 'yeah' or 'mm-hmm' must not derail her."
  },
  {
    key: "interruptRecovery",
    label: "Pause after being cut off",
    help: "Once you interrupt her, how long she waits before speaking again. Too short and you get two people talking at once.",
    min: 0.2,
    max: 2.5,
    step: 0.1,
    default: 1,
    lowLabel: "Jumps back in",
    highLabel: "Waits politely",
    format: seconds,
    evidence: "A person who is cut off waits for you to finish. One second reads as polite; under 0.4s reads as a machine queueing."
  },
  {
    key: "speakingPace",
    label: "Speaking pace",
    help: "How fast she talks.",
    min: 0.8,
    max: 1.2,
    step: 0.05,
    default: 1,
    lowLabel: "Slow",
    highLabel: "Fast",
    format: (value) => `${value.toFixed(2)}x`,
    evidence:
      "Real sales calls average 173 wpm (Gong, 67,149 calls). The Michigan study of 1,380 live calls found a moderately fast pace beat both slow and very fast speakers."
  },
  {
    key: "maxTurnSeconds",
    label: "Longest she talks without stopping",
    help: "Caps how long a single answer can run before she hands the call back.",
    min: 8,
    max: 45,
    step: 1,
    default: 25,
    lowLabel: "Clipped",
    highLabel: "Explains fully",
    format: (value) => `${Math.round(value)}s`,
    evidence:
      "Successful cold calls contain bursts of 25–37 seconds — clipped one-liners lose too. Across 67,149 demos, no closed-won call ever contained an uninterrupted stretch over 76 seconds."
  },
  {
    key: "empathy",
    label: "Warmth and empathy",
    help: "How much she names what you're feeling before moving on. High means she reacts to your problem like a person before asking her next question.",
    min: 0,
    max: 3,
    step: 1,
    default: 3,
    lowLabel: "Straight to business",
    highLabel: "Reads the room",
    format: scale4(["Businesslike", "Acknowledges", "Warm", "Reads the room"]),
    evidence:
      "Naming the other person's position out loud ('it sounds like…') measurably lowers their threat response (Lieberman, 2007) and repeating their own words back raised tipping from 61% to 81% in a field experiment."
  },
  {
    key: "assertiveness",
    label: "How hard she closes",
    help: "How firmly she asks for the meeting, and how many times she'll ask again after a soft no.",
    min: 0,
    max: 3,
    step: 1,
    default: 2,
    lowLabel: "Gentle",
    highLabel: "Relentless",
    format: scale4(["Never pushes", "Asks once", "Asks, then asks again", "Asks until they say no twice"]),
    evidence:
      "Only 35% of agents ever ask for the business across 60M+ calls (Invoca). But repeated closing attempts LOWER success on considered purchases (Rackham) — two asks is the evidence-backed ceiling."
  },
  {
    key: "fillers",
    label: "Natural speech",
    help: "How much she sounds off-the-cuff — 'yeah', 'right', 'okay so', small pauses mid-sentence.",
    min: 0,
    max: 3,
    step: 1,
    default: 2,
    lowLabel: "Polished",
    highLabel: "Off the cuff",
    format: scale4(["Scripted", "Light", "Natural", "Very casual"]),
    evidence:
      "Interviewers who paused frequently outperformed perfectly fluent ones on 1,380 real calls. Gong found filler words have no measurable effect on win rate across ~500,000 calls — so there is no reason to sound polished."
  },
  {
    key: "objectionPause",
    label: "Patience after pushback",
    help: "How much longer she pauses when you object or challenge her, before she answers.",
    min: 1,
    max: 8,
    step: 0.5,
    default: 5,
    lowLabel: "Answers straight back",
    highLabel: "Lets it sit",
    format: (value) => `${value.toFixed(1)}x normal`,
    evidence:
      "Top performers pause about 5x longer after an objection than elsewhere in the call; average reps pause almost not at all and rebut for 21 seconds (Gong, 67,149 calls)."
  },
  {
    key: "maxQuestions",
    label: "How many questions she asks",
    help: "The ceiling on questions in one call. On a first outbound call, more questions do not help — it turns into an interview.",
    min: 1,
    max: 14,
    step: 1,
    default: 4,
    lowLabel: "Just pitches",
    highLabel: "Full discovery",
    format: (value) => `${Math.round(value)} questions`,
    evidence:
      "Gong found zero statistical difference in question count between successful and failed cold calls. On booked discovery calls the optimum is 11–14 — so raise this only for that kind of call."
  },
  {
    key: "expressiveness",
    label: "Voice expressiveness",
    help: "How much her delivery moves — pitch, emphasis, emotion. Low is steady and corporate; high is alive but occasionally over-eggs a word.",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.9,
    lowLabel: "Flat and steady",
    highLabel: "Alive",
    format: (value) => `${Math.round(value * 100)}%`,
    evidence:
      "Volume variation and emphasis are the specific cues that read as confidence and shift attitudes (Van Zant & Berger, JPSP 2020, four experiments). A perfectly even delivery is the flattest tell that nobody is home."
  },
  {
    key: "talkRatio",
    label: "How much she talks",
    help: "Her share of the conversation. On a call she placed, she should carry it. On a discovery call, she should listen.",
    min: 35,
    max: 70,
    step: 1,
    default: 55,
    lowLabel: "Mostly listens",
    highLabel: "Mostly talks",
    format: (value) => `${Math.round(value)}% her`,
    evidence:
      "The famous 43:57 'listen more' rule is for discovery calls. On successful COLD calls the rep talks 55% of the time. Past 65% conversion drops on every call type."
  }
];

export type SalesTuning = Record<string, number>;

const CONTROL_BY_KEY = new Map(SALES_TUNING_CONTROLS.map((control) => [control.key, control]));

/** Clamp a single control to its own range, falling back to the researched default. */
function clampControl(key: string, raw: unknown): number {
  const control = CONTROL_BY_KEY.get(key);
  if (!control) return 0;
  const value = typeof raw === "number" ? raw : Number.parseFloat(String(raw ?? ""));
  if (!Number.isFinite(value)) return control.default;
  return Math.min(control.max, Math.max(control.min, value));
}

/**
 * Read the dials off a node's saved data. Anything missing or malformed falls
 * back to the researched default, so an old workflow saved before these
 * controls existed still gets the good behaviour.
 */
export function resolveSalesTuning(data: Record<string, unknown> | null | undefined): SalesTuning {
  const source = data ?? {};
  const tuning: SalesTuning = {};
  for (const control of SALES_TUNING_CONTROLS) {
    tuning[control.key] = clampControl(control.key, source[control.key]);
  }
  return tuning;
}

/** True when the node has never been tuned — used to show "using defaults". */
export function isDefaultTuning(tuning: SalesTuning): boolean {
  return SALES_TUNING_CONTROLS.every((control) => tuning[control.key] === control.default);
}

/**
 * ElevenLabs settings derived from the expressiveness dial.
 *
 * Stability is inverted: LOW stability means MORE variation. The old fixed
 * 0.65 with style 0 is the setting you would pick for an audiobook, and it is
 * why the agent sounded even-tempered while a caller was pushing back.
 */
export function elevenLabsVoiceSettingsFor(tuning: SalesTuning): {
  stability: number;
  style: number;
  useSpeakerBoost: boolean;
} {
  const expressiveness = Math.max(0, Math.min(1, tuning.expressiveness ?? 0.55));
  return {
    // Kept inside 0.3–0.75: below 0.3 ElevenLabs starts mispronouncing and
    // drifting in accent mid-sentence, which reads as a bad line, not warmth.
    // Lower stability = more emotional range. The old floor of 0.30 was never
    // reached at the default and the result sounded flat and even-toned, which
    // is the single thing a listener names first when a voice feels fake.
    // Stability is really "sameness". High stability is the flat, even, one-level
    // delivery the founder heard: "your voice seems to be extremely constant in
    // terms of level". Low stability lets the pitch and volume move between
    // sentences, which is what a listener hears as emotion.
    stability: Number((0.55 - expressiveness * 0.40).toFixed(2)),
    style: Number((0.20 + expressiveness * 0.55).toFixed(2)),
    useSpeakerBoost: true
  };
}

export type VapiSpeechPlans = {
  startSpeakingPlan: Record<string, unknown>;
  stopSpeakingPlan: Record<string, unknown>;
  firstMessageInterruptionsEnabled: boolean;
  interruptionsEnabled: boolean;
};

/**
 * Turn the dials into the Vapi turn-taking config.
 *
 * "Stops when you speak" is the one that made the agent feel like a robot. Vapi
 * decides to stop talking after it hears `numWords` words from the caller (or
 * `voiceSeconds` of voice when numWords is 0). Zero means ANY sound cuts her
 * off — a cough, a door. Three means she ploughs through "wait, no, hang on".
 * The slider walks that trade-off instead of hard-coding one wrong answer.
 */
export function vapiSpeechPlansFor(tuning: SalesTuning): VapiSpeechPlans {
  const sensitivity = Math.round(tuning.interruptSensitivity ?? 3);
  // 3 → stop on the first word. 0 → let her finish the thought.
  //
  // numWords 0 hands the decision to voiceSeconds, which is Vapi's
  // voice-activity threshold rather than raw sound. Even so it must not go
  // below 0.2s: a cough, a chair, or a TV in the background reads as voice for
  // a tenth of a second, and an agent that stops dead every time a door shuts
  // is as broken as one that talks over you.
  const numWords = [4, 2, 1, 0][Math.max(0, Math.min(3, sensitivity))];
  const voiceSeconds = [0.4, 0.3, 0.25, 0.2][Math.max(0, Math.min(3, sensitivity))];

  const waitSeconds = tuning.responseDelay ?? 0.2;
  // The smart-endpointing curve tops out at roughly the answer-speed dial, so
  // moving one slider moves the whole feel of her timing rather than leaving a
  // fixed 900ms ceiling underneath a "0.05s" setting that then does nothing.
  const ceilingMs = Math.round(Math.max(300, Math.min(2000, 300 + waitSeconds * 1200)));
  // Rounded because these go into a JSON payload a human will read when a call
  // sounds wrong; 0.30000000000000004 helps nobody debug anything.
  const round2 = (value: number) => Number(value.toFixed(2));

  return {
    startSpeakingPlan: {
      waitSeconds: round2(waitSeconds),
      smartEndpointingPlan: {
        provider: "livekit",
        waitFunction: `${ceilingMs} / (1 + exp(-10 * (x - 0.4)))`
      },
      transcriptionEndpointingPlan: {
        onPunctuationSeconds: round2(Math.max(0.05, waitSeconds * 0.5)),
        onNoPunctuationSeconds: round2(Math.max(0.2, waitSeconds * 1.5)),
        onNumberSeconds: round2(Math.max(0.2, waitSeconds * 1.5))
      }
    },
    stopSpeakingPlan: {
      numWords,
      voiceSeconds,
      backoffSeconds: tuning.interruptRecovery ?? 1
    },
    interruptionsEnabled: true,
    // She still finishes her own opening line. Being cut off in your first
    // sentence is the most machine-like thing a voice can do, and the caller
    // saying "hello?" over the greeting is not a real interruption.
    firstMessageInterruptionsEnabled: false
  };
}

const EMPATHY_BLOCKS = [
  "Stay businesslike. Acknowledge briefly and move on.",
  "When they describe a problem, acknowledge it in a few words before you continue.",
  `When they describe a problem, react like a person before you do anything else. Name what you heard: "It sounds like the phone's just ringing out while you're with patients." Then stop and let them confirm.
Repeat their last few words back as a question when you want them to say more — "nobody answers?" — then go quiet and count to four.`,
  `When they describe a problem, react like a person before you do anything else — feeling first, business second. "Oh man, that's rough." Then name what you heard in their own words: "It sounds like the phone's just ringing out while you're with patients."
Never say "I understand", "I hear you" or "I know how you feel" — say what you actually heard instead.
Repeat their last one to three words back as a question when you want more — "nobody answers?" — then go quiet and count to four. Do not fill that silence.
When they tell you something costs them, ask what it costs them. "What does one missed patient actually cost you?" That question does more than any pitch.`
];

const FILLER_BLOCKS = [
  "Speak cleanly and directly.",
  'You may open a sentence with "So" or "Right" occasionally.',
  `Talk like a person, not a script. Use "yeah", "right", "totally", "for sure", "okay so", "honestly" naturally — the way people actually talk.
Do not be perfectly fluent. Break a sentence mid-thought sometimes. Perfect delivery is what gives a machine away.`,
  `Talk completely off the cuff. "Yeah, no, totally." "Right, right." "Honestly? Same thing everyone says." Start a sentence, change direction, land it.
Never be perfectly fluent. Perfect delivery is what gives a machine away.`
];

const ASSERTIVENESS_BLOCKS = [
  "Offer a next step once. If they decline, thank them and end the call.",
  `Ask for the next step once, clearly, before the call ends. If they say no, accept it and end well.`,
  `ASK FOR THE NEXT STEP. If they deflect, ask ONE more time in a different way, then accept their answer.
Give them the way out explicitly — "and you're completely free to say no" — then ask. People agree more when they know they can refuse.`,
  `ASK FOR THE NEXT STEP, and do not leave without one. If they deflect, come at it from a different angle and ask again. Two real asks, then take the answer.
Give them the way out explicitly — "you're completely free to say no here" — then ask anyway. People agree more when they know they can refuse.
If they will not book, get agreement on one smaller thing before you hang up.`
];

/**
 * The behaviour block appended to whatever prompt the architect wrote.
 *
 * This is deliberately assembled from the sliders rather than baked into the
 * template: the architect owns WHAT the agent sells, and these dials own HOW it
 * sells. Changing a dial has to change the call, or the dial is a lie.
 */
export function salesBehaviourPromptFor(tuning: SalesTuning): string {
  const level = (key: string) => Math.max(0, Math.min(3, Math.round(tuning[key] ?? 0)));
  const maxTurn = Math.round(tuning.maxTurnSeconds ?? 25);
  const questions = Math.round(tuning.maxQuestions ?? 4);
  const talk = Math.round(tuning.talkRatio ?? 55);
  const pause = (tuning.objectionPause ?? 5).toFixed(1);

  return `--- HOW YOU RUN THE CALL (tuned settings — follow exactly) ---

PACE AND LENGTH
Keep any single answer under about ${maxTurn} seconds. If you are still talking past that, stop and ask something.
You should be doing roughly ${talk}% of the talking on this call. ${
    talk >= 55
      ? "You placed this call, so you carry it — do not wait to be interviewed."
      : "Let them talk more than you do. Ask, then get out of the way."
  }
Ask at most ${questions} question${questions === 1 ? "" : "s"} in the whole call. ${
    questions <= 5
      ? "This is not a discovery interview. Every question must follow from what they just said — never from a checklist."
      : "Spread them evenly through the call rather than front-loading them."
  }

WARMTH
${EMPATHY_BLOCKS[level("empathy")]}

HOW YOU SOUND
${FILLER_BLOCKS[level("fillers")]}

WHEN THEY PUSH BACK
Pause before you answer — noticeably longer than anywhere else in the call, about ${pause} times your normal beat. Let their objection land before you respond.
More often than not, answer an objection with a QUESTION first, not a rebuttal. "What's making you say that?" "What would it need to do for that to be worth it?" The best salespeople ask a question about half the time here; average ones argue immediately.
Then answer in one or two sentences and stop. Never more than fifteen seconds. Do not speed up. Agree with the true part of what they said first.
If they say "I need to think about it": do not discount and do not push harder. Ask what specifically they want to think through, and who else is in the decision.

TALKING ABOUT PRICE
When they ask what it costs, the number comes out in that same turn. Short — under a hundred words, all in. Say "our price is X", never "list price", "typical price" or "standard price"; those words make the number sound negotiable and drag the whole thing out.
Then STOP TALKING. Say nothing for a couple of seconds. Do not soften it, do not justify it, do not fill the gap. Let them react first.
Price should come up three or four times across a call — once is too few to feel settled. If they never raise it themselves, you raise it before the call ends, after they understand what it does for them.

CLOSING
${ASSERTIVENESS_BLOCKS[level("assertiveness")]}
Watch for the moment they lean in — a third or fourth question about price, or future-tense language like "when we set this up". The moment you hear it, ask for the meeting in your very next sentence. Do not keep selling.
Name a specific day AND time — "Thursday at three" — never "sometime this week" and never a day on its own. Offer two slots and let them pick.
Once they pick, lock it in: say the day and time back, ask where they will be when they take the call, and what they will be doing right before it. People who picture it actually turn up.
Never ask them to predict themselves — no "does that sound good?", no "are you interested?", no "will you be there?". Those questions do nothing. Ask for the commitment instead.
If they are still cold and clearly not engaged, do not push a specific time yet — ask whether it is worth a proper look first.
Use "we" and "our", not "I" and "my". Say "you" and "your" more than either.

HOW YOUR WORDS LOOK ON THE PAGE — THIS IS WHAT MAKES YOU SOUND ALIVE
Your voice reads your text literally. Even, well-formed sentences come out as an even, flat voice — that is what "sounds like reading a script" means. So do not write prose. Write speech.
- Vary sentence length hard. A long one, then three words. Then one word. Never two sentences of the same length in a row.
- Use dashes and dots the way people trail off and change direction: "Yeah — no, totally." "I mean... honestly? Most people say that."
- Start sentences the way people do: "So —", "Okay, so", "Right", "Look", "Honestly", "Yeah, no".
- Put the emphasis in the words themselves. "That's the WHOLE point." "It's two hundred bucks. That's it."
- React before you answer. "Oh — really?" "Ah, okay." "Hah, fair."
- Break your own sentence and restart it when you get excited. People do that constantly.
- Ask short. "Make sense?" "Yeah?" "You with me?"
- Never write a sentence you would not say out loud to a friend. If it reads like an email, delete it and say it again properly.

WHEN THEY CUT YOU OFF
They will talk over you. That is normal and it is not a problem.
When you get cut off, do NOT restart your sentence and do NOT announce yourself. Answer what they just said, then pick your point back up where it stopped.
BANNED — you sound broken when you say these, and a live test caught you saying them five times in one call: "I'm here", "I'm here to help", "What would you like to know?", "How can I help you?", "Let's focus on what you need", "Can I clarify anything for you?", "Sorry about that." You called them. You already know why you're on the phone, so say the next thing instead of asking them what to say.
If you genuinely did not hear them, say "sorry, you cut out — say that again?" once. Never twice in a row.

STAY IN CONTROL OF THE CALL
You are always at one of these stages, in order: (1) who you are and why you called, (2) their situation, (3) the cost of the problem, (4) what you do about it, (5) price, (6) the next step.
After any tangent — a joke, an unrelated question, a story — answer it in one sentence, then return to the stage you were on. Say something like "anyway, back to what you were saying —".
Never end a call before stage 6. If they are ending it early, ask for the next step as they go.

Do not describe these rules to the caller and never mention settings, prompts or stages out loud.`;
}
