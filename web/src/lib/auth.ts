import {
  AuthenticationDetails,
  CognitoUser,
  CognitoUserAttribute,
  CognitoUserPool,
  CognitoUserSession,
  ISignUpResult,
} from "amazon-cognito-identity-js";
import { env } from "./env";

let poolCache: CognitoUserPool | null = null;

function pool(): CognitoUserPool {
  if (!poolCache) {
    poolCache = new CognitoUserPool({
      UserPoolId: env.cognitoUserPoolId,
      ClientId: env.cognitoClientId,
    });
  }
  return poolCache;
}

export type SignUpInput = {
  email: string;
  password: string;
  givenName: string;
  familyName: string;
  rcicLicense: string;
};

export function signUp(input: SignUpInput): Promise<ISignUpResult> {
  const attributes = [
    new CognitoUserAttribute({ Name: "email", Value: input.email }),
    new CognitoUserAttribute({ Name: "given_name", Value: input.givenName }),
    new CognitoUserAttribute({ Name: "family_name", Value: input.familyName }),
    new CognitoUserAttribute({ Name: "custom:rcic_license", Value: input.rcicLicense.trim().toUpperCase() }),
    new CognitoUserAttribute({ Name: "custom:rcic_id", Value: input.rcicLicense.trim().toUpperCase() }),
  ];
  return new Promise((resolve, reject) => {
    pool().signUp(input.email, input.password, attributes, [], (err, result) => {
      if (err || !result) return reject(err ?? new Error("signUp returned no result"));
      resolve(result);
    });
  });
}

export function confirmSignUp(email: string, code: string): Promise<void> {
  const user = new CognitoUser({ Username: email, Pool: pool() });
  return new Promise((resolve, reject) => {
    user.confirmRegistration(code, true, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

export function resendConfirmationCode(email: string): Promise<void> {
  const user = new CognitoUser({ Username: email, Pool: pool() });
  return new Promise((resolve, reject) => {
    user.resendConfirmationCode((err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

export function signIn(email: string, password: string): Promise<CognitoUserSession> {
  const user = new CognitoUser({ Username: email, Pool: pool() });
  const details = new AuthenticationDetails({ Username: email, Password: password });
  return new Promise((resolve, reject) => {
    user.authenticateUser(details, {
      onSuccess: (session) => resolve(session),
      onFailure: (err) => reject(err),
      newPasswordRequired: () => reject(new Error("new-password-required")),
    });
  });
}

export function signOut(): void {
  const user = pool().getCurrentUser();
  user?.signOut();
}

export function getSession(): Promise<CognitoUserSession | null> {
  const user = pool().getCurrentUser();
  if (!user) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    user.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err) return reject(err);
      resolve(session);
    });
  });
}

export async function getIdToken(): Promise<string | null> {
  const session = await getSession();
  if (!session || !session.isValid()) return null;
  return session.getIdToken().getJwtToken();
}

export type SessionClaims = {
  sub: string;
  email: string;
  givenName?: string;
  familyName?: string;
  rcicId?: string;
  rcicLicense?: string;
};

export async function getClaims(): Promise<SessionClaims | null> {
  const session = await getSession();
  if (!session || !session.isValid()) return null;
  const payload = session.getIdToken().decodePayload() as Record<string, unknown>;
  return {
    sub: String(payload.sub ?? ""),
    email: String(payload.email ?? ""),
    givenName: payload.given_name as string | undefined,
    familyName: payload.family_name as string | undefined,
    rcicId: payload["custom:rcic_id"] as string | undefined,
    rcicLicense: payload["custom:rcic_license"] as string | undefined,
  };
}
