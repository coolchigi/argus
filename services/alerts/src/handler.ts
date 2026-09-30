import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { randomUUID } from 'node:crypto';
import { alertSeverity, sendsRealtime } from './decide';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ses = new SESv2Client({});

const BRIEFS_TABLE = requiredEnv('BRIEFS_TABLE');
const ALERTS_TABLE = requiredEnv('ALERTS_TABLE');
const RCIC_USERS_TABLE = requiredEnv('RCIC_USERS_TABLE');
const SES_FROM_EMAIL = requiredEnv('SES_FROM_EMAIL');
const DEMO_RCIC_EMAIL = process.env.DEMO_RCIC_EMAIL ?? '';
// How long a claim on a brief's alert holds before another delivery may take
// it over. Infra sets it above the function timeout, so a live invocation
// never loses its claim, and a crashed one frees it before Lambda's retry.
const CLAIM_LEASE_MS = Number(requiredEnv('ALERT_CLAIM_LEASE_SECONDS')) * 1000;

type ImpactType = 'crs-delta' | 'eligibility-flip' | 'deadline-shift' | 'lmia-implication' | 'french-bonus' | 'procedural' | 'none';

type BriefReadyDetail = {
  briefId: string;
  rcicId: string;
  clientId: string;
  assessmentKey: string;
  impactType: ImpactType;
  numericDelta: number | null;
  confidence: 'low' | 'medium' | 'high';
  // Severity Sentinel stored on the PolicyRules row. Absent on events
  // emitted before Composer started forwarding it.
  ruleSeverity?: string | null;
  subject: string;
  createdAt: string;
};

type EventBridgeInput = { source?: string; 'detail-type'?: string; detail?: BriefReadyDetail };

export const handler = async (event: EventBridgeInput | BriefReadyDetail): Promise<{ dispatched: boolean; reason?: string }> => {
  const runId = randomUUID();
  const detail: BriefReadyDetail = 'detail' in event && event.detail ? event.detail : (event as BriefReadyDetail);

  const severity = alertSeverity(detail);
  log('info', 'alert-start', {
    runId,
    briefId: detail.briefId,
    rcicId: detail.rcicId,
    clientId: detail.clientId,
    impactType: detail.impactType,
    numericDelta: detail.numericDelta,
    ruleSeverity: detail.ruleSeverity ?? null,
    severity,
  });

  if (!sendsRealtime(severity)) {
    log('info', 'alert-skipped-below-threshold', { runId, briefId: detail.briefId, severity });
    return { dispatched: false, reason: 'severity-below-threshold' };
  }

  const user = await loadUser(detail.rcicId);
  // The consultant turned real-time email off in Settings (PATCH /me). The
  // brief is still drafted and waits in the app.
  if (realtimeAlertsOff(user)) {
    log('info', 'alert-skipped-preference-off', { runId, briefId: detail.briefId, rcicId: detail.rcicId });
    return { dispatched: false, reason: 'realtime-alerts-off' };
  }

  const recipient = resolveRecipient(user);
  if (!recipient) {
    log('error', 'alert-no-recipient', { runId, rcicId: detail.rcicId });
    return { dispatched: false, reason: 'no-recipient-configured' };
  }

  const brief = await loadBrief(detail.rcicId, detail.briefId);
  if (!brief) {
    log('error', 'alert-brief-not-found', { runId, briefId: detail.briefId });
    return { dispatched: false, reason: 'brief-not-found' };
  }

  // Composer sends BriefReady at least once, so the same brief can arrive
  // twice, sometimes at the same moment. The claim on the brief row lets one
  // delivery send. See claimAlert for what happens when a step fails.
  const claim = await claimAlert(detail.rcicId, detail.briefId, runId);
  if (claim === 'already-sent') {
    log('info', 'alert-already-sent', { runId, briefId: detail.briefId });
    return { dispatched: false, reason: 'already-sent' };
  }
  if (claim === 'in-flight') {
    // Another delivery holds the claim and hasn't sent yet. Throwing makes
    // Lambda retry this one later: by then the email is out, or the claim
    // has gone stale and this delivery takes it over.
    log('info', 'alert-in-flight', { runId, briefId: detail.briefId });
    throw new Error(`alert for brief ${detail.briefId} is in flight in another delivery`);
  }

  let messageId: string;
  try {
    messageId = await sendEmail(recipient, brief, detail);
  } catch (err) {
    // Nothing went out, so free the claim and let Lambda retry the send.
    await releaseClaim(detail.rcicId, detail.briefId, runId).catch((releaseErr: unknown) => {
      // The retry takes the claim over once the lease runs out.
      log('error', 'alert-claim-release-failed', { runId, briefId: detail.briefId, error: String(releaseErr) });
    });
    throw err;
  }

  // The email is out. From here a failure gets logged and never thrown: a
  // throw means a Lambda retry, and a retry after the lease sends again.
  try {
    await markSent(detail.rcicId, detail.briefId, runId, messageId);
  } catch (err) {
    log('error', 'alert-mark-sent-failed', { runId, briefId: detail.briefId, sesMessageId: messageId, error: String(err) });
  }
  try {
    await recordSend({
      rcicId: detail.rcicId,
      briefId: detail.briefId,
      clientId: detail.clientId,
      severity,
      recipient,
      sesMessageId: messageId,
    });
  } catch (err) {
    log('error', 'alert-record-failed', { runId, briefId: detail.briefId, sesMessageId: messageId, error: String(err) });
  }

  log('info', 'alert-dispatched', {
    runId,
    briefId: detail.briefId,
    rcicId: detail.rcicId,
    recipient,
    sesMessageId: messageId,
  });
  return { dispatched: true };
};

