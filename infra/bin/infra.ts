#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { ArgusStatefulStack } from '../lib/argus-stateful-stack';

const app = new cdk.App();

// Account and region are pinned via CDK_DEFAULT_ACCOUNT / CDK_DEFAULT_REGION
// resolved from the AWS profile. See docs/argus-design.md Section 9.
const env: cdk.Environment = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
};

new ArgusStatefulStack(app, 'ArgusStatefulDev', {
  env,
  description: 'Argus stateful resources (Cognito, KMS signing key, 7 DynamoDB tables, 2 S3 buckets)',
});

// ArgusApiStack (Lambda + API Gateway + Step Functions + EventBridge) lands in the
// next commit. It takes stateful-stack outputs (userPool, tables, buckets, signingKey)
// via constructor props for automatic cross-stack references.
