const assert = require('node:assert/strict');
const test = require('node:test');
const { hasSupportedTranscriptEvidence, locateTranscriptQuote, transcriptContainsQuote } = require('./transcript-review.ts');

test('requires both transcript quotes and a back-translation for meaning mismatches', () => {
  assert.equal(hasSupportedTranscriptEvidence({
    category: 'Meaning',
    sourceQuote: 'one cup',
    dubQuote: 'two cups',
    backTranslationQuote: 'two cups',
  }), true);
  assert.equal(hasSupportedTranscriptEvidence({
    category: 'Meaning',
    sourceQuote: 'one cup',
    dubQuote: 'two cups',
    backTranslationQuote: '',
  }), false);
});

test('supports one-sided quotes only for actual omissions and additions', () => {
  assert.equal(hasSupportedTranscriptEvidence({
    category: 'Omission/addition',
    sourceQuote: 'add one cup',
    dubQuote: '',
    backTranslationQuote: '',
  }), true);
  assert.equal(hasSupportedTranscriptEvidence({
    category: 'Omission/addition',
    sourceQuote: '',
    dubQuote: 'add two cups',
    backTranslationQuote: 'add two cups',
  }), true);
  assert.equal(hasSupportedTranscriptEvidence({
    category: 'Meaning',
    sourceQuote: 'source phrase',
    dubQuote: '',
    backTranslationQuote: '',
  }), false);
});

test('locates exact quoted text in the Saaras transcript and rejects invented quotes', () => {
  const segments = [
    { start: 4, end: 5, text: 'Add ONE cup of water.' },
    { start: 5, end: 7, text: 'Then stir well.' },
  ];
  assert.deepEqual(locateTranscriptQuote(segments, 'one cup of water', 0), { start: 4, end: 5 });
  assert.deepEqual(locateTranscriptQuote(segments, 'three cups of water', 0), { start: undefined, end: undefined });
  assert.equal(transcriptContainsQuote('Add one cup of water, then stir.', 'ONE cup of water'), true);
  assert.equal(transcriptContainsQuote('Add one cup of water, then stir.', 'three cups of water'), false);
  assert.equal(transcriptContainsQuote('Add one cup of water, then stir.', 'one cup'), true);
});
