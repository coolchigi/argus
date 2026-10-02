import { test } from "node:test";
import assert from "node:assert/strict";
import {
  describeResetError,
  PASSWORD_HINT,
  RESET_DONE_COPY,
  RESET_GENERIC_COPY,
  RESET_RESENT_COPY,
  RESET_SENT_COPY,
} from "./password-reset.ts";

// Shaped like amazon-cognito-identity-js errors: name and code are both the Cognito type.
function cognitoError(code: string, message = `${code}: raw Cognito text`): Error {
  const err = new Error(message);
  err.name = code;
  (err as Error & { code: string }).code = code;
  return err;
}

test("a wrong code and an expired code get different, plain messages", () => {
  const mismatch = describeResetError(cognitoError("CodeMismatchException"));
  const expired = describeResetError(cognitoError("ExpiredCodeException"));
  assert.match(mismatch, /doesn't match/);
  assert.match(expired, /expired/);
  assert.match(expired, /new code/);
  assert.notEqual(mismatch, expired);
});

test("a weak password states the whole policy", () => {
  const copy = describeResetError(cognitoError("InvalidPasswordException", "Password does not conform to policy"));
  assert.match(copy, /12/);
  for (const part of [/uppercase/, /lowercase/, /number/, /symbol/]) assert.match(copy, part);
});

test("both Cognito rate limits get the wait-and-retry message", () => {
  for (const code of ["LimitExceededException", "TooManyRequestsException"]) {
    assert.equal(describeResetError(cognitoError(code)), "Too many tries. Wait a few minutes and try again.");
  }
});

test("anything else gets the generic retry message, never the raw error", () => {
  const cases: unknown[] = [
    cognitoError("InvalidParameterException", "Cannot reset password for the user as there is no registered/verified email"),
    cognitoError("NetworkError", "Network error"),
    cognitoError("UserNotFoundException", "Username/client id combination not found."),
    new Error("boom"),
    "a string",
    null,
    undefined,
    { code: 42 },
  ];
  for (const err of cases) assert.equal(describeResetError(err), RESET_GENERIC_COPY);
});

test("an error whose code names a built-in object key still gets the generic message", () => {
  for (const code of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
    assert.equal(describeResetError({ code, name: code }), RESET_GENERIC_COPY);
  }
});

test("a code set only on name (no code field) still maps", () => {
  const err = new Error("x");
  err.name = "ExpiredCodeException";
  assert.match(describeResetError(err), /expired/);
});

test("no message names a Cognito exception", () => {
  const codes = [
    "CodeMismatchException",
    "ExpiredCodeException",
    "InvalidPasswordException",
    "LimitExceededException",
    "TooManyRequestsException",
    "SomethingNewException",
  ];
  for (const code of codes) assert.doesNotMatch(describeResetError(cognitoError(code)), /Exception|Cognito/);
});

test("the sent copy reads the same whether or not the account exists", () => {
  assert.match(RESET_SENT_COPY, /^If an account uses that email/);
  assert.match(RESET_RESENT_COPY, /^If an account uses that email/);
});

test("reset copy has no em dashes or semicolons", () => {
  const all = [
    RESET_SENT_COPY,
    RESET_RESENT_COPY,
    RESET_DONE_COPY,
    RESET_GENERIC_COPY,
    PASSWORD_HINT,
    ...["CodeMismatchException", "ExpiredCodeException", "InvalidPasswordException", "LimitExceededException"].map(
      (c) => describeResetError(cognitoError(c)),
    ),
  ];
  for (const copy of all) assert.doesNotMatch(copy, /[—;]/);
});
