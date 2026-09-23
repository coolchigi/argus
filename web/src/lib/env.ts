function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

export const env = {
  apiUrl: required("NEXT_PUBLIC_ARGUS_API_URL"),
  cognitoRegion: required("NEXT_PUBLIC_COGNITO_REGION"),
  cognitoUserPoolId: required("NEXT_PUBLIC_COGNITO_USER_POOL_ID"),
  cognitoClientId: required("NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID"),
};
