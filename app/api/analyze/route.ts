import { NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { del as deleteBlob, get as getBlob } from '@vercel/blob';
import { updateAnalysisProgress } from './progress-store';
import { put } from '@vercel/blob';
import { createClient } from '../../../lib/supabase/server';
import { createAdminClient } from '../../../lib/supabase/admin';
import { sendGmailJobEmail } from '../../../lib/email/gmail';
import { appUrl } from '../../../lib/app-url';

export const runtime = 'nodejs';
export const maxDuration = 300;

const SARVAM = 'https://api.sarvam.ai';
const LANGUAGES: Record<string, { sarvam: string }> = {
  English: { sarvam: 'en-IN' }, Hindi: { sarvam: 'hi-IN' },
  Tamil: { sarvam: 'ta-IN' }, Telugu: { sarvam: 'te-IN' },
  Gujarati: { sarvam: 'gu-IN' }, Kannada: { sarvam: 'kn-IN' },
  Bengali: { sarvam: 'bn-IN' }, Marathi: { sarvam: 'mr-IN' },
  Punjabi: { sarvam: 'pa-IN' }, Malayalam: { sarvam: 'ml-IN' },
  Odia: { sarvam: 'od-IN' }, Assamese: { sarvam: 'as-IN' },
  Urdu: { sarvam: 'ur-IN' }, Sanskrit: { sarvam: 'sa-IN' },
  Nepali: { sarvam: 'ne-IN' },
};
const TARGET_LANGUAGE_REVIEW_NOTES: Record<string, string> = {
  Punjabi: 'Punjabi reference note: A Start in Punjabi (Academy of the Punjab in North America), lesson 15, teaches rīn/rinn as “cook” and rīdda as “cooked,” including the example of cooked dal. Do not interpret a Punjabi cooking form applied to dal as rajma or an added ingredient without clear evidence in the actual phrase.',
};
function targetLanguageReviewNote(language: string) {
  return TARGET_LANGUAGE_REVIEW_NOTES[language] || `Respect dialects and regional forms in ${language}. Do not call an unfamiliar inflection or synonym a changed ingredient unless the quoted dub wording clearly names a different food.`;
}

type Segment = { start: number; end: number; text: string; words?: { start: number; end: number; text: string }[] };
type Transcript = { transcript: string; segments: Segment[]; detectedLanguage: string; engine: string };
type CompactAudio = { data: string; mime_type: string; durationSeconds?: number };
type AudioFinding = { severity: 'critical' | 'review' | 'info'; title: string; detail: string; category?: string; sourceStart?: number; sourceEnd?: number; dubStart?: number; dubEnd?: number; sourceStartSegment?: number; sourceEndSegment?: number; dubStartSegment?: number; dubEndSegment?: number; evidenceStatus?: 'cross-checked' | 'audio-only' | 'transcript-only' | 'visual-only'; sourceQuote?: string; dubQuote?: string; backTranslationQuote?: string };
type TranscriptReviewChunk = { id: string; sourceText: string; dubText: string; backTranslationText: string };
type QaCheckpoint = {
  kind?: 'qa-checkpoint';
  originalResult?: Transcript;
  dubbedResult?: Transcript;
  originalTranscriptionJobId?: string;
  dubbedTranscriptionJobId?: string;
  audioReviewChunks?: Record<string, AudioFinding[]>;
  videoReviewFindings?: AudioFinding[];
  videoReviewComplete?: boolean;
  videoReviewVersion?: number;
  dubbedScriptResult?: Transcript;
  dubbedAudioResult?: Transcript;
  audioReviewChunkCount?: number;
  audioReviewModels?: string[];
  backTranslation?: string;
  sourceAudio?: CompactAudio;
  dubAudio?: CompactAudio;
  textFindings?: AudioFinding[];
  textReviewChunks?: Record<string, AudioFinding[]>;
  textBackTranslations?: Record<string, string>;
  textReviewChunkCount?: number;
  transcriptReviewModels?: string[];
  transcriptComparisonVersion?: number;
  audioReviewPromptVersion?: number;
  audioFindings?: AudioFinding[];
  textReviewComplete?: boolean;
  textReviewAttempted?: boolean;
  audioReviewComplete?: boolean;
  transcriptCrossCheckError?: string | null;
};
type Json = Record<string, any>;
const transcriptFindingsSchema = {
  type: 'object',
  properties: {
    backTranslation: { type: 'string' },
    findings: { type: 'array', items: { type: 'object', properties: {
    severity: { type: 'string', enum: ['critical', 'review', 'info'] }, category: { type: 'string' },
    title: { type: 'string' }, detail: { type: 'string' }, sourceQuote: { type: 'string' }, dubQuote: { type: 'string' }, backTranslationQuote: { type: 'string' },
    sourceStartSegment: { type: ['integer', 'null'] }, sourceEndSegment: { type: ['integer', 'null'] },
    dubStartSegment: { type: ['integer', 'null'] }, dubEndSegment: { type: ['integer', 'null'] },
  }, required: ['severity', 'category', 'title', 'detail', 'sourceQuote', 'dubQuote', 'backTranslationQuote'] } } },
  required: ['backTranslation', 'findings'],
};
const audioFindingsSchema = {
  type: 'object',
  properties: { findings: { type: 'array', items: { type: 'object', properties: {
    severity: { type: 'string', enum: ['critical', 'review', 'info'] }, category: { type: 'string' },
    title: { type: 'string' }, detail: { type: 'string' }, sourceQuote: { type: 'string' }, dubQuote: { type: 'string' },
    sourceStart: { type: ['number', 'null'] }, sourceEnd: { type: ['number', 'null'] },
    dubStart: { type: ['number', 'null'] }, dubEnd: { type: ['number', 'null'] },
    sourceStartSegment: { type: ['integer', 'null'] }, sourceEndSegment: { type: ['integer', 'null'] },
    dubStartSegment: { type: ['integer', 'null'] }, dubEndSegment: { type: ['integer', 'null'] },
  }, required: ['severity', 'category', 'title', 'detail', 'sourceQuote', 'dubQuote', 'sourceStart', 'sourceEnd', 'dubStart', 'dubEnd', 'sourceStartSegment', 'sourceEndSegment', 'dubStartSegment', 'dubEndSegment'] } } },
  required: ['findings'],
};

function sarvamSegments(data: Json): Segment[] {
  const timestamps = data.timestamps;
  if (timestamps && typeof timestamps === 'object') {
    const labels: unknown[] = Array.isArray(timestamps.chunks) ? timestamps.chunks
      : Array.isArray(timestamps.words) ? timestamps.words
        : Array.isArray(timestamps.segments) ? timestamps.segments : [];
    const starts: unknown[] = timestamps.start_time_seconds || timestamps.startTimeSeconds || timestamps.starts || [];
    const ends: unknown[] = timestamps.end_time_seconds || timestamps.endTimeSeconds || timestamps.ends || [];
    const parsed = labels.map((entry, index) => {
      const item = entry && typeof entry === 'object' ? entry as Json : {};
      const text = typeof entry === 'string' ? entry : String(item.text ?? item.transcript ?? item.word ?? '');
      const start = Number(item.start ?? item.start_time_seconds ?? starts[index]);
      const end = Number(item.end ?? item.end_time_seconds ?? ends[index]);
      return { start, end, text: text.trim() };
    }).filter(segment => segment.text && Number.isFinite(segment.start) && Number.isFinite(segment.end) && segment.end >= segment.start);
    if (parsed.length) return parsed;
  }
  const segments = Array.isArray(data.segments) ? data.segments : data.diarized_transcript?.entries;
  if (!Array.isArray(segments)) return [];
  return segments.map((item: Json) => ({
    start: Number(item.start ?? item.start_time_seconds),
    end: Number(item.end ?? item.end_time_seconds),
    text: String(item.text ?? item.transcript ?? '').trim(),
  })).filter((segment: Segment) => segment.text && Number.isFinite(segment.start) && Number.isFinite(segment.end) && segment.end >= segment.start);
}

function providerError(value: unknown): string {
  if (typeof value === 'string') return value.trim() || 'No provider error detail was returned.';
  if (value instanceof Error) return value.message;
  if (!value || typeof value !== 'object') return 'Unrecognized provider error response.';

  const item = value as Json;
  const candidates = [
    item.message,
    item.detail,
    item.error_description,
    item.error?.message,
    item.error?.detail,
    item.error,
    item.error_message,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    if (candidate && typeof candidate === 'object') {
      const nested = providerError(candidate);
      if (nested && nested !== 'Unrecognized provider error response.') return nested;
    }
  }

  try {
    const serialized = JSON.stringify(item);
    if (serialized && serialized !== '{}') return serialized;
  } catch { /* use fallback below */ }
  return 'Unrecognized provider error response.';
}

async function readBlobStream(stream: ReadableStream<Uint8Array> | null): Promise<ArrayBuffer> {
  if (!stream) throw new Error('Vercel Blob returned no readable media stream.');
  if (stream.locked) throw new Error('Vercel Blob media stream is already locked. The blob must be fetched once and read before any other operation.');
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value?.byteLength) {
        chunks.push(value);
        length += value.byteLength;
      }
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer.slice(0) as ArrayBuffer;
}

function interactionOutputText(payload: Json): string {
  if (typeof payload.output_text === 'string' && payload.output_text.trim()) return payload.output_text;
  return payload.steps?.flatMap((step: Json) => step.content || [])
    .filter((item: Json) => item.type === 'text')
    .map((item: Json) => item.text || '')
    .join('') || '';
}

