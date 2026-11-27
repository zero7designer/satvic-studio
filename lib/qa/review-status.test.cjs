const assert = require('node:assert/strict');
const test = require('node:test');
const { isQaReviewComplete, qaJobProjectStatus, qaProjectStatus } = require('./review-status.ts');

test('does not treat an empty or legacy report as complete without an explicit completion flag', () => {
  assert.equal(isQaReviewComplete({ reviewComplete: false }), false);
  assert.equal(isQaReviewComplete({}), false);
  assert.equal(qaProjectStatus({ findings: [], reviewComplete: false }), 'Needs review');
  assert.equal(qaProjectStatus({ findings: [] }), 'Needs review');
});

test('marks only completed reports with no findings as ready', () => {
  assert.equal(qaProjectStatus({ findings: [], reviewComplete: true }), 'Ready');
  assert.equal(qaProjectStatus({ findings: [{}], reviewComplete: true }), 'Needs review');
});

test('keeps completed jobs with a review warning out of the ready state', () => {
  assert.equal(qaJobProjectStatus({ status: 'completed', issueCount: 0, errorMessage: 'QA review incomplete' }), 'Needs review');
  assert.equal(qaJobProjectStatus({ status: 'completed', issueCount: 0 }), 'Ready');
});
