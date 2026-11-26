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
  for (const name of [
    'argus-composer-stream-failures',
    'argus-alerts-failures',
    'argus-analyst-failures',
    'argus-auditor-failures',
    'argus-anchor-failures',
  ]) {
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

describe('agent failure queues', () => {
  const agents = [
    { fn: 'argus-analyst', rule: 'argus-policy-delta-to-analyst', event: 'PolicyDelta' },
    { fn: 'argus-auditor', rule: 'argus-hypothesis-to-auditor', event: 'ImpactHypothesis' },
    { fn: 'argus-anchor', rule: 'argus-verdict-to-anchor', event: 'AuditVerdict' },
  ];
  for (const { fn, rule, event } of agents) {
    const fnId = logicalIdOf('AWS::Lambda::Function', (p) => p.FunctionName === fn);
    const q = queueId(`${fn}-failures`);

    it(`sends a ${event} that fails every ${fn} try to its failure queue`, () => {
      template.hasResourceProperties('AWS::Lambda::EventInvokeConfig', {
        FunctionName: { Ref: fnId },
        MaximumRetryAttempts: 2,
        DestinationConfig: { OnFailure: { Destination: { 'Fn::GetAtt': [q, 'Arn'] } } },
      });
    });

    it(`sends a ${event} EventBridge could not deliver to ${fn} to the same queue`, () => {
      template.hasResourceProperties('AWS::Events::Rule', {
        Name: rule,
        Targets: [{ Arn: { 'Fn::GetAtt': [fnId, 'Arn'] }, DeadLetterConfig: { Arn: { 'Fn::GetAtt': [q, 'Arn'] } } }],
      });
    });

    it(`lets EventBridge write to ${fn}'s failure queue`, () => {
      const policies = Object.values(all).filter(
        (r) => r.Type === 'AWS::SQS::QueuePolicy' && r.Properties.Queues.some((x: unknown) => JSON.stringify(x) === JSON.stringify({ Ref: q })),
      );
      const statements = policies.flatMap((r) => r.Properties.PolicyDocument.Statement);
      assert.ok(
        statements.some((st) => st.Effect === 'Allow' && st.Principal?.Service === 'events.amazonaws.com' && [st.Action].flat().includes('sqs:SendMessage')),
      );
    });
  }
});

describe('Sentinel guardrail-block alarm', () => {
  // Sentinel keeps no snapshot on a block, so it retries the page every hour
  // and blocks again. No queue fills and the Lambda doesn't error, so only
  // this alarm tells the operator.
  const filters = Object.values(all).filter((r) => r.Type === 'AWS::Logs::MetricFilter');
  const sentinelLogsId = logicalIdOf('AWS::Logs::LogGroup', (p) => p.LogGroupName === '/aws/lambda/argus-sentinel');

  it("counts Sentinel's guardrail-blocked lines and sends nothing in an hour without one", () => {
    const hits = filters.filter((r) => JSON.stringify(r.Properties.LogGroupName) === JSON.stringify({ Ref: sentinelLogsId }));
    assert.equal(hits.length, 1);
    const p = hits[0].Properties;
    assert.equal(p.FilterPattern, '{ $.msg = "guardrail-blocked" }');
    assert.equal(p.MetricTransformations.length, 1);
    const t = p.MetricTransformations[0];
    assert.equal(t.MetricValue, '1');
    // A default value would send a 0 every hour, which bills the metric
    // every hour instead of only in hours with a block.
    assert.equal(t.DefaultValue, undefined);
  });

  it('emails the operator on 1 block and clears after 3 hourly runs without one', () => {
    const t = filters[0].Properties.MetricTransformations[0];
    const alarms = Object.values(all).filter(
      (r) => r.Type === 'AWS::CloudWatch::Alarm' && r.Properties.MetricName === t.MetricName && r.Properties.Namespace === t.MetricNamespace,
    );
    assert.equal(alarms.length, 1);
    const p = alarms[0].Properties;
    assert.equal(p.Statistic, 'Sum');
    assert.equal(p.Period, 3600);
    assert.equal(p.ComparisonOperator, 'GreaterThanOrEqualToThreshold');
    assert.equal(p.Threshold, 1);
    assert.equal(p.EvaluationPeriods, 3);
    assert.equal(p.DatapointsToAlarm, 1);
    assert.equal(p.TreatMissingData, 'notBreaching');
    assert.deepEqual(p.AlarmActions, [{ Ref: topicId }]);
  });
});
