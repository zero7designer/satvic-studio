const assert = require('node:assert/strict');
const test = require('node:test');
const { parseSpeakerDiarization } = require('./speaker-diarization.ts');

test('derives distinct speaker count from timestamped turns and keeps repeat labels together', () => {
  const result = parseSpeakerDiarization({
    segments: [
      { speakerId: 'Speaker 2', startSeconds: 8, endSeconds: 10, text: 'Second voice.' },
      { speakerId: 'speaker 1', startSeconds: 1, endSeconds: 3, text: 'First voice.' },
      { speakerId: 'SPEAKER_1', startSeconds: 5, endSeconds: 6, text: 'Same first voice.' },
    ],
    note: 'Two distinct voice patterns.',
  });

  assert.equal(result.speakerCount, 2);
  assert.deepEqual(result.speakers, [
    { id: 'speaker_1', firstSeenSeconds: 1, turnCount: 2 },
    { id: 'speaker_2', firstSeenSeconds: 8, turnCount: 1 },
  ]);
  assert.deepEqual(result.segments.map(segment => segment.startSeconds), [1, 5, 8]);
});

test('allows an empty diarization only when Gemini returns no speech segments', () => {
  const result = parseSpeakerDiarization({ segments: [], note: 'No speech detected.' });
  assert.equal(result.speakerCount, 0);
  assert.deepEqual(result.speakers, []);
});

test('rejects segments without usable speaker labels, timestamps, or speech text', () => {
  assert.throws(() => parseSpeakerDiarization({
    segments: [{ speakerId: '', startSeconds: 0, endSeconds: 1, text: 'Speech.' }],
  }), /invalid speaker label/i);
  assert.throws(() => parseSpeakerDiarization({
    segments: [{ speakerId: 'speaker_1', startSeconds: 2, endSeconds: 1, text: 'Speech.' }],
  }), /invalid speaker timestamps/i);
  assert.throws(() => parseSpeakerDiarization({
    segments: [{ speakerId: 'speaker_1', startSeconds: 0, endSeconds: 1, text: '  ' }],
  }), /invalid speaker timestamps/i);
});
