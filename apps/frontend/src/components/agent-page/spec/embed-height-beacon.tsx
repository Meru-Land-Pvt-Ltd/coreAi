"use client";

import { useEffect } from "react";

/**
 * Tells the host page how tall the product currently is.
 *
 * An iframe has no idea how tall its content is, so without this every embed
 * would either clip the answer or leave a lake of empty space under it. The
 * loader script listens and resizes the frame, which is why an embedded agent
 * grows naturally as an answer streams in.
 *
 * Deliberately the only place in the whole product renderer that touches
 * window.parent. The message carries a slug and a number and nothing else, so
 * the wildcard target origin (we cannot know the host's origin) leaks nothing.
 */
export function EmbedHeightBeacon({ slug }: { slug: string }) {
  useEffect(() => {
    if (typeof window === "undefined" || window.parent === window) return;

    let lastHeight = 0;
    const send = () => {
      const height = Math.ceil(document.documentElement.scrollHeight);
      // Only speak when the number actually moved — a ResizeObserver can fire
      // many times per frame while an answer renders.
      if (height === lastHeight) return;
      lastHeight = height;
      window.parent.postMessage({ type: "triven:height", slug, height }, "*");
    };

    send();
    const observer = new ResizeObserver(send);
    observer.observe(document.documentElement);
    // Fonts and images land after layout and change the height again.
    window.addEventListener("load", send);

    return () => {
      observer.disconnect();
      window.removeEventListener("load", send);
    };
  }, [slug]);

  return null;
}
