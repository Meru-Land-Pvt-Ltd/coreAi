"use client";

import { useEffect, useRef, useState, type ReactNode, type TouchEvent } from "react";
import type { MobilePanel } from "./types";

const SWIPE_CLOSE_PX = 80;

export function MobileSheet({
  panel,
  children,
  onClose
}: {
  panel: MobilePanel;
  children: ReactNode;
  onClose: () => void;
}) {
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [entered, setEntered] = useState(false);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const lockHorizontalRef = useRef(false);

  useEffect(() => {
    setDragX(0);
    setDragging(false);
    lockHorizontalRef.current = false;
    setEntered(false);
    if (!panel) return;
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, [panel]);

  useEffect(() => {
    if (!panel) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [panel]);

  if (!panel) return null;

  const isLibrary = panel === "library";
  const title = isLibrary ? "Components" : "Properties";

  function onTouchStart(event: TouchEvent) {
    if (!isLibrary) return;
    const touch = event.touches[0];
    if (!touch) return;
    startXRef.current = touch.clientX;
    startYRef.current = touch.clientY;
    lockHorizontalRef.current = false;
    setDragging(true);
  }

  function onTouchMove(event: TouchEvent) {
    if (!isLibrary || !dragging) return;
    const touch = event.touches[0];
    if (!touch) return;

    const deltaX = touch.clientX - startXRef.current;
    const deltaY = touch.clientY - startYRef.current;

    if (!lockHorizontalRef.current) {
      if (Math.abs(deltaX) < 8 && Math.abs(deltaY) < 8) return;
      if (Math.abs(deltaY) > Math.abs(deltaX)) {
        setDragging(false);
        setDragX(0);
        return;
      }
      lockHorizontalRef.current = true;
    }

    setDragX(Math.min(0, deltaX));
  }

  function onTouchEnd() {
    if (!isLibrary) return;
    if (dragX <= -SWIPE_CLOSE_PX) {
      onClose();
    }
    setDragX(0);
    setDragging(false);
    lockHorizontalRef.current = false;
  }

  const libraryOffset = entered ? dragX : -320;

  return (
    <div className="fixed inset-0 z-50 xl:hidden" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close panel"
        data-testid="mobile-sheet-backdrop"
        onClick={onClose}
        className="absolute inset-0 bg-slate-950/40 transition-opacity duration-280"
        style={{ opacity: isLibrary ? (entered ? Math.max(0.15, 1 + dragX / 280) : 0) : 1 }}
      />

      {isLibrary ? (
        <aside
          data-testid="builder-mobile-library-sidebar"
          className="absolute inset-y-0 left-0 flex w-[min(20rem,86vw)] flex-col overflow-hidden bg-white shadow-2xl will-change-transform"
          style={{
            transform: `translateX(${libraryOffset}px)`,
            transition: dragging ? "none" : "transform 280ms ease-out"
          }}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onTouchCancel={onTouchEnd}
        >
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <p
              className="text-sm font-black text-slate-900"
              data-testid="architect-ui-workflow-builder-mobile-sheet-panel-library-components-properties-text"
            >
              {title}
            </p>
            <button
              type="button"
              onClick={onClose}
              data-testid="mobile-sheet-close"
              className="rounded-lg p-1.5 text-slate-400 hover:bg-gray-100 hover:text-slate-600"
              aria-label="Close components"
            >
              ×
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
          <p className="shrink-0 border-t border-gray-100 px-4 py-2 text-center text-[10px] text-slate-400">
            Swipe left to close
          </p>
        </aside>
      ) : (
        <aside className="absolute bottom-0 left-0 right-0 flex max-h-[min(82vh,720px)] flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl pb-[env(safe-area-inset-bottom)]">
          <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-gray-200" aria-hidden="true" />
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <p
              className="text-sm font-black text-slate-900"
              data-testid="architect-ui-workflow-builder-mobile-sheet-panel-library-components-properties-text"
            >
              {title}
            </p>
            <button
              type="button"
              onClick={onClose}
              data-testid="mobile-sheet-close"
              className="rounded-lg p-1.5 text-slate-400 hover:bg-gray-100 hover:text-slate-600"
              aria-label="Close properties"
            >
              ×
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
        </aside>
      )}
    </div>
  );
}
