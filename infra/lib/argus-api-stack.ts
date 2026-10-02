import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigwv2auth from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as apigwv2int from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaDestinations from 'aws-cdk-lib/aws-lambda-destinations';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import { IRCC_WATCH_LIST, assertValidWatchList } from './ircc-watch-list';

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
  readonly publicCountersTable: dynamodb.Table;

  readonly guardrail: bedrock.CfnGuardrail;

  readonly policyCorpusBucket: s3.Bucket;
  readonly generatedArtifactsBucket: s3.Bucket;

  /** Gets the failure-queue alarms. Same address as the budget alarms (ARGUS_BUDGET_EMAIL). */
  readonly operatorEmail: string;
}

/**
 * The HTTP API, the agent and service Lambdas, the EventBridge rules that
 * chain the agents, and the Sentinel and Recall schedules. The orchestrator
 * Lambda and the Step Functions state machine are unused placeholders from
 * the first scaffold.
 */
export class ArgusApiStack extends cdk.Stack {
  public readonly httpApi: apigwv2.HttpApi;

  constructor(scope: Construct, id: string, props: ArgusApiStackProps) {
    super(scope, id, props);

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(props.operatorEmail)) {
      throw new Error('ArgusApiStack needs an operator email (set ARGUS_BUDGET_EMAIL)');
    }
    // Operator alarms. CloudWatch alarms can't email on their own, so they
    // publish here and the topic emails the operator. The address has to
    // confirm the subscription once after deploy. The messages carry alarm
    // and queue names only, so the topic stays on default encryption: an
    // alarm can't publish to a topic under the AWS-managed SNS key.
    const operatorAlarms = new sns.Topic(this, 'OperatorAlarms', {
      topicName: 'argus-operator-alarms',
      displayName: 'Argus operator alarms',
      enforceSSL: true,
    });
    operatorAlarms.addSubscription(new snsSubscriptions.EmailSubscription(props.operatorEmail));
    // Fires when a failure queue holds any message, and stays in alarm until
    // someone drains it. One email per transition into alarm.
    const alarmOnFailures = (id: string, queue: sqs.Queue, what: string) => {
      const alarm = new cloudwatch.Alarm(this, id, {
        alarmName: `${queue.queueName}-not-empty`,
        alarmDescription: `${what} Inspect and redrive or delete the messages in ${queue.queueName}.`,
        metric: queue.metricApproximateNumberOfMessagesVisible({
          period: cdk.Duration.minutes(5),
          statistic: cloudwatch.Stats.MAXIMUM,
        }),
        threshold: 0,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        evaluationPeriods: 1,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
      alarm.addAlarmAction(new cwActions.SnsAction(operatorAlarms));
    };

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

    // Demo lever. POST /demo/trigger-policy-change replays a real PolicyRules
    // row as a PolicyDelta aimed at the caller's tenant, so a demo runs the
    // whole agent chain on demand. Off unless ARGUS_DEMO_TRIGGER_ENABLED is
    // "true" at synth time (on by default for the hackathon), and only for the
    // rcicIds in ARGUS_DEMO_RCIC_ALLOWLIST. /demo/seed stays a 501.
    //
    // Reuses the DemoHandler and DemoHandlerLogs construct ids and the
    // physical names of the earlier placeholder so CloudFormation updates both
    // in place, same as ProfilesHandler below.
    const demoLogGroup = new logs.LogGroup(this, 'DemoHandlerLogs', {
      logGroupName: '/aws/lambda/argus-demo',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const demoHandler = new nodejs.NodejsFunction(this, 'DemoHandler', {
      functionName: 'argus-demo',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      projectRoot: path.join(__dirname, '../..'),
      depsLockFilePath: path.join(__dirname, '../../services/demo/package-lock.json'),
      entry: path.join(__dirname, '../../services/demo/src/handler.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      environment: {
        POLICY_RULES_TABLE: props.policyRulesTable.tableName,
        DEMO_TRIGGER_ENABLED: process.env.ARGUS_DEMO_TRIGGER_ENABLED ?? 'true',
        DEMO_RCIC_ALLOWLIST: process.env.ARGUS_DEMO_RCIC_ALLOWLIST ?? 'demo-rcic-001,R670922',
        NODE_OPTIONS: '--enable-source-maps',
      },
      logGroup: demoLogGroup,
      tracing: lambda.Tracing.ACTIVE,
      bundling: { minify: true, target: 'es2022', format: nodejs.OutputFormat.ESM, sourceMap: true },
    });

    // Reads rule metadata (GetItem, or a filtered Scan by domain) and puts one
    // event on the default bus. It writes no table.
    demoHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:GetItem', 'dynamodb:Scan'],
        resources: [props.policyRulesTable.tableArn],
      }),
    );
    demoHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['events:PutEvents'],
        resources: [`arn:aws:events:${this.region}:${this.account}:event-bus/default`],
      }),
    );

    // Me service (Phase E). GET /me returns the consultant's identity, firm,
    // province, preferences, onboarding state, signing key details and setup
    // counts. PATCH /me edits firm, province, preferences and onboarding on
    // the RcicUsers row. Consultant data only. Clients appear as a count.
    //
    // Reuses the MeHandler and MeHandlerLogs construct ids and the physical
    // names of the earlier placeholder so CloudFormation updates both in
    // place, same as ProfilesHandler below.
    const meLogGroup = new logs.LogGroup(this, 'MeHandlerLogs', {
      logGroupName: '/aws/lambda/argus-me',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const meHandler = new nodejs.NodejsFunction(this, 'MeHandler', {
      functionName: 'argus-me',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      projectRoot: path.join(__dirname, '../..'),
      depsLockFilePath: path.join(__dirname, '../../services/me/package-lock.json'),
      entry: path.join(__dirname, '../../services/me/src/handler.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      environment: {
        RCIC_USERS_TABLE: props.rcicUsersTable.tableName,
        CLIENT_PROFILES_TABLE: props.clientProfilesTable.tableName,
        IMPACT_ASSESSMENTS_TABLE: props.impactAssessmentsTable.tableName,
        SIGNING_KEY_ID: props.signingKey.keyId,
        NODE_OPTIONS: '--enable-source-maps',
      },
      logGroup: meLogGroup,
      tracing: lambda.Tracing.ACTIVE,
      bundling: { minify: true, target: 'es2022', format: nodejs.OutputFormat.ESM, sourceMap: true },
    });

    // Least privilege. One row read and a conditional update on RcicUsers (no
    // PutItem, so a PATCH can never create a tenant row). Query only on the
    // two tables it counts. The public half of the signing key, never Sign.
    meHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:GetItem', 'dynamodb:UpdateItem'],
        resources: [props.rcicUsersTable.tableArn],
      }),
    );
    meHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:Query'],
        resources: [props.clientProfilesTable.tableArn, props.impactAssessmentsTable.tableArn],
      }),
    );
    meHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['kms:GetPublicKey', 'kms:DescribeKey'],
        resources: [props.signingKey.keyArn],
      }),
    );

    // Profiles service (Phase F). The consultant's caseload: list with derived
    // counts, detail, single create, CSV bulk import and PATCH. DELETE is a
    // soft close (status closed), never a hard delete (ADR-0002).
    //
    // Reuses the ProfilesHandler and ProfilesHandlerLogs construct ids and the
    // physical names of the earlier placeholder so CloudFormation updates both
    // in place, same as PolicyEventsHandler below.
    const profilesLogGroup = new logs.LogGroup(this, 'ProfilesHandlerLogs', {
      logGroupName: '/aws/lambda/argus-profiles',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const profilesHandler = new nodejs.NodejsFunction(this, 'ProfilesHandler', {
      functionName: 'argus-profiles',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      projectRoot: path.join(__dirname, '../..'),
      depsLockFilePath: path.join(__dirname, '../../services/profiles/package-lock.json'),
      entry: path.join(__dirname, '../../services/profiles/src/handler.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(29),
      memorySize: 512,
      environment: {
        CLIENT_PROFILES_TABLE: props.clientProfilesTable.tableName,
        IMPACT_ASSESSMENTS_TABLE: props.impactAssessmentsTable.tableName,
        BRIEFS_TABLE: props.briefsTable.tableName,
        NODE_OPTIONS: '--enable-source-maps',
      },
      logGroup: profilesLogGroup,
      tracing: lambda.Tracing.ACTIVE,
      bundling: { minify: true, target: 'es2022', format: nodejs.OutputFormat.ESM, sourceMap: true },
    });

    props.impactAssessmentsTable.grantReadData(profilesHandler);
    props.briefsTable.grantReadData(profilesHandler);

    // Policy events service (Phase C1). Derives events at read time from
    // ImpactAssessments grouped by policyEventId, joined to PolicyRules,
    // Briefs, TrainingCorrections and Alerts, because nothing writes the
    // PolicyEvents table yet. Also serves the /activity feed.
    //
    // Reuses the PolicyEventsHandler and PolicyEventsHandlerLogs construct
    // ids and the physical names of the earlier placeholder so
    // CloudFormation updates both in place, same as ImpactsHandler below.
    const policyEventsLogGroup = new logs.LogGroup(this, 'PolicyEventsHandlerLogs', {
      logGroupName: '/aws/lambda/argus-policy-events',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const policyEventsHandler = new nodejs.NodejsFunction(this, 'PolicyEventsHandler', {
      functionName: 'argus-policy-events',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      projectRoot: path.join(__dirname, '../..'),
      depsLockFilePath: path.join(__dirname, '../../services/policy-events/package-lock.json'),
      entry: path.join(__dirname, '../../services/policy-events/src/handler.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(29),
      memorySize: 512,
      environment: {
        IMPACT_ASSESSMENTS_TABLE: props.impactAssessmentsTable.tableName,
        POLICY_RULES_TABLE: props.policyRulesTable.tableName,
        BRIEFS_TABLE: props.briefsTable.tableName,
        TRAINING_CORRECTIONS_TABLE: props.trainingCorrectionTable.tableName,
        CLIENT_PROFILES_TABLE: props.clientProfilesTable.tableName,
        ALERTS_TABLE: props.alertsTable.tableName,
        POLICY_CORPUS_BUCKET: props.policyCorpusBucket.bucketName,
        ARCHIVE_LINK_TTL_SECONDS: String(7 * 24 * 60 * 60),
        NODE_OPTIONS: '--enable-source-maps',
      },
      logGroup: policyEventsLogGroup,
      tracing: lambda.Tracing.ACTIVE,
      bundling: { minify: true, target: 'es2022', format: nodejs.OutputFormat.ESM, sourceMap: true },
    });

    props.policyRulesTable.grantReadData(policyEventsHandler);
    props.briefsTable.grantReadData(policyEventsHandler);
    props.trainingCorrectionTable.grantReadData(policyEventsHandler);
    props.clientProfilesTable.grantReadData(policyEventsHandler);
    props.alertsTable.grantReadData(policyEventsHandler);
    props.policyCorpusBucket.grantRead(policyEventsHandler);


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
        POLICY_RULES_TABLE: props.policyRulesTable.tableName,
        // Public verify falls back to sent briefs by their sent-body hash.
        BRIEFS_TABLE: props.briefsTable.tableName,
        SIGNING_KEY_ID: props.signingKey.keyId,
        // Public receipts name the consultant only when they opted in, and
        // /public/stats sums the landing counters.
        RCIC_USERS_TABLE: props.rcicUsersTable.tableName,
        PUBLIC_COUNTERS_TABLE: props.publicCountersTable.tableName,
        // Corrections are checked against the same guardrail the Auditor
        // applies when it reads them back, so a client name is refused at
        // filing time instead of blocking later audits.
        BEDROCK_GUARDRAIL_ID: props.guardrail.attrGuardrailId,
        BEDROCK_GUARDRAIL_VERSION: 'DRAFT',
        AUDIT_TRAIL_TABLE: props.auditTrailTable.tableName,
        NODE_OPTIONS: '--enable-source-maps',
      },
      logGroup: impactsServiceLogGroup,
      tracing: lambda.Tracing.ACTIVE,
      bundling: { minify: true, target: 'es2022', format: nodejs.OutputFormat.ESM, sourceMap: true },
    });

    props.impactAssessmentsTable.grantReadData(impactsHandler);
    props.trainingCorrectionTable.grantReadWriteData(impactsHandler);
    props.policyRulesTable.grantReadData(impactsHandler);
    // Includes the bySentBodyHash index the public verify fallback queries.
    props.briefsTable.grantReadData(impactsHandler);
    impactsHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['kms:GetPublicKey'],
        resources: [props.signingKey.keyArn],
      }),
    );
    // ADR-0004: a correction that changes isAffected is stored as a new,
    // signed consultant-review row. PutItem only (no Update, no Delete), and
    // the handler's put is create-only, so no existing assessment can be
    // changed. kms:Sign on the one signing key, the same grant Anchor and
    // briefs-service hold.
    impactsHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:PutItem'],
        resources: [props.impactAssessmentsTable.tableArn],
      }),
    );
    props.signingKey.grantSign(impactsHandler);
    // One consultant row per public receipt, and the 14 counter rows.
    impactsHandler.addToRolePolicy(
      new iam.PolicyStatement({ actions: ['dynamodb:GetItem'], resources: [props.rcicUsersTable.tableArn] }),
    );
    impactsHandler.addToRolePolicy(
      new iam.PolicyStatement({ actions: ['dynamodb:BatchGetItem'], resources: [props.publicCountersTable.tableArn] }),
    );

    // Records service (ADR-0002, export on demand). GET /records lists the
    // consultant's signed assessments and sent briefs for a date range, and
    // POST /exports writes them to a zip (records.jsonl, VERIFY.md and the
    // public key) under exports/ in the generated-artifacts bucket, then
    // returns a 1-hour presigned link. Its own function so the only role that
    // can write export files reads the two tables and nothing else: no
    // corrections write, no Bedrock, no Sign.
    const recordsLogGroup = new logs.LogGroup(this, 'RecordsHandlerLogs', {
      logGroupName: '/aws/lambda/argus-records',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const recordsHandler = new nodejs.NodejsFunction(this, 'RecordsHandler', {
      functionName: 'argus-records',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      projectRoot: path.join(__dirname, '../..'),
      depsLockFilePath: path.join(__dirname, '../../services/records/package-lock.json'),
      entry: path.join(__dirname, '../../services/records/src/handler.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(29),
      memorySize: 512,
      environment: {
        IMPACT_ASSESSMENTS_TABLE: props.impactAssessmentsTable.tableName,
        BRIEFS_TABLE: props.briefsTable.tableName,
        GENERATED_ARTIFACTS_BUCKET: props.generatedArtifactsBucket.bucketName,
        SIGNING_KEY_ID: props.signingKey.keyId,
        // SHA-256 of the signing key's SPKI, the same value the web verifier
        // pins (web/src/lib/signature-verify.ts). Exports refuse to run if KMS
        // returns any other key.
        SIGNING_KEY_SPKI_SHA256: '9eeaa3055e1915ee2c31e6c904c37bdde22eb43e82a08ccf9fba9dfccebe94be',
        EXPORT_URL_TTL_SECONDS: '3600',
        NODE_OPTIONS: '--enable-source-maps',
      },
      logGroup: recordsLogGroup,
      tracing: lambda.Tracing.ACTIVE,
      bundling: { minify: true, target: 'es2022', format: nodejs.OutputFormat.ESM, sourceMap: true },
    });

    // Query only, on the two base tables. No GetItem, no Scan, no index.
    recordsHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:Query'],
        resources: [props.impactAssessmentsTable.tableArn, props.briefsTable.tableArn],
      }),
    );
    // Put, then GetObject so the presigned link works. Only under exports/.
    recordsHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['s3:PutObject', 's3:GetObject'],
        resources: [props.generatedArtifactsBucket.arnForObjects('exports/*')],
      }),
    );
    recordsHandler.addToRolePolicy(
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

    assertValidWatchList(IRCC_WATCH_LIST);
    const sentinelHandler = new nodejs.NodejsFunction(this, 'SentinelHandler', {
      functionName: 'argus-sentinel',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      projectRoot: path.join(__dirname, '../..'),
      depsLockFilePath: path.join(__dirname, '../../services/sentinel/package-lock.json'),
      entry: path.join(__dirname, '../../services/sentinel/src/handler.ts'),
      handler: 'handler',
      // Sentinel scans 5 pages at a time, each capped at a 15 s fetch plus a
      // 30 s classifier call. With 30 pages that caps out near 6 minutes,
      // so 10 leaves room. A normal run takes well under a minute.
      timeout: cdk.Duration.minutes(10),
      memorySize: 512,
      environment: {
        POLICY_CORPUS_BUCKET: props.policyCorpusBucket.bucketName,
        POLICY_RULES_TABLE: props.policyRulesTable.tableName,
        RULE_INDEX_TABLE: props.ruleIndexTable.tableName,
        BEDROCK_CLASSIFIER_MODEL: 'us.amazon.nova-micro-v1:0',
        BEDROCK_GUARDRAIL_ID: props.guardrail.attrGuardrailId,
        BEDROCK_GUARDRAIL_VERSION: 'DRAFT',
        AUDIT_TRAIL_TABLE: props.auditTrailTable.tableName,
        NODE_OPTIONS: '--enable-source-maps',
      },
      logGroup: sentinelLogGroup,
      tracing: lambda.Tracing.ACTIVE,
      bundling: {
        minify: true,
        target: 'es2022',
        format: nodejs.OutputFormat.ESM,
        sourceMap: true,
        // The watch list goes into the code, not the environment: 30 URLs
        // overflow Lambda's 4 KB environment limit.
        define: { IRCC_WATCH_LIST: JSON.stringify(IRCC_WATCH_LIST) },
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
        AUDIT_TRAIL_TABLE: props.auditTrailTable.tableName,
        BEDROCK_REASONER_MODEL: 'us.amazon.nova-pro-v1:0',
        BEDROCK_GUARDRAIL_ID: props.guardrail.attrGuardrailId,
        BEDROCK_GUARDRAIL_VERSION: 'DRAFT',
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
        BEDROCK_GUARDRAIL_ID: props.guardrail.attrGuardrailId,
        BEDROCK_GUARDRAIL_VERSION: 'DRAFT',
        FEW_SHOT_MAX: '5',
        FEW_SHOT_MAX_AGE_DAYS: '90',
        AUDIT_TRAIL_TABLE: props.auditTrailTable.tableName,
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
        AUDIT_TRAIL_TABLE: props.auditTrailTable.tableName,
        PUBLIC_COUNTERS_TABLE: props.publicCountersTable.tableName,
        NODE_OPTIONS: '--enable-source-maps',
      },
      logGroup: anchorLogGroup,
      tracing: lambda.Tracing.ACTIVE,
      bundling: { minify: true, target: 'es2022', format: nodejs.OutputFormat.ESM, sourceMap: true },
    });

    props.policyRulesTable.grantReadData(anchorHandler);
    props.impactAssessmentsTable.grantWriteData(anchorHandler);
    props.signingKey.grantSign(anchorHandler);
    const bumpPublicCounter = new iam.PolicyStatement({
      actions: ['dynamodb:UpdateItem'],
      resources: [props.publicCountersTable.tableArn],
    });
    anchorHandler.addToRolePolicy(bumpPublicCounter);

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
        AUDIT_TRAIL_TABLE: props.auditTrailTable.tableName,
        BEDROCK_GUARDRAIL_ID: props.guardrail.attrGuardrailId,
        BEDROCK_GUARDRAIL_VERSION: 'DRAFT',
        NODE_OPTIONS: '--enable-source-maps',
      },
      logGroup: composerLogGroup,
      tracing: lambda.Tracing.ACTIVE,
      bundling: { minify: true, target: 'es2022', format: nodejs.OutputFormat.ESM, sourceMap: true },
    });

    props.policyRulesTable.grantReadData(composerHandler);
    props.briefsTable.grantWriteData(composerHandler);
    // A redelivered record reads the brief it may already have written, so a
    // retry never drafts a second brief for the same assessment.
    composerHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:GetItem'],
        resources: [props.briefsTable.tableArn],
      }),
    );
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

    // Where a stream record goes once Composer's retries run out. Lambda sends
    // the record's shard and sequence range here (the record itself stays in
    // the stream for 24 hours, and the assessment row stays in its table for
    // good). Without it, a record that keeps failing leaves only a log line.
    const composerFailures = new sqs.Queue(this, 'ComposerStreamFailures', {
      queueName: 'argus-composer-stream-failures',
      retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
    });

    composerHandler.addEventSource(
      new lambdaEventSources.DynamoEventSource(props.impactAssessmentsTable, {
        startingPosition: lambda.StartingPosition.LATEST,
        batchSize: 5,
        maxBatchingWindow: cdk.Duration.seconds(5),
        // The handler returns batchItemFailures only for failures a retry can
        // fix (throttling, 5xx). It drops bad input, guardrail blocks and
        // missing rules itself, so these retries go to transient errors.
        retryAttempts: 3,
        bisectBatchOnError: true,
        reportBatchItemFailures: true,
        onFailure: new lambdaEventSources.SqsDlq(composerFailures),
        filters: [
          lambda.FilterCriteria.filter({ eventName: lambda.FilterRule.isEqual('INSERT') }),
        ],
      }),
    );
    alarmOnFailures(
      'ComposerStreamFailuresAlarm',
      composerFailures,
      'Composer ran out of retries on an assessment, so its client has no brief.',
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

    // Where a BriefReady goes when Alerts can't handle it: the function
    // failed on every try, or EventBridge couldn't invoke it at all. Each
    // message holds the event, so it can be redriven once the cause is fixed.
    const alertsFailures = new sqs.Queue(this, 'AlertsFailures', {
      queueName: 'argus-alerts-failures',
      retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
    });
    alarmOnFailures(
      'AlertsFailuresAlarm',
      alertsFailures,
      'Alerts gave up on a BriefReady, so a high-severity email may not have gone out.',
    );
    const alertsTimeout = cdk.Duration.seconds(30);

    const alertsHandler = new nodejs.NodejsFunction(this, 'AlertsHandler', {
      functionName: 'argus-alerts',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      projectRoot: path.join(__dirname, '../..'),
      depsLockFilePath: path.join(__dirname, '../../services/alerts/package-lock.json'),
      entry: path.join(__dirname, '../../services/alerts/src/handler.ts'),
      handler: 'handler',
      timeout: alertsTimeout,
      memorySize: 256,
      environment: {
        BRIEFS_TABLE: props.briefsTable.tableName,
        ALERTS_TABLE: props.alertsTable.tableName,
        RCIC_USERS_TABLE: props.rcicUsersTable.tableName,
        SES_FROM_EMAIL: alertsFromEmail,
        DEMO_RCIC_EMAIL: alertsDemoRecipient,
        // Twice the timeout, so a live invocation never loses its claim on a
        // brief's alert, and a dead one's claim is stale by the time Lambda
        // retries (1 minute after the first failure, per the Lambda docs).
        ALERT_CLAIM_LEASE_SECONDS: String(alertsTimeout.toSeconds() * 2),
        NODE_OPTIONS: '--enable-source-maps',
      },
      // BriefReady arrives as an async invoke. A throw (SES down, or another
      // delivery of the same brief still sending) gets 2 more tries, then
      // the event lands in the failure queue with its error.
      retryAttempts: 2,
      onFailure: new lambdaDestinations.SqsDestination(alertsFailures),
      logGroup: alertsLogGroup,
      tracing: lambda.Tracing.ACTIVE,
      bundling: { minify: true, target: 'es2022', format: nodejs.OutputFormat.ESM, sourceMap: true },
    });

    props.briefsTable.grantReadData(alertsHandler);
    props.alertsTable.grantWriteData(alertsHandler);
    props.rcicUsersTable.grantReadData(alertsHandler);
    // Claims, releases and marks the alert on the brief row. The table only,
    // since the handler never touches the brief indexes.
    alertsHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:UpdateItem'],
        resources: [props.briefsTable.tableArn],
      }),
    );

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
      // EventBridge keeps its default retry (24 hours) for failures to
      // invoke. An event it still can't deliver goes to the failure queue.
      targets: [new targets.LambdaFunction(alertsHandler, { deadLetterQueue: alertsFailures })],
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
        PUBLIC_COUNTERS_TABLE: props.publicCountersTable.tableName,
        DEFAULT_FROM_EMAIL: alertsFromEmail,
        // Base of the "Verify this message" link in every sent brief.
        ARGUS_PUBLIC_BASE_URL: process.env.ARGUS_PUBLIC_BASE_URL ?? 'https://main.d270cjhakw6y7j.amplifyapp.com',
        // Relay From ("Name via Argus <relay>", Reply-To the consultant).
        // Off until the relay domain is verified in SES.
        BRIEFS_RELAY_ENABLED: process.env.ARGUS_BRIEFS_RELAY_ENABLED === 'true' ? 'true' : 'false',
        BRIEFS_RELAY_FROM_EMAIL: process.env.ARGUS_BRIEFS_RELAY_FROM ?? '',
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
    briefsServiceHandler.addToRolePolicy(bumpPublicCounter);
    // GET /briefs/{id}/send-signature returns the public key with the signature.
    briefsServiceHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['kms:GetPublicKey'],
        resources: [props.signingKey.keyArn],
      }),
    );

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
        BEDROCK_GUARDRAIL_ID: props.guardrail.attrGuardrailId,
        BEDROCK_GUARDRAIL_VERSION: 'DRAFT',
        RECALL_LOOKBACK_DAYS: '30',
        RECALL_MAX_PAIRS: '200',
        AUDIT_TRAIL_TABLE: props.auditTrailTable.tableName,
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

    // Pipeline step telemetry. Each agent appends one AuditTrail row per step.
    // PutItem only: no UpdateItem, DeleteItem or BatchWriteItem, so an agent
    // can add a step and can never rewrite or remove one (ADR-0002).
    const appendStep = new iam.PolicyStatement({
      actions: ['dynamodb:PutItem'],
      resources: [props.auditTrailTable.tableArn],
    });
    for (const h of [sentinelHandler, recallHandler, analystHandler, auditorHandler, anchorHandler, composerHandler]) {
      h.addToRolePolicy(appendStep);
    }
    // The lineage routes read the steps back, by partition and by run.
    props.auditTrailTable.grantReadData(impactsHandler);

    const orchestratorHandler = placeholder('OrchestratorHandler', 'orchestrator');

    // -----------------------------------------------------------------
    // Grants. Every Lambda gets least-privilege via CDK grant helpers.
    // Read carefully. Do not swap for wildcard IAM policies.
    // -----------------------------------------------------------------

    // Read plus conditional put and update. No DeleteItem or BatchWriteItem:
    // closing a client is an update, and nothing in the service removes a row.
    props.clientProfilesTable.grantReadData(profilesHandler);
    profilesHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:PutItem', 'dynamodb:UpdateItem'],
        resources: [props.clientProfilesTable.tableArn],
      }),
    );
    props.policyEventsTable.grantReadData(policyEventsHandler);
    props.impactAssessmentsTable.grantReadData(policyEventsHandler);

    // Bedrock guardrail: every Lambda that invokes a foundation model also
    // gets ApplyGuardrail on the shared Argus guardrail. Same guardrail id
    // is exported as an env var to each handler above so the Converse call
    // can attach guardrailConfig.
    const guardrailApply = new iam.PolicyStatement({
      actions: ['bedrock:ApplyGuardrail'],
      resources: [props.guardrail.attrGuardrailArn],
    });
    // impacts-service invokes no model. It only runs ApplyGuardrail on
    // correction text before storing it.
    for (const h of [sentinelHandler, analystHandler, auditorHandler, composerHandler, recallHandler, impactsHandler]) {
      h.addToRolePolicy(guardrailApply);
    }

    props.policyCorpusBucket.grantReadWrite(sentinelHandler);

    // Unused placeholder from the first scaffold. Its grants are still deployed.
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
      description: 'Argus REST surface for the Next.js dashboard and the public receipt pages.',
      corsPreflight: {
        allowHeaders: ['Authorization', 'Content-Type'],
        allowMethods: [
          apigwv2.CorsHttpMethod.GET,
          apigwv2.CorsHttpMethod.POST,
          apigwv2.CorsHttpMethod.PATCH,
          apigwv2.CorsHttpMethod.DELETE,
          apigwv2.CorsHttpMethod.OPTIONS,
        ],
        allowOrigins: [
          'https://tryargus.ca',
          'https://main.d270cjhakw6y7j.amplifyapp.com',
          'http://localhost:3000',
          'https://phase-8-frontend.d270cjhakw6y7j.amplifyapp.com',
          'http://localhost:3001',
        ],
      },
    });

    const routes: Array<{ path: string; methods: apigwv2.HttpMethod[]; handler: lambda.Function }> = [
      { path: '/me', methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.PATCH], handler: meHandler },
      { path: '/profiles', methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.POST], handler: profilesHandler },
      { path: '/profiles/bulk', methods: [apigwv2.HttpMethod.POST], handler: profilesHandler },
      { path: '/profiles/{id}', methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.PATCH, apigwv2.HttpMethod.DELETE], handler: profilesHandler },
      { path: '/policy-events', methods: [apigwv2.HttpMethod.GET], handler: policyEventsHandler },
      { path: '/policy-events/{id}', methods: [apigwv2.HttpMethod.GET], handler: policyEventsHandler },
      { path: '/policy-events/{id}/impacts', methods: [apigwv2.HttpMethod.GET], handler: policyEventsHandler },
      { path: '/activity', methods: [apigwv2.HttpMethod.GET], handler: policyEventsHandler },
      { path: '/impacts', methods: [apigwv2.HttpMethod.GET], handler: impactsHandler },
      { path: '/impacts/{id}', methods: [apigwv2.HttpMethod.GET], handler: impactsHandler },
      { path: '/impacts/{id}/audit-signature', methods: [apigwv2.HttpMethod.GET], handler: impactsHandler },
      { path: '/impacts/{id}/lineage', methods: [apigwv2.HttpMethod.GET], handler: impactsHandler },
      // {id} is one pipeline run (a policyEventId). Served by impacts-service,
      // which owns the lineage reads.
      { path: '/policy-events/{id}/lineage', methods: [apigwv2.HttpMethod.GET], handler: impactsHandler },
      { path: '/impacts/{id}/correction', methods: [apigwv2.HttpMethod.POST], handler: impactsHandler },
      { path: '/impacts/{id}/corrections', methods: [apigwv2.HttpMethod.GET], handler: impactsHandler },
      { path: '/corrections', methods: [apigwv2.HttpMethod.GET], handler: impactsHandler },
      { path: '/records', methods: [apigwv2.HttpMethod.GET], handler: recordsHandler },
      { path: '/exports', methods: [apigwv2.HttpMethod.POST], handler: recordsHandler },
      { path: '/briefs', methods: [apigwv2.HttpMethod.GET], handler: briefsServiceHandler },
      { path: '/briefs/batch-send', methods: [apigwv2.HttpMethod.POST], handler: briefsServiceHandler },
      { path: '/briefs/{id}', methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.PATCH], handler: briefsServiceHandler },
      { path: '/briefs/{id}/send', methods: [apigwv2.HttpMethod.POST], handler: briefsServiceHandler },
      { path: '/briefs/{id}/archive-link', methods: [apigwv2.HttpMethod.GET], handler: briefsServiceHandler },
      { path: '/briefs/{id}/send-signature', methods: [apigwv2.HttpMethod.GET], handler: briefsServiceHandler },
      { path: '/briefs/{id}/copied', methods: [apigwv2.HttpMethod.POST], handler: briefsServiceHandler },
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

    // Public routes. No Cognito authorizer. The /verify/[hash] receipt page
    // and the marketing hero fetch signature material without a login,
    // exactly like a Stripe hosted receipt.
    this.httpApi.addRoutes({
      path: '/public/verify/{hash}',
      methods: [apigwv2.HttpMethod.GET],
      integration: new apigwv2int.HttpLambdaIntegration('Integration-public-verify', impactsHandler),
    });
    // The signing key as a JWK set (the web serves it at
    // /.well-known/jwks.json), and the landing page's 7-day counters.
    this.httpApi.addRoutes({
      path: '/public/jwks',
      methods: [apigwv2.HttpMethod.GET],
      integration: new apigwv2int.HttpLambdaIntegration('Integration-public-jwks', impactsHandler),
    });
    this.httpApi.addRoutes({
      path: '/public/stats',
      methods: [apigwv2.HttpMethod.GET],
      integration: new apigwv2int.HttpLambdaIntegration('Integration-public-stats', impactsHandler),
    });

    // Read-only guest view. GET /guest/<route> serves one demo tenant
    // without a login, so a visitor can look around the dashboard before
    // signing up. GET only, so no guest request reaches a write, a Bedrock
    // call or an email. Each service maps the route back to its signed-in
    // read (services/shared/guest-view.ts) and the /me read swaps the
    // consultant's identity for a stand-in name. Set ARGUS_GUEST_RCIC_ID to
    // an empty string to turn it off.
    const guestRcicId = process.env.ARGUS_GUEST_RCIC_ID ?? 'R670922';
    if (guestRcicId) {
      for (const fn of [meHandler, profilesHandler, policyEventsHandler, impactsHandler, recordsHandler, briefsServiceHandler]) {
        fn.addEnvironment('GUEST_RCIC_ID', guestRcicId);
      }
      const guestReads = routes.filter((r) => r.path !== '/profiles/bulk' && r.path !== '/exports' && !r.path.startsWith('/demo/') && r.methods.includes(apigwv2.HttpMethod.GET));
      const guestRouteSettings: Record<string, { ThrottlingRateLimit: number; ThrottlingBurstLimit: number }> = {};
      const guestRoutes: apigwv2.HttpRoute[] = [];
      for (const route of guestReads) {
        const path = `/guest${route.path}`;
        guestRoutes.push(...this.httpApi.addRoutes({
          path,
          methods: [apigwv2.HttpMethod.GET],
          integration: new apigwv2int.HttpLambdaIntegration(`Integration-guest-${route.path.replace(/[^a-zA-Z0-9]/g, '-')}`, route.handler),
        }));
        // A public route has no login in front of it, so cap each one.
        guestRouteSettings[`GET ${path}`] = { ThrottlingRateLimit: 10, ThrottlingBurstLimit: 20 };
      }
      const stage = this.httpApi.defaultStage?.node.defaultChild as apigwv2.CfnStage | undefined;
      // Route settings name routes by key, so the stage waits for them.
      stage?.addPropertyOverride('RouteSettings', guestRouteSettings);
      for (const r of guestRoutes) stage?.node.addDependency(r);
    }

    // -----------------------------------------------------------------
    // Step Functions Express Workflow, a placeholder Pass state. The agent
    // pipeline runs on the EventBridge rules and the ImpactAssessments
    // stream above, so nothing routes through this workflow.
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
          comment: 'Placeholder. The agent pipeline runs on EventBridge',
          result: sfn.Result.fromObject({ phase: 1, status: 'placeholder' }),
        })
      ),
      logs: { destination: workflowLogs, level: sfn.LogLevel.ALL, includeExecutionData: false },
      tracingEnabled: true,
    });

    // -----------------------------------------------------------------
    // EventBridge schedules.
    // - Sentinel fires hourly to diff IRCC pages.
    // - Recall fires daily at 03:00 UTC and re-runs stored rules from the last 30 days.
    // -----------------------------------------------------------------
    new events.Rule(this, 'SentinelHourly', {
      ruleName: 'argus-sentinel-hourly',
      description: 'Trigger Sentinel Lambda to diff IRCC pages every hour',
      schedule: events.Schedule.rate(cdk.Duration.hours(1)),
      targets: [new targets.LambdaFunction(sentinelHandler)],
    });

    new events.Rule(this, 'RecallDaily', {
      ruleName: 'argus-recall-daily',
      description: 'Trigger Recall Lambda daily at 03:00 UTC to re-run stored rules from the last 30 days',
      schedule: events.Schedule.cron({ minute: '0', hour: '3' }),
      targets: [new targets.LambdaFunction(recallHandler)],
    });

    cdk.Tags.of(this).add('Project', 'Argus');
    cdk.Tags.of(this).add('Environment', 'dev');

    new cdk.CfnOutput(this, 'HttpApiUrl', { value: this.httpApi.apiEndpoint });
  }
}
