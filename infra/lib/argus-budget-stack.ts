import * as cdk from 'aws-cdk-lib';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import { Construct } from 'constructs';

// Cost alarms for the hackathon window, Sep 19 to Oct 19
// (docs/argus-design.md Section 14). Amounts are set in infra/bin/infra.ts.
//
// AWS Budgets reports this account in USD (describe-budgets and Cost
// Explorer both return Unit "USD", checked 2026-09-29), so the CAD amounts
// are converted with a pinned Bank of Canada rate. Re-run
// scripts/budget_fx.py to refresh the rate and date below.

export interface BudgetFx {
  /** Bank of Canada FXUSDCAD daily average: CAD per 1 USD. */
  readonly cadPerUsd: number;
  /** Observation date of that rate, YYYY-MM-DD. */
  readonly observedOn: string;
}

export interface ArgusBudgetStackProps extends cdk.StackProps {
  /** Operator email for the alerts. Consultant/operator PII only. */
  readonly alertEmail: string;
  /** First alarm, in CAD. */
  readonly warnCad: number;
  /** Second alarm and budget limit, in CAD. */
  readonly hardCad: number;
  /** First day of the window, YYYY-MM-DD (UTC, included). */
  readonly windowStart: string;
  /** Last day of the window, YYYY-MM-DD (UTC, included). */
  readonly windowLastDay: string;
  readonly fx: BudgetFx;
}

/**
 * Converts CAD to USD and rounds down to the cent, so the USD alarm never
 * fires later than the CAD amount it stands for.
 */
export function cadToUsd(cad: number, fx: BudgetFx): number {
  if (!(fx.cadPerUsd > 0)) throw new Error(`bad FX rate ${fx.cadPerUsd}`);
  return Math.floor((cad / fx.cadPerUsd) * 100) / 100;
}

function utcMidnightEpoch(day: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`expected YYYY-MM-DD, got ${day}`);
  const ms = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(ms)) throw new Error(`invalid date ${day}`);
  return ms / 1000;
}

export class ArgusBudgetStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ArgusBudgetStackProps) {
    super(scope, id, props);

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(props.alertEmail)) {
      throw new Error('ArgusBudgetStack needs an alert email (set ARGUS_BUDGET_EMAIL)');
    }
    if (!(props.warnCad > 0 && props.warnCad < props.hardCad)) {
      throw new Error(`warn (CA$${props.warnCad}) must be above 0 and below hard (CA$${props.hardCad})`);
    }

    const start = utcMidnightEpoch(props.windowStart);
    // Budgets excludes the end date from a custom period, so end the period
    // the day after the last day we want counted.
    const end = utcMidnightEpoch(props.windowLastDay) + 24 * 60 * 60;
    if (end <= start) throw new Error('window must end after it starts');

    const warnUsd = cadToUsd(props.warnCad, props.fx);
    const hardUsd = cadToUsd(props.hardCad, props.fx);
    const subscribers = [{ subscriptionType: 'EMAIL', address: props.alertEmail }];
    const alarmAt = (usd: number): budgets.CfnBudget.NotificationWithSubscribersProperty => ({
      notification: {
        notificationType: 'ACTUAL',
        comparisonOperator: 'GREATER_THAN',
        threshold: usd,
        thresholdType: 'ABSOLUTE_VALUE',
      },
      subscribers,
    });

    new budgets.CfnBudget(this, 'HackathonWindowBudget', {
      budget: {
        budgetName: 'Argus hackathon window',
        budgetType: 'COST',
        // A one-off period that spans the Sep/Oct month boundary. AWS deletes
        // the budget after the end date.
        timeUnit: 'CUSTOM',
        timePeriod: { start: String(start), end: String(end) },
        budgetLimit: { amount: hardUsd, unit: 'USD' },
        // Account-wide on purpose. Bedrock calls through system inference
        // profiles carry no resource tags, and Bedrock is most of the spend,
        // so a Project=Argus tag filter would miss it.
        //
        // Credits and refunds are left out so the alarm tracks gross usage.
        // Credits run out, and netting them hides how fast usage grows.
        costTypes: { includeCredit: false, includeRefund: false },
      },
      notificationsWithSubscribers: [alarmAt(warnUsd), alarmAt(hardUsd)],
    });

    new cdk.CfnOutput(this, 'WarnUsd', {
      value: String(warnUsd),
      description: `CA$${props.warnCad} at ${props.fx.cadPerUsd} CAD/USD (Bank of Canada, ${props.fx.observedOn})`,
    });
    new cdk.CfnOutput(this, 'HardUsd', {
      value: String(hardUsd),
      description: `CA$${props.hardCad} at ${props.fx.cadPerUsd} CAD/USD (Bank of Canada, ${props.fx.observedOn})`,
    });
  }
}
