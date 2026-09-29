import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { ArgusBudgetStack, ArgusBudgetStackProps, cadToUsd } from './argus-budget-stack';

const base: ArgusBudgetStackProps = {
  env: { account: '123456789012', region: 'us-east-1' },
  alertEmail: 'operator@example.com',
  warnCad: 50,
  hardCad: 150,
  windowStart: '2026-09-19',
  windowLastDay: '2026-10-19',
  fx: { cadPerUsd: 1.4168, observedOn: '2026-09-28' },
};

function budgetOf(props: ArgusBudgetStackProps) {
  const stack = new ArgusBudgetStack(new cdk.App(), 'Budget', props);
  const resources = Template.fromStack(stack).findResources('AWS::Budgets::Budget');
  const all = Object.values(resources);
  assert.equal(all.length, 1);
  return all[0].Properties;
}

describe('ArgusBudgetStack', () => {
  const props = budgetOf(base);
  const notes = props.NotificationsWithSubscribers as Array<{
    Notification: { NotificationType: string; ComparisonOperator: string; Threshold: number; ThresholdType: string };
    Subscribers: Array<{ SubscriptionType: string; Address: string }>;
  }>;
  const thresholds = notes.map((n) => n.Notification.Threshold);

  it('alarms on actual spend at both CAD amounts, as absolute USD values', () => {
    assert.equal(notes.length, 2);
    for (const n of notes) {
      assert.equal(n.Notification.NotificationType, 'ACTUAL');
      assert.equal(n.Notification.ComparisonOperator, 'GREATER_THAN');
      // PERCENTAGE is the default. A USD amount read as a percentage would
      // fire at the wrong spend.
      assert.equal(n.Notification.ThresholdType, 'ABSOLUTE_VALUE');
      assert.deepEqual(n.Subscribers, [{ SubscriptionType: 'EMAIL', Address: 'operator@example.com' }]);
    }
  });

  it('never fires later than the CAD amount, and is off by under a cent', () => {
    for (const [cad, usd] of [
      [base.warnCad, thresholds[0]],
      [base.hardCad, thresholds[1]],
    ]) {
      const backToCad = usd * base.fx.cadPerUsd;
      assert.ok(backToCad <= cad, `US$${usd} is CA$${backToCad}, above CA$${cad}`);
      assert.ok((usd + 0.01) * base.fx.cadPerUsd > cad, `US$${usd} undershoots CA$${cad} by a cent or more`);
    }
  });

  it('sets the limit to the hard alarm, in USD', () => {
    assert.deepEqual(props.Budget.BudgetLimit, { Amount: thresholds[1], Unit: 'USD' });
    assert.ok(thresholds[0] < thresholds[1]);
  });

  it('covers Sep 19 through Oct 19 UTC, both days counted', () => {
    assert.equal(props.Budget.TimeUnit, 'CUSTOM');
    const start = new Date(Number(props.Budget.TimePeriod.Start) * 1000).toISOString();
    const end = new Date(Number(props.Budget.TimePeriod.End) * 1000).toISOString();
    assert.equal(start, '2026-09-19T00:00:00.000Z');
    // Budgets excludes the end date, so it has to be the day after.
    assert.equal(end, '2026-10-20T00:00:00.000Z');
  });

  it('tracks the whole account, gross of credits', () => {
    assert.equal(props.Budget.BudgetType, 'COST');
    assert.equal(props.Budget.CostFilters, undefined);
    assert.equal(props.Budget.FilterExpression, undefined);
    assert.equal(props.Budget.CostTypes.IncludeCredit, false);
    assert.equal(props.Budget.CostTypes.IncludeRefund, false);
  });

  it('refuses to synth without an alert email', () => {
    assert.throws(() => budgetOf({ ...base, alertEmail: '' }), /ARGUS_BUDGET_EMAIL/);
  });

  it('refuses a warn amount at or above the hard amount', () => {
    assert.throws(() => budgetOf({ ...base, warnCad: base.hardCad }), /must be above 0 and below/);
  });

  it('rejects a malformed window date', () => {
    assert.throws(() => budgetOf({ ...base, windowStart: '2026-9-19' }), /YYYY-MM-DD/);
  });
});

describe('cadToUsd', () => {
  it('rounds down to the cent', () => {
    // CA$2 at 3 CAD/USD is US$0.666..., which must become 0.66. Rounding to
    // the nearest cent (0.67) would fire the alarm after the CAD amount.
    assert.equal(cadToUsd(2, { cadPerUsd: 3, observedOn: 'x' }), 0.66);
  });

  it('rejects a zero or missing rate', () => {
    assert.throws(() => cadToUsd(50, { cadPerUsd: 0, observedOn: 'x' }), /bad FX rate/);
    assert.throws(() => cadToUsd(50, { cadPerUsd: Number.NaN, observedOn: 'x' }), /bad FX rate/);
  });
});
