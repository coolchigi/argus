import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { ArgusApiStack } from './argus-api-stack';
import { ArgusStatefulStack } from './argus-stateful-stack';

// The failure queues, their alarms, and the Alerts retry wiring, read from
// the synthesized API stack. Bundling is skipped: these tests don't need the
// Lambda code, only the resources around it. The app reads cdk.json's
// context, so cross-stack references synth the way they deploy.
const cdkJson = JSON.parse(readFileSync(path.join(__dirname, '..', 'cdk.json'), 'utf8')) as { context: Record<string, unknown> };

const env = { account: '123456789012', region: 'us-east-1' };

function apiStack(operatorEmail = 'operator@example.com') {
  const app = new cdk.App({ context: { ...cdkJson.context, 'aws:cdk:bundling-stacks': [] } });
  const s = new ArgusStatefulStack(app, 'Stateful', { env });
  return new ArgusApiStack(app, 'Api', {
    env,
    operatorEmail,
    userPool: s.userPool,
    userPoolClient: s.userPoolClient,
    signingKey: s.signingKey,
    rcicUsersTable: s.rcicUsersTable,
    clientProfilesTable: s.clientProfilesTable,
    policyEventsTable: s.policyEventsTable,
    impactAssessmentsTable: s.impactAssessmentsTable,
    alertsTable: s.alertsTable,
    auditTrailTable: s.auditTrailTable,
    trainingCorrectionTable: s.trainingCorrectionTable,
    policyRulesTable: s.policyRulesTable,
    ruleIndexTable: s.ruleIndexTable,
    briefsTable: s.briefsTable,
    publicCountersTable: s.publicCountersTable,
    guardrail: s.guardrail,
    policyCorpusBucket: s.policyCorpusBucket,
    generatedArtifactsBucket: s.generatedArtifactsBucket,
  });
}

type Res = { Type: string; Properties: Record<string, any> };
const template = Template.fromStack(apiStack());
const all = template.toJSON().Resources as Record<string, Res>;
const logicalIdOf = (type: string, pred: (p: Record<string, any>) => boolean) => {
  const hits = Object.entries(all).filter(([, r]) => r.Type === type && pred(r.Properties ?? {}));
  assert.equal(hits.length, 1, `${type} matches`);
  return hits[0][0];
};
const queueId = (name: string) => logicalIdOf('AWS::SQS::Queue', (p) => p.QueueName === name);
const alertsFnId = logicalIdOf('AWS::Lambda::Function', (p) => p.FunctionName === 'argus-alerts');
const topicId = logicalIdOf('AWS::SNS::Topic', (p) => p.TopicName === 'argus-operator-alarms');

describe('failure-queue alarms', () => {
  for (const name of ['argus-composer-stream-failures', 'argus-alerts-failures']) {
    it(`emails the operator when ${name} holds any message`, () => {
      const q = queueId(name);
      const alarms = Object.values(all).filter(
        (r) => r.Type === 'AWS::CloudWatch::Alarm' && JSON.stringify(r.Properties.Dimensions) === JSON.stringify([{ Name: 'QueueName', Value: { 'Fn::GetAtt': [q, 'QueueName'] } }]),
      );
      assert.equal(alarms.length, 1);
      const p = alarms[0].Properties;
      assert.equal(p.MetricName, 'ApproximateNumberOfMessagesVisible');
      assert.equal(p.Namespace, 'AWS/SQS');
      assert.equal(p.ComparisonOperator, 'GreaterThanThreshold');
      assert.equal(p.Threshold, 0);
      assert.equal(p.Statistic, 'Maximum');
      assert.deepEqual(p.AlarmActions, [{ Ref: topicId }]);
    });
  }

  it('subscribes the operator email to the alarm topic', () => {
    template.hasResourceProperties('AWS::SNS::Subscription', {
      Protocol: 'email',
      Endpoint: 'operator@example.com',
      TopicArn: { Ref: topicId },
    });
  });

  it('refuses to synth without an operator email', () => {
    assert.throws(() => apiStack(''), /ARGUS_BUDGET_EMAIL/);
  });
});

describe('Alerts retry and dedupe wiring', () => {
  const q = queueId('argus-alerts-failures');

  it('sends a BriefReady that fails every try to the failure queue', () => {
    template.hasResourceProperties('AWS::Lambda::EventInvokeConfig', {
      FunctionName: { Ref: alertsFnId },
      MaximumRetryAttempts: 2,
      DestinationConfig: { OnFailure: { Destination: { 'Fn::GetAtt': [q, 'Arn'] } } },
    });
  });

  it('sends a BriefReady EventBridge could not deliver to the same queue', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      Name: 'argus-brief-ready-to-alerts',
      Targets: [{ Arn: { 'Fn::GetAtt': [alertsFnId, 'Arn'] }, DeadLetterConfig: { Arn: { 'Fn::GetAtt': [q, 'Arn'] } } }],
    });
  });

  it('holds a claim longer than the function can run', () => {
    const fn = all[alertsFnId].Properties;
    assert.ok(Number(fn.Environment.Variables.ALERT_CLAIM_LEASE_SECONDS) > fn.Timeout);
  });

  it('lets Alerts update brief rows, and write nothing else on the briefs table', () => {
    const statements = Object.values(all)
      .filter((r) => r.Type === 'AWS::IAM::Policy' && JSON.stringify(r.Properties.Roles).includes('AlertsHandler'))
      .flatMap((r) => r.Properties.PolicyDocument.Statement as Array<{ Action: string | string[]; Resource: unknown }>);
    const onBriefs = statements.filter((st) => JSON.stringify(st.Resource).includes('BriefsTable'));
    const writes = onBriefs.filter((st) => [st.Action].flat().some((a) => /Put|Update|Delete|Write/.test(a)));
    assert.equal(writes.length, 1);
    assert.equal(writes[0].Action, 'dynamodb:UpdateItem');
    // The table ARN alone, as one reference, with no index or wildcard.
    const ref = JSON.stringify(writes[0].Resource);
    assert.ok(!Array.isArray(writes[0].Resource), ref);
    assert.match(ref, /BriefsTable[0-9A-F]+Arn/);
    assert.doesNotMatch(ref, /index|\*/);
  });
});
