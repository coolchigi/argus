import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigwv2auth from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as apigwv2int from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import { Construct } from 'constructs';

const IRCC_SEED_URLS = [
  'https://www.canada.ca/en/immigration-refugees-citizenship/news.html',
  'https://www.canada.ca/en/immigration-refugees-citizenship/services/immigrate-canada/express-entry/submit-profile/rounds-invitations.html',
  'https://www.canada.ca/en/immigration-refugees-citizenship/corporate/mandate/policies-operational-instructions-agreements/ministerial-instructions.html',
  'https://www.canada.ca/en/immigration-refugees-citizenship/services/immigrate-canada/express-entry/check-score.html',
];

export interface ArgusApiStackProps extends cdk.StackProps {
  readonly userPool: cognito.UserPool;
  readonly userPoolClient: cognito.UserPoolClient;
  readonly signingKey: kms.Key;

  readonly rcicUsersTable: dynamodb.Table;
  readonly clientProfilesTable: dynamodb.Table;
  readonly policyEventsTable: dynamodb.Table;
  readonly impactAssessmentsTable: dynamodb.Table;
  readonly alertsTable: dynamodb.Table;
  readonly auditTrailTable: dynamodb.Table;
  readonly trainingCorrectionTable: dynamodb.Table;
  readonly policyRulesTable: dynamodb.Table;
  readonly ruleIndexTable: dynamodb.Table;
  readonly briefsTable: dynamodb.Table;

  readonly policyCorpusBucket: s3.Bucket;
  readonly generatedArtifactsBucket: s3.Bucket;
}

/**
 * API surface plus async orchestration.
 *
 * Every Lambda is a Phase 1 placeholder returning 501. Real handlers land
 * during Phases 2 to 5. This stack exists so we can wire IAM grants, API
 * Gateway routes, EventBridge schedules, and Step Functions state machine
 * end to end in a shape the CDK skill agrees with.
 */
export class ArgusApiStack extends cdk.Stack {
  public readonly httpApi: apigwv2.HttpApi;

