/**
 * Onboarding gate for the middleware: a member must choose their
 * workgroup before using the app. The profiles.workgroup column is
 * NOT NULL and defaults to 'ninguno', so "no group assigned" is
 * represented by null (defensive) or 'ninguno' — anything else means
 * onboarding is already done.
 */
export function requiresWorkgroupOnboarding(workgroup: string | null): boolean {
  return workgroup === null || workgroup === "ninguno";
}
