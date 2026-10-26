export const MAX_TARGET_ROLE_LENGTH = 120;

const TARGET_ROLE_CHARACTERS = new RegExp(
  "^[\\p{L}\\p{M}\\p{N}\\s&/,+().#:'-]+$",
  "u",
);
const TARGET_ROLE_LETTER = new RegExp("\\p{L}", "u");

export function normalizeTargetRole(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function getTargetRoleError(value: string) {
  const normalized = normalizeTargetRole(value);
  if (!normalized) return "";
  if (normalized.length > MAX_TARGET_ROLE_LENGTH) {
    return `Keep the target role to ${MAX_TARGET_ROLE_LENGTH} characters or fewer.`;
  }
  if (!TARGET_ROLE_LETTER.test(normalized)) {
    return "A target role must include at least one letter.";
  }
  if (!TARGET_ROLE_CHARACTERS.test(normalized)) {
    return "Use letters, numbers, spaces, and common role-title punctuation.";
  }
  if (normalized.split(/\s+/).length > 12) {
    return "Keep the target role to 12 words or fewer.";
  }
  return "";
}