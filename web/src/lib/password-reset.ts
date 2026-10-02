// Copy for the forgot-password flow. The user pool sets
// PreventUserExistenceErrors, so a reset request "succeeds" for an unknown
// email too. The copy after step 1 has to read the same either way.

export const RESET_SENT_COPY = "If an account uses that email, we sent a code to it.";
export const RESET_RESENT_COPY = "If an account uses that email, we sent a new code to it.";
export const RESET_DONE_COPY = "Password reset. Sign in with your new password.";

// Mirrors the user pool's password policy (min 12, upper, lower, number, symbol).
export const PASSWORD_HINT = "12+ characters, upper, lower, digit, symbol.";

const TOO_MANY = "Too many tries. Wait a few minutes and try again.";

const ERROR_COPY: Record<string, string> = {
  CodeMismatchException: "That code doesn't match. Check the email we sent and try again.",
  ExpiredCodeException: "That code has expired. Send a new code and try again.",
  InvalidPasswordException:
    "Your new password needs at least 12 characters, with an uppercase letter, a lowercase letter, a number and a symbol.",
  LimitExceededException: TOO_MANY,
  TooManyRequestsException: TOO_MANY,
  TooManyFailedAttemptsException: TOO_MANY,
};

export const RESET_GENERIC_COPY = "Something went wrong. Try again in a minute.";

// amazon-cognito-identity-js sets both `code` and `name` to the Cognito error
// type. Never show either one, or the raw message, to the consultant.
export function describeResetError(err: unknown): string {
  if (err && typeof err === "object") {
    const { code, name } = err as { code?: unknown; name?: unknown };
    for (const key of [code, name]) {
      if (typeof key === "string" && Object.hasOwn(ERROR_COPY, key)) return ERROR_COPY[key];
    }
  }
  return RESET_GENERIC_COPY;
}
