import { AdminUpdateUserAttributesCommand, CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { PostConfirmationTriggerEvent } from 'aws-lambda';

const cognito = new CognitoIdentityProviderClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const RCIC_USERS_TABLE = requiredEnv('RCIC_USERS_TABLE');

export const handler = async (event: PostConfirmationTriggerEvent): Promise<PostConfirmationTriggerEvent> => {
  // Cognito requires the trigger to return the event untouched. Any thrown error
  // aborts the signup flow, so we surface exactly what failed and keep the state
  // in Cognito consistent (user is confirmed, but no rcicUsers row).
  // Only provision on first confirmation, not after password recovery.
  if (event.triggerSource !== 'PostConfirmation_ConfirmSignUp') {
    log('info', 'trigger-ignored', { triggerSource: event.triggerSource });
    return event;
  }

  const attrs = event.request.userAttributes ?? {};
  const email = attrs.email;
  const licenseRaw = attrs['custom:rcic_license'];
  const givenName = attrs.given_name;
  const familyName = attrs.family_name;
  const sub = attrs.sub;

  if (!email || !licenseRaw || !sub) {
    log('error', 'missing-required-attributes', {
      hasEmail: !!email,
      hasLicense: !!licenseRaw,
      hasSub: !!sub,
    });
    throw new Error('missing-required-attributes');
  }

  const license = licenseRaw.trim().toUpperCase();
  const existingRcicId = attrs['custom:rcic_id'];
  const rcicId = existingRcicId && existingRcicId.length > 0 ? existingRcicId : license;

  await ddb.send(
    new PutCommand({
      TableName: RCIC_USERS_TABLE,
      Item: {
        rcicId,
        cognitoSub: sub,
        rcicLicense: license,
        email,
        verifiedSenderEmail: email,
        displayName: [givenName, familyName].filter(Boolean).join(' ').trim() || license,
        active: true,
        createdAt: new Date().toISOString(),
      },
      // Idempotent: if the row already exists (re-signup, replay), do not overwrite it.
      ConditionExpression: 'attribute_not_exists(rcicId)',
    }),
  ).catch((err: unknown) => {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
      log('info', 'rcic-row-already-exists', { rcicId });
      return;
    }
    throw err;
  });

  if (!existingRcicId) {
    // Persist the chosen rcicId back onto the Cognito user so subsequent JWTs
    // carry it as a claim. Handlers read custom:rcic_id first.
    await cognito.send(
      new AdminUpdateUserAttributesCommand({
        UserPoolId: event.userPoolId,
        Username: event.userName,
        UserAttributes: [{ Name: 'custom:rcic_id', Value: rcicId }],
      }),
    );
  }

  log('info', 'rcic-provisioned', { rcicId, license, email });
  return event;
};

function log(level: 'debug' | 'info' | 'error', msg: string, fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ level, msg, timestamp: new Date().toISOString(), ...fields }));
}

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}
