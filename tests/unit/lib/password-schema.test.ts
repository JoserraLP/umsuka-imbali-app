import { describe, expect, it } from "vitest";
import {
  passwordStrengthSchema,
  loginSchema,
  resetPasswordSchema,
  changePasswordSchema,
  generateResetTokenSchema,
} from "@/lib/auth/password-schema";

// ── Reusable valid password fixture ──────────────────────
const VALID_PASSWORD = "SecurePass123!";
const WEAK_PASSWORD_NO_UPPER = "securepass123!";
const WEAK_PASSWORD_NO_LOWER = "SECUREPASS123!";
const WEAK_PASSWORD_NO_DIGIT = "SecurePass!!";
const WEAK_PASSWORD_NO_SPECIAL = "SecurePass123";
const WEAK_PASSWORD_TOO_SHORT = "Se1!";

describe("passwordStrengthSchema", () => {
  it("accepts a strong password with all required character types", () => {
    const result = passwordStrengthSchema.safeParse(VALID_PASSWORD);
    expect(result.success).toBe(true);
  });

  it("rejects password shorter than 8 characters", () => {
    const result = passwordStrengthSchema.safeParse(WEAK_PASSWORD_TOO_SHORT);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error!.issues[0]!.message).toContain("8 caracteres");
    }
  });

  it("rejects password without uppercase letter", () => {
    const result = passwordStrengthSchema.safeParse(WEAK_PASSWORD_NO_UPPER);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error!.issues[0]!.message).toContain("mayúscula");
    }
  });

  it("rejects password without lowercase letter", () => {
    const result = passwordStrengthSchema.safeParse(WEAK_PASSWORD_NO_LOWER);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error!.issues[0]!.message).toContain("minúscula");
    }
  });

  it("rejects password without a digit", () => {
    const result = passwordStrengthSchema.safeParse(WEAK_PASSWORD_NO_DIGIT);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error!.issues[0]!.message).toContain("número");
    }
  });

  it("rejects password without a special character", () => {
    const result = passwordStrengthSchema.safeParse(WEAK_PASSWORD_NO_SPECIAL);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error!.issues[0]!.message).toContain("especial");
    }
  });

  it("rejects password longer than 100 characters", () => {
    const longPassword = "A1!" + "a".repeat(99);
    const result = passwordStrengthSchema.safeParse(longPassword);
    expect(result.success).toBe(false);
  });

  it("accepts password with various special characters", () => {
    const passwords = [
      "Test1234!",
      "Test@1234",
      "Test#1234",
      "Test\$1234",
      "Test%1234",
      "Test^1234",
      "Test&1234",
      "Test*1234",
      "Test(1234",
      "Test)1234",
      "Test-1234",
      "Test_1234",
      "Test+1234",
      "Test=1234",
      "Test[1234",
      "Test]1234",
      "Test{1234",
      "Test}1234",
      "Test|1234",
      "Test:1234",
      "Test;1234",
      "Test'1234",
      'Test"1234',
      "Test<1234",
      "Test>1234",
      "Test,1234",
      "Test.1234",
      "Test?1234",
      "Test~1234",
      "Test`1234",
    ];
    for (const pwd of passwords) {
      const result = passwordStrengthSchema.safeParse(pwd);
      expect(result.success).toBe(true);
    }
  });

  it("accepts password with exactly 8 characters meeting all criteria", () => {
    const result = passwordStrengthSchema.safeParse("Abcd123!");
    expect(result.success).toBe(true);
  });
});

describe("loginSchema", () => {
  it("accepts valid username and password", () => {
    const result = loginSchema.safeParse({
      username: "testuser",
      password: VALID_PASSWORD,
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty username", () => {
    const result = loginSchema.safeParse({
      username: "",
      password: VALID_PASSWORD,
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty password", () => {
    const result = loginSchema.safeParse({
      username: "testuser",
      password: "",
    });
    expect(result.success).toBe(false);
  });

  it("trims whitespace from username", () => {
    const result = loginSchema.safeParse({
      username: "  testuser  ",
      password: VALID_PASSWORD,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.username).toBe("testuser");
    }
  });

  it("does not trim whitespace from password", () => {
    const result = loginSchema.safeParse({
      username: "testuser",
      password: "  password  ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.password).toBe("  password  ");
    }
  });
});

describe("resetPasswordSchema", () => {
  it("accepts valid token, password, and matching confirmation", () => {
    const result = resetPasswordSchema.safeParse({
      token: "550e8400-e29b-41d4-a716-446655440000",
      password: VALID_PASSWORD,
      confirmPassword: VALID_PASSWORD,
    });
    expect(result.success).toBe(true);
  });

  it("rejects non-UUID token", () => {
    const result = resetPasswordSchema.safeParse({
      token: "not-a-uuid",
      password: VALID_PASSWORD,
      confirmPassword: VALID_PASSWORD,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error!.issues[0]!.message).toContain("Token inválido");
    }
  });

  it("rejects weak password", () => {
    const result = resetPasswordSchema.safeParse({
      token: "550e8400-e29b-41d4-a716-446655440000",
      password: WEAK_PASSWORD_TOO_SHORT,
      confirmPassword: WEAK_PASSWORD_TOO_SHORT,
    });
    expect(result.success).toBe(false);
  });

  it("rejects when passwords do not match", () => {
    const result = resetPasswordSchema.safeParse({
      token: "550e8400-e29b-41d4-a716-446655440000",
      password: VALID_PASSWORD,
      confirmPassword: "DifferentPass1!",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const confirmIssues = result.error!.issues.filter(
        (i) => i.path.includes("confirmPassword"),
      );
      expect(confirmIssues.length).toBeGreaterThan(0);
    }
  });
});

describe("changePasswordSchema", () => {
  it("accepts valid current, new, and matching confirmation", () => {
    const result = changePasswordSchema.safeParse({
      currentPassword: "OldPass123!",
      newPassword: VALID_PASSWORD,
      confirmPassword: VALID_PASSWORD,
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty current password", () => {
    const result = changePasswordSchema.safeParse({
      currentPassword: "",
      newPassword: VALID_PASSWORD,
      confirmPassword: VALID_PASSWORD,
    });
    expect(result.success).toBe(false);
  });

  it("rejects weak new password", () => {
    const result = changePasswordSchema.safeParse({
      currentPassword: "OldPass123!",
      newPassword: WEAK_PASSWORD_NO_SPECIAL,
      confirmPassword: WEAK_PASSWORD_NO_SPECIAL,
    });
    expect(result.success).toBe(false);
  });

  it("rejects when new passwords do not match", () => {
    const result = changePasswordSchema.safeParse({
      currentPassword: "OldPass123!",
      newPassword: VALID_PASSWORD,
      confirmPassword: "DifferentPass1!",
    });
    expect(result.success).toBe(false);
  });
});

describe("generateResetTokenSchema", () => {
  it("accepts a valid profile UUID", () => {
    const result = generateResetTokenSchema.safeParse({
      profileId: "550e8400-e29b-41d4-a716-446655440000",
    });
    expect(result.success).toBe(true);
  });

  it("rejects non-UUID profileId", () => {
    const result = generateResetTokenSchema.safeParse({
      profileId: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty profileId", () => {
    const result = generateResetTokenSchema.safeParse({
      profileId: "",
    });
    expect(result.success).toBe(false);
  });
});
