type AuthErrorLike = {
  name?: string;
  message?: string;
  code?: string;
} | null | undefined;

/**
 * Session cookies can be stale after concurrent refreshes or a revoked session.
 * These conditions mean "signed out" for page rendering; they are not app errors.
 */
export function isRecoverableAuthSessionError(error: AuthErrorLike) {
  if (!error) return false;

  const code = error.code?.toLowerCase();
  const message = error.message?.toLowerCase() ?? "";

  return (
    error.name === "AuthSessionMissingError" ||
    error.name === "AuthRetryableFetchError" ||
    code === "refresh_token_not_found" ||
    code === "refresh_token_already_used" ||
    code === "session_expired" ||
    message.includes("invalid refresh token") ||
    message.includes("refresh token not found")
  );
}
