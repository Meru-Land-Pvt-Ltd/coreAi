import type { QuoteNode } from "@coreai/shared";
import { Initials, SectionIntroBlock, SectionShell } from "./primitives";
import { sectionTokens, surfaceFor, withAlpha } from "./tokens";
import type { SectionSurface } from "./tokens";
import type { SectionProps } from "./types";

/**
 * Testimonial row — quote cards with a monogram avatar.
 *
 * No photos are invented and no logos are borrowed: the avatar is the author's
 * initials in the page accent. That keeps the section honest (nothing on the
 * page claims a person exists who does not) and keeps it beautiful without an
 * image pipeline.
 */

function QuoteCard({ quote, surface }: { quote: QuoteNode; surface: SectionSurface }) {
  const author = quote.author?.trim();
  return (
    <figure
      data-testid="spec-testimonial"
      data-spec-node-id={quote.id}
      className="flex h-full flex-col gap-5 rounded-2xl p-6 sm:p-7"
      style={{
        backgroundColor: surface.card,
        border: `1px solid ${surface.cardBorder}`,
        boxShadow: surface.cardShadow
      }}
    >
      <span aria-hidden="true" className="text-4xl leading-none font-serif" style={{ color: withAlpha(surface.accent, 0.55) }}>
        &ldquo;
      </span>
      <blockquote
        data-testid="spec-testimonial-text"
        className="flex-1 text-[0.9375rem] leading-relaxed sm:text-base"
        style={{ color: surface.ink }}
      >
        {quote.text}
      </blockquote>
      {author || quote.role ? (
        <figcaption className="flex items-center gap-3">
          {author ? <Initials name={author} surface={surface} /> : null}
          <span className="flex min-w-0 flex-col">
            {author ? (
              <span data-testid="spec-testimonial-author" className="truncate text-sm font-semibold" style={{ color: surface.ink }}>
                {author}
              </span>
            ) : null}
            {quote.role ? (
              <span data-testid="spec-testimonial-role" className="truncate text-xs" style={{ color: surface.inkSubtle }}>
                {quote.role}
              </span>
            ) : null}
          </span>
        </figcaption>
      ) : null}
    </figure>
  );
}

export function TestimonialRowSection({ section, ctx }: SectionProps<"testimonialRow">) {
  const { node, parts } = section;
  const tokens = sectionTokens(ctx?.mode, ctx?.accent, ctx?.font);
  const surface = surfaceFor(tokens, node.background ?? "tint", node.style?.bgTone);
  const columns =
    parts.quotes.length >= 3 ? "sm:grid-cols-2 lg:grid-cols-3" : parts.quotes.length === 2 ? "sm:grid-cols-2" : "";

  return (
    <SectionShell node={node} kind="testimonialRow" surface={surface} tokens={tokens} padding="lg">
      <SectionIntroBlock intro={parts} surface={surface} align={node.style?.align ?? "center"} />
      <div
        data-testid="spec-testimonial-grid"
        className={`grid items-stretch gap-5 sm:gap-6 ${columns} ${
          parts.eyebrow || parts.heading || parts.subtext ? "mt-10 sm:mt-14" : ""
        }`}
      >
        {parts.quotes.map((quote) => (
          <QuoteCard key={quote.id} quote={quote} surface={surface} />
        ))}
      </div>
    </SectionShell>
  );
}
