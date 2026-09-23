import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

/**
 * Stateful resources for Argus.
 *
 * Kept in its own stack so it can carry terminationProtection in production
 * and so the API stack can be re-created without touching the data plane.
 *
 * Read `docs/adr/` for the decision record backing each construct choice.
 */
export class ArgusStatefulStack extends cdk.Stack {
  public readonly signingKey: kms.Key;
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;

  public readonly rcicUsersTable: dynamodb.Table;
  public readonly clientProfilesTable: dynamodb.Table;
  public readonly policyEventsTable: dynamodb.Table;
  public readonly impactAssessmentsTable: dynamodb.Table;
  public readonly alertsTable: dynamodb.Table;
  public readonly auditTrailTable: dynamodb.Table;
  public readonly trainingCorrectionTable: dynamodb.Table;
  public readonly policyRulesTable: dynamodb.Table;
  public readonly ruleIndexTable: dynamodb.Table;
  public readonly briefsTable: dynamodb.Table;

  public readonly policyCorpusBucket: s3.Bucket;
  public readonly generatedArtifactsBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // KMS ECDSA P-256 key for signing ImpactAssessment hashes.
    // Public verification via a JWKS endpoint served from a Lambda in Phase 4.
    this.signingKey = new kms.Key(this, 'SigningKey', {
      alias: 'alias/argus-impact-signing',
      description: 'ECDSA P-256 key for signing Argus ImpactAssessment hashes',
      keySpec: kms.KeySpec.ECC_NIST_P256,
      keyUsage: kms.KeyUsage.SIGN_VERIFY,
      enableKeyRotation: false, // Key rotation is not supported for asymmetric keys.
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Cognito user pool for RCICs.
    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: 'argus-rcic-pool',
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: false },
        givenName: { required: true, mutable: true },
        familyName: { required: true, mutable: true },
      },
      customAttributes: {
        // R-license number issued by the College of Immigration and Citizenship Consultants (CICC).
        rcic_license: new cognito.StringAttribute({ minLen: 7, maxLen: 8, mutable: false }),
        // Internal Argus rcicId (partition key across every table). Usually equals
        // the R-license for real users. Split out here because the demo user's
        // rcicId "demo-rcic-001" does not fit the 7-8 char R-license shape, and
        // Cognito custom attribute constraints cannot be modified after create.
        rcic_id: new cognito.StringAttribute({ minLen: 3, maxLen: 40, mutable: true }),
      },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: { sms: false, otp: true },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.userPoolClient = this.userPool.addClient('WebClient', {
      userPoolClientName: 'argus-web-client',
      authFlows: { userSrp: true },
      preventUserExistenceErrors: true,
      accessTokenValidity: cdk.Duration.hours(8),
      idTokenValidity: cdk.Duration.hours(8),
      refreshTokenValidity: cdk.Duration.days(30),
    });

