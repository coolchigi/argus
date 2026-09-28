import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { alertSeverity, sendsRealtime } from './decide.ts';

describe('alertSeverity', () => {
  it('uses the rule severity Sentinel stored', () => {
    assert.equal(alertSeverity({ ruleSeverity: 'high', impactType: 'procedural' }), 'high');
    assert.equal(alertSeverity({ ruleSeverity: 'medium', impactType: 'deadline-shift' }), 'medium');
    assert.equal(alertSeverity({ ruleSeverity: 'low', impactType: 'procedural' }), 'low');
  });

  it('ignores the size of a CRS delta, since that would be an IRCC threshold in code', () => {
    // Shaped like a BriefReady detail, so a numericDelta is present and
    // must not move the result.
    const big = { ruleSeverity: 'medium', impactType: 'crs-delta', numericDelta: -200 };
    const small = { ruleSeverity: 'high', impactType: 'crs-delta', numericDelta: -5 };
    assert.equal(alertSeverity(big), 'medium');
    assert.equal(sendsRealtime(alertSeverity(big)), false);
    assert.equal(alertSeverity(small), 'high');
    assert.equal(sendsRealtime(alertSeverity(small)), true);
  });

  it('escalates an eligibility flip to high whatever the rule severity', () => {
    assert.equal(alertSeverity({ ruleSeverity: 'low', impactType: 'eligibility-flip' }), 'high');
    assert.equal(alertSeverity({ impactType: 'eligibility-flip' }), 'high');
  });

  it('reports unknown when the event has no usable rule severity', () => {
    assert.equal(alertSeverity({ impactType: 'crs-delta' }), 'unknown');
    assert.equal(alertSeverity({ ruleSeverity: 'HIGH', impactType: 'procedural' }), 'unknown');
    assert.equal(alertSeverity({ ruleSeverity: 3, impactType: 'procedural' }), 'unknown');
  });
});

describe('sendsRealtime', () => {
  it('emails high only by default', () => {
    assert.equal(sendsRealtime('high'), true);
    assert.equal(sendsRealtime('medium'), false);
    assert.equal(sendsRealtime('low'), false);
    assert.equal(sendsRealtime('unknown'), false);
  });

  it('honours a lower minimum', () => {
    assert.equal(sendsRealtime('medium', 'medium'), true);
    assert.equal(sendsRealtime('low', 'medium'), false);
    assert.equal(sendsRealtime('low', 'low'), true);
    assert.equal(sendsRealtime('unknown', 'low'), false);
  });
});
