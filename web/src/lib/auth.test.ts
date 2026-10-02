import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { CognitoUser } from "amazon-cognito-identity-js";

// env.ts throws at load without these. Set them before auth.ts loads.
process.env.NEXT_PUBLIC_ARGUS_API_URL = "https://api.example.test";
process.env.NEXT_PUBLIC_COGNITO_REGION = "us-east-1";
process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID = "us-east-1_TestPool1";
process.env.NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID = "test-client-id";
const { forgotPassword, confirmForgotPassword } = await import("./auth.ts");

type Callbacks = { onSuccess: (data?: unknown) => void; onFailure: (err: Error) => void };
type Call = { method: string; username: string; clientId: string; args: unknown[] };

const proto = CognitoUser.prototype as unknown as Record<string, unknown>;
const originals = { forgotPassword: proto.forgotPassword, confirmPassword: proto.confirmPassword };

afterEach(() => {
  proto.forgotPassword = originals.forgotPassword;
  proto.confirmPassword = originals.confirmPassword;
});

// Replace one CognitoUser method. `settle` decides how Cognito answers.
function stub(method: "forgotPassword" | "confirmPassword", settle: (cb: Callbacks) => void): Call[] {
  const calls: Call[] = [];
  proto[method] = function (this: CognitoUser & { pool: { getClientId(): string } }, ...args: unknown[]) {
    calls.push({ method, username: this.getUsername(), clientId: this.pool.getClientId(), args });
    const cb = args.find((a) => a && typeof a === "object" && "onFailure" in a) as Callbacks;
    settle(cb);
  };
  return calls;
}

function cognitoError(code: string): Error {
  const err = new Error(`${code} from Cognito`);
  err.name = code;
  (err as Error & { code: string }).code = code;
  return err;
}

test("forgotPassword asks Cognito to send a code for that email on the configured app client", async () => {
  const calls = stub("forgotPassword", (cb) => cb.onSuccess({ CodeDeliveryDetails: {} }));
  await forgotPassword("rcic@example.test");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].username, "rcic@example.test");
  assert.equal(calls[0].clientId, "test-client-id");
});

test("forgotPassword rejects with Cognito's error so the page can map it", async () => {
  const err = cognitoError("LimitExceededException");
  stub("forgotPassword", (cb) => cb.onFailure(err));
  await assert.rejects(forgotPassword("rcic@example.test"), (e) => e === err);
});

test("forgotPassword does not resolve before Cognito answers", async () => {
  let answer: Callbacks | undefined;
  stub("forgotPassword", (cb) => {
    answer = cb;
  });
  let settled = false;
  const pending = forgotPassword("rcic@example.test").then(() => {
    settled = true;
  });
  await new Promise((r) => setImmediate(r));
  assert.equal(settled, false);
  answer!.onSuccess();
  await pending;
  assert.equal(settled, true);
});

test("confirmForgotPassword sends the code and the new password, in that order, for that email", async () => {
  const calls = stub("confirmPassword", (cb) => cb.onSuccess("SUCCESS"));
  await confirmForgotPassword("rcic@example.test", "123456", "New-Passw0rd!x");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].username, "rcic@example.test");
  assert.equal(calls[0].clientId, "test-client-id");
  assert.equal(calls[0].args[0], "123456");
  assert.equal(calls[0].args[1], "New-Passw0rd!x");
});

test("confirmForgotPassword rejects with Cognito's error on a wrong code", async () => {
  const err = cognitoError("CodeMismatchException");
  stub("confirmPassword", (cb) => cb.onFailure(err));
  await assert.rejects(confirmForgotPassword("rcic@example.test", "000000", "New-Passw0rd!x"), (e) => e === err);
});