    // DynamoDB tables, all PAY_PER_REQUEST for MVP.
    // GSIs added where the design doc's read patterns need them.
    this.rcicUsersTable = new dynamodb.Table(this, 'RcicUsersTable', {
      tableName: 'argus-rcic-users',
      partitionKey: { name: 'rcicId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.clientProfilesTable = new dynamodb.Table(this, 'ClientProfilesTable', {
      tableName: 'argus-client-profiles',
      partitionKey: { name: 'rcicId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'clientId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    this.clientProfilesTable.addGlobalSecondaryIndex({
      indexName: 'byNocCode',
      partitionKey: { name: 'nocCode', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'rcicId', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    this.clientProfilesTable.addGlobalSecondaryIndex({
      indexName: 'byProgramIntent',
      partitionKey: { name: 'programIntent', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'rcicId', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    this.policyEventsTable = new dynamodb.Table(this, 'PolicyEventsTable', {
      tableName: 'argus-policy-events',
      partitionKey: { name: 'policyDomain', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'eventKey', type: dynamodb.AttributeType.STRING }, // `${timestamp}#${eventId}`
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.impactAssessmentsTable = new dynamodb.Table(this, 'ImpactAssessmentsTable', {
      tableName: 'argus-impact-assessments',
      partitionKey: { name: 'rcicId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'assessmentKey', type: dynamodb.AttributeType.STRING }, // `${policyEventId}#${clientId}`
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES, // Feeds the alerting Lambda.
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    // GSI for the public /verify/[hash] page. Look up a signed assessment by
    // its canonical hash so anyone with the fingerprint can retrieve the
    // signature material (no client-identifying data is returned by the
    // public route).
    this.impactAssessmentsTable.addGlobalSecondaryIndex({
      indexName: 'byCanonicalHash',
      partitionKey: { name: 'canonicalHash', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.KEYS_ONLY,
    });

    this.alertsTable = new dynamodb.Table(this, 'AlertsTable', {
      tableName: 'argus-alerts',
      partitionKey: { name: 'rcicId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.auditTrailTable = new dynamodb.Table(this, 'AuditTrailTable', {
      tableName: 'argus-audit-trail',
      partitionKey: { name: 'assessmentId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'stepTimestamp', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Consultant corrections stream in as few-shot examples for the Auditor.
    // ASET self-growing pattern, adapted.
    this.trainingCorrectionTable = new dynamodb.Table(this, 'TrainingCorrectionTable', {
      tableName: 'argus-training-corrections',
      partitionKey: { name: 'rcicId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'correctionKey', type: dynamodb.AttributeType.STRING }, // `${assessmentId}#${timestamp}`
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Content-addressed IRCC rule versions (ADR-0001). Immutable once written.
    this.policyRulesTable = new dynamodb.Table(this, 'PolicyRulesTable', {
      tableName: 'argus-policy-rules',
      partitionKey: { name: 'rule_hash', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // "Which rule version was active on date X for topic Y" resolver (ADR-0001).
    this.ruleIndexTable = new dynamodb.Table(this, 'RuleIndexTable', {
      tableName: 'argus-rule-index',
      partitionKey: { name: 'topic', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'effective_from', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Composer output. One brief per (assessmentKey, rcicId). GSI lets the API
    // find a brief by its ImpactAssessment. Stream feeds the Alerts dispatcher.
    this.briefsTable = new dynamodb.Table(this, 'BriefsTable', {
      tableName: 'argus-briefs',
      partitionKey: { name: 'rcicId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'briefId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    this.briefsTable.addGlobalSecondaryIndex({
      indexName: 'byAssessment',
      partitionKey: { name: 'assessmentKey', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'rcicId', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Policy corpus. Snapshots of IRCC pages plus embedding-source markdown.
    this.policyCorpusBucket = new s3.Bucket(this, 'PolicyCorpusBucket', {
      bucketName: `argus-policy-corpus-${cdk.Aws.ACCOUNT_ID}`,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          id: 'transition-to-ia-after-90-days',
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(90),
            },
          ],
        },
      ],
    });

    // Generated artifacts: HeyGen video URLs, generated PDFs, temporary rendered content.
    this.generatedArtifactsBucket = new s3.Bucket(this, 'GeneratedArtifactsBucket', {
      bucketName: `argus-generated-artifacts-${cdk.Aws.ACCOUNT_ID}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          id: 'expire-after-30-days',
          expiration: cdk.Duration.days(30),
        },
      ],
    });

    // Cognito PostConfirmation trigger. Provisions the RcicUsers row after
    // signup email verification and writes rcic_id back onto the Cognito
    // user so every subsequent JWT carries the claim. Lives in this stack
    // (not the api stack) to avoid a cyclic dependency: the trigger attaches
    // to userPool, which api-stack imports; hosting the Lambda here keeps
    // stateful -> api one-directional.
    const userProvisioningLogGroup = new logs.LogGroup(this, 'UserProvisioningHandlerLogs', {
      logGroupName: '/aws/lambda/argus-user-provisioning',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const userProvisioningHandler = new nodejs.NodejsFunction(this, 'UserProvisioningHandler', {
      functionName: 'argus-user-provisioning',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      projectRoot: path.join(__dirname, '../..'),
      depsLockFilePath: path.join(__dirname, '../../services/user-provisioning/package-lock.json'),
      entry: path.join(__dirname, '../../services/user-provisioning/src/handler.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      environment: {
        RCIC_USERS_TABLE: this.rcicUsersTable.tableName,
        NODE_OPTIONS: '--enable-source-maps',
      },
      logGroup: userProvisioningLogGroup,
      tracing: lambda.Tracing.ACTIVE,
      bundling: { minify: true, target: 'es2022', format: nodejs.OutputFormat.ESM, sourceMap: true },
    });

    this.rcicUsersTable.grantWriteData(userProvisioningHandler);
    // Wildcard resource (not `this.userPool.userPoolArn`) because referencing
    // the UserPool ARN here creates a UserPool -> Lambda -> Role -> Policy ->
    // UserPool cycle at CFN validation time. The Lambda is invoked only by
    // Cognito post-confirmation, and event.userPoolId is the only pool it
    // ever touches, so scoping to a specific pool ARN adds no security.
    userProvisioningHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cognito-idp:AdminUpdateUserAttributes'],
        resources: [`arn:aws:cognito-idp:${this.region}:${this.account}:userpool/*`],
      }),
    );

    this.userPool.addTrigger(cognito.UserPoolOperation.POST_CONFIRMATION, userProvisioningHandler);

    // Tag everything for cost attribution. Bedrock cost tracking uses a
    // separate inference-profile tagging path (see docs/argus-design.md).
    cdk.Tags.of(this).add('Project', 'Argus');
    cdk.Tags.of(this).add('Environment', 'dev');

    // Outputs so the API stack (and humans) can find these.
    new cdk.CfnOutput(this, 'UserPoolId', { value: this.userPool.userPoolId });
    new cdk.CfnOutput(this, 'UserPoolClientId', { value: this.userPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, 'SigningKeyArn', { value: this.signingKey.keyArn });
    new cdk.CfnOutput(this, 'PolicyCorpusBucketName', { value: this.policyCorpusBucket.bucketName });
  }
}
