"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { WhatsAppEmbeddedSignupOnboarding } from "./WhatsAppEmbeddedSignupOnboarding";
import type { WhatsAppConnection } from "@/components/architect/features/api";

export function WhatsAppConnectModal({
  open,
  onClose,
  onConnected
}: {
  open: boolean;
  onClose: () => void;
  onConnected?: (connection: WhatsAppConnection) => void;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-900/45 px-4 backdrop-blur-sm"
      data-testid="whatsapp-connect-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Connect WhatsApp Business"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-gray-100 bg-white shadow-xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 z-10 rounded-lg px-2 py-1 text-sm font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          data-testid="whatsapp-connect-modal-close"
          aria-label="Close"
        >
          ✕
        </button>
        <WhatsAppEmbeddedSignupOnboarding
          variant="modal"
          onClose={onClose}
          onConnected={(connection) => {
            onConnected?.(connection);
            onClose();
          }}
        />
      </div>
    </div>,
    document.body
  );
}
