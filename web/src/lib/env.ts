// Every NEXT_PUBLIC_* var must be read with LITERAL property access here so
// Next.js's build-time inliner can bake the value into the client bundle.
// Dynamic access (process.env[name]) is only wired server-side, so a helper
// that reads by variable name produces "undefined" in the browser and fails
// every client component that touches env at module load.

const apiUrl = process.env.NEXT_PUBLIC_ARGUS_API_URL;
const cognitoRegion = process.env.NEXT_PUBLIC_COGNITO_REGION;
const cognitoUserPoolId = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID;
const cognitoClientId = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID;

if (!apiUrl) throw new Error("Missing NEXT_PUBLIC_ARGUS_API_URL");
if (!cognitoRegion) throw new Error("Missing NEXT_PUBLIC_COGNITO_REGION");
if (!cognitoUserPoolId) throw new Error("Missing NEXT_PUBLIC_COGNITO_USER_POOL_ID");
if (!cognitoClientId) throw new Error("Missing NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID");

export const env = {
  apiUrl,
  cognitoRegion,
  cognitoUserPoolId,
  cognitoClientId,
};