async function extractAudioForSarvam(file: File): Promise<File> {
  const extension = path.extname(file.name).toLowerCase();
  const isVideo = file.type.startsWith('video/') || ['.mp4', '.mov', '.mkv', '.avi', '.webm', '.m4v'].includes(extension);
  if (!isVideo) return file;
  const ffmpegBinary = ffmpegPath;
  if (!ffmpegBinary) throw new Error('The bundled FFmpeg executable is unavailable. Reinstall project dependencies and try again.');

  const directory = await mkdtemp(path.join(os.tmpdir(), 'satvic-dub-qa-'));
  const inputPath = path.join(directory, `input${extension || '.mp4'}`);
  const outputPath = path.join(directory, 'audio.mp3');
  try {
    await writeFile(inputPath, Buffer.from(await file.arrayBuffer()));
    await new Promise<void>((resolve, reject) => {
      const child = spawn(ffmpegBinary, [
        '-nostdin', '-y', '-i', inputPath, '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k', '-f', 'mp3', outputPath,
      ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
      let diagnostic = '';
      child.stderr?.on('data', chunk => { diagnostic = `${diagnostic}${chunk}`.slice(-2500); });
      child.once('error', reject);
      child.once('close', code => code === 0 ? resolve() : reject(new Error(code === 1 && /Stream map .* matches no streams|matches no streams/i.test(diagnostic) ? 'This video has no audio track.' : `Could not extract video audio. ${diagnostic.trim().split('\n').slice(-3).join(' ')}`)));
    });
    const audio = await readFile(outputPath);
    if (!audio.length) throw new Error('Audio extraction created an empty file.');
    return new File([audio], `${path.basename(file.name, extension)}.mp3`, { type: 'audio/mpeg' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function extractCompactAudio(file: File): Promise<CompactAudio> {
  const extension = path.extname(file.name).toLowerCase() || '.mp4';
  const directory = await mkdtemp(path.join(os.tmpdir(), 'satvic-audio-review-'));
  const inputPath = path.join(directory, `input${extension}`);
  const outputPath = path.join(directory, 'review.mp3');
  try {
    await writeFile(inputPath, Buffer.from(await file.arrayBuffer()));
    let inputDurationSeconds: number | undefined;
    await new Promise<void>((resolve, reject) => {
      const child = spawn(ffmpegPath!, ['-nostdin', '-y', '-i', inputPath, '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '24000', '-b:a', '48k', '-f', 'mp3', outputPath], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
      let diagnostic = '';
      child.stderr?.on('data', chunk => {
        diagnostic = `${diagnostic}${chunk}`.slice(-1800);
        const durationMatch = diagnostic.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i);
        if (durationMatch) inputDurationSeconds = Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3]);
      });
      child.once('error', reject);
      child.once('close', code => code === 0 ? resolve() : reject(new Error(`Could not prepare audio for AI listening. ${diagnostic.trim().split('\n').slice(-2).join(' ')}`)));
    });
    const audio = await readFile(outputPath);
    return { data: audio.toString('base64'), mime_type: 'audio/mp3', ...(inputDurationSeconds && Number.isFinite(inputDurationSeconds) ? { durationSeconds: inputDurationSeconds } : {}) };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function isVideoMedia(file: File) {
  const extension = path.extname(file.name).toLowerCase();
  return file.type.startsWith('video/') || ['.mp4', '.mov', '.mkv', '.avi', '.webm', '.m4v'].includes(extension);
}

async function scanDubVideo(file: File): Promise<AudioFinding[]> {
  if (!isVideoMedia(file)) return [];
  if (!ffmpegPath) throw new Error('The bundled FFmpeg executable is unavailable for the video check.');
  const directory = await mkdtemp(path.join(os.tmpdir(), 'satvic-video-check-'));
  const extension = path.extname(file.name).toLowerCase() || '.mp4';
  const inputPath = path.join(directory, `dub${extension}`);
  const findings: AudioFinding[] = [];
  let freezeStart: number | undefined;
  let blackStart: number | undefined;
  let pending = '';
  try {
    await writeFile(inputPath, Buffer.from(await file.arrayBuffer()));
    await new Promise<void>((resolve, reject) => {
      const child = spawn(ffmpegPath!, [
        '-hide_banner', '-nostdin', '-i', inputPath,
        '-vf', 'fps=2,freezedetect=n=-60dB:d=5,blackdetect=d=1.5:pix_th=0.10',
        '-an', '-f', 'null', '-',
      ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
      let diagnostic = '';
      const parseLine = (line: string) => {
        diagnostic = `${diagnostic}${line}\n`.slice(-2500);
        const freezeMatch = line.match(/freeze_start:\s*(-?\d+(?:\.\d+)?)/);
        if (freezeMatch) freezeStart = Number(freezeMatch[1]);
        const freezeDuration = line.match(/freeze_duration:\s*(\d+(?:\.\d+)?)/);
        if (freezeDuration && freezeStart !== undefined) {
          const duration = Number(freezeDuration[1]);
          if (duration >= 5) findings.push({
            severity: 'review', title: 'Possible frozen section in dubbed video', category: 'Video freeze',
            detail: `Dubbed video frames changed very little for ${duration.toFixed(1)} seconds (${formatClock(freezeStart)}–${formatClock(freezeStart + duration)}). This may be a freeze or an intentionally still shot; check this section.`,
            dubStart: freezeStart, dubEnd: freezeStart + duration, evidenceStatus: 'visual-only',
          });
          freezeStart = undefined;
        }
        const blackMatch = line.match(/black_start:\s*(-?\d+(?:\.\d+)?)/);
        if (blackMatch) blackStart = Number(blackMatch[1]);
        const blackEnd = line.match(/black_end:\s*(-?\d+(?:\.\d+)?)/);
        const blackDuration = line.match(/black_duration:\s*(\d+(?:\.\d+)?)/);
        if (blackEnd && blackDuration && blackStart !== undefined) {
          const end = Number(blackEnd[1]);
          const duration = Number(blackDuration[1]);
          if (duration >= 1.5) findings.push({
            severity: 'review', title: 'Possible black screen in dubbed video', category: 'Black screen',
            detail: `Dubbed video appears black for ${duration.toFixed(1)} seconds (${formatClock(blackStart)}–${formatClock(end)}). Check whether this is intentional.`,
            dubStart: blackStart, dubEnd: end, evidenceStatus: 'visual-only',
          });
          blackStart = undefined;
        }
      };
      child.stderr?.on('data', chunk => {
        pending += String(chunk);
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() || '';
        lines.forEach(parseLine);
      });
      child.once('error', reject);
      child.once('close', code => {
        if (pending) parseLine(pending);
        code === 0 ? resolve() : reject(new Error(`Could not scan the dubbed video. ${diagnostic.trim().split('\n').slice(-2).join(' ')}`));
      });
    });
    return findings.slice(0, 50);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function formatClock(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

async function sliceCompactAudio(audio: CompactAudio, startSeconds: number, durationSeconds: number) {
  if (!ffmpegPath) throw new Error('The bundled FFmpeg executable is unavailable for audio review.');
  const directory = await mkdtemp(path.join(os.tmpdir(), 'satvic-audio-chunk-'));
  const inputPath = path.join(directory, 'input.mp3');
  const outputPath = path.join(directory, 'chunk.mp3');
  try {
    await writeFile(inputPath, Buffer.from(audio.data, 'base64'));
    const createSilence = async () => {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(ffmpegPath!, ['-nostdin', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', String(durationSeconds), '-ac', '1', '-ar', '24000', '-b:a', '48k', '-f', 'mp3', outputPath], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
        let diagnostic = '';
        child.stderr?.on('data', chunk => { diagnostic = `${diagnostic}${chunk}`.slice(-1200); });
        child.once('error', reject);
        child.once('close', code => code === 0 ? resolve() : reject(new Error(`Could not create a silent audio segment. ${diagnostic.trim().split('\n').slice(-2).join(' ')}`)));
      });
      return readFile(outputPath);
    };
    if (audio.durationSeconds !== undefined && startSeconds >= audio.durationSeconds) {
      const silence = await createSilence();
      return { data: silence.toString('base64'), mime_type: 'audio/mp3' };
    }
    await new Promise<void>((resolve, reject) => {
      const child = spawn(ffmpegPath!, ['-nostdin', '-y', '-ss', String(startSeconds), '-i', inputPath, '-t', String(durationSeconds), '-map', '0:a:0', '-vn', '-af', 'apad', '-ac', '1', '-ar', '24000', '-b:a', '48k', '-f', 'mp3', outputPath], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
      let diagnostic = '';
      child.stderr?.on('data', chunk => { diagnostic = `${diagnostic}${chunk}`.slice(-1200); });
      child.once('error', reject);
      child.once('close', code => code === 0 ? resolve() : reject(new Error(`Could not prepare an audio review segment. ${diagnostic.trim().split('\n').slice(-2).join(' ')}`)));
    });
    const bytes = await readFile(outputPath);
    if (!bytes.length) {
      const silence = await createSilence();
      if (!silence.length) return null;
      return { data: silence.toString('base64'), mime_type: 'audio/mp3' };
    }
    return { data: bytes.toString('base64'), mime_type: 'audio/mp3' };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function transcribeWithSarvam(
  file: File,
  languageCode: string,
  key: string,
  resumeJobId?: string,
  onJobStarted?: (jobId: string) => Promise<void>,
  onJobFailed?: () => Promise<void>,
): Promise<Transcript> {
  let jobId = resumeJobId || '';
  if (!jobId) {
    const audioFile = await extractAudioForSarvam(file);
    const fileName = audioFile.name.replace(/[^\w.-]/g, '_').slice(-100) || 'media.mp3';
    const job = await sarvamJson('/speech-to-text/job/v1', key, { job_parameters: { model: 'saaras:v4', mode: 'transcribe', language_code: languageCode, with_timestamps: true } });
    if (!job.job_id) throw new Error('Sarvam did not return a transcription job ID.');
    jobId = String(job.job_id);
    const linkResponse = await sarvamJson('/speech-to-text/job/v1/upload-files', key, { job_id: jobId, files: [fileName] });
    const uploadUrl = linkResponse.upload_urls?.[fileName]?.file_url || linkResponse.upload_urls?.[fileName]?.url;
    if (!uploadUrl) throw new Error('Sarvam did not return a media upload URL.');
    const uploaded = await fetch(uploadUrl, { method: 'PUT', body: new Uint8Array(await audioFile.arrayBuffer()), headers: { 'content-type': audioFile.type || 'audio/mpeg', 'x-ms-blob-type': 'BlockBlob' } });
    if (!uploaded.ok) throw new Error(`Sarvam media upload failed (${uploaded.status}).`);
    await sarvamJson(`/speech-to-text/job/v1/${encodeURIComponent(jobId)}/start`, key, {});
    await onJobStarted?.(jobId);
  }
  // Leave time for Vercel to save a resumable checkpoint before its 300s limit.
  const deadline = Date.now() + 210_000;
  let status: Json = {};
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 5000));
    const response = await fetch(`${SARVAM}/speech-to-text/job/v1/${encodeURIComponent(jobId)}/status`, { headers: { 'api-subscription-key': key }, cache: 'no-store', signal: AbortSignal.timeout(15_000) });
    status = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Sarvam status check returned ${response.status}: ${providerError(status)}`);
    if (status.job_state === 'Completed' || status.job_state === 'PartiallyCompleted') break;
    if (status.job_state === 'Failed') {
      await onJobFailed?.();
      const detail = providerError(status.error_message ?? status);
      throw new Error(`Sarvam transcription job ${jobId} failed (job_state=Failed). Exact provider error: ${detail}`);
    }
  }
  if (!['Completed', 'PartiallyCompleted'].includes(status.job_state)) {
    const providerState = typeof status.job_state === 'string' && status.job_state.trim()
      ? status.job_state.trim()
      : 'unknown';
    throw new Error(`Sarvam transcription job ${jobId} is still processing (job_state=${providerState}). Its job ID is saved; QA will resume polling the same job without creating another transcription.`);
  }
  const outputNames = (status.job_details || []).flatMap((detail: Json) => detail.outputs || []).map((output: Json) => output.file_name).filter(Boolean);
  if (!outputNames.length) throw new Error('Sarvam completed without returning a transcript file.');
  const downloadInfo = await sarvamJson('/speech-to-text/job/v1/download-files', key, { job_id: jobId, files: outputNames });
  const resultUrl = downloadInfo.download_urls?.[outputNames[0]]?.file_url || downloadInfo.download_urls?.[outputNames[0]]?.url;
  if (!resultUrl) throw new Error('Sarvam did not return a transcript download link.');
  const resultResponse = await fetch(resultUrl, { cache: 'no-store' });
  if (!resultResponse.ok) throw new Error('Could not download the Sarvam transcript result.');
  const data = await resultResponse.json();
  const transcript = typeof data.transcript === 'string' ? data.transcript : '';
  if (!transcript.trim()) throw new Error('Sarvam returned an empty transcript. Check that the selected media has clear speech.');
  const segments = sarvamSegments(data);
  return { transcript, segments, detectedLanguage: data.language_code || languageCode, engine: 'Sarvam Saaras v4' };
}

function parseSarvamSrt(srt: string, language: string): Transcript | null {
  const time = (value: string) => {
    const match = value.trim().match(/^(\d{2,}):(\d{2}):(\d{2})[,.](\d{3})$/);
    return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000 : NaN;
  };
  const segments: Segment[] = [];
  for (const block of srt.replace(/^\uFEFF/, '').split(/\r?\n\s*\r?\n/)) {
    const lines = block.trim().split(/\r?\n/);
    const timingIndex = lines.findIndex(line => line.includes('-->'));
    if (timingIndex < 0) continue;
    const [startText, endText] = lines[timingIndex].split('-->').map(value => value.trim().split(/\s+/)[0]);
    const start = time(startText || '');
    const end = time(endText || '');
    const text = lines.slice(timingIndex + 1).join(' ').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim();
    if (text && Number.isFinite(start) && Number.isFinite(end) && end >= start) segments.push({ start, end, text });
  }
  if (!segments.length) return null;
  return { transcript: segments.map(segment => segment.text).join(' '), segments, detectedLanguage: language, engine: 'Sarvam dubbing SRT export' };
}

async function sarvamJson(path: string, key: string, body: Json): Promise<Json> {
  const response = await fetch(`${SARVAM}${path}`, {
    method: 'POST',
    headers: { 'api-subscription-key': key, 'content-type': 'application/json' },
    body: JSON.stringify(body), cache: 'no-store',
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Sarvam ${path} returned ${response.status}: ${providerError(result)}`);
  return result;
}

async function geminiRequest(body: Json, key: string, timeoutMs: number) {
  const primaryModel = String(body.model || process.env.GEMINI_MODEL || 'gemini-3.8-flash');
  const models = [...new Set([primaryModel, process.env.GEMINI_FALLBACK_MODEL?.trim() || 'gemini-3.5-flash-lite'])];
  let lastError: unknown;
  for (const model of models) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
          method: 'POST', headers: { 'x-goog-api-key': key, 'content-type': 'application/json' }, cache: 'no-store',
          body: JSON.stringify({ ...body, model }), signal: AbortSignal.timeout(timeoutMs),
        });
        if ([429, 500, 502, 503, 504].includes(response.status) && attempt < 2) {
          const retryAfter = Number(response.headers.get('retry-after'));
          const pauseMs = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(10_000, retryAfter * 1000) : 1500 * (attempt + 1);
          await response.body?.cancel();
          await new Promise(resolve => setTimeout(resolve, pauseMs));
          continue;
        }
        if ([403, 404, 429, 500, 502, 503, 504].includes(response.status) && model !== models[models.length - 1]) {
          await response.body?.cancel();
          break;
        }
        const headers = new Headers(response.headers);
        headers.set('x-satvic-gemini-model', model);
        return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
      } catch (error) {
        lastError = error;
        const named = error as Error & { cause?: Error & { code?: string } };
        const cause = named.cause;
        const detail = [cause?.code, cause?.message || named.message].filter(Boolean).join(': ');
        if (named.name === 'TimeoutError' || attempt === 2) {
          throw new Error(`Could not reach Gemini model ${model} after ${attempt + 1} attempt(s): ${detail || 'network request failed'}`);
        }
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Could not reach Gemini.');
}

function phrasesSupportSameFinding(audio: AudioFinding, text: AudioFinding) {
  if (audio.sourceStart !== undefined && text.sourceStart !== undefined && Math.abs(audio.sourceStart - text.sourceStart) > 30) return false;
  if (audio.dubStart !== undefined && text.dubStart !== undefined && Math.abs(audio.dubStart - text.dubStart) > 30) return false;
  const audioCategory = (audio.category || '').toLowerCase().split('/')[0];
  const textCategory = (text.category || '').toLowerCase().split('/')[0];
  if (audioCategory && textCategory && audioCategory !== textCategory && !(audioCategory.includes('number') && textCategory.includes('number'))) return false;
  const overlap = (left: string, right: string) => {
    const a = new Set(left.toLocaleLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || []);
    const b = new Set(right.toLocaleLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || []);
    if (!a.size || !b.size) return false;
    const common = [...a].filter(word => b.has(word)).length;
    return common >= 1 && common / Math.min(a.size, b.size) >= 0.5;
  };
  return overlap(audio.sourceQuote || '', text.sourceQuote || '') && overlap(audio.dubQuote || '', text.dubQuote || '');
}

function locateQuote(segments: Segment[], phrase: string, suggestedStartIndex: unknown) {
  const phraseTokens = phrase.normalize('NFKC').toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  if (!phraseTokens.length || !segments.length) return { start: undefined, end: undefined };
  const transcriptTokens = segments.flatMap((segment, segmentIndex) =>
    (segment.text.normalize('NFKC').toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) || [])
      .map(token => ({ token, segmentIndex })),
  );
  const matches: { first: number; last: number }[] = [];
  for (let index = 0; index <= transcriptTokens.length - phraseTokens.length; index += 1) {
    if (phraseTokens.every((token, offset) => transcriptTokens[index + offset].token === token)) {
      matches.push({ first: transcriptTokens[index].segmentIndex, last: transcriptTokens[index + phraseTokens.length - 1].segmentIndex });
    }
  }
  if (!matches.length) return { start: undefined, end: undefined };
  const preferredIndex = Number.isInteger(suggestedStartIndex) ? Number(suggestedStartIndex) : matches[0].first;
  const match = matches.reduce((closest, candidate) =>
    Math.abs(candidate.first - preferredIndex) < Math.abs(closest.first - preferredIndex) ? candidate : closest,
  );
  return { start: segments[match.first].start, end: segments[match.last].end };
}
function buildTranscriptReviewChunks(source: Transcript, dub: Transcript): TranscriptReviewChunk[] {
  const makeTextChunks = () => {
    const chunkSize = 6500;
    const overlap = 900;
    const stride = chunkSize - overlap;
    const longest = Math.max(source.transcript.length, dub.transcript.length);
    const count = Math.max(1, Math.ceil(longest / stride));
    return Array.from({ length: count }, (_, index) => {
      const startRatio = Math.max(0, (index * stride) / Math.max(longest, 1));
      const endRatio = Math.min(1, (index * stride + chunkSize) / Math.max(longest, 1));
      const coreEndRatio = Math.min(1, ((index + 1) * stride) / Math.max(longest, 1));
      const take = (text: string) => text.slice(Math.floor(startRatio * text.length), Math.ceil(endRatio * text.length));
      const backTranslationText = dub.transcript.slice(Math.floor(startRatio * dub.transcript.length), Math.floor(coreEndRatio * dub.transcript.length));
      return { id: String(index), sourceText: take(source.transcript), dubText: take(dub.transcript), backTranslationText };
    });
  };
  if (!source.segments.length || !dub.segments.length) return makeTextChunks();

  const sourceDuration = source.segments[source.segments.length - 1]?.end || 0;
  const dubDuration = dub.segments[dub.segments.length - 1]?.end || 0;
  const duration = Math.max(sourceDuration, dubDuration);
  if (!sourceDuration || !dubDuration) return makeTextChunks();
  const chunks: TranscriptReviewChunk[] = [];
  const windowSeconds = 120;
  const stepSeconds = 100;
  const addWindow = (progressStart: number, progressEnd: number, coreStart: number, coreEnd: number) => {
    const sourceStart = progressStart * sourceDuration;
    const sourceEnd = progressEnd * sourceDuration;
    const dubStart = progressStart * dubDuration;
    const dubEnd = progressEnd * dubDuration;
    const dubCoreStart = coreStart * dubDuration;
    const dubCoreEnd = coreEnd * dubDuration;
    const sourceParts = source.segments.map((segment, index) => ({ segment, index })).filter(({ segment }) => segment.end >= sourceStart && segment.start <= sourceEnd);
    const dubParts = dub.segments.map((segment, index) => ({ segment, index })).filter(({ segment }) => segment.end >= dubStart && segment.start <= dubEnd);
    const backTranslationParts = dub.segments.map((segment, index) => ({ segment, index }))
      .filter(({ segment }) => segment.start >= dubCoreStart && (segment.start < dubCoreEnd || coreEnd >= 1 && segment.start <= dubCoreEnd));
    const sourceText = sourceParts.map(({ segment, index }) => `[${index}] ${segment.start.toFixed(1)}-${segment.end.toFixed(1)}s: ${segment.text}`).join('\n');
    const dubText = dubParts.map(({ segment, index }) => `[${index}] ${segment.start.toFixed(1)}-${segment.end.toFixed(1)}s: ${segment.text}`).join('\n');
    const backTranslationText = backTranslationParts.map(({ segment, index }) => `[${index}] ${segment.start.toFixed(1)}-${segment.end.toFixed(1)}s: ${segment.text}`).join('\n');
    if (!sourceText && !dubText) return;
    if (sourceText.length + dubText.length > 12000 && (coreEnd - coreStart) * duration > 24) {
      const midpoint = (coreStart + coreEnd) / 2;
      const overlap = Math.min(8 / duration, (coreEnd - coreStart) / 4);
      addWindow(progressStart, Math.min(progressEnd, midpoint + overlap), coreStart, midpoint);
      addWindow(Math.max(progressStart, midpoint - overlap), progressEnd, midpoint, coreEnd);
      return;
    }
    chunks.push({ id: String(chunks.length), sourceText, dubText, backTranslationText });
  };
  const chunkCount = Math.ceil(duration / stepSeconds);
  for (let index = 0; index < chunkCount; index += 1) {
    const progressStart = (index * stepSeconds) / duration;
    const progressEnd = Math.min(1, (index * stepSeconds + windowSeconds) / duration);
    const coreEnd = Math.min(1, ((index + 1) * stepSeconds) / duration);
    addWindow(progressStart, progressEnd, progressStart, coreEnd);
  }
  return chunks.length ? chunks : makeTextChunks();
}
function formatSegmentsRange(segments: Segment[], start: number, end: number) {
  return segments.map((segment, index) => ({ segment, index }))
    .filter(({ segment }) => segment.end >= start && segment.start <= end)
    .map(({ segment, index }) => `[${index}] ${segment.start.toFixed(1)}-${segment.end.toFixed(1)}s: ${segment.text}`)
    .join('\n');
}

function segmentRange(segments: Segment[], startIndex: unknown, endIndex: unknown, startTime: unknown, endTime: unknown) {
  if (!segments.length) return { start: typeof startTime === 'number' && Number.isFinite(startTime) ? Math.max(0, startTime) : undefined, end: typeof endTime === 'number' && Number.isFinite(endTime) ? Math.max(0, endTime) : undefined };
  const resolveIndex = (value: unknown, fallbackTime: unknown) => {
    if (Number.isInteger(value) && Number(value) >= 0 && Number(value) < segments.length) return Number(value);
    if (typeof fallbackTime === 'number' && Number.isFinite(fallbackTime)) return segments.reduce((best, segment, index) => Math.abs(segment.start - fallbackTime) < Math.abs(segments[best].start - fallbackTime) ? index : best, 0);
    return undefined;
  };
  const first = resolveIndex(startIndex, startTime);
  const last = resolveIndex(endIndex, endTime);
  if (first === undefined) return { start: undefined, end: undefined };
  const boundedEnd = Math.max(first, last ?? first);
  return { start: segments[first].start, end: segments[boundedEnd].end };
}
async function geminiTranscriptReviewPass(source: Transcript, dub: Transcript, chunk: TranscriptReviewChunk, sourceLanguage: string, targetLanguage: string, modelsUsed: Set<string>): Promise<{ findings: AudioFinding[]; backTranslation: string }> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error('GEMINI_API_KEY is missing for transcript review.');
  const model = process.env.GEMINI_TRANSCRIPT_REVIEW_MODEL?.trim() || process.env.GEMINI_MODEL?.trim() || 'gemini-3.8-flash';
  const prompt = `You are reviewing passage ${Number(chunk.id) + 1} in a full-video dubbing QA. Both passages are Saaras v4 transcripts of the original audio and finished dubbed audio. Source language: ${sourceLanguage}; dub language: ${targetLanguage}. Translate the DUB CORE below into ${sourceLanguage} and return that translation in backTranslation. Keep its original order, but omit segment numbers and timestamps from the translation. Use this Gemini translation to compare meaning with the original transcript. Compare corresponding ideas in narrative order, not merely lines with similar timestamps; the source and dub may speak the same idea at different times. Never pair unrelated source and dub passages. Check each idea in both directions, including every number, name, quantity, negation, instruction, omission, and addition. Natural rewording is correct. Use the overlapping transcript context to handle timing shifts, but translate only the DUB CORE so adjacent passages do not duplicate evidence. Do not call content missing or added only because it is absent from one passage. Quote exact original and dubbed Saaras transcript text, and return segment indexes that contain those exact quotes. For each finding, include backTranslationQuote: a natural ${sourceLanguage} translation of that exact dubQuote. Use it as the bridge to sourceQuote; do not report a mismatch if the quoted passages are unrelated. Do not infer pronunciation, voice gender, or accent from text. Do not judge health advice without a trusted reference. ${targetLanguageReviewNote(targetLanguage)} Return every distinct concrete mismatch in separate findings. Return an empty list when no mismatch is evident. JSON only: {"backTranslation":"dub core translated to source language","findings":[{"severity":"critical|review|info","category":"Meaning|Omission/addition|Numbers/names|Language mixing|Other","title":"short issue","detail":"plain-English explanation of the difference","sourceQuote":"exact source phrase","dubQuote":"exact dubbed transcript phrase","backTranslationQuote":"dub quote translated to source language","sourceStartSegment":0,"sourceEndSegment":0,"dubStartSegment":0,"dubEndSegment":0}]}

SOURCE AUDIO TRANSCRIPT (${sourceLanguage}):\n${chunk.sourceText}\n\nDUB AUDIO TRANSCRIPT (${targetLanguage}):\n${chunk.dubText}\n\nDUB CORE TO TRANSLATE ONCE (${targetLanguage}):\n${chunk.backTranslationText}`;
  const response = await geminiRequest({ model, input: prompt, response_format: { type: 'text', mime_type: 'application/json', schema: transcriptFindingsSchema }, generation_config: { max_output_tokens: 6144 } }, key, 150_000);
  const usedModel = response.headers.get('x-satvic-gemini-model');
  if (usedModel) modelsUsed.add(usedModel);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Gemini transcript cross-check returned ${response.status}: ${providerError(payload)}`);
  const output = interactionOutputText(payload);
  let parsed: Json;
  try { parsed = JSON.parse(output.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); }
  catch { throw new Error(`Gemini transcript cross-check returned incomplete or invalid JSON for passage ${Number(chunk.id) + 1}.`); }
  if (!Array.isArray(parsed.findings)) throw new Error(`Gemini transcript cross-check returned invalid findings for passage ${Number(chunk.id) + 1}.`);
  const backTranslation = typeof parsed.backTranslation === 'string' ? parsed.backTranslation.trim() : '';
  if (chunk.backTranslationText.trim() && !backTranslation) throw new Error(`Gemini did not return the back-translation for passage ${Number(chunk.id) + 1}.`);
  if (parsed.findings.some((item: Json) => item?.title && item?.detail && item?.sourceQuote?.trim() && item?.dubQuote?.trim() && !item?.backTranslationQuote?.trim())) {
    throw new Error(`Gemini returned a transcript finding without back-translation evidence for passage ${Number(chunk.id) + 1}.`);
  }
  const findingsByKey = new Map<string, AudioFinding>();
  for (const item of parsed.findings.filter((entry: Json) => entry?.title && entry?.detail && entry?.sourceQuote?.trim() && entry?.dubQuote?.trim() && entry?.backTranslationQuote?.trim() && ['critical', 'review', 'info'].includes(entry.severity))) {
    const sourceQuote = String(item.sourceQuote).slice(0, 300);
    const dubQuote = String(item.dubQuote).slice(0, 300);
    const backTranslationQuote = String(item.backTranslationQuote).slice(0, 300);
    const sourceLocation = locateQuote(source.segments, sourceQuote, item.sourceStartSegment);
    const dubLocation = locateQuote(dub.segments, dubQuote, item.dubStartSegment);
    const finding: AudioFinding = { severity: item.severity, title: String(item.title).slice(0, 140), detail: String(item.detail).slice(0, 1000), category: String(item.category || 'Meaning'), sourceQuote, dubQuote, backTranslationQuote, sourceStart: sourceLocation.start, sourceEnd: sourceLocation.end, dubStart: dubLocation.start, dubEnd: dubLocation.end, evidenceStatus: 'transcript-only' };
    findingsByKey.set(`${finding.title}|${sourceQuote}|${dubQuote}|${finding.sourceStart ?? ''}|${finding.dubStart ?? ''}`.toLowerCase(), finding);
  }
  return { findings: [...findingsByKey.values()], backTranslation };
}
async function geminiAudioReview(sourceInput: Transcript, dubInput: Transcript, sourceAudio: CompactAudio, dubAudio: CompactAudio, sourceLanguage: string, targetLanguage: string, modelsUsed: Set<string>, clipStart: number, clipEnd: number): Promise<AudioFinding[]> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error('GEMINI_API_KEY is missing for audio review.');
  const model = process.env.GEMINI_MODEL?.trim() || 'gemini-3.8-flash';
  const source: Transcript = { ...sourceInput, transcript: formatSegmentsRange(sourceInput.segments, clipStart, clipEnd) };
  const dub: Transcript = { ...dubInput, transcript: formatSegmentsRange(dubInput.segments, clipStart, clipEnd) };
  const [sourceClip, dubClip] = await Promise.all([sliceCompactAudio(sourceAudio, clipStart, clipEnd - clipStart), sliceCompactAudio(dubAudio, clipStart, clipEnd - clipStart)]);
  if (!sourceClip || !dubClip) throw new Error(`Could not create both Gemini audio-review clips for ${clipStart.toFixed(1)}–${clipEnd.toFixed(1)} seconds.`);
  const body = {
    model,
    input: [
      { type: 'text', text: `You are reviewing only audio from ${clipStart.toFixed(1)} to ${clipEnd.toFixed(1)} seconds. You are an audio dubbing quality reviewer. You can listen to BOTH attached audio tracks. Track 1 is the original ${sourceLanguage}; track 2 is the finished dub in ${targetLanguage}. Compare the words actually spoken in the audio, not merely the transcripts. The supplied source transcript and dub transcript or SRT help locate speech but may contain omissions or errors; the attached audio itself is authoritative. Independently listen to each audio track and form an internal transcript of the words actually spoken, then compare those words; never treat a matching transcript as proof that the dub audio is correct. Flag a spoken omission, addition, changed number/name/meaning, or other audible mismatch even when the supplied transcripts look equivalent. The timestamped transcripts below help locate speech; audio is the evidence. Find EVERY distinct issue and each separate occurrence; do not stop after one or combine separate times. Check changed meaning, omissions/additions, each quantity and unit, and claims changed from below to above a limit. Flag clear English words or phrases used instead of the selected target language as Language mixing; ignore proper names, brands, and common loanwords. Do not judge health or nutrition safety without a trusted reference. ${targetLanguageReviewNote(targetLanguage)} Do not label a regional accent as wrong just because it differs; only flag if it affects intelligibility or brief requirements. For each issue give start and end seconds relative to the start of this supplied audio clip (the app adds the clip offset), a category, severity (critical/review/info), a plain-English explanation that states what the source says and what the dub says, with short quotes. Return the zero-based start/end segment indexes for the closest supplied transcript segments (sourceStartSegment, sourceEndSegment, dubStartSegment, dubEndSegment), or null indexes when no transcript segment is supplied. Use transcript segments as timing anchors when available. Do not invent issues or exact quotes. If audio or transcripts are unclear, state the uncertainty instead of guessing. Output JSON only: {"findings":[ {"severity":"critical|review|info","category":"Meaning|Omission/addition|Numbers/names|Language mixing|Pronunciation/intelligibility|Accent/voice|Pacing/timing|Audio quality|Other","title":"short actionable issue","detail":"what the source says and what the dub says","sourceQuote":"short source phrase","dubQuote":"short target-language phrase heard","sourceStart":0,"sourceEnd":1,"dubStart":0,"dubEnd":1,"sourceStartSegment":0,"sourceEndSegment":0,"dubStartSegment":0,"dubEndSegment":0}]}. If no concrete issue is audible, return {"findings":[]}.\n\nSOURCE TRANSCRIPT SEGMENTS (seconds):\n${formatSegmentsRange(source.segments, clipStart, clipEnd)}\n\nDUB TRANSCRIPT SEGMENTS (seconds):\n${formatSegmentsRange(dub.segments, clipStart, clipEnd)}\n\nFull source transcript: ${source.transcript.slice(0, 8000)}\n\nFull dub transcript: ${dub.transcript.slice(0, 8000)}` },
      { type: 'audio', data: sourceClip.data, mime_type: sourceClip.mime_type },
      { type: 'audio', data: dubClip.data, mime_type: dubClip.mime_type },
    ],
  };
  body.input.unshift({ type: 'text', text: 'Voice-casting review: in every chunk, compare the apparent vocal presentation of each audible source speaker with the person voicing that same dialogue in the dub. Explicitly flag clear mismatches such as a masculine-sounding source character voiced by a feminine-sounding dub voice, or two distinct source speakers collapsed into one dub voice. Match dialogue turns by meaning as well as timestamps because translations may shift timing. Report perceived voice presentation, never a real person’s gender. If the match is uncertain, do not guess.' });
  const requestBytes = Buffer.byteLength(JSON.stringify(body));
  if (requestBytes > 18 * 1024 * 1024) throw new Error('The two audio tracks are too long for one AI listening review. Use shorter clips (about 20 minutes or less) and analyze the video in parts.');
  const response = await geminiRequest({ ...body, response_format: { type: 'text', mime_type: 'application/json', schema: audioFindingsSchema }, generation_config: { max_output_tokens: 6144 } }, key, 165_000);
  const usedModel = response.headers.get('x-satvic-gemini-model');
  if (usedModel) modelsUsed.add(usedModel);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Gemini audio review returned ${response.status}: ${providerError(payload)}`);
  const output = interactionOutputText(payload);
  let parsed: Json;
  try {
    parsed = JSON.parse(output.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
  } catch {
    throw new Error('Gemini audio review returned incomplete or invalid JSON.');
  }
  if (!Array.isArray(parsed.findings)) throw new Error('Gemini audio review returned invalid findings.')
  const findings = parsed.findings.filter((item: Json) => item?.title && item?.detail && ['critical', 'review', 'info'].includes(item.severity)).map((item: Json): AudioFinding => {
    const sourceRange = Number.isInteger(item.sourceStartSegment)
      ? segmentRange(source.segments, item.sourceStartSegment, item.sourceEndSegment, item.sourceStart != null ? clipStart + Number(item.sourceStart) : undefined, item.sourceEnd != null ? clipStart + Number(item.sourceEnd) : undefined)
      : { start: item.sourceStart != null && Number.isFinite(Number(item.sourceStart)) ? clipStart + Number(item.sourceStart) : undefined, end: item.sourceEnd != null && Number.isFinite(Number(item.sourceEnd)) ? clipStart + Number(item.sourceEnd) : undefined };
    const dubRange = Number.isInteger(item.dubStartSegment)
      ? segmentRange(dub.segments, item.dubStartSegment, item.dubEndSegment, item.dubStart != null ? clipStart + Number(item.dubStart) : undefined, item.dubEnd != null ? clipStart + Number(item.dubEnd) : undefined)
      : { start: item.dubStart != null && Number.isFinite(Number(item.dubStart)) ? clipStart + Number(item.dubStart) : undefined, end: item.dubEnd != null && Number.isFinite(Number(item.dubEnd)) ? clipStart + Number(item.dubEnd) : undefined };
    return {
      severity: item.severity, title: String(item.title).slice(0, 140), detail: String(item.detail).slice(0, 1000),
      category: String(item.category || 'Other'), sourceQuote: String(item.sourceQuote || '').slice(0, 300), dubQuote: String(item.dubQuote || '').slice(0, 300), sourceStart: sourceRange.start, sourceEnd: sourceRange.end,
      dubStart: dubRange.start, dubEnd: dubRange.end, evidenceStatus: 'audio-only',
    };
  });
  return findings;
}
export async function POST(request: Request) {
  const key = process.env.SARVAM_API_KEY?.trim() || '';
  if (!process.env.GEMINI_API_KEY?.trim()) return NextResponse.json({ error: 'Add GEMINI_API_KEY to .env.local. The AI audio reviewer needs it to listen to and compare both languages.' }, { status: 503 });
  let stage = 'Reading uploaded files';
  let stageStartedAt = Date.now();
  const markStage = (nextStage: string) => {
    console.info(`[api/analyze] stage=${stage} durationMs=${Date.now() - stageStartedAt}`);
    stage = nextStage;
    stageStartedAt = Date.now();
  };
  let progressId = '';
  let historyJobId = '';
  let historyOriginalUrl = '';
  let historyDubbedUrl = '';
  let historyNotificationEmail = '';
  let historyProjectName = '';
  let historySourceLanguage = '';
  let historyTargetLanguage = '';
  let historyUserId = '';
  let historyManagedByWorkflow = false;
  let historySupabase: any = null;
  let checkpoint: QaCheckpoint = {};
  let checkpointSave = Promise.resolve();
  let checkpointUrl = '';
  const persistCheckpoint = () => {
    if (!historyJobId || !historySupabase || !historyUserId) return Promise.resolve();
    checkpointSave = checkpointSave.then(async () => {
      checkpoint.kind = 'qa-checkpoint';
      const checkpointSnapshot = { ...checkpoint };
      delete checkpointSnapshot.sourceAudio;
      delete checkpointSnapshot.dubAudio;
      const stored = await put(`satvic-users/${historyUserId}/satvic-jobs/${historyJobId}-qa-checkpoint-${crypto.randomUUID()}.json`, JSON.stringify(checkpointSnapshot), { access: 'private', contentType: 'application/json', addRandomSuffix: false });
      const previousCheckpointUrl = checkpointUrl;
      checkpointUrl = stored.url;
      const { error } = await historySupabase.from('qa_jobs').update({ report_blob_url: checkpointUrl, updated_at: new Date().toISOString() }).eq('id', historyJobId).eq('user_id', historyUserId);
      if (error) throw error;
      if (previousCheckpointUrl && previousCheckpointUrl !== checkpointUrl) await deleteBlob(previousCheckpointUrl).catch(error => console.warn('[api/analyze] Could not remove an old checkpoint blob.', error));
    });
    return checkpointSave;
  };
  try {
    const isJson = request.headers.get('content-type')?.includes('application/json');
    const form = isJson ? null : await request.formData();
    const json: Json = isJson ? await request.json() : {};
    const generatedBySarvam = json.generatedBySarvam === true;
  if (!key) return NextResponse.json({ error: 'Add SARVAM_API_KEY to .env.local. Saaras transcription is required for source and dubbed audio QA.' }, { status: 503 });
    historyJobId = String(json.historyJobId || '');
    if (historyJobId) {
      const internalToken = request.headers.get('x-workflow-internal');
      const workflowAuthorized = Boolean(process.env.WORKFLOW_INTERNAL_TOKEN && internalToken === process.env.WORKFLOW_INTERNAL_TOKEN);
      historyManagedByWorkflow = workflowAuthorized;
      historySupabase = workflowAuthorized ? createAdminClient() : await createClient();
      const user = workflowAuthorized ? null : (await historySupabase.auth.getUser()).data.user;
      if (!workflowAuthorized && !user) return NextResponse.json({ error: 'Sign in before saving this analysis.' }, { status: 401 });
      let savedJobQuery = historySupabase.from('qa_jobs').select('id,user_id,original_blob_url,dubbed_blob_url,report_blob_url').eq('id', historyJobId);
      if (!workflowAuthorized && user) savedJobQuery = savedJobQuery.eq('user_id', user.id);
      const { data: savedJob, error: savedJobError } = await savedJobQuery.maybeSingle();
      if (savedJobError) throw savedJobError;
      if (!savedJob) return NextResponse.json({ error: 'This QA project was not found.' }, { status: 404 });
      if (workflowAuthorized && (!json.userId || savedJob.user_id !== json.userId)) return NextResponse.json({ error: 'The background QA request did not match this project owner.' }, { status: 403 });
      if (String(json.originalBlobUrl || '') !== savedJob.original_blob_url || String(json.dubbedBlobUrl || '') !== savedJob.dubbed_blob_url) return NextResponse.json({ error: 'The uploaded media does not match this saved QA project.' }, { status: 400 });
      historyUserId = savedJob.user_id;
      historyNotificationEmail = user?.email || String(json.notificationEmail || '');
      historyOriginalUrl = savedJob.original_blob_url;
      historyDubbedUrl = savedJob.dubbed_blob_url || '';
      checkpointUrl = savedJob.report_blob_url || '';
      if (checkpointUrl) {
        try {
          const cached = await getBlob(checkpointUrl, { access: 'private' });
          if (cached) {
            const cachedBytes = await readBlobStream(cached.stream);
            const parsed = JSON.parse(new TextDecoder('utf-8').decode(cachedBytes)) as Json;
            if (parsed.kind === 'qa-checkpoint') checkpoint = parsed as QaCheckpoint;
            else {
              if (typeof parsed.originalTranscript === 'string' && Array.isArray(parsed.originalSegments)) {
                checkpoint.originalResult = { transcript: parsed.originalTranscript, segments: parsed.originalSegments, detectedLanguage: parsed.sourceLanguage || json.sourceLanguage || '', engine: parsed.originalTranscriptionEngine || 'Sarvam Saaras v4' };
                if (parsed.generatedBySarvam === true && typeof parsed.dubSubtitleTranscript === 'string' && parsed.dubSubtitleTranscript.trim()) {
                  checkpoint.dubbedScriptResult = { transcript: parsed.dubSubtitleTranscript, segments: Array.isArray(parsed.dubSubtitleSegments) ? parsed.dubSubtitleSegments : [], detectedLanguage: parsed.targetLanguage || json.targetLanguage || '', engine: 'Sarvam dubbing SRT export' };
                }
                if (typeof parsed.dubbedTranscript === 'string' && Array.isArray(parsed.dubbedSegments)) {
                  const storedDubEngine = parsed.dubbedTranscriptionEngine || (parsed.dubSubtitleTranscript && parsed.dubSubtitleTranscript === parsed.dubbedTranscript ? 'Sarvam dubbing SRT export' : 'Sarvam Saaras v4');
                  checkpoint.dubbedResult = { transcript: parsed.dubbedTranscript, segments: parsed.dubbedSegments, detectedLanguage: parsed.targetLanguage || json.targetLanguage || '', engine: storedDubEngine };
                }
                if (typeof parsed.backTranslation === 'string' && parsed.backTranslation.trim()) checkpoint.backTranslation = parsed.backTranslation;
              }
              checkpointUrl = '';
            }
          }
        } catch (error) {
          checkpointUrl = '';
          console.warn('[api/analyze] Could not load the saved QA checkpoint; recomputing missing stages.', error);
        }
      }
    }
    progressId = String(form?.get('progressId') || '');
    markStage('Checking uploaded videos');
    updateAnalysisProgress(progressId, stage, 12);
    let original: FormDataEntryValue | File | null = form?.get('original') || null;
    let dubbed: FormDataEntryValue | File | null = form?.get('dubbed') || null;
    if (isJson) {
      const originalBlobUrl = String(json.originalBlobUrl || '');
      const dubbedBlobUrl = String(json.dubbedBlobUrl || '');
      if (!originalBlobUrl.startsWith('https://') || !dubbedBlobUrl.startsWith('https://')) return NextResponse.json({ error: 'Both uploaded Blob URLs are required.' }, { status: 400 });
      const [originalBlob, dubbedBlob] = await Promise.all([
        getBlob(originalBlobUrl, { access: 'private', useCache: false }),
        getBlob(dubbedBlobUrl, { access: 'private', useCache: false }),
      ]);
      if (!originalBlob || originalBlob.statusCode !== 200) return NextResponse.json({ error: 'The original uploaded video could not be downloaded from Blob storage.' }, { status: 404 });
      if (!dubbedBlob || dubbedBlob.statusCode !== 200) return NextResponse.json({ error: 'The saved dubbed video could not be downloaded from Blob storage.' }, { status: 404 });
      const [originalBytes, dubbedBytes] = await Promise.all([
        readBlobStream(originalBlob.stream),
        readBlobStream(dubbedBlob.stream),
      ]);
      original = new File([originalBytes], String(json.originalName || 'source.mp4'), { type: originalBlob.blob.contentType || 'video/mp4' });
      dubbed = new File([dubbedBytes], 'dub.mp4', { type: dubbedBlob.blob.contentType || 'video/mp4' });
    }
    const sourceLanguage = String(form?.get('sourceLanguage') || json.sourceLanguage || 'Hindi');
    const targetLanguage = String(form?.get('targetLanguage') || json.targetLanguage || 'Tamil');
    historyProjectName = String(form?.get('projectName') || json.projectName || '');
    historySourceLanguage = sourceLanguage;
    historyTargetLanguage = targetLanguage;
    if (!(original instanceof File) || !(dubbed instanceof File)) return NextResponse.json({ error: 'Choose both the original and dubbed media.' }, { status: 400 });
    if (!historyProjectName) historyProjectName = original.name.replace(/\.[^.]+$/, '');
    if (!original.size || !dubbed.size) {
      return NextResponse.json({
        error: `One of the selected files is empty. Original=${original.size} bytes, dubbed=${dubbed.size} bytes.`,
      }, { status: 400 });
    }
    if (original.size > 450 * 1024 * 1024 || dubbed.size > 450 * 1024 * 1024) return NextResponse.json({ error: 'Each media file must be smaller than 450 MB for this local server.' }, { status: 413 });
    const source = LANGUAGES[sourceLanguage]; const target = LANGUAGES[targetLanguage];
    if (!source || !target) return NextResponse.json({ error: 'That language pair is not enabled yet.' }, { status: 400 });

    if (historyJobId && !historyManagedByWorkflow) await sendGmailJobEmail({
      to: historyNotificationEmail,
      outcome: 'started',
      projectName: historyProjectName,
      sourceLanguage,
      targetLanguage,
      detail: 'Your video QA is starting. We will email you again when the report is ready or if the analysis fails.',
      appUrl: appUrl(),
    });

    const dubbedSubtitleSrt = typeof json.dubbedSubtitleSrt === 'string' && json.dubbedSubtitleSrt.length <= 2_000_000 ? json.dubbedSubtitleSrt : '';
    let originalResult = checkpoint.originalResult;
    const parsedDubScript = checkpoint.dubbedScriptResult || (dubbedSubtitleSrt && parseSarvamSrt(dubbedSubtitleSrt, target.sarvam)) || undefined;
    let dubbedScriptResult = parsedDubScript;
    let dubbedResult = generatedBySarvam
      ? checkpoint.dubbedResult
      : checkpoint.dubbedResult || dubbedScriptResult;
    if (checkpoint.transcriptComparisonVersion !== 7) {
      if (generatedBySarvam && originalResult?.engine !== 'Sarvam Saaras v4') originalResult = checkpoint.originalResult = undefined;
      if (generatedBySarvam && dubbedResult?.engine !== 'Sarvam Saaras v4') dubbedResult = checkpoint.dubbedResult = undefined;
      checkpoint.dubbedAudioResult = undefined;
      checkpoint.textReviewComplete = false;
      checkpoint.textReviewAttempted = false;
      checkpoint.textFindings = undefined;
      checkpoint.textReviewChunks = {};
      checkpoint.textReviewChunkCount = undefined;
      checkpoint.textBackTranslations = {};
      checkpoint.transcriptReviewModels = [];
      checkpoint.backTranslation = undefined;
      checkpoint.transcriptComparisonVersion = 7;
      checkpoint.audioReviewComplete = false;
      checkpoint.audioReviewChunks = {};
      checkpoint.audioReviewModels = [];
      checkpoint.audioFindings = [];
      checkpoint.audioReviewChunkCount = undefined;
    }
    if (checkpoint.audioReviewPromptVersion !== 2) {
      checkpoint.audioReviewComplete = false;
      checkpoint.audioReviewChunks = {};
      checkpoint.audioReviewModels = [];
      checkpoint.audioFindings = [];
      checkpoint.audioReviewChunkCount = undefined;
      checkpoint.audioReviewPromptVersion = 2;
    }
    if (checkpoint.videoReviewVersion !== 1) {
      checkpoint.videoReviewComplete = false;
      checkpoint.videoReviewFindings = [];
      checkpoint.videoReviewVersion = 1;
    }
    if (!originalResult || !dubbedResult) {
      markStage(generatedBySarvam ? 'Transcribing original and dubbed media with Saaras' : dubbedResult ? 'Transcribing source with Sarvam' : 'Transcribing source and dubbed media with Sarvam');
      updateAnalysisProgress(progressId, stage, 24);
      const transcriptionJobCallbacks = (track: 'original' | 'dubbed') => ({
        onJobStarted: async (jobId: string) => {
          if (track === 'original') checkpoint.originalTranscriptionJobId = jobId;
          else checkpoint.dubbedTranscriptionJobId = jobId;
          await persistCheckpoint();
        },
        onJobFailed: async () => {
          await persistCheckpoint();
        },
      });
      const originalCallbacks = transcriptionJobCallbacks('original');
      const dubbedCallbacks = transcriptionJobCallbacks('dubbed');
      const [newOriginalResult, newDubResult] = await Promise.all([
        originalResult ? Promise.resolve(originalResult) : transcribeWithSarvam(original, source.sarvam, key, checkpoint.originalTranscriptionJobId, originalCallbacks.onJobStarted, originalCallbacks.onJobFailed).then(async result => { originalResult = result; checkpoint.originalResult = result; delete checkpoint.originalTranscriptionJobId; await persistCheckpoint(); return result; }),
        dubbedResult ? Promise.resolve(dubbedResult) : transcribeWithSarvam(dubbed, target.sarvam, key, checkpoint.dubbedTranscriptionJobId, dubbedCallbacks.onJobStarted, dubbedCallbacks.onJobFailed).then(async result => { dubbedResult = result; checkpoint.dubbedResult = result; delete checkpoint.dubbedTranscriptionJobId; await persistCheckpoint(); return result; }),
      ]);
      originalResult = newOriginalResult;
      dubbedResult = newDubResult;
    }
    if (!originalResult || !dubbedResult) throw new Error('Sarvam Saaras did not return both source and dubbed transcripts.');
    if (!generatedBySarvam) dubbedScriptResult ||= dubbedResult;
    if (generatedBySarvam && dubbedScriptResult) checkpoint.dubbedScriptResult = dubbedScriptResult;
    markStage('Preparing transcript and audio evidence');
    updateAnalysisProgress(progressId, stage, 66);
    let backTranslation = '';
    const [sourceAudio, dubAudio] = checkpoint.sourceAudio && checkpoint.dubAudio
      ? [checkpoint.sourceAudio, checkpoint.dubAudio] as const
      : await Promise.all([extractCompactAudio(original), extractCompactAudio(dubbed)]);
    checkpoint.sourceAudio = sourceAudio;
    checkpoint.dubAudio = dubAudio;
    await persistCheckpoint();
    markStage('Gemini checking transcript and audio in parallel');
    updateAnalysisProgress(progressId, stage, 82);
    let textFindings: AudioFinding[] = checkpoint.textFindings || [];
    const transcriptModelsUsed = new Set<string>(checkpoint.transcriptReviewModels || []);
    const audioModelsUsed = new Set<string>(checkpoint.audioReviewModels || []);
    let transcriptCrossCheckAvailable = checkpoint.textReviewComplete === true;
    let transcriptCrossCheckError: string | null = checkpoint.transcriptCrossCheckError || null;
    const reviewCoverageWarnings: string[] = [];
    const runVideoReview = async () => {
      if (checkpoint.videoReviewComplete) return checkpoint.videoReviewFindings || [];
      try {
        checkpoint.videoReviewFindings = await scanDubVideo(dubbed as File);
        checkpoint.videoReviewComplete = true;
      } catch (error) {
        checkpoint.videoReviewComplete = false;
        const message = error instanceof Error ? error.message.slice(0, 300) : 'Unknown video scan error';
        reviewCoverageWarnings.push(`The dubbed-video freeze and black-screen scan did not finish: ${message}`);
        console.warn(`[api/analyze] Video scan unavailable: ${message}`);
      }
      await persistCheckpoint();
      return checkpoint.videoReviewFindings || [];
    };
    const runTranscriptReview = async (sourceTranscript: Transcript, dubTranscript: Transcript) => {
      const chunks = buildTranscriptReviewChunks(sourceTranscript, dubTranscript);
      checkpoint.textReviewChunks ||= {};
      checkpoint.textBackTranslations ||= {};
      if (checkpoint.textReviewChunkCount !== chunks.length) {
        checkpoint.textReviewChunks = {};
        checkpoint.textBackTranslations = {};
        checkpoint.textReviewChunkCount = chunks.length;
        checkpoint.textReviewComplete = false;
        checkpoint.textFindings = [];
      }
      const chunkHasResult = (chunk: TranscriptReviewChunk) =>
        Object.prototype.hasOwnProperty.call(checkpoint.textReviewChunks, chunk.id)
        && typeof checkpoint.textBackTranslations?.[chunk.id] === 'string';
      if (checkpoint.textReviewComplete && chunks.every(chunkHasResult)) {
        textFindings = checkpoint.textFindings || [];
        checkpoint.backTranslation = chunks.map(chunk => checkpoint.textBackTranslations?.[chunk.id] || '').filter(Boolean).join('\n');
        backTranslation = checkpoint.backTranslation;
        transcriptCrossCheckAvailable = true;
        transcriptCrossCheckError = null;
        return;
      }
      checkpoint.backTranslation = undefined;
      backTranslation = '';
      checkpoint.textReviewAttempted = true;
      checkpoint.transcriptCrossCheckError = null;
      await persistCheckpoint();
      try {
        for (const [index, chunk] of chunks.entries()) {
          if (chunkHasResult(chunk)) continue;
          markStage(`Gemini transcript review ${index + 1}/${chunks.length}`);
          updateAnalysisProgress(progressId, stage, Math.min(95, 82 + Math.floor((index / chunks.length) * 12)));
          const result = await geminiTranscriptReviewPass(sourceTranscript, dubTranscript, chunk, sourceLanguage, targetLanguage, transcriptModelsUsed);
          checkpoint.textReviewChunks[chunk.id] = result.findings;
          checkpoint.textBackTranslations[chunk.id] = result.backTranslation;
          checkpoint.transcriptReviewModels = [...transcriptModelsUsed];
          const allFindings = Object.values(checkpoint.textReviewChunks).flat();
          textFindings = [...new Map(allFindings.map(item => [`${item.title}|${item.sourceQuote}|${item.dubQuote}|${item.sourceStart ?? ''}|${item.dubStart ?? ''}`.toLowerCase(), item] as const)).values()];
          checkpoint.textFindings = textFindings;
          await persistCheckpoint();
        }
        checkpoint.textReviewComplete = chunks.every(chunkHasResult);
        transcriptCrossCheckAvailable = checkpoint.textReviewComplete;
        if (checkpoint.textReviewComplete) {
          checkpoint.backTranslation = chunks.map(chunk => checkpoint.textBackTranslations?.[chunk.id] || '').filter(Boolean).join('\n');
          backTranslation = checkpoint.backTranslation;
        }
        transcriptCrossCheckError = null;
        checkpoint.transcriptCrossCheckError = null;
        if (!checkpoint.textReviewComplete) throw new Error('Gemini transcript cross-check did not review every transcript passage.');
      } catch (error) {
        transcriptCrossCheckAvailable = false;
        transcriptCrossCheckError = error instanceof Error ? error.message.slice(0, 500) : 'Unknown Gemini error';
        console.warn(`[api/analyze] Transcript cross-check unavailable: ${transcriptCrossCheckError}`);
        checkpoint.textReviewComplete = false;
        checkpoint.transcriptCrossCheckError = transcriptCrossCheckError;
      }
      await persistCheckpoint();
    };
    const runAudioReview = async (sourceTranscript: Transcript, dubTranscript: Transcript) => {
      const chunkSeconds = 30;
      const duration = Math.max(
        sourceAudio.durationSeconds || 0,
        dubAudio.durationSeconds || 0,
        sourceTranscript.segments[sourceTranscript.segments.length - 1]?.end || 0,
        dubTranscript.segments[dubTranscript.segments.length - 1]?.end || 0,
      );
      if (!duration) throw new Error('Transcript or subtitle timing data is missing, so audio QA cannot be split into resumable checkpoints.');
      const chunkCount = Math.ceil(duration / chunkSeconds);
      if (checkpoint.audioReviewComplete && !checkpoint.audioReviewModels?.length) {
        checkpoint.audioReviewComplete = false;
      }
      checkpoint.audioReviewChunks ||= {};
      checkpoint.audioReviewChunkCount = chunkCount;
      await persistCheckpoint();
      if (checkpoint.audioReviewComplete) return checkpoint.audioFindings || [];
      for (let index = 0; index < chunkCount; index += 1) {
        const chunkKey = String(index);
        const hasFindings = Object.prototype.hasOwnProperty.call(checkpoint.audioReviewChunks, chunkKey);
        if (hasFindings) continue;
        const start = index * chunkSeconds;
        const end = Math.min(duration, start + chunkSeconds);
        markStage(`Gemini listening review ${index + 1}/${chunkCount}`);
        updateAnalysisProgress(progressId, stage, Math.min(95, 82 + Math.floor((index / chunkCount) * 12)));
        const findings = await geminiAudioReview(sourceTranscript, dubTranscript, sourceAudio, dubAudio, sourceLanguage, targetLanguage, audioModelsUsed, start, end);
        checkpoint.audioReviewChunks[chunkKey] = findings;
        checkpoint.audioReviewModels = [...audioModelsUsed];
        checkpoint.audioFindings = Object.values(checkpoint.audioReviewChunks).flat();
        await persistCheckpoint();
      }
      checkpoint.audioReviewComplete = true;
      checkpoint.audioFindings = Object.values(checkpoint.audioReviewChunks).flat();
      await persistCheckpoint();
      return checkpoint.audioFindings;
    };
    if (!originalResult || !dubbedResult) throw new Error('Both source and dubbed transcripts are required for QA.');
    let aiFindings: AudioFinding[];
    const [, findings] = await Promise.all([
      runTranscriptReview(originalResult, dubbedResult),
      runAudioReview(originalResult, dubbedResult),
      runVideoReview(),
    ]);
    aiFindings = findings;
    if (!originalResult?.segments.length) reviewCoverageWarnings.push('The source transcript has no timing data, so source-side issue locations may be unavailable.');
    if (!dubbedResult?.segments.length) reviewCoverageWarnings.push('The dub transcript has no timing data, so dub-side issue locations and transcript playback are unavailable.');
    if (checkpoint.audioReviewComplete && !checkpoint.audioReviewModels?.length) throw new Error('Gemini did not confirm any audio-review model response; the QA report cannot be marked complete.');
    const audioFindings = aiFindings.map(item => ({
      ...item,
      evidenceStatus: textFindings.some(check => phrasesSupportSameFinding(item, check)) ? 'cross-checked' as const : 'audio-only' as const,
      source: 'Gemini audio review',
    }));
    const unmatchedTextFindings = textFindings
      .filter(check => !aiFindings.some(item => phrasesSupportSameFinding(item, check)))
      .map(item => ({ ...item, source: 'Gemini transcript cross-check' }));
    const videoFindings = (checkpoint.videoReviewFindings || []).map(item => ({ ...item, source: 'Local dubbed-video frame scan' }));
    const combinedFindings = [
      ...audioFindings,
      ...unmatchedTextFindings,
      ...videoFindings,
    ];
    const transcriptReviewer = [...transcriptModelsUsed].join(', ');
    if (!textFindings.length && transcriptCrossCheckAvailable && (!transcriptReviewer || /lite/i.test(transcriptReviewer))) {
      reviewCoverageWarnings.push('Gemini Flash Lite or an unrecorded reviewer returned no findings. This is not a reliable clean verdict; use a stronger transcript-review model or manually check the report transcripts and audio.');
    }
    markStage('Finishing the timestamped report');
    updateAnalysisProgress(progressId, stage, 97);
    updateAnalysisProgress(progressId, 'Analysis complete', 100, 'complete');
    const report: Json = {
      project: historyProjectName || original.name.replace(/\.[^.]+$/, ''),
      sourceLanguage, targetLanguage, generatedBySarvam, createdAt: new Date().toISOString(),
      originalTranscript: originalResult.transcript, dubbedTranscript: dubbedResult.transcript,
      originalTranscriptionEngine: originalResult.engine,
      dubbedTranscriptionEngine: dubbedResult.engine,
      dubSubtitleTranscript: generatedBySarvam ? dubbedScriptResult?.transcript || '' : '',
      dubSubtitleSegments: generatedBySarvam ? dubbedScriptResult?.segments || [] : [],
      backTranslation, findings: combinedFindings,
      transcriptCrossCheckAvailable,
      transcriptCrossCheckError,
      audioReviewCompleted: true,
      audioReviewEngine: [...audioModelsUsed].join(', '),
      audioReviewFindingCount: aiFindings.length,
      audioReviewChunkCount: checkpoint.audioReviewChunkCount || 0,
      videoReviewCompleted: checkpoint.videoReviewComplete === true,
      videoReviewEngine: 'FFmpeg freeze and black-screen scan',
      videoReviewFindingCount: videoFindings.length,
      transcriptReviewChunkCount: checkpoint.textReviewChunkCount || 0,
      reviewCoverageWarnings,
      reviewComplete: transcriptCrossCheckAvailable && checkpoint.videoReviewComplete === true && reviewCoverageWarnings.length === 0,
      originalSegments: originalResult.segments, dubbedSegments: dubbedResult.segments,
      timestampsAvailable: originalResult.segments.length > 0 && dubbedResult.segments.length > 0,
      transcriptionEngine: originalResult.engine === dubbedResult.engine ? originalResult.engine : `${originalResult.engine} · ${dubbedResult.engine}`,
      semanticReviewEngine: process.env.GEMINI_API_KEY ? `${[...transcriptModelsUsed].join(', ') || process.env.GEMINI_TRANSCRIPT_REVIEW_MODEL || process.env.GEMINI_MODEL || 'gemini-3.8-flash'} transcript review` : null,
      disclaimer: 'The AI listens to both audio tracks and reports suspected issues with time ranges. Treat these as review findings, not a guarantee: speech recognition and audio models can miss mistakes or infer words incorrectly.',
    };
    if (historyJobId && historySupabase) {
      report.originalVideoUrl = historyOriginalUrl;
      report.dubbedVideoUrl = historyDubbedUrl;
      const stored = await put(`satvic-users/${historyUserId}/satvic-jobs/${crypto.randomUUID()}-qa-report.json`, JSON.stringify(report), { access: 'private', contentType: 'application/json', addRandomSuffix: true });
      const reviewWarning = report.reviewComplete ? null : `QA review incomplete: ${transcriptCrossCheckError || reviewCoverageWarnings.join(' ') || 'The transcript cross-check or timing coverage did not complete.'}`;
      await historySupabase.from('qa_jobs').update({ report_blob_url: stored.url, status: 'completed', issue_count: combinedFindings.length, error_message: reviewWarning, updated_at: new Date().toISOString() }).eq('id', historyJobId);
      if (checkpointUrl) {
        await deleteBlob(checkpointUrl).catch(error => console.warn('[api/analyze] Could not remove the completed QA checkpoint.', error));
      }
      if (!historyManagedByWorkflow) await sendGmailJobEmail({
        to: historyNotificationEmail,
        outcome: 'completed',
        projectName: historyProjectName,
        sourceLanguage,
        targetLanguage,
        detail: reviewWarning ? `Audio review completed, but the transcript cross-check or coverage is incomplete: ${reviewWarning}` : 'Your dub QA report is ready in Satvic Studio.',
        appUrl: appUrl(),
      });
    }
    return NextResponse.json(report);
  } catch (error) {
    console.info(`[api/analyze] stage=${stage} failedAfterMs=${Date.now() - stageStartedAt}`);
    const message = error instanceof Error ? error.message : providerError(error as Json);
    const sarvamPaymentIssue = /Sarvam .* returned 402|returned 402/i.test(message);
    const resumableProviderIssue = !sarvamPaymentIssue && /timeout|timed out|deadline|rate.?limit|returned 429|still processing|job_state=/i.test(message);
    const sarvam402Detail = message.replace(/^.*?returned 402:\s*/i, '').trim().slice(0, 700);
    const visibleMessage = sarvamPaymentIssue
      ? `Sarvam rejected the transcription request (HTTP 402)${sarvam402Detail ? `: ${sarvam402Detail}` : '.'} Check that SARVAM_API_KEY in this Vercel environment belongs to the account with credits and has transcription access. Your saved dub is safe; retry QA after resolving the Sarvam response.`
      : message;
    if (historyJobId && historySupabase) {
      await historySupabase.from('qa_jobs').update({ status: resumableProviderIssue ? 'running' : 'failed', error_message: visibleMessage.slice(0, 2000), updated_at: new Date().toISOString() }).eq('id', historyJobId);
      if (!historyManagedByWorkflow) await sendGmailJobEmail({
        to: historyNotificationEmail,
        outcome: 'failed',
        projectName: historyProjectName || 'Video QA',
        sourceLanguage: historySourceLanguage || 'Unknown',
        targetLanguage: historyTargetLanguage || 'Unknown',
        detail: `${stage}: ${visibleMessage}`,
        appUrl: appUrl(),
      });
    }
    updateAnalysisProgress(progressId, 'Analysis stopped', 100, 'error', visibleMessage);
    console.error(`[api/analyze] ${stage} failed: ${visibleMessage || 'Unknown analysis error.'}`);
    const status = sarvamPaymentIssue ? 402 : /rate.?limit|returned 429/i.test(message) ? 429 : resumableProviderIssue ? 504 : /returned 503/.test(message) ? 503 : 502;
    return NextResponse.json({ error: `${resumableProviderIssue ? 'QA checkpoint retry: ' : ''}${stage}: ${visibleMessage || 'Unknown analysis error.'}` }, { status });
  }
}
