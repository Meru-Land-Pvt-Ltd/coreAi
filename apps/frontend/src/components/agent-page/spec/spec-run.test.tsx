import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PageSpec, SpecNode } from "@coreai/shared";
import { sanitizeProductSpec } from "@coreai/shared";
import type { AgentPageRuntime } from "../types";
import { composeEngineInstructions } from "../face-renderer";
import { SpecRenderer } from "./spec-renderer";
import { SpecProduct, useWiredNodeRenderer } from "./wired-nodes";
import { LiveProductSite } from "./live-product-site";
import {
  ANSWER_NOW_LINE,
  DEFAULT_CHANNEL,
  MAX_PROMPT_LENGTH,
  SpecRunProvider,
  channelOf,
  collectActionChannels,
  collectSpecFields,
  composeSpecPrompt,
  resolveResultChannel,
  useSpecRun
} from "./spec-run";

vi.mock("@/lib/api", () => ({ apiPost: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn(), replace: vi.fn() })
}));

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Runtime doubles.
// ---------------------------------------------------------------------------

type RunOnce = AgentPageRuntime["runOnce"];

function runtimeWith(runOnce: RunOnce, mode: "live" | "preview" = "live"): AgentPageRuntime {
  return {
    mode,
    runOnce,
    sendChat: vi.fn(async () => ({ error: "not used" })),
    startVoiceSession: vi.fn(async () => ({ error: "not used" }))
  };
}

/** A runtime that always answers with the same text. */
function textRuntime(text = "Here is your answer.") {
  const runOnce = vi.fn<RunOnce>(async () => ({
    output: { text, mediaUrls: [], structured: null },
    remainingToday: 9
  }));
  return { runtime: runtimeWith(runOnce), runOnce };
}

/** Lets a test resolve each run by hand, to observe in-flight state. */
function deferredRuntime() {
  const resolvers: Array<(value: Awaited<ReturnType<RunOnce>>) => void> = [];
  const runOnce = vi.fn<RunOnce>(
    () =>
      new Promise<Awaited<ReturnType<RunOnce>>>((resolve) => {
        resolvers.push(resolve);
      })
  );
  return { runtime: runtimeWith(runOnce), runOnce, resolvers };
}

// ---------------------------------------------------------------------------
// Page fixtures.
// ---------------------------------------------------------------------------

function page(blocks: SpecNode[]): PageSpec {
  return { id: "home", title: "Test", path: "", blocks };
}

/** The canonical product: one field, one button, one result. */
function simpleProductPage(): PageSpec {
  return page([
    {
      id: "sec",
      type: "section",
      children: [
        { id: "field", type: "input", label: "Your idea", wire: { role: "input", nodeId: "in" } },
        { id: "go", type: "button", label: "Make it", wire: { role: "action", nodeId: "gen" } },
        { id: "out", type: "result", wire: { role: "output", nodeId: "gen" } }
      ]
    }
  ]);
}

// ===========================================================================
// Reading the page.
// ===========================================================================

describe("reading wires off a page", () => {
  it("collects input fields in document order, ignoring unwired ones", () => {
    const fields = collectSpecFields(
      page([
        {
          id: "s",
          type: "section",
          children: [
            { id: "a", type: "input", label: "Name", wire: { role: "input", nodeId: "n1" } },
            { id: "decor", type: "input", label: "Not wired" },
            {
              id: "row",
              type: "row",
              children: [
                { id: "b", type: "choice", options: ["X", "Y"], wire: { role: "input" } },
                { id: "c", type: "upload", wire: { role: "input", nodeId: "n2" } }
              ]
            }
          ]
        }
      ])
    );

    expect(fields.map((f) => f.specNodeId)).toEqual(["a", "b", "c"]);
    expect(fields.map((f) => f.kind)).toEqual(["input", "choice", "upload"]);
    expect(fields[0].wireNodeId).toBe("n1");
  });

  it("ignores a node whose wire is the wrong role", () => {
    const fields = collectSpecFields(
      page([{ id: "a", type: "input", wire: { role: "output", nodeId: "n" } }])
    );
    expect(fields).toEqual([]);
  });

  it("collects each distinct action channel once", () => {
    const channels = collectActionChannels(
      page([
        { id: "b1", type: "button", label: "A", wire: { role: "action", nodeId: "x" } },
        { id: "b2", type: "button", label: "B", wire: { role: "action", nodeId: "x" } },
        { id: "b3", type: "button", label: "C", wire: { role: "action", nodeId: "y" } },
        { id: "b4", type: "button", label: "D" },
        { id: "b5", type: "button", label: "E", href: "/pricing" }
      ])
    );
    expect(channels).toEqual(["x", "y"]);
  });

  it("files a wire with no nodeId under the shared default channel", () => {
    expect(channelOf(undefined)).toBe(DEFAULT_CHANNEL);
    expect(channelOf({ role: "action" })).toBe(DEFAULT_CHANNEL);
    expect(channelOf({ role: "action", nodeId: "  " })).toBe(DEFAULT_CHANNEL);
    expect(channelOf({ role: "action", nodeId: "gen" })).toBe("gen");
  });
});

