#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { ArgusApiStack } from '../lib/argus-api-stack';
import { ArgusBudgetStack } from '../lib/argus-budget-stack';
import { ArgusStatefulStack } from '../lib/argus-stateful-stack';

const app = new cdk.App();

// Account and region are pinned via CDK_DEFAULT_ACCOUNT / CDK_DEFAULT_REGION
// resolved from the AWS profile. See docs/argus-design.md Section 9.
const env: cdk.Environment = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
};

const stateful = new ArgusStatefulStack(app, 'ArgusStatefulDev', {
  env,
  description: 'Argus stateful resources (Cognito with user provisioning Lambda, KMS signing key, Bedrock Guardrail, 11 DynamoDB tables, 2 S3 buckets)',
});

new ArgusApiStack(app, 'ArgusApiDev', {
  env,
  description: 'Argus API, agent and service Lambdas, EventBridge pipeline and schedules',
  userPool: stateful.userPool,
  userPoolClient: stateful.userPoolClient,
  signingKey: stateful.signingKey,
  rcicUsersTable: stateful.rcicUsersTable,
  clientProfilesTable: stateful.clientProfilesTable,
  policyEventsTable: stateful.policyEventsTable,
  impactAssessmentsTable: stateful.impactAssessmentsTable,
  alertsTable: stateful.alertsTable,
  auditTrailTable: stateful.auditTrailTable,
  trainingCorrectionTable: stateful.trainingCorrectionTable,
  policyRulesTable: stateful.policyRulesTable,
  ruleIndexTable: stateful.ruleIndexTable,
  briefsTable: stateful.briefsTable,
  publicCountersTable: stateful.publicCountersTable,
  guardrail: stateful.guardrail,
  policyCorpusBucket: stateful.policyCorpusBucket,
  generatedArtifactsBucket: stateful.generatedArtifactsBucket,
  operatorEmail: process.env.ARGUS_BUDGET_EMAIL ?? '',
});

// Account-level cost alarms, in their own stack: the budget has no links to
// Argus resources, and AWS deletes it on its own after the window ends, so it
// stays out of the stack that holds the retained tables and signing key.
// CA$50 warn and the CA$150 ceiling from docs/argus-design.md Section 14
// (Chi's call over Section 9's CA$200). Rate from scripts/budget_fx.py.
new ArgusBudgetStack(app, 'ArgusBudgetDev', {
  env,
  description: 'Argus cost budget alarms for the hackathon window',
  alertEmail: process.env.ARGUS_BUDGET_EMAIL ?? '',
  warnCad: 50,
  hardCad: 150,
  windowStart: '2026-09-19',
  windowLastDay: '2026-10-19',
  fx: { cadPerUsd: 1.4168, observedOn: '2026-09-28' },
});
