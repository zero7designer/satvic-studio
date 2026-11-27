export type TranscriptReviewSegment = { start: number; end: number; text: string };

export type TranscriptFindingEvidence = {
  category?: unknown;
  sourceQuote?: unknown;
  dubQuote?: unknown;
  backTranslationQuote?: unknown;
};

function tokensForTranscript(text: string) {
  return text.normalize('NFKC').toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
}

export function transcriptContainsQuote(transcript: string, phrase: string) {
  const phraseTokens = tokensForTranscript(phrase);
  const transcriptWords = tokensForTranscript(transcript);
  return phraseTokens.length > 0 && transcriptWords.some((_, index) =>
    phraseTokens.every((token, offset) => transcriptWords[index + offset] === token),
  );
}

export function locateTranscriptQuote(segments: TranscriptReviewSegment[], phrase: string, suggestedStartIndex: unknown) {
  const phraseTokens = tokensForTranscript(phrase);
  if (!phraseTokens.length || !segments.length) return { start: undefined, end: undefined };
  const wordsWithSegment = segments.flatMap((segment, segmentIndex) =>
    tokensForTranscript(segment.text)
      .map(token => ({ token, segmentIndex })),
  );
  const matches: { first: number; last: number }[] = [];
  for (let index = 0; index <= wordsWithSegment.length - phraseTokens.length; index += 1) {
    if (phraseTokens.every((token, offset) => wordsWithSegment[index + offset].token === token)) {
      matches.push({ first: wordsWithSegment[index].segmentIndex, last: wordsWithSegment[index + phraseTokens.length - 1].segmentIndex });
    }
  }
  if (!matches.length) return { start: undefined, end: undefined };
  const preferredIndex = Number.isInteger(suggestedStartIndex) ? Number(suggestedStartIndex) : matches[0].first;
  const match = matches.reduce((closest, candidate) =>
    Math.abs(candidate.first - preferredIndex) < Math.abs(closest.first - preferredIndex) ? candidate : closest,
  );
  return { start: segments[match.first].start, end: segments[match.last].end };
}

export function hasSupportedTranscriptEvidence(finding: TranscriptFindingEvidence) {
  const sourceQuote = typeof finding.sourceQuote === 'string' && finding.sourceQuote.trim();
  const dubQuote = typeof finding.dubQuote === 'string' && finding.dubQuote.trim();
  const backTranslationQuote = typeof finding.backTranslationQuote === 'string' && finding.backTranslationQuote.trim();
  const omissionOrAddition = typeof finding.category === 'string' && /omission|addition/i.test(finding.category);

  if (sourceQuote && dubQuote) return Boolean(backTranslationQuote);
  if (!omissionOrAddition) return false;
  if (sourceQuote && !dubQuote) return !backTranslationQuote;
  if (!sourceQuote && dubQuote) return Boolean(backTranslationQuote);
  return false;
}
