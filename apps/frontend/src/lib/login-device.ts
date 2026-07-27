const DEVICE_ID_KEY = "triven-device-id";
const PENDING_NEXT_KEY = "triven-pending-login-next";

function randomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replace(/-/g, "");
  }

  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function getLoginDeviceId(): string | null {
  if (typeof window === "undefined") return null;

  try {
    const existing = window.localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;

    const created = randomId();
    window.localStorage.setItem(DEVICE_ID_KEY, created);
    return created;
  } catch {
    return null;
  }
}

export function setPendingLoginNext(next: string | null) {
  if (typeof window === "undefined") return;

  try {
    if (next) {
      window.localStorage.setItem(PENDING_NEXT_KEY, next);
    } else {
      window.localStorage.removeItem(PENDING_NEXT_KEY);
    }
  } catch {
    // Non-fatal — the login just lands on the default dashboard.
  }
}

/** Read and clear the stored return path. */
export function takePendingLoginNext(): string | null {
  if (typeof window === "undefined") return null;

  try {
    const next = window.localStorage.getItem(PENDING_NEXT_KEY);
    window.localStorage.removeItem(PENDING_NEXT_KEY);
    return next;
  } catch {
    return null;
  }
}

const PENDING_ROLE_KEY = "triven.login.pending-role";

export function setPendingLoginRole(role: "BUSINESS" | "ARCHITECT" | null) {
  if (typeof window === "undefined") return;

  try {
    if (role) {
      window.localStorage.setItem(PENDING_ROLE_KEY, role);
    } else {
      window.localStorage.removeItem(PENDING_ROLE_KEY);
    }
  } catch {
    // Non-fatal — routing falls back to the account's default side.
  }
}

/** Read and clear the requested login role. */
export function takePendingLoginRole(): "BUSINESS" | "ARCHITECT" | null {
  if (typeof window === "undefined") return null;

  try {
    const value = window.localStorage.getItem(PENDING_ROLE_KEY);
    window.localStorage.removeItem(PENDING_ROLE_KEY);
    return value === "BUSINESS" || value === "ARCHITECT" ? value : null;
  } catch {
    return null;
  }
}
