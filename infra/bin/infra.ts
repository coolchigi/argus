#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { ArgusApiStack } from '../lib/argus-api-stack';
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
  description: 'Argus stateful resources (Cognito, KMS signing key, 7 DynamoDB tables, 2 S3 buckets)',
});

new ArgusApiStack(app, 'ArgusApiDev', {
  env,
  description: 'Argus API surface, Step Functions orchestration, EventBridge schedules',
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
  policyCorpusBucket: stateful.policyCorpusBucket,
  generatedArtifactsBucket: stateful.generatedArtifactsBucket,
});
