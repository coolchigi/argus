import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as kms from 'aws-cdk-lib/aws-kms';
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
