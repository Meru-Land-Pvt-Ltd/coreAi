import { SectionIntroBlock, SectionShell } from "./primitives";
import { sectionTokens, surfaceFor, withAlpha } from "./tokens";
import type { SectionProps } from "./types";

/**
 * FAQ accordion — built on native `<details>` / `<summary>`.
 *
 * Why native: it is keyboard-operable and screen-reader-correct with no
 * JavaScript at all, it survives server rendering, and browser find-in-page can
 * open a closed answer. The only motion is the chevron, and that is disabled
 * under `prefers-reduced-motion`. Panels open independently — nothing the
 * visitor opened closes itself while they are reading it.
 */
export function FaqAccordionSection({ section, ctx }: SectionProps<"faqAccordion">) {
  const { node, parts } = section;
  const tokens = sectionTokens(ctx?.mode, ctx?.accent, ctx?.font);
  const surface = surfaceFor(tokens, node.background ?? "plain", node.style?.bgTone);

  return (
    <SectionShell node={node} kind="faqAccordion" surface={surface} tokens={tokens} padding="lg" width="md">
      <SectionIntroBlock intro={parts} surface={surface} align={node.style?.align ?? "center"} />
      <div
        data-testid="spec-faq-list"
        className={`flex flex-col gap-3 ${parts.eyebrow || parts.heading || parts.subtext ? "mt-10 sm:mt-12" : ""}`}
      >
        {parts.items.map((item) => (
          <details
            key={item.id}
            data-testid="spec-faq-item"
            data-spec-node-id={item.id}
            className="group overflow-hidden rounded-2xl"
            style={{
              backgroundColor: surface.card,
              border: `1px solid ${surface.cardBorder}`
            }}
          >
            <summary
              data-testid="spec-faq-question"
              className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-left text-[0.9375rem] font-semibold outline-none focus-visible:ring-4 sm:px-6 sm:py-5 sm:text-base [&::-webkit-details-marker]:hidden"
              style={{
                color: surface.ink,
                // @ts-expect-error -- custom property drives the focus ring color
                "--tw-ring-color": withAlpha(surface.accent, 0.35)
              }}
            >
              {/*
                A heading inside `summary` is valid HTML and it is what keeps
                the questions in the page's heading outline — the AI wrote them
                as headings, so they stay headings.
              */}
              <h3 className="min-w-0 text-[0.9375rem] font-semibold sm:text-base">{item.question}</h3>
              <svg
                aria-hidden="true"
                viewBox="0 0 20 20"
                className="h-5 w-5 shrink-0 transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none"
                fill="none"
                stroke={surface.accentInk}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m5 7.5 5 5 5-5" />
              </svg>
            </summary>
            <div
              data-testid="spec-faq-answer"
              className="flex flex-col gap-3 px-5 pb-5 text-[0.9375rem] leading-relaxed sm:px-6 sm:pb-6"
              style={{ color: surface.inkMuted }}
            >
              {item.answer.split(/\n{2,}/).map((paragraph, index) => (
                <p key={`${item.id}-p-${index}`}>{paragraph}</p>
              ))}
            </div>
          </details>
        ))}
      </div>
    </SectionShell>
  );
}
