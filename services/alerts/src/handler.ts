import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { randomUUID } from 'node:crypto';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ses = new SESv2Client({});

const BRIEFS_TABLE = requiredEnv('BRIEFS_TABLE');
const ALERTS_TABLE = requiredEnv('ALERTS_TABLE');
const RCIC_USERS_TABLE = requiredEnv('RCIC_USERS_TABLE');
const SES_FROM_EMAIL = requiredEnv('SES_FROM_EMAIL');
const DEMO_RCIC_EMAIL = process.env.DEMO_RCIC_EMAIL ?? '';
const HIGH_SEVERITY_CRS_THRESHOLD = 50;

type ImpactType = 'crs-delta' | 'eligibility-flip' | 'deadline-shift' | 'lmia-implication' | 'french-bonus' | 'procedural' | 'none';

type BriefReadyDetail = {
  briefId: string;
  rcicId: string;
  clientId: string;
  assessmentKey: string;
  impactType: ImpactType;
  numericDelta: number | null;
  confidence: 'low' | 'medium' | 'high';
  subject: string;
  createdAt: string;
};

type EventBridgeInput = { source?: string; 'detail-type'?: string; detail?: BriefReadyDetail };

export const handler = async (event: EventBridgeInput | BriefReadyDetail): Promise<{ dispatched: boolean; reason?: string }> => {
  const runId = randomUUID();
  const detail: BriefReadyDetail = 'detail' in event && event.detail ? event.detail : (event as BriefReadyDetail);

  const severity = classify(detail);
  log('info', 'alert-start', {
    runId,
    briefId: detail.briefId,
    rcicId: detail.rcicId,
    clientId: detail.clientId,
    impactType: detail.impactType,
    numericDelta: detail.numericDelta,
    severity,
  });

  if (severity !== 'high') {
    log('info', 'alert-skipped-non-high', { runId, briefId: detail.briefId, severity });
    return { dispatched: false, reason: 'severity-below-threshold' };
  }

  const recipient = await resolveRecipient(detail.rcicId);
  if (!recipient) {
    log('error', 'alert-no-recipient', { runId, rcicId: detail.rcicId });
    return { dispatched: false, reason: 'no-recipient-configured' };
  }

  const brief = await loadBrief(detail.rcicId, detail.briefId);
  if (!brief) {
    log('error', 'alert-brief-not-found', { runId, briefId: detail.briefId });
    return { dispatched: false, reason: 'brief-not-found' };
  }

  const messageId = await sendEmail(recipient, brief, detail);
  await recordSend({
    rcicId: detail.rcicId,
    briefId: detail.briefId,
    clientId: detail.clientId,
    severity,
    recipient,
    sesMessageId: messageId,
  });

  log('info', 'alert-dispatched', {
    runId,
    briefId: detail.briefId,
    rcicId: detail.rcicId,
    recipient,
    sesMessageId: messageId,
  });
  return { dispatched: true };
};

function classify(detail: BriefReadyDetail): 'high' | 'medium' | 'low' {
  if (detail.impactType === 'eligibility-flip') return 'high';
  if (detail.impactType === 'crs-delta' && typeof detail.numericDelta === 'number' && Math.abs(detail.numericDelta) >= HIGH_SEVERITY_CRS_THRESHOLD) {
    return 'high';
  }
  if (detail.impactType === 'none') return 'low';
  return 'medium';
}

async function resolveRecipient(rcicId: string): Promise<string | null> {
  const res = await ddb.send(new GetCommand({ TableName: RCIC_USERS_TABLE, Key: { rcicId } }));
  const email = res.Item?.email;
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
