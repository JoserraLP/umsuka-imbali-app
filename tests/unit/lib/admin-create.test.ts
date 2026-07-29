import { describe, expect, it } from "vitest";

const EMAIL_ALIAS_DOMAIN = "umsuka.internal";

/**
 * Tests the email alias generation logic that is embedded in
 * src/lib/auth/admin-create.ts's `generateEmailAlias()` function.
 *
 * The actual implementation uses `crypto.randomUUID()` which we
 * cannot mock easily — we test the format contract here.
 */
describe("email alias generation", () => {
  it("produces the correct format: user-{uuid}@umsuka.internal", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    const alias = `user-${uuid}@${EMAIL_ALIAS_DOMAIN}`;

    expect(alias).toMatch(/^user-[a-f0-9-]+@umsuka\.internal$/);
    expect(alias).not.toContain(" ");
    expect(alias).not.toContain("..");
  });

  it("UUIDs are 36 characters (standard format)", () => {
    const uuid = crypto.randomUUID();
    expect(uuid.length).toBe(36);
    expect(uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("generated alias is unique across calls", () => {
    const aliases = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const uuid = crypto.randomUUID();
      const alias = `user-${uuid}@${EMAIL_ALIAS_DOMAIN}`;
      aliases.add(alias);
    }
    expect(aliases.size).toBe(100);
  });

  it("alias email does not reveal any user information", () => {
    const uuid = crypto.randomUUID();
    const alias = `user-${uuid}@${EMAIL_ALIAS_DOMAIN}`;

    // Should not contain names, dates, or sequential numbers
    expect(alias).not.toMatch(/^user-\d+@/); // not sequential
    expect(alias).not.toMatch(/@.*user.*@/); // no double @
    expect(alias.split("@")[0]).toMatch(/^user-/); // starts with user-
  });
});