async function loadUser(rcicId: string): Promise<Record<string, unknown> | null> {
  const res = await ddb.send(new GetCommand({ TableName: RCIC_USERS_TABLE, Key: { rcicId } }));
  return (res.Item as Record<string, unknown> | undefined) ?? null;
}

/** Only an explicit false turns alerts off. A row without preferences keeps them on. */
function realtimeAlertsOff(user: Record<string, unknown> | null): boolean {
  const prefs = user?.preferences;
  return prefs !== null && typeof prefs === 'object' && (prefs as Record<string, unknown>).realtimeAlerts === false;
}

function resolveRecipient(user: Record<string, unknown> | null): string | null {
  const email = user?.email;
  if (typeof email === 'string' && email.includes('@')) return email;
  if (DEMO_RCIC_EMAIL) return DEMO_RCIC_EMAIL;
  return null;
}

type StoredBrief = {
  subject: string;
  bodyMarkdown: string;
  suggestedActions?: string[];
  citationSourceUrl?: string;
};

async function loadBrief(rcicId: string, briefId: string): Promise<StoredBrief | null> {
  const res = await ddb.send(new GetCommand({ TableName: BRIEFS_TABLE, Key: { rcicId, briefId } }));
  if (!res.Item) return null;
  return {
    subject: String(res.Item.subject ?? ''),
    bodyMarkdown: String(res.Item.bodyMarkdown ?? ''),
    suggestedActions: Array.isArray(res.Item.suggestedActions) ? (res.Item.suggestedActions as string[]) : [],
    citationSourceUrl: typeof res.Item.citationSourceUrl === 'string' ? res.Item.citationSourceUrl : undefined,
  };
}

// The alert's idempotency record lives on the brief row, keyed (rcicId,
// briefId) like the brief itself. AlertsTable keys on (rcicId, timestamp)
// and every row there shows up in the activity feed, so a marker row would
// need a fake timestamp and a filter in every reader.
//
// Claim, send, then mark. The claim is a create-only write, so two
// deliveries can't both send. If the send fails, the claim is released and
// Lambda retries. If the invocation dies after claiming, the claim goes
// stale after the lease and the retry takes it over. The one way to get a
// second email: SES accepted the first, then the sent mark failed or the
// invocation died before writing it, and a delivery came after the lease.
// That trade is on purpose. A duplicate email costs the consultant a
// second read. A lost alert on a high-severity change costs them the
// same-day heads-up, which is the whole job of this service.
type Claim = 'claimed' | 'already-sent' | 'in-flight';