describe("resolveResultChannel", () => {
  it("makes every output follow the only action on the page, however it was written", () => {
    // The common AI shape: button pinned to a real node, result left bare.
    expect(
      resolveResultChannel({ role: "output" }, { actionChannels: ["gen"], lastChannel: null })
    ).toBe("gen");
  });

  it("keeps a pinned output on its own node when several actions exist", () => {
    expect(
      resolveResultChannel(
        { role: "output", nodeId: "b" },
        { actionChannels: ["a", "b"], lastChannel: "a" }
      )
    ).toBe("b");
  });

  it("lets an unpinned output follow the most recent run when several actions exist", () => {
    expect(
      resolveResultChannel({ role: "output" }, { actionChannels: ["a", "b"], lastChannel: "b" })
    ).toBe("b");
  });

  it("falls back to the default channel before anything has run", () => {
    expect(
      resolveResultChannel({ role: "output" }, { actionChannels: [], lastChannel: null })
    ).toBe(DEFAULT_CHANNEL);
  });
});

// ===========================================================================
// Prompt composition.
// ===========================================================================

describe("composeSpecPrompt", () => {
  it("sends bare text bare when there is nothing to explain", () => {
    const { prompt, displayPrompt } = composeSpecPrompt({
      fields: [{ kind: "input", value: "a cat on a bike" }]
    });
    expect(prompt).toBe("a cat on a bike");
    expect(displayPrompt).toBe("a cat on a bike");
  });

  it("builds an instruction block naming the button, and closes with the answer-now order", () => {
    const { prompt } = composeSpecPrompt({
      buttonLabel: "Make it",
      fields: [{ kind: "input", value: "a cat" }]
    });
    expect(prompt).toContain("The customer pressed the button: 'Make it'.");
    expect(prompt).toContain("The customer wrote: a cat");
    expect(prompt.endsWith(ANSWER_NOW_LINE)).toBe(true);
  });

  it("labels a field when the author gave it a label", () => {
    const { prompt } = composeSpecPrompt({
      buttonLabel: "Send",
      fields: [
        { kind: "input", label: "Your name", value: "Ada" },
        { kind: "choice", label: "Tone", value: "Warm" },
        { kind: "upload", label: "Resume", value: "ada.pdf" }
      ]
    });
    expect(prompt).toContain("For 'Your name', the customer wrote: Ada");
    expect(prompt).toContain("For 'Tone', the customer selected: 'Warm'.");
    expect(prompt).toContain("For 'Resume', the customer attached a file: 'ada.pdf'.");
  });

  it("uses the unlabelled phrasing when a field has no label", () => {
    const { prompt } = composeSpecPrompt({
      buttonLabel: "Go",
      fields: [
        { kind: "choice", value: "Noir" },
        { kind: "upload", value: "a.png" }
      ]
    });
    expect(prompt).toContain("The customer selected option: 'Noir'.");
    expect(prompt).toContain("The customer attached a file: 'a.png'.");
  });

  it("never leaks the scaffolding into what the page shows", () => {
    const { displayPrompt } = composeSpecPrompt({
      buttonLabel: "Make it",
      fields: [
        { kind: "input", value: "a cat" },
        { kind: "choice", label: "Style", value: "Noir" }
      ]
    });
    // Only the customer's own words — not the button, not the chosen style.
    expect(displayPrompt).toBe("a cat");
    expect(displayPrompt).not.toContain("Make it");
    expect(displayPrompt).not.toContain("Noir");
    expect(displayPrompt).not.toContain(ANSWER_NOW_LINE);
  });

  it("falls back to the button label when the customer typed nothing", () => {
    const { displayPrompt } = composeSpecPrompt({ buttonLabel: "Surprise me", fields: [] });
    expect(displayPrompt).toBe("Surprise me");
  });

  it("trims the written tail, never the closing order, at the cap", () => {
    const { prompt } = composeSpecPrompt({
      buttonLabel: "Go",
      fields: [{ kind: "input", value: "x".repeat(MAX_PROMPT_LENGTH * 2) }]
    });
    expect(prompt.length).toBeLessThanOrEqual(MAX_PROMPT_LENGTH);
    expect(prompt).toContain("The customer pressed the button: 'Go'.");
    expect(prompt.endsWith(ANSWER_NOW_LINE)).toBe(true);
  });

  it("keeps the same closing order as the block renderer (drift pin)", () => {
    // composeEngineInstructions is the block renderer's composer. If that file
    // ever rewords the closing line, this fails instead of the two products
    // quietly disagreeing about how to talk to the same brain.
    const blockPrompt = composeEngineInstructions({ written: "hello" });
    expect(blockPrompt.endsWith(ANSWER_NOW_LINE)).toBe(true);
  });

  it("phrases a pressed button exactly as the block renderer does (drift pin)", () => {
    const blockPrompt = composeEngineInstructions({ buttonLabel: "Make it" });
    const { prompt } = composeSpecPrompt({ buttonLabel: "Make it", fields: [] });
    const line = "The customer pressed the button: 'Make it'.";
    expect(blockPrompt).toContain(line);
    expect(prompt).toContain(line);
  });
});

