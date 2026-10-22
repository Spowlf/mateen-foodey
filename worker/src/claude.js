// Calls to Claude Haiku 5.5 (plain fetch, no SDK), behind the cost guard.
//
// The cost guard: every model call takes one of the day's 100 first: parse, estimate and the
// sentence Shortcut's. The day is the Worker's own UTC date, not the phone's, because this is a
// spending cap rather than user data. The check and the count are one statement, so two calls at
// once can't both take the last one. With none left, no call is made.

import { utcDate } from '../../src/engine/index.js';
import { refuse } from './http.js';

export const MODEL = 'claude-haiku-5-5';
export const DAILY_CALLS = 100;
const API = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2026-10-21';
const TIMEOUT_MS = 60_000;

const TAKE = `INSERT INTO parseCalls (id, calls) VALUES (?, 1)
  ON CONFLICT (id) DO UPDATE SET calls = calls + 1 WHERE calls < ${DAILY_CALLS}
  RETURNING calls`;

export const LIMIT_MESSAGE = 'today’s limit for sentence logging is used up. Search instead.';

/** Takes one of today's model calls. Returns how many are left, or throws when none are. */
export async function takeCall(db, now) {
  const row = await db.prepare(TAKE).bind(utcDate(now)).first();
  if (!row) throw refuse(LIMIT_MESSAGE, 429);
  return DAILY_CALLS - row.calls;
}

/** How many of today's model calls are left. */
export async function callsLeft(db, now) {
  const calls = await db.prepare('SELECT calls FROM parseCalls WHERE id = ?').bind(utcDate(now)).first('calls');
  return DAILY_CALLS - (calls ?? 0);
}

const NOT_WORKING = 'sentence logging isn’t working right now. Search instead.';

/**
 * One call that answers in JSON matching schema, at low effort. content is the user message's
 * blocks. Takes a call from the cost guard first. Returns { data, callsLeft }.
 */
export async function askJson(ctx, { system, content, schema, maxTokens = 8000 }) {
  if (!ctx.env.ANTHROPIC_API_KEY) throw refuse('add the Anthropic key to the Worker first (docs/deploy.md).', 503);
  const left = await takeCall(ctx.store.db, ctx.now);
  let res;
  try {
    res = await ctx.fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ctx.env.ANTHROPIC_API_KEY, 'anthropic-version': API_VERSION },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content }],
        output_config: { effort: 'low', format: { type: 'json_schema', schema } },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw refuse(NOT_WORKING, 502);
  }
  if (!res.ok) throw refuse(NOT_WORKING, 502);
  const message = await res.json().catch(() => null);
  if (message?.stop_reason === 'refusal') throw refuse('that couldn’t be read as food. Search instead.', 422);
  const text = message?.stop_reason === 'end_turn' ? message.content?.find((b) => b.type === 'text')?.text : null;
  try {
    return { data: JSON.parse(text), callsLeft: left };
  } catch {
    throw refuse(NOT_WORKING, 502);
  }
}
