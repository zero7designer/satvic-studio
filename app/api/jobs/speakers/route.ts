import { get } from '@vercel/blob';
import { NextResponse } from 'next/server';
import ffmpegPath from 'ffmpeg-static';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createClient } from '../../../../lib/supabase/server';
import { parseSpeakerDiarization } from '../../../../lib/qa/speaker-diarization';

export const runtime = 'nodejs';
export const maxDuration = 120;

type Json = Record<string, any>;

const speakerSchema = {
  type: 'object',
  properties: {
    segments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          speakerId: { type: 'string' },
          startSeconds: { type: 'number' },
          endSeconds: { type: 'number' },
          text: { type: 'string' },
        },
        required: ['speakerId', 'startSeconds', 'endSeconds', 'text'],
      },
    },
    note: { type: 'string' },
  },
  required: ['segments', 'note'],
};

function outputText(payload: Json): string {
  if (typeof payload.output_text === 'string') return payload.output_text;
  return payload.steps?.flatMap((step: Json) => step.content || [])
    .filter((item: Json) => item.type === 'text')
    .map((item: Json) => item.text || '')
    .join('') || '';
}

function providerError(payload: Json): string {
  return payload?.error?.message || payload?.message || payload?.detail || 'Gemini returned no error details.';
}

async function extractAudioFromBlob(stream: ReadableStream<Uint8Array>, extension: string) {
  const executable = ffmpegPath;
  if (!executable) throw new Error('The bundled FFmpeg executable is unavailable.');
  const directory = await mkdtemp(path.join(os.tmpdir(), 'satvic-speaker-count-'));
  const inputPath = path.join(directory, `source${extension}`);
  const audioPath = path.join(directory, 'source-audio.mp3');
  try {
    await pipeline(
      Readable.fromWeb(stream as import('node:stream/web').ReadableStream<Uint8Array>),
      createWriteStream(inputPath),
    );
    let diagnostic = '';
    await new Promise<void>((resolve, reject) => {
      const child = spawn(executable, [
        '-nostdin', '-y', '-i', inputPath, '-map', '0:a:0', '-vn',
        '-ac', '2', '-ar', '24000', '-b:a', '64k', '-f', 'mp3', audioPath,
      ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
      child.stderr?.on('data', chunk => { diagnostic = `${diagnostic}${chunk}`.slice(-2000); });
      child.once('error', reject);
      child.once('close', code => code === 0
        ? resolve()
        : reject(new Error(/matches no streams/i.test(diagnostic)
          ? 'No audio track was found in the source video.'
          : `Could not prepare source audio for speaker detection. ${diagnostic.trim().split('\n').slice(-2).join(' ')}`)));
    });
    const audio = await readFile(audioPath);
    if (!audio.length) throw new Error('Audio extraction created an empty file.');
    return audio.toString('base64');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function detectSpeakers(audio: string) {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error('GEMINI_API_KEY is missing for speaker detection.');
  const models = [...new Set([
    process.env.GEMINI_MODEL?.trim() || 'gemini-3.8-flash',
    process.env.GEMINI_FALLBACK_MODEL?.trim() || 'gemini-3.5-flash-lite',
  ])];
  const body = {
    input: [
      {
        type: 'text',
        text: 'Diarize this audio as a sequence of speech turns. Return one segment for every contiguous spoken turn, including overlapping turns as separate segments. For every segment, provide startSeconds and endSeconds measured from the beginning of the audio, the exact audible words in text, and a stable speakerId. Reuse the same speakerId across turns whenever the voice identity matches. Assign a new speakerId only when the audible voice is genuinely different. Compare vocal identity using timbre, resonance, habitual pitch range, accent, and voice quality; do not split one person because they change emotion, loudness, or speaking style, and do not merge clearly different voices merely because they share a language or gender. Exclude music and sound effects. Listen through the entire recording before deciding the labels. Number IDs in order of first appearance (speaker_1, speaker_2, etc.). Do not return a standalone speaker count; the application derives it from the unique segment labels. If speech or speaker identity is unclear, explain the uncertainty in note instead of inventing turns. If no speech is audible, return an empty segments array and explain that in note.',
      },
      { type: 'audio', data: audio, mime_type: 'audio/mp3' },
    ],
    response_format: { type: 'text', mime_type: 'application/json', schema: speakerSchema },
    generation_config: { max_output_tokens: 6144 },
  };
  let lastError = '';
  for (const model of models) {
    try {
      const requestBody = JSON.stringify({ ...body, model });
      if (Buffer.byteLength(requestBody) > 18 * 1024 * 1024) throw new Error('The audio is too large for Gemini speaker detection. Use a shorter source clip.');
      const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
        method: 'POST',
        headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
        cache: 'no-store',
        body: requestBody,
        signal: AbortSignal.timeout(45_000),
      });
      const payload = await response.json().catch(() => ({})) as Json;
      if (!response.ok) {
        lastError = `Gemini speaker detection failed (${response.status}): ${providerError(payload)}`;
        if ([403, 404, 429, 500, 502, 503, 504].includes(response.status)) continue;
        throw new Error(lastError);
      }
      const text = outputText(payload).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      return { ...parseSpeakerDiarization(JSON.parse(text)), model };
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Gemini speaker detection failed.';
      if (/too large for Gemini speaker detection/.test(lastError)) throw error;
    }
  }
  throw new Error(lastError || 'Gemini speaker detection failed on the primary and fallback models.');
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Sign in before detecting speakers.' }, { status: 401 });
    if (!process.env.BLOB_READ_WRITE_TOKEN) return NextResponse.json({ error: 'Private video storage is not configured.' }, { status: 503 });

    const body = await request.json() as Json;
    const blobUrl = typeof body.originalBlobUrl === 'string' ? body.originalBlobUrl : '';
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(blobUrl);
    } catch {
      return NextResponse.json({ error: 'Upload the source video before detecting speakers.' }, { status: 400 });
    }
    if (parsedUrl.protocol !== 'https:' || !parsedUrl.hostname.endsWith('.blob.vercel-storage.com')) {
      return NextResponse.json({ error: 'Invalid source video URL.' }, { status: 400 });
    }
    const expectedPrefix = `satvic-users/${user.id}/satvic-jobs/`;
    const requestedPath = decodeURIComponent(parsedUrl.pathname).replace(/^\/+/, '');
    if (!requestedPath.startsWith(expectedPrefix)) return NextResponse.json({ error: 'That source video does not belong to your account.' }, { status: 403 });

    const blob = await get(blobUrl, { access: 'private' });
    if (!blob || blob.statusCode !== 200 || !blob.stream || !blob.blob.pathname.startsWith(expectedPrefix)) {
      return NextResponse.json({ error: 'The uploaded source video is no longer available in your account.' }, { status: 404 });
    }
    const extension = path.extname(blob.blob.pathname).toLowerCase();
    const supportedExtension = /^\.(mp4|mov|mkv|avi|webm|m4v|mp3|wav|m4a)$/.test(extension) ? extension : '.mp4';
    const audio = await extractAudioFromBlob(blob.stream, supportedExtension);
    const result = await detectSpeakers(audio);
    return NextResponse.json(result, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not detect speakers from the source audio.';
    console.error(`[api/jobs/speakers] ${message}`);
    return NextResponse.json({ error: message }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
}