// ===========================================================================
// The round trip.
// ===========================================================================

describe("input + button + result round trip", () => {
  it("types, runs, and lands the answer on the wired result", async () => {
    const user = userEvent.setup();
    const { runtime, runOnce } = textRuntime("A cat on a bike, painted.");

    render(<SpecProduct page={simpleProductPage()} runtime={runtime} />);

    // Before the run: an inviting empty state, never a blank hole.
    expect(screen.getByTestId("spec-result-empty")).toBeTruthy();

    await user.type(screen.getByLabelText("Your idea"), "a cat on a bike");
    await user.click(screen.getByRole("button", { name: "Make it" }));

    await waitFor(() => expect(screen.getByTestId("spec-result-text")).toBeTruthy());

    expect(runOnce).toHaveBeenCalledTimes(1);
    const sent = runOnce.mock.calls[0][0];
    expect(sent.prompt).toContain("The customer pressed the button: 'Make it'.");
    expect(sent.prompt).toContain("For 'Your idea', the customer wrote: a cat on a bike");
    expect(sent.prompt.endsWith(ANSWER_NOW_LINE)).toBe(true);
    // Every run on a visit shares one session.
    expect(typeof sent.sessionId).toBe("string");

    expect(screen.getByTestId("spec-result-text").textContent).toContain(
      "A cat on a bike, painted."
    );
    // The page echoes the customer's words, never the engine prompt.
    expect(screen.getByTestId("spec-result-prompt").textContent).toContain("a cat on a bike");
    expect(screen.queryByText(new RegExp(ANSWER_NOW_LINE))).toBeNull();
  });

  it("shows a human working state while the run is in flight", async () => {
    const user = userEvent.setup();
    const { runtime, resolvers } = deferredRuntime();

    render(<SpecProduct page={simpleProductPage()} runtime={runtime} />);

    await user.type(screen.getByLabelText("Your idea"), "a cat");
    await user.click(screen.getByRole("button", { name: "Make it" }));

    await waitFor(() => expect(screen.getByTestId("spec-result-working")).toBeTruthy());
    expect(screen.getByTestId("spec-result-working").textContent).toContain("Working on it…");
    // The button says what it is doing rather than going dead.
    expect(screen.getByRole("button", { name: /Working on it/ })).toBeTruthy();

    resolvers[0]({ output: { text: "done", mediaUrls: [], structured: null } });
    await waitFor(() => expect(screen.getByTestId("spec-result-text")).toBeTruthy());
    expect(screen.queryByTestId("spec-result-working")).toBeNull();
  });

  it("survives the customer leaving before the run settles", async () => {
    const user = userEvent.setup();
    const { runtime, resolvers } = deferredRuntime();

    const { unmount } = render(<SpecProduct page={simpleProductPage()} runtime={runtime} />);

    await user.type(screen.getByLabelText("Your idea"), "a cat");
    await user.click(screen.getByRole("button", { name: "Make it" }));
    await waitFor(() => expect(screen.getByTestId("spec-result-working")).toBeTruthy());

    // The customer closes the product while the agent is still thinking, then
    // the run lands anyway — nobody can recall a promise in flight.
    // NOTE: this only pins down that the late settle is harmless. React 19
    // silently discards writes into an unmounted tree, so `aliveRef` in
    // spec-run.tsx is not observable from here; do not read this as coverage
    // of the guard itself.
    unmount();
    expect(() =>
      resolvers[0]({ output: { text: "too late", mediaUrls: [], structured: null } })
    ).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
  });

  it("pairs a bare output wire with a pinned action wire", async () => {
    const user = userEvent.setup();
    const { runtime } = textRuntime("paired");

    // The shape an AI writes most often: action names a node, output does not.
    render(
      <SpecProduct
        page={page([
          { id: "go", type: "button", label: "Run", wire: { role: "action", nodeId: "gen" } },
          { id: "out", type: "result", wire: { role: "output" } }
        ])}
        runtime={runtime}
      />
    );

    await user.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() => expect(screen.getByTestId("spec-result-text").textContent).toContain("paired"));
  });

  it("feeds a choice and an upload into the prompt", async () => {
    const user = userEvent.setup();
    const { runtime, runOnce } = textRuntime();

    render(
      <SpecProduct
        page={page([
          {
            id: "tone",
            type: "choice",
            label: "Tone",
            options: ["Warm", "Formal"],
            wire: { role: "input", nodeId: "t" }
          },
          { id: "file", type: "upload", label: "Brief", wire: { role: "input", nodeId: "f" } },
          { id: "go", type: "button", label: "Write it", wire: { role: "action", nodeId: "gen" } },
          { id: "out", type: "result", wire: { role: "output", nodeId: "gen" } }
        ])}
        runtime={runtime}
      />
    );

    await user.click(screen.getByRole("button", { name: "Warm" }));

    const file = new File(["hello"], "brief.txt", { type: "text/plain" });
    await user.upload(screen.getByLabelText("Brief") as HTMLInputElement, file);

    await user.click(screen.getByRole("button", { name: "Write it" }));
    await waitFor(() => expect(runOnce).toHaveBeenCalledTimes(1));

    const prompt = runOnce.mock.calls[0][0].prompt;
    expect(prompt).toContain("For 'Tone', the customer selected: 'Warm'.");
    expect(prompt).toContain("For 'Brief', the customer attached a file: 'brief.txt'.");
  });
});