  constructor(scope: Construct, id: string, props: ArgusApiStackProps) {
    super(scope, id, props);

    // -----------------------------------------------------------------
    // Placeholder Lambda factory. Real code will be bundled from
    // services/<name>/handler.ts starting in Phase 2. For now every
    // route returns 501 so we can prove routing and auth work.
    // -----------------------------------------------------------------
    const placeholder = (logicalId: string, name: string): lambda.Function =>
      new lambda.Function(this, logicalId, {
        functionName: `argus-${name}`,
        runtime: lambda.Runtime.NODEJS_22_X,
        architecture: lambda.Architecture.ARM_64,
        handler: 'index.handler',
        code: lambda.Code.fromInline(
          `exports.handler = async () => ({ statusCode: 501, body: JSON.stringify({ error: 'not-implemented', handler: '${name}' }) });`
        ),
        timeout: cdk.Duration.seconds(10),
        memorySize: 256,
        logGroup: new logs.LogGroup(this, `${logicalId}Logs`, {
          logGroupName: `/aws/lambda/argus-${name}`,
          retention: logs.RetentionDays.ONE_WEEK,
          removalPolicy: cdk.RemovalPolicy.DESTROY,
        }),
      });

    // API handlers (one per bounded context).
    const meHandler = placeholder('MeHandler', 'me');
    const profilesHandler = placeholder('ProfilesHandler', 'profiles');
    const policyEventsHandler = placeholder('PolicyEventsHandler', 'policy-events');
    const demoHandler = placeholder('DemoHandler', 'demo');


    // Impacts service. Lists assessments, returns a single one, exports the
    // KMS audit signature plus the public key so anyone can verify offline,
    // and accepts consultant corrections. Corrections land in the
    // TrainingCorrectionTable and feed the Auditor's few-shot examples on
    // the next audit run, so the model measurably improves as the
    // consultant uses it (ASET pattern, design doc section 12).
    //
    // Reuses the ImpactsHandler construct id so CloudFormation performs an
    // in-place update over the earlier placeholder function, avoiding a
    // delete+create that would collide on the physical function name.
    const impactsServiceLogGroup = new logs.LogGroup(this, 'ImpactsHandlerLogs', {
      logGroupName: '/aws/lambda/argus-impacts',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const impactsHandler = new nodejs.NodejsFunction(this, 'ImpactsHandler', {
      functionName: 'argus-impacts',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      projectRoot: path.join(__dirname, '../..'),
      depsLockFilePath: path.join(__dirname, '../../services/impacts-service/package-lock.json'),
      entry: path.join(__dirname, '../../services/impacts-service/src/handler.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(29),
      memorySize: 512,
      environment: {
        IMPACT_ASSESSMENTS_TABLE: props.impactAssessmentsTable.tableName,
        TRAINING_CORRECTIONS_TABLE: props.trainingCorrectionTable.tableName,
        SIGNING_KEY_ID: props.signingKey.keyId,
        DEFAULT_RCIC_ID: 'demo-rcic-001',
        NODE_OPTIONS: '--enable-source-maps',
      },
      logGroup: impactsServiceLogGroup,
      tracing: lambda.Tracing.ACTIVE,
      bundling: { minify: true, target: 'es2022', format: nodejs.OutputFormat.ESM, sourceMap: true },
    });

    props.impactAssessmentsTable.grantReadData(impactsHandler);
    props.trainingCorrectionTable.grantReadWriteData(impactsHandler);
    impactsHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['kms:GetPublicKey'],
        resources: [props.signingKey.keyArn],
      }),
    );

    const sentinelLogGroup = new logs.LogGroup(this, 'SentinelHandlerLogs', {
      logGroupName: '/aws/lambda/argus-sentinel',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const sentinelHandler = new nodejs.NodejsFunction(this, 'SentinelHandler', {
      functionName: 'argus-sentinel',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      projectRoot: path.join(__dirname, '../..'),
      depsLockFilePath: path.join(__dirname, '../../services/sentinel/package-lock.json'),
      entry: path.join(__dirname, '../../services/sentinel/src/handler.ts'),
      handler: 'handler',
      timeout: cdk.Duration.minutes(3),
      memorySize: 512,
      environment: {
        POLICY_CORPUS_BUCKET: props.policyCorpusBucket.bucketName,
        POLICY_RULES_TABLE: props.policyRulesTable.tableName,
        RULE_INDEX_TABLE: props.ruleIndexTable.tableName,
        BEDROCK_CLASSIFIER_MODEL: 'us.amazon.nova-micro-v1:0',
        IRCC_SEED_URLS: JSON.stringify(IRCC_SEED_URLS),
        NODE_OPTIONS: '--enable-source-maps',
      },
      logGroup: sentinelLogGroup,
      tracing: lambda.Tracing.ACTIVE,
      bundling: {
        minify: true,
        target: 'es2022',
        format: nodejs.OutputFormat.ESM,
        sourceMap: true,
      },
    });

    sentinelHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['events:PutEvents'],
        resources: [`arn:aws:events:${this.region}:${this.account}:event-bus/default`],
      }),
    );

    sentinelHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: [
          `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/us.amazon.nova-micro-v1:0`,
          `arn:aws:bedrock:*::foundation-model/amazon.nova-micro-v1:0`,
        ],
      }),
    );

    props.policyRulesTable.grantWriteData(sentinelHandler);
    props.ruleIndexTable.grantWriteData(sentinelHandler);

    const analystLogGroup = new logs.LogGroup(this, 'AnalystHandlerLogs', {
      logGroupName: '/aws/lambda/argus-analyst',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const analystHandler = new nodejs.NodejsFunction(this, 'AnalystHandler', {
      functionName: 'argus-analyst',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      projectRoot: path.join(__dirname, '../..'),
      depsLockFilePath: path.join(__dirname, '../../services/analyst/package-lock.json'),
      entry: path.join(__dirname, '../../services/analyst/src/handler.ts'),
      handler: 'handler',
      timeout: cdk.Duration.minutes(5),
      memorySize: 1024,
      environment: {
        CLIENT_PROFILES_TABLE: props.clientProfilesTable.tableName,
        POLICY_RULES_TABLE: props.policyRulesTable.tableName,
        RCIC_USERS_TABLE: props.rcicUsersTable.tableName,
        BEDROCK_REASONER_MODEL: 'us.amazon.nova-pro-v1:0',
        NODE_OPTIONS: '--enable-source-maps',
      },
      logGroup: analystLogGroup,
      tracing: lambda.Tracing.ACTIVE,
      bundling: {
        minify: true,
        target: 'es2022',
        format: nodejs.OutputFormat.ESM,
        sourceMap: true,
      },
    });

    props.clientProfilesTable.grantReadData(analystHandler);
    props.policyRulesTable.grantReadData(analystHandler);
    props.rcicUsersTable.grantReadData(analystHandler);

    analystHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: [
          `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/us.amazon.nova-pro-v1:0`,
          `arn:aws:bedrock:*::foundation-model/amazon.nova-pro-v1:0`,
        ],
      }),
    );

    analystHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['events:PutEvents'],
        resources: [`arn:aws:events:${this.region}:${this.account}:event-bus/default`],
      }),
    );

    new events.Rule(this, 'PolicyDeltaToAnalyst', {
      ruleName: 'argus-policy-delta-to-analyst',
      description: 'Route Sentinel PolicyDelta events to the Analyst Lambda',
      eventPattern: {
        source: ['argus.sentinel'],
        detailType: ['PolicyDelta'],
      },
      targets: [new targets.LambdaFunction(analystHandler)],
    });

    const auditorLogGroup = new logs.LogGroup(this, 'AuditorHandlerLogs', {
      logGroupName: '/aws/lambda/argus-auditor',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const auditorHandler = new nodejs.NodejsFunction(this, 'AuditorHandler', {
      functionName: 'argus-auditor',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      projectRoot: path.join(__dirname, '../..'),
      depsLockFilePath: path.join(__dirname, '../../services/auditor/package-lock.json'),
      entry: path.join(__dirname, '../../services/auditor/src/handler.ts'),
      handler: 'handler',
      timeout: cdk.Duration.minutes(2),
      memorySize: 512,
      environment: {
        POLICY_RULES_TABLE: props.policyRulesTable.tableName,
        TRAINING_CORRECTIONS_TABLE: props.trainingCorrectionTable.tableName,
        BEDROCK_AUDITOR_MODEL: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
        FEW_SHOT_MAX: '5',
        FEW_SHOT_MAX_AGE_DAYS: '90',
        NODE_OPTIONS: '--enable-source-maps',
      },
      logGroup: auditorLogGroup,
      tracing: lambda.Tracing.ACTIVE,
      bundling: { minify: true, target: 'es2022', format: nodejs.OutputFormat.ESM, sourceMap: true },
    });

    props.policyRulesTable.grantReadData(auditorHandler);
    props.trainingCorrectionTable.grantReadData(auditorHandler);

    auditorHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: [
          `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0`,
          `arn:aws:bedrock:*::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0`,
        ],
      }),
    );

    auditorHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['events:PutEvents'],
        resources: [`arn:aws:events:${this.region}:${this.account}:event-bus/default`],
      }),
    );

    new events.Rule(this, 'ImpactHypothesisToAuditor', {
      ruleName: 'argus-hypothesis-to-auditor',
      description: 'Route Analyst ImpactHypothesis events to the Auditor Lambda',
      eventPattern: {
        source: ['argus.analyst'],
        detailType: ['ImpactHypothesis'],
      },
      targets: [new targets.LambdaFunction(auditorHandler)],
    });

    const anchorLogGroup = new logs.LogGroup(this, 'AnchorHandlerLogs', {
      logGroupName: '/aws/lambda/argus-anchor',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const anchorHandler = new nodejs.NodejsFunction(this, 'AnchorHandler', {
      functionName: 'argus-anchor',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      projectRoot: path.join(__dirname, '../..'),
      depsLockFilePath: path.join(__dirname, '../../services/anchor/package-lock.json'),
      entry: path.join(__dirname, '../../services/anchor/src/handler.ts'),
      handler: 'handler',
      timeout: cdk.Duration.minutes(1),
      memorySize: 512,
      environment: {
        POLICY_RULES_TABLE: props.policyRulesTable.tableName,
        IMPACT_ASSESSMENTS_TABLE: props.impactAssessmentsTable.tableName,
        SIGNING_KEY_ID: props.signingKey.keyId,
        NODE_OPTIONS: '--enable-source-maps',
      },
      logGroup: anchorLogGroup,
      tracing: lambda.Tracing.ACTIVE,
      bundling: { minify: true, target: 'es2022', format: nodejs.OutputFormat.ESM, sourceMap: true },
    });

    props.policyRulesTable.grantReadData(anchorHandler);
    props.impactAssessmentsTable.grantWriteData(anchorHandler);
    props.signingKey.grantSign(anchorHandler);

    new events.Rule(this, 'AuditVerdictToAnchor', {
      ruleName: 'argus-verdict-to-anchor',
      description: 'Route Auditor AuditVerdict events to the Anchor Lambda',
      eventPattern: {
        source: ['argus.auditor'],
        detailType: ['AuditVerdict'],
      },
      targets: [new targets.LambdaFunction(anchorHandler)],
    });

    // Composer: subscribes to ImpactAssessments DynamoDB stream. For every newly
    // signed assessment where the client is actually affected, drafts a client
    // update via Nova Lite, writes it to the Briefs table, and emits BriefReady
    // for the Alerts dispatcher.
    const composerLogGroup = new logs.LogGroup(this, 'ComposerHandlerLogs', {
      logGroupName: '/aws/lambda/argus-composer',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const composerHandler = new nodejs.NodejsFunction(this, 'ComposerHandler', {
      functionName: 'argus-composer',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      projectRoot: path.join(__dirname, '../..'),
      depsLockFilePath: path.join(__dirname, '../../services/composer/package-lock.json'),
      entry: path.join(__dirname, '../../services/composer/src/handler.ts'),
      handler: 'handler',
      timeout: cdk.Duration.minutes(2),
      memorySize: 512,
      environment: {
        POLICY_RULES_TABLE: props.policyRulesTable.tableName,
        BRIEFS_TABLE: props.briefsTable.tableName,
        BEDROCK_COMPOSER_MODEL: 'us.amazon.nova-lite-v1:0',
        NODE_OPTIONS: '--enable-source-maps',
      },
      logGroup: composerLogGroup,
      tracing: lambda.Tracing.ACTIVE,
      bundling: { minify: true, target: 'es2022', format: nodejs.OutputFormat.ESM, sourceMap: true },
    });

    props.policyRulesTable.grantReadData(composerHandler);
    props.briefsTable.grantWriteData(composerHandler);
    props.impactAssessmentsTable.grantStreamRead(composerHandler);

    composerHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: [
          `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/us.amazon.nova-lite-v1:0`,
          `arn:aws:bedrock:*::foundation-model/amazon.nova-lite-v1:0`,
        ],
      }),
    );

    composerHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['events:PutEvents'],
        resources: [`arn:aws:events:${this.region}:${this.account}:event-bus/default`],
      }),
    );

    composerHandler.addEventSource(
      new lambdaEventSources.DynamoEventSource(props.impactAssessmentsTable, {
        startingPosition: lambda.StartingPosition.LATEST,
        batchSize: 5,
        maxBatchingWindow: cdk.Duration.seconds(5),
        retryAttempts: 3,
        bisectBatchOnError: true,
        reportBatchItemFailures: true,
        filters: [
          lambda.FilterCriteria.filter({ eventName: lambda.FilterRule.isEqual('INSERT') }),
        ],
      }),
    );

    // Alerts dispatcher. Subscribes to argus.composer BriefReady, classifies
    // severity, and sends SES email for high-severity impacts only. Medium and
    // low route into the weekly digest (deferred). SES runs in sandbox mode
    // until the domain is verified, which is fine for the demo path.
    const alertsFromEmail = process.env.ARGUS_SES_FROM ?? 'alerts@tryargus.ca';
    const alertsDemoRecipient = process.env.ARGUS_DEMO_RCIC_EMAIL ?? '';

    const alertsLogGroup = new logs.LogGroup(this, 'AlertsHandlerLogs', {
      logGroupName: '/aws/lambda/argus-alerts',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const alertsHandler = new nodejs.NodejsFunction(this, 'AlertsHandler', {
      functionName: 'argus-alerts',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      projectRoot: path.join(__dirname, '../..'),
      depsLockFilePath: path.join(__dirname, '../../services/alerts/package-lock.json'),
      entry: path.join(__dirname, '../../services/alerts/src/handler.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        BRIEFS_TABLE: props.briefsTable.tableName,
        ALERTS_TABLE: props.alertsTable.tableName,
        RCIC_USERS_TABLE: props.rcicUsersTable.tableName,
        SES_FROM_EMAIL: alertsFromEmail,
        DEMO_RCIC_EMAIL: alertsDemoRecipient,
        NODE_OPTIONS: '--enable-source-maps',
      },
      logGroup: alertsLogGroup,
      tracing: lambda.Tracing.ACTIVE,
      bundling: { minify: true, target: 'es2022', format: nodejs.OutputFormat.ESM, sourceMap: true },
    });

    props.briefsTable.grantReadData(alertsHandler);
    props.alertsTable.grantWriteData(alertsHandler);
    props.rcicUsersTable.grantReadData(alertsHandler);

    alertsHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ses:SendEmail'],
        resources: [
          `arn:aws:ses:${this.region}:${this.account}:identity/*`,
          `arn:aws:ses:${this.region}:${this.account}:configuration-set/*`,
        ],
      }),
    );

    new events.Rule(this, 'BriefReadyToAlerts', {
      ruleName: 'argus-brief-ready-to-alerts',
      description: 'Route Composer BriefReady events to the Alerts dispatcher',
      eventPattern: {
        source: ['argus.composer'],
        detailType: ['BriefReady'],
      },
      targets: [new targets.LambdaFunction(alertsHandler)],
    });

    // Briefs service. Handles the consultant-facing brief lifecycle:
    // list, fetch, edit, single send, and batch send. Every send KMS-signs
    // the canonicalized sent body (subject + edited body + suggested actions
    // + recipient hash + sender + timestamp), stores the signature on the
    // brief row, and appends an entry to AlertsTable with channel
    // "consultant-manual". Recipient address is stored as SHA256 hash plus
    // domain only, so client PII never lands in Argus.
    const briefsServiceLogGroup = new logs.LogGroup(this, 'BriefsServiceHandlerLogs', {
      logGroupName: '/aws/lambda/argus-briefs-service',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const briefsServiceHandler = new nodejs.NodejsFunction(this, 'BriefsServiceHandler', {
      functionName: 'argus-briefs-service',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      projectRoot: path.join(__dirname, '../..'),
      depsLockFilePath: path.join(__dirname, '../../services/briefs-service/package-lock.json'),
      entry: path.join(__dirname, '../../services/briefs-service/src/handler.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(29),
      memorySize: 512,
      environment: {
        BRIEFS_TABLE: props.briefsTable.tableName,
        ALERTS_TABLE: props.alertsTable.tableName,
        RCIC_USERS_TABLE: props.rcicUsersTable.tableName,
        POLICY_RULES_TABLE: props.policyRulesTable.tableName,
        POLICY_CORPUS_BUCKET: props.policyCorpusBucket.bucketName,
        SIGNING_KEY_ID: props.signingKey.keyId,
        DEFAULT_FROM_EMAIL: alertsFromEmail,
        DEFAULT_RCIC_ID: 'demo-rcic-001',
        BATCH_SEND_MAX: '25',
        ARCHIVE_LINK_TTL_SECONDS: String(7 * 24 * 60 * 60),
        NODE_OPTIONS: '--enable-source-maps',
      },
      logGroup: briefsServiceLogGroup,
      tracing: lambda.Tracing.ACTIVE,
      bundling: { minify: true, target: 'es2022', format: nodejs.OutputFormat.ESM, sourceMap: true },
    });

    props.briefsTable.grantReadWriteData(briefsServiceHandler);
    props.alertsTable.grantWriteData(briefsServiceHandler);
    props.rcicUsersTable.grantReadData(briefsServiceHandler);
    props.policyRulesTable.grantReadData(briefsServiceHandler);
    props.policyCorpusBucket.grantRead(briefsServiceHandler);
    props.signingKey.grantSign(briefsServiceHandler);

    briefsServiceHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ses:SendEmail'],
        resources: [
          `arn:aws:ses:${this.region}:${this.account}:identity/*`,
          `arn:aws:ses:${this.region}:${this.account}:configuration-set/*`,
        ],
      }),
    );

    // Recall. Nightly triage that backfills coverage: for every rule captured
    // in the last N days, decide (via Nova Micro) which clients in each RCIC's
    // caseload deserve deep analysis, then re-emit PolicyDelta with a
    // recall-namespaced eventId so Anchor's dedup keeps recall-origin
    // assessments distinct from live-Sentinel ones. Existing assessment keys
    // are pruned before the model runs, so we don't pay Bedrock twice.
    const recallLogGroup = new logs.LogGroup(this, 'RecallHandlerLogs', {
      logGroupName: '/aws/lambda/argus-recall',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const recallHandler = new nodejs.NodejsFunction(this, 'RecallHandler', {
      functionName: 'argus-recall',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      projectRoot: path.join(__dirname, '../..'),
      depsLockFilePath: path.join(__dirname, '../../services/recall/package-lock.json'),
      entry: path.join(__dirname, '../../services/recall/src/handler.ts'),
      handler: 'handler',
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      environment: {
        POLICY_RULES_TABLE: props.policyRulesTable.tableName,
        CLIENT_PROFILES_TABLE: props.clientProfilesTable.tableName,
        IMPACT_ASSESSMENTS_TABLE: props.impactAssessmentsTable.tableName,
        RCIC_USERS_TABLE: props.rcicUsersTable.tableName,
        BEDROCK_TRIAGE_MODEL: 'us.amazon.nova-micro-v1:0',
        RECALL_LOOKBACK_DAYS: '30',
        RECALL_MAX_PAIRS: '200',
        NODE_OPTIONS: '--enable-source-maps',
      },
      logGroup: recallLogGroup,
      tracing: lambda.Tracing.ACTIVE,
      bundling: { minify: true, target: 'es2022', format: nodejs.OutputFormat.ESM, sourceMap: true },
    });

    props.policyRulesTable.grantReadData(recallHandler);
    props.clientProfilesTable.grantReadData(recallHandler);
    props.impactAssessmentsTable.grantReadData(recallHandler);
    props.rcicUsersTable.grantReadData(recallHandler);

    recallHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: [
          `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/us.amazon.nova-micro-v1:0`,
          `arn:aws:bedrock:*::foundation-model/amazon.nova-micro-v1:0`,
        ],
      }),
    );

    recallHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['events:PutEvents'],
        resources: [`arn:aws:events:${this.region}:${this.account}:event-bus/default`],
      }),
    );

    const orchestratorHandler = placeholder('OrchestratorHandler', 'orchestrator');

    // -----------------------------------------------------------------
    // Grants. Every Lambda gets least-privilege via CDK grant helpers.
    // Read carefully. Do not swap for wildcard IAM policies.
    // -----------------------------------------------------------------

    // Read-only surfaces for query endpoints.
    props.clientProfilesTable.grantReadData(meHandler);
    props.clientProfilesTable.grantReadWriteData(profilesHandler);
    props.policyEventsTable.grantReadData(policyEventsHandler);
    props.impactAssessmentsTable.grantReadData(policyEventsHandler);

    // Demo lever needs write access to seed profiles and trigger a fake policy delta.
    props.clientProfilesTable.grantReadWriteData(demoHandler);
    props.policyEventsTable.grantReadWriteData(demoHandler);

    props.policyCorpusBucket.grantReadWrite(sentinelHandler);

    // Orchestrator has the biggest surface (it fans out to all agents).
    props.clientProfilesTable.grantReadData(orchestratorHandler);
    props.policyEventsTable.grantReadData(orchestratorHandler);
    props.impactAssessmentsTable.grantReadWriteData(orchestratorHandler);
    props.auditTrailTable.grantWriteData(orchestratorHandler);
    props.trainingCorrectionTable.grantReadData(orchestratorHandler);
    props.policyCorpusBucket.grantRead(orchestratorHandler);
    props.signingKey.grantSign(orchestratorHandler); // Anchor step signs ImpactAssessments.

    // Alerts dispatcher (Phase 5B): subscribes to argus.composer BriefReady
    // events, sends SES email for high-severity impacts, records send history
    // in AlertsTable. Wired below alongside its EventBridge rule.

    // -----------------------------------------------------------------
    // API Gateway HTTP API with Cognito authorizer.
    // -----------------------------------------------------------------
    const authorizer = new apigwv2auth.HttpUserPoolAuthorizer(
      'CognitoAuthorizer',
      props.userPool,
      { userPoolClients: [props.userPoolClient] }
    );

    this.httpApi = new apigwv2.HttpApi(this, 'ArgusHttpApi', {
      apiName: 'argus-api',
      description: 'Argus REST surface. Consumers are the Next.js dashboard and (via AgentCore Gateway wrapping this API) consultant Claude Code MCP clients.',
      corsPreflight: {
        allowHeaders: ['Authorization', 'Content-Type'],
        allowMethods: [
          apigwv2.CorsHttpMethod.GET,
          apigwv2.CorsHttpMethod.POST,
          apigwv2.CorsHttpMethod.PATCH,
          apigwv2.CorsHttpMethod.DELETE,
          apigwv2.CorsHttpMethod.OPTIONS,
        ],
        allowOrigins: ['https://tryargus.ca', 'http://localhost:3000'],
      },
    });

    const routes: Array<{ path: string; methods: apigwv2.HttpMethod[]; handler: lambda.Function }> = [
      { path: '/me', methods: [apigwv2.HttpMethod.GET], handler: meHandler },
      { path: '/profiles', methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.POST], handler: profilesHandler },
      { path: '/profiles/bulk', methods: [apigwv2.HttpMethod.POST], handler: profilesHandler },
      { path: '/profiles/{id}', methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.PATCH, apigwv2.HttpMethod.DELETE], handler: profilesHandler },
      { path: '/policy-events', methods: [apigwv2.HttpMethod.GET], handler: policyEventsHandler },
      { path: '/policy-events/{id}', methods: [apigwv2.HttpMethod.GET], handler: policyEventsHandler },
      { path: '/policy-events/{id}/impacts', methods: [apigwv2.HttpMethod.GET], handler: policyEventsHandler },
      { path: '/impacts', methods: [apigwv2.HttpMethod.GET], handler: impactsHandler },
      { path: '/impacts/{id}', methods: [apigwv2.HttpMethod.GET], handler: impactsHandler },
      { path: '/impacts/{id}/audit-signature', methods: [apigwv2.HttpMethod.GET], handler: impactsHandler },
      { path: '/impacts/{id}/correction', methods: [apigwv2.HttpMethod.POST], handler: impactsHandler },
      { path: '/briefs', methods: [apigwv2.HttpMethod.GET], handler: briefsServiceHandler },
      { path: '/briefs/batch-send', methods: [apigwv2.HttpMethod.POST], handler: briefsServiceHandler },
      { path: '/briefs/{id}', methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.PATCH], handler: briefsServiceHandler },
      { path: '/briefs/{id}/send', methods: [apigwv2.HttpMethod.POST], handler: briefsServiceHandler },
      { path: '/briefs/{id}/archive-link', methods: [apigwv2.HttpMethod.GET], handler: briefsServiceHandler },
      { path: '/demo/trigger-policy-change', methods: [apigwv2.HttpMethod.POST], handler: demoHandler },
      { path: '/demo/seed', methods: [apigwv2.HttpMethod.POST], handler: demoHandler },
    ];

    for (const route of routes) {
      this.httpApi.addRoutes({
        path: route.path,
        methods: route.methods,
        integration: new apigwv2int.HttpLambdaIntegration(
          `Integration-${route.path.replace(/[^a-zA-Z0-9]/g, '-')}`,
          route.handler
        ),
        authorizer,
      });
    }

    // -----------------------------------------------------------------
    // Step Functions Express Workflow for the multi-agent pipeline.
    // Placeholder Pass state today. Real Analyst -> Auditor -> Anchor ->
    // Composer graph lands in Phase 3 to 4 as Strands runs inside the
    // orchestrator Lambda's handler.
    // -----------------------------------------------------------------
    const workflowLogs = new logs.LogGroup(this, 'OrchestrationLogs', {
      logGroupName: '/aws/vendedlogs/states/argus-orchestration',
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    new sfn.StateMachine(this, 'OrchestrationWorkflow', {
      stateMachineName: 'argus-orchestration',
      stateMachineType: sfn.StateMachineType.EXPRESS,
      definitionBody: sfn.DefinitionBody.fromChainable(
        new sfn.Pass(this, 'PlaceholderPass', {
          comment: 'Real 5-agent Strands pipeline lands in Phase 3',
          result: sfn.Result.fromObject({ phase: 1, status: 'placeholder' }),
        })
      ),
      logs: { destination: workflowLogs, level: sfn.LogLevel.ALL, includeExecutionData: false },
      tracingEnabled: true,
    });

    // -----------------------------------------------------------------
    // EventBridge schedules.
    // - Sentinel fires hourly to diff IRCC pages.
    // - Recall fires daily at 03:00 UTC to re-scan the last 30 days.
    // -----------------------------------------------------------------
    new events.Rule(this, 'SentinelHourly', {
      ruleName: 'argus-sentinel-hourly',
      description: 'Trigger Sentinel Lambda to diff IRCC pages every hour',
      schedule: events.Schedule.rate(cdk.Duration.hours(1)),
      targets: [new targets.LambdaFunction(sentinelHandler)],
    });

    new events.Rule(this, 'RecallDaily', {
      ruleName: 'argus-recall-daily',
      description: 'Trigger Recall Lambda daily at 03:00 UTC to re-scan the last 30 days of IRCC pages',
      schedule: events.Schedule.cron({ minute: '0', hour: '3' }),
      targets: [new targets.LambdaFunction(recallHandler)],
    });

    cdk.Tags.of(this).add('Project', 'Argus');
    cdk.Tags.of(this).add('Environment', 'dev');

    new cdk.CfnOutput(this, 'HttpApiUrl', { value: this.httpApi.apiEndpoint });
  }
}
