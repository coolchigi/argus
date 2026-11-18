import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractMainText } from './extract.ts';

const nested = '<main><p>Send:</p><ul><li>Proof of funds<ul><li>bank letter<ul><li>signed</li></ul></li></ul></li><li>Passport</li></ul></main>';

describe('extractMainText', () => {
  it('stays flat by default, because every stored rule_hash was taken from flat text', () => {
    assert.equal(extractMainText(nested), 'Send:\n\n- Proof of funds\n\n- bank letter\n\n- signed\n\n- Passport');
  });

  it('indents nested list items when asked, and returns to the left after the list', () => {
    assert.equal(extractMainText(nested, { keepListDepth: true }), 'Send:\n\n- Proof of funds\n\n  - bank letter\n\n    - signed\n\n- Passport');
  });

  it('pulls up the text of a nested item that wraps a paragraph', () => {
    const html = '<main><ul><li>Parent<ul><li><p>wrapped</p></li></ul></li></ul></main>';
    assert.equal(extractMainText(html, { keepListDepth: true }), '- Parent\n\n  - wrapped');
  });

  it('gives the same text for both modes when nothing is nested', () => {
    const html = '<main><h2>A</h2><p>Lead:</p><ul><li>one</li><li>two</li></ul></main>';
    assert.equal(extractMainText(html, { keepListDepth: true }), extractMainText(html));
  });
});