async function claimAlert(rcicId: string, briefId: string, runId: string): Promise<Claim> {
  const now = Date.now();
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: BRIEFS_TABLE,
        Key: { rcicId, briefId },
        UpdateExpression: 'SET alertClaimId = :run, alertClaimedAt = :now',
        ConditionExpression:
          'attribute_exists(briefId) AND attribute_not_exists(alertSentAt) AND (attribute_not_exists(alertClaimedAt) OR alertClaimedAt < :stale)',
        ExpressionAttributeValues: { ':run': runId, ':now': now, ':stale': now - CLAIM_LEASE_MS },
      }),
    );
    return 'claimed';
  } catch (err) {
    if ((err as { name?: unknown }).name !== 'ConditionalCheckFailedException') throw err;
  }
  // Either the alert went out or another delivery holds a live claim.
  const res = await ddb.send(new GetCommand({ TableName: BRIEFS_TABLE, Key: { rcicId, briefId }, ConsistentRead: true }));
  return res.Item?.alertSentAt ? 'already-sent' : 'in-flight';
}

async function releaseClaim(rcicId: string, briefId: string, runId: string): Promise<void> {
  await ddb.send(
    new UpdateCommand({
      TableName: BRIEFS_TABLE,
      Key: { rcicId, briefId },
      UpdateExpression: 'REMOVE alertClaimId, alertClaimedAt',
      ConditionExpression: 'alertClaimId = :run',
      ExpressionAttributeValues: { ':run': runId },
    }),
  );
}

async function markSent(rcicId: string, briefId: string, runId: string, sesMessageId: string): Promise<void> {
  // No claim condition. The email went out, so the mark goes on even if a
  // slow send let another delivery take the claim over.
  await ddb.send(
    new UpdateCommand({
      TableName: BRIEFS_TABLE,
      Key: { rcicId, briefId },
      UpdateExpression: 'SET alertSentAt = :at, alertSesMessageId = :m, alertClaimId = :run',
      ConditionExpression: 'attribute_exists(briefId)',
      ExpressionAttributeValues: { ':at': new Date().toISOString(), ':m': sesMessageId, ':run': runId },
    }),
  );
}

async function sendEmail(recipient: string, brief: StoredBrief, detail: BriefReadyDetail): Promise<string> {
  const headerLine = `Argus alert. Client ${detail.clientId}. Impact: ${detail.impactType}${detail.numericDelta !== null ? ` (${detail.numericDelta} pts)` : ''}.`;
  const actionsBlock = brief.suggestedActions && brief.suggestedActions.length > 0
    ? '\n\nSuggested actions:\n' + brief.suggestedActions.map((a) => `- ${a}`).join('\n')
    : '';
  const textBody = [
    headerLine,
    '',
    'Draft brief (edit before sending to your client):',
    '',
    brief.bodyMarkdown,
    actionsBlock,
    '',
    brief.citationSourceUrl ? `Source: ${brief.citationSourceUrl}` : '',
    '',
    `Brief id: ${detail.briefId}. Signed assessment key: ${detail.assessmentKey}.`,
  ].join('\n');

  const res = await ses.send(
    new SendEmailCommand({
      FromEmailAddress: SES_FROM_EMAIL,
      Destination: { ToAddresses: [recipient] },
      Content: {
        Simple: {
          Subject: { Data: `[Argus] ${brief.subject}`, Charset: 'UTF-8' },
          Body: { Text: { Data: textBody, Charset: 'UTF-8' } },
        },
      },
    }),
  );
  return res.MessageId ?? '(no-message-id)';
}

async function recordSend(row: {
  rcicId: string;
  briefId: string;
  clientId: string;
  severity: string;
  recipient: string;
  sesMessageId: string;
}): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: ALERTS_TABLE,
      Item: {
        rcicId: row.rcicId,
        timestamp: new Date().toISOString(),
        briefId: row.briefId,
        clientId: row.clientId,
        severity: row.severity,
        recipient: row.recipient,
        sesMessageId: row.sesMessageId,
        channel: 'ses-realtime',
      },
    }),
  );
}

function log(level: 'debug' | 'info' | 'error', msg: string, fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ level, msg, timestamp: new Date().toISOString(), ...fields }));
}

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}
