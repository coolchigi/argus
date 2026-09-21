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
    const impactsHandler = placeholder('ImpactsHandler', 'impacts');
    const demoHandler = placeholder('DemoHandler', 'demo');

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
        BEDROCK_REASONER_MODEL: 'us.amazon.nova-pro-v1:0',
        SEEDED_RCIC_IDS: JSON.stringify(['demo-rcic-001']),
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
        BEDROCK_AUDITOR_MODEL: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
        NODE_OPTIONS: '--enable-source-maps',
      },
      logGroup: auditorLogGroup,
      tracing: lambda.Tracing.ACTIVE,
      bundling: { minify: true, target: 'es2022', format: nodejs.OutputFormat.ESM, sourceMap: true },
    });

    props.policyRulesTable.grantReadData(auditorHandler);

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

    const recallHandler = placeholder('RecallHandler', 'recall');
    const orchestratorHandler = placeholder('OrchestratorHandler', 'orchestrator');
    const alertsStreamHandler = placeholder('AlertsStreamHandler', 'alerts-stream');

    // -----------------------------------------------------------------
    // Grants. Every Lambda gets least-privilege via CDK grant helpers.
    // Read carefully. Do not swap for wildcard IAM policies.
    // -----------------------------------------------------------------

    // Read-only surfaces for query endpoints.
    props.clientProfilesTable.grantReadData(meHandler);
    props.clientProfilesTable.grantReadWriteData(profilesHandler);
    props.policyEventsTable.grantReadData(policyEventsHandler);
    props.impactAssessmentsTable.grantReadData(policyEventsHandler);
    props.impactAssessmentsTable.grantReadData(impactsHandler);
    props.auditTrailTable.grantReadData(impactsHandler);
    props.trainingCorrectionTable.grantReadWriteData(impactsHandler); // consultant marks impact wrong

    // Composer path uses generated-artifacts bucket for HeyGen output.
    props.generatedArtifactsBucket.grantReadWrite(impactsHandler);

    // Demo lever needs write access to seed profiles and trigger a fake policy delta.
    props.clientProfilesTable.grantReadWriteData(demoHandler);
    props.policyEventsTable.grantReadWriteData(demoHandler);

    props.policyCorpusBucket.grantReadWrite(sentinelHandler);
    props.policyCorpusBucket.grantRead(recallHandler);
    props.policyEventsTable.grantReadWriteData(recallHandler);

    // Orchestrator has the biggest surface (it fans out to all agents).
    props.clientProfilesTable.grantReadData(orchestratorHandler);
    props.policyEventsTable.grantReadData(orchestratorHandler);
    props.impactAssessmentsTable.grantReadWriteData(orchestratorHandler);
    props.auditTrailTable.grantWriteData(orchestratorHandler);
    props.trainingCorrectionTable.grantReadData(orchestratorHandler);
    props.policyCorpusBucket.grantRead(orchestratorHandler);
    props.signingKey.grantSign(orchestratorHandler); // Anchor step signs ImpactAssessments.

    // Alerts stream processor: reads from ImpactAssessments stream, writes Alerts.
    props.impactAssessmentsTable.grantStreamRead(alertsStreamHandler);
    props.alertsTable.grantWriteData(alertsStreamHandler);

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
      { path: '/impacts/{id}/brief', methods: [apigwv2.HttpMethod.POST], handler: impactsHandler },
      { path: '/impacts/{id}/audit-signature', methods: [apigwv2.HttpMethod.GET], handler: impactsHandler },
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