// ===========================================================================
// Independence.
// ===========================================================================

describe("two buttons on one page", () => {
  it("run independently and land on their own results", async () => {
    const user = userEvent.setup();
    const runOnce = vi.fn<RunOnce>(async ({ prompt }) => ({
      output: {
        text: prompt.includes("Left") ? "left answer" : "right answer",
        mediaUrls: [],
        structured: null
      }
    }));
    const runtime = runtimeWith(runOnce);

    render(
      <SpecProduct
        page={page([
          { id: "b1", type: "button", label: "Left", wire: { role: "action", nodeId: "a" } },
          { id: "r1", type: "result", wire: { role: "output", nodeId: "a" } },
          { id: "b2", type: "button", label: "Right", wire: { role: "action", nodeId: "b" } },
          { id: "r2", type: "result", wire: { role: "output", nodeId: "b" } }
        ])}
        runtime={runtime}
      />
    );

    const left = screen.getByTestId("spec-node-r1");
    const right = screen.getByTestId("spec-node-r2");

    await user.click(screen.getByRole("button", { name: "Left" }));
    await waitFor(() =>
      expect(within(left).getByTestId("spec-result-text").textContent).toContain("left answer")
    );
    // The other channel is untouched — still its empty invitation.
    expect(within(right).getByTestId("spec-result-empty")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Right" }));
    await waitFor(() =>
      expect(within(right).getByTestId("spec-result-text").textContent).toContain("right answer")
    );
    // And the first result did not get overwritten by the second run.
    expect(within(left).getByTestId("spec-result-text").textContent).toContain("left answer");
  });

  it("leaves the other button clickable while one is working", async () => {
    const user = userEvent.setup();
    const { runtime, runOnce, resolvers } = deferredRuntime();

    render(
      <SpecProduct
        page={page([
          { id: "b1", type: "button", label: "Left", wire: { role: "action", nodeId: "a" } },
          { id: "b2", type: "button", label: "Right", wire: { role: "action", nodeId: "b" } }
        ])}
        runtime={runtime}
      />
    );

    await user.click(screen.getByRole("button", { name: "Left" }));
    await waitFor(() => expect(runOnce).toHaveBeenCalledTimes(1));

    // Left is busy; Right must not be blocked by it.
    expect(screen.getByRole("button", { name: "Right" }).hasAttribute("disabled")).toBe(false);
    await user.click(screen.getByRole("button", { name: "Right" }));
    expect(runOnce).toHaveBeenCalledTimes(2);

    resolvers.forEach((resolve) =>
      resolve({ output: { text: "ok", mediaUrls: [], structured: null } })
    );
  });

  it("fires once when the same channel is asked to run twice in a single tick", async () => {
    // The disabled attribute guards the UI, but it only exists after a
    // re-render. This drives the run state directly, the way two clicks
    // landing in one tick would, and proves the guard is synchronous.
    const user = userEvent.setup();
    const { runtime, runOnce, resolvers } = deferredRuntime();

    function DoubleFire() {
      const run = useSpecRun();
      return (
        <button
          type="button"
          data-testid="double-fire"
          onClick={() => {
            run?.runAction({ channel: "a", buttonLabel: "Go" });
            run?.runAction({ channel: "a", buttonLabel: "Go" });
          }}
        >
          fire twice
        </button>
      );
    }

    render(
      <SpecRunProvider
        page={page([
          { id: "b1", type: "button", label: "Go", wire: { role: "action", nodeId: "a" } }
        ])}
        runtime={runtime}
      >
        <DoubleFire />
      </SpecRunProvider>
    );

    await user.click(screen.getByTestId("double-fire"));
    expect(runOnce).toHaveBeenCalledTimes(1);

    resolvers.forEach((resolve) =>
      resolve({ output: { text: "ok", mediaUrls: [], structured: null } })
    );
  });

  it("ignores a second press on the SAME button while it is working", async () => {
    const user = userEvent.setup();
    const { runtime, runOnce, resolvers } = deferredRuntime();

    render(
      <SpecProduct
        page={page([
          { id: "b1", type: "button", label: "Only", wire: { role: "action", nodeId: "a" } }
        ])}
        runtime={runtime}
      />
    );

    await user.click(screen.getByRole("button", { name: "Only" }));
    await waitFor(() => expect(runOnce).toHaveBeenCalledTimes(1));
    // The busy button is disabled, so this is a no-op either way.
    await user.click(screen.getByRole("button", { name: /Working on it/ }));
    expect(runOnce).toHaveBeenCalledTimes(1);

    resolvers[0]({ output: { text: "ok", mediaUrls: [], structured: null } });
  });
});

// ===========================================================================
// Decoration — no wire, no behavior, no harm.
// ===========================================================================

describe("unwired elements", () => {
  it("a button with no wire does nothing and never breaks the page", async () => {
    const user = userEvent.setup();
    const { runtime, runOnce } = textRuntime();

    render(
      <SpecProduct
        page={page([
          { id: "decor", type: "button", label: "Learn more" },
          { id: "out", type: "result", wire: { role: "output" } }
        ])}
        runtime={runtime}
      />
    );

    const button = screen.getByRole("button", { name: "Learn more" });
    // Styled and focusable — decoration, not a broken control.
    expect(button.hasAttribute("disabled")).toBe(false);
    expect(button.getAttribute("data-spec-wired")).toBe("none");

    await user.click(button);
    await user.click(button);

    expect(runOnce).not.toHaveBeenCalled();
    // The page is intact and the result is still its calm empty state.
    expect(screen.getByTestId("spec-result-empty")).toBeTruthy();
  });

  it("a button with an href navigates instead of running", () => {
    const { runtime } = textRuntime();
    render(
      <SpecProduct
        page={page([{ id: "cta", type: "button", label: "See pricing", href: "/pricing" }])}
        runtime={runtime}
      />
    );

    const link = screen.getByRole("link", { name: "See pricing" });
    expect(link.getAttribute("href")).toBe("/pricing");
    expect(link.getAttribute("data-spec-wired")).toBe("href");
  });

  it("an action wire wins over an href on the same button", async () => {
    const user = userEvent.setup();
    const { runtime, runOnce } = textRuntime();

    render(
      <SpecProduct
        page={page([
          {
            id: "cta",
            type: "button",
            label: "Go",
            href: "/pricing",
            wire: { role: "action", nodeId: "gen" }
          }
        ])}
        runtime={runtime}
      />
    );

    expect(screen.queryByRole("link", { name: "Go" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Go" }));
    await waitFor(() => expect(runOnce).toHaveBeenCalledTimes(1));
  });

  it("an unwired input still accepts typing but is never read", async () => {
    const user = userEvent.setup();
    const { runtime, runOnce } = textRuntime();

    render(
      <SpecProduct
        page={page([
          { id: "decor", type: "input", label: "Newsletter email" },
          { id: "go", type: "button", label: "Run", wire: { role: "action", nodeId: "gen" } }
        ])}
        runtime={runtime}
      />
    );

    await user.type(screen.getByLabelText("Newsletter email"), "ada@example.com");
    await user.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() => expect(runOnce).toHaveBeenCalledTimes(1));

    expect(runOnce.mock.calls[0][0].prompt).not.toContain("ada@example.com");
  });

  it("renders every socket inert, and nothing throws, with no provider at all", () => {
    // The static preview: SpecRenderer alone, no wires, no runtime.
    render(<SpecRenderer page={simpleProductPage()} />);
    expect(screen.getByTestId("spec-page")).toBeTruthy();
    // Wired types are skipped entirely when no extension is mounted.
    expect(screen.queryByRole("button", { name: "Make it" })).toBeNull();
  });

  it("renders sockets styled-but-inert when the extension is mounted without a provider", async () => {
    const user = userEvent.setup();

    function Bare() {
      const renderNode = useWiredNodeRenderer();
      return <SpecRenderer page={simpleProductPage()} renderNode={renderNode} />;
    }
    render(<Bare />);

    const button = screen.getByRole("button", { name: "Make it" });
    await user.click(button);
    // No provider means no run state — it simply does nothing.
    expect(button.hasAttribute("disabled")).toBe(false);
    await user.type(screen.getByLabelText("Your idea"), "still typable");
    expect((screen.getByLabelText("Your idea") as HTMLInputElement).value).toBe("still typable");
  });
});

// ===========================================================================
// Failure.
// ===========================================================================

describe("failure", () => {
  it("shows a friendly retry that replays the same run", async () => {
    const user = userEvent.setup();
    const runOnce = vi
      .fn<RunOnce>()
      .mockResolvedValueOnce({ error: "Something went wrong." })
      .mockResolvedValueOnce({
        output: { text: "second time lucky", mediaUrls: [], structured: null }
      });
    const runtime = runtimeWith(runOnce);

    render(<SpecProduct page={simpleProductPage()} runtime={runtime} />);

    await user.type(screen.getByLabelText("Your idea"), "a cat");
    await user.click(screen.getByRole("button", { name: "Make it" }));

    await waitFor(() => expect(screen.getByTestId("spec-result-error")).toBeTruthy());
    expect(screen.getByTestId("spec-result-error").textContent).toContain("try again");

    await user.click(screen.getByTestId("spec-result-retry"));
    await waitFor(() => expect(screen.getByTestId("spec-result-text")).toBeTruthy());

    expect(runOnce).toHaveBeenCalledTimes(2);
    // The retry replays the identical prompt, not a re-composed one.
    expect(runOnce.mock.calls[1][0].prompt).toBe(runOnce.mock.calls[0][0].prompt);
    expect(screen.queryByTestId("spec-result-error")).toBeNull();
  });

  it("recovers from a thrown rejection instead of shimmering forever", async () => {
    const user = userEvent.setup();
    const runOnce = vi.fn<RunOnce>(async () => {
      throw new Error("network down");
    });
    const runtime = runtimeWith(runOnce);

    render(<SpecProduct page={simpleProductPage()} runtime={runtime} />);
    await user.click(screen.getByRole("button", { name: "Make it" }));

    await waitFor(() => expect(screen.getByTestId("spec-result-error")).toBeTruthy());
    expect(screen.queryByTestId("spec-result-working")).toBeNull();
    expect(screen.getByTestId("spec-result-retry")).toBeTruthy();
  });

  it("shows the daily limit honestly and stops the button", async () => {
    const user = userEvent.setup();
    const runOnce = vi.fn<RunOnce>(async () => ({
      error: "Daily limit reached",
      code: "PAGE_LIMIT_REACHED"
    }));
    const runtime = runtimeWith(runOnce);

    render(<SpecProduct page={simpleProductPage()} runtime={runtime} />);
    await user.click(screen.getByRole("button", { name: "Make it" }));

    await waitFor(() => expect(screen.getByTestId("spec-result-limit")).toBeTruthy());
    // No error strip — a spent limit is not a failure to retry.
    expect(screen.queryByTestId("spec-result-error")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Make it" }));
    expect(runOnce).toHaveBeenCalledTimes(1);
  });

  it("never rate-limits a builder preview", async () => {
    const user = userEvent.setup();
    const { runtime, runOnce } = textRuntime();
    const preview = { ...runtime, mode: "preview" as const };

    render(<SpecProduct page={simpleProductPage()} runtime={preview} remainingToday={0} />);
    await user.click(screen.getByRole("button", { name: "Make it" }));

    await waitFor(() => expect(runOnce).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("spec-result-limit")).toBeNull();
  });

  it("opens a published page in the limit state when nothing is left", () => {
    const { runtime } = textRuntime();
    render(<SpecProduct page={simpleProductPage()} runtime={runtime} remainingToday={0} />);
    expect(screen.getByTestId("spec-result-limit")).toBeTruthy();
  });
});

// ===========================================================================
// History.
// ===========================================================================

describe("history", () => {
  it("stays hidden until there is something to remember, then restores a run", async () => {
    const user = userEvent.setup();
    let call = 0;
    const runOnce = vi.fn<RunOnce>(async () => {
      call += 1;
      return { output: { text: `answer ${call}`, mediaUrls: [], structured: null } };
    });
    const runtime = runtimeWith(runOnce);

    render(
      <SpecProduct
        page={page([
          { id: "field", type: "input", label: "Idea", wire: { role: "input", nodeId: "in" } },
          { id: "go", type: "button", label: "Run", wire: { role: "action", nodeId: "gen" } },
          { id: "out", type: "result", wire: { role: "output", nodeId: "gen" } },
          { id: "hist", type: "history", wire: { role: "output", nodeId: "gen" } }
        ])}
        runtime={runtime}
      />
    );

    expect(screen.queryByTestId("spec-history-item")).toBeNull();

    await user.type(screen.getByLabelText("Idea"), "first");
    await user.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() => expect(screen.getByTestId("spec-result-text").textContent).toContain("answer 1"));

    await user.clear(screen.getByLabelText("Idea"));
    await user.type(screen.getByLabelText("Idea"), "second");
    await user.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() => expect(screen.getByTestId("spec-result-text").textContent).toContain("answer 2"));

    const items = screen.getAllByTestId("spec-history-item");
    expect(items).toHaveLength(2);
    // Newest first.
    expect(items[0].textContent).toContain("second");

    await user.click(items[1]);
    await waitFor(() =>
      expect(screen.getByTestId("spec-result-text").textContent).toContain("answer 1")
    );
  });
});

// ===========================================================================
// Result variants.
// ===========================================================================

describe("result variants", () => {
  const structured = {
    stats: [{ label: "Revenue", value: "$4,200" }],
    chart: { type: "bar" as const, title: "Weekly", series: [{ label: "Mon", value: 3 }] },
    table: { columns: ["A"], rows: [["1"]] }
  };

  async function renderVariant(variant: "auto" | "text" | "cards" | "chart" | "table") {
    const user = userEvent.setup();
    const runOnce = vi.fn<RunOnce>(async () => ({
      output: { text: "narrative", mediaUrls: [], structured }
    }));
    render(
      <SpecProduct
        page={page([
          { id: "go", type: "button", label: "Run", wire: { role: "action", nodeId: "gen" } },
          { id: "out", type: "result", variant, wire: { role: "output", nodeId: "gen" } }
        ])}
        runtime={runtimeWith(runOnce)}
      />
    );
    await user.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() => expect(screen.queryByTestId("spec-result-empty")).toBeNull());
  }

  it("auto shows everything the answer carried", async () => {
    await renderVariant("auto");
    expect(screen.getByTestId("spec-result-text")).toBeTruthy();
    expect(screen.getByTestId("agent-visual-chart")).toBeTruthy();
    expect(screen.getByTestId("agent-visual-table")).toBeTruthy();
  });

  it("chart shows only the chart", async () => {
    await renderVariant("chart");
    expect(screen.getByTestId("agent-visual-chart")).toBeTruthy();
    expect(screen.queryByTestId("agent-visual-table")).toBeNull();
  });

  it("table shows only the table", async () => {
    await renderVariant("table");
    expect(screen.getByTestId("agent-visual-table")).toBeTruthy();
    expect(screen.queryByTestId("agent-visual-chart")).toBeNull();
  });

  it("text shows the prose and none of the visuals", async () => {
    await renderVariant("text");
    expect(screen.getByTestId("spec-result-text")).toBeTruthy();
    expect(screen.queryByTestId("agent-visual-chart")).toBeNull();
    expect(screen.queryByTestId("agent-visual-table")).toBeNull();
  });

  it("says so plainly when an answer came back empty", async () => {
    const user = userEvent.setup();
    const runOnce = vi.fn<RunOnce>(async () => ({
      output: { text: null, mediaUrls: [], structured: null }
    }));
    render(<SpecProduct page={simpleProductPage()} runtime={runtimeWith(runOnce)} />);
    await user.click(screen.getByRole("button", { name: "Make it" }));
    await waitFor(() =>
      expect(screen.getByTestId("spec-node-out").textContent).toContain("Nothing came back")
    );
  });
});

// ===========================================================================
// The published site, end to end.
// ===========================================================================

describe("LiveProductSite", () => {
  it("drives the real public runtime from a button on a published page", async () => {
    const user = userEvent.setup();
    const { apiPost } = await import("@/lib/api");
    const post = vi.mocked(apiPost);
    post.mockResolvedValue({
      success: true,
      data: {
        output: { text: "live answer", mediaUrls: [], structured: null },
        remainingToday: 4
      }
    } as never);

    const product = sanitizeProductSpec({
      version: 1,
      pages: [
        {
          id: "home",
          title: "Home",
          path: "",
          blocks: [
            {
              id: "hero",
              type: "section",
              children: [
                { id: "h", type: "heading", level: 1, text: "Close your books" },
                { id: "q", type: "input", label: "Idea", wire: { role: "input", nodeId: "q" } },
                { id: "b", type: "button", label: "Make", wire: { role: "action", nodeId: "gen" } },
                { id: "r", type: "result", wire: { role: "output", nodeId: "gen" } }
              ]
            }
          ]
        }
      ],
      nav: { links: [], footerLinks: [] }
    })!;

    render(
      <LiveProductSite
        slug="ledger-abc123"
        product={product}
        page={product.pages[0]}
        listingName="Ledger"
      />
    );

    await user.type(screen.getByLabelText("Idea"), "close the books");
    await user.click(screen.getByRole("button", { name: "Make" }));

    await waitFor(() =>
      expect(screen.getByTestId("spec-result-text").textContent).toContain("live answer")
    );

    // The wire reached the real published-page endpoint, with the composed
    // prompt — not a mock in the middle.
    expect(post).toHaveBeenCalledWith(
      "/agent-pages/ledger-abc123/run",
      expect.objectContaining({
        prompt: expect.stringContaining("For 'Idea', the customer wrote: close the books")
      })
    );
  });
});

// ===========================================================================
// The contract holds for specs that came through the sanitizer.
// ===========================================================================

describe("sanitized specs", () => {
  it("drives a product built from a sanitized spec end to end", async () => {
    const user = userEvent.setup();
    const { runtime, runOnce } = textRuntime("sanitized answer");

    const spec = sanitizeProductSpec({
      version: 1,
      pages: [
        {
          id: "home",
          title: "Home",
          path: "",
          blocks: [
            {
              id: "hero",
              type: "section",
              background: "gradient",
              children: [
                { id: "h", type: "heading", level: 1, text: "Ask anything" },
                { id: "q", type: "input", label: "Question", wire: { role: "input", nodeId: "q" } },
                { id: "b", type: "button", label: "Ask", wire: { role: "action", nodeId: "brain" } },
                { id: "r", type: "result", wire: { role: "output", nodeId: "brain" } }
              ]
            }
          ]
        }
      ],
      nav: { links: [], footerLinks: [] }
    });

    expect(spec).not.toBeNull();
    render(<SpecProduct page={spec!.pages[0]} theme={spec!.theme} runtime={runtime} />);

    await user.type(screen.getByLabelText("Question"), "why is the sky blue");
    await user.click(screen.getByRole("button", { name: "Ask" }));

    await waitFor(() =>
      expect(screen.getByTestId("spec-result-text").textContent).toContain("sanitized answer")
    );
    expect(runOnce.mock.calls[0][0].prompt).toContain(
      "For 'Question', the customer wrote: why is the sky blue"
    );
  });
});
