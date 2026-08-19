import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { authRoleSchema } from "./schemas";

/**
 * THE HOLE THIS GUARDS.
 *
 * POST /auth/login accepts a `role` field, ADMIN is an allowed value, and the
 * handler used to grant whatever role was asked for after checking only the
 * account's own password. Anyone holding a password could post role:"ADMIN",
 * be granted it permanently, and walk into platform pricing, payouts, the
 * phone-number pool, every business record and the power to suspend users.
 *
 * The emailed-code paths always checked this. The password path did not.
 * These tests fail loudly if that check is ever removed again.
 */
describe("admin cannot be granted by asking for it", () => {
  it("still accepts ADMIN as a role you can ask for", () => {
    // The check is an entitlement check, not a schema restriction — an admin
    // must still be able to sign in. If this ever stops being true the guard
    // below is testing nothing.
    expect(authRoleSchema.options).toContain("ADMIN");
  });

  it("guards the grant with an entitlement check, before granting", () => {
    const source = readFileSync(
      new URL("./routes.ts", import.meta.url).pathname,
      "utf8"
    );

    const guardIndex = source.indexOf(
      'if (input.role === "ADMIN" && !candidates.some((candidate) => holdsAdminRole(candidate)))'
    );
    const grantIndex = source.indexOf("await grantRole(user.id, input.role)");

    expect(guardIndex).toBeGreaterThan(-1);
    expect(grantIndex).toBeGreaterThan(-1);
    // Order matters as much as presence: a check that runs after the grant is
    // not a check.
    expect(guardIndex).toBeLessThan(grantIndex);
  });

  it("checks every row for the address, not just the resolved one", () => {
    const source = readFileSync(
      new URL("./routes.ts", import.meta.url).pathname,
      "utf8"
    );
    // User rows are unique per (email, role), so an owner who is both an
    // architect and an admin has two. Checking only the resolved row would let
    // the architect row hide the admin one — or vice versa.
    expect(source).toContain("candidates.some((candidate) => holdsAdminRole(candidate))");
  });
});

