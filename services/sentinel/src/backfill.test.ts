import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { planRow } from './backfill.ts';
import { extractMainText } from './extract.ts';

const oldest = '<main><p>Old rule.</p><p>Kept.</p></main>';
const middle = '<main><p>New rule.</p><p>Kept.</p></main>';
const newest = '<main><p>Newer rule.</p><p>Kept.</p></main>';
const snapshots: Record<string, string> = { v1: oldest, v2: middle, v3: newest };
const read = async (id: string) => snapshots[id];
const hashOf = (html: string) => createHash('sha256').update(extractMainText(html)).digest('hex');
const row = (versionId: string, html: string) => ({ rule_hash: hashOf(html), source_url: 'https://www.canada.ca/x', captured_at: '2026-10-16T00:00:00.000Z', source_s3_version_id: versionId });
const NEWEST_FIRST = ['v3', 'v2', 'v1'];

describe('planRow', () => {
  it('compares a row with the version before it, not the latest one', async () => {
    const plan = await planRow(row('v2', middle), NEWEST_FIRST, read);
    assert.equal(plan.status, 'ready');
    if (plan.status !== 'ready') return;
    assert.match(plan.changes.text, /New rule\./);
    assert.match(plan.changes.text, /Old rule\./);
    assert.doesNotMatch(plan.changes.text, /Newer rule/);
    assert.match(plan.changes.text, /Detected: 2026-10-16/);
    assert.equal(plan.changes.previous_hash, hashOf(oldest));
  });

  it('never overwrites changes a row already has', async () => {
    const plan = await planRow({ ...row('v2', middle), rule_changes: { text: 'x' } }, NEWEST_FIRST, read);
    assert.deepEqual(plan, { status: 'skip', reason: 'already has rule_changes' });
  });

  it('skips a row whose hash does not match its snapshot, as with an older extractor', async () => {
    const plan = await planRow({ ...row('v2', middle), rule_hash: 'not-the-hash' }, NEWEST_FIRST, read);
    assert.equal(plan.status, 'skip');
  });

  it('skips a page first seen at this version, since nothing came before it', async () => {
    const plan = await planRow(row('v1', oldest), NEWEST_FIRST, read);
    assert.deepEqual(plan, { status: 'skip', reason: 'no earlier version in S3' });
  });

  it('walks past an earlier snapshot with the same text', async () => {
    const repeated = { v4: middle, v2: middle, v1: oldest };
    const plan = await planRow(row('v4', middle), ['v4', 'v2', 'v1'], async (id) => repeated[id as keyof typeof repeated]);
    assert.equal(plan.status, 'ready');
    if (plan.status === 'ready') assert.equal(plan.changes.previous_hash, hashOf(oldest));
  });

  it('skips a change of quote style only', async () => {
    const curly = '<main><p>It won’t change</p></main>';
    const straight = "<main><p>It won't change</p></main>";
    const plan = await planRow(row('v2', straight), ['v2', 'v1'], async (id) => (id === 'v2' ? straight : curly));
    assert.deepEqual(plan, { status: 'skip', reason: 'no real change from the earlier version' });
  });
});
