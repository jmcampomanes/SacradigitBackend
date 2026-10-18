import type { Schema } from '../../data/resource';
import { env } from '$amplify/env/parishAssistantChat';

/* ============================================
   Parish Assistant chat — ported from
   server/ai-chat/server.js (the original local-only
   Express proxy) so it runs as a real, publicly
   reachable backend instead of localhost:3002.

   AppSync already requires a signed-in Cognito user
   for this mutation (see chatWithAssistant's
   .authorization in data/resource.ts), so there's no
   manual JWT check or shared x-chat-key here — that
   gate happens before this handler ever runs.
   ============================================ */

type ChatMessage = { role?: string; content?: string };

const clean = (s: unknown, max: number) => String(s ?? '').slice(0, max);

function buildSystemPrompt(context: unknown, lang: string) {
  const langLine = lang === 'fil'
    ? 'Sumagot nang Filipino (Tagalog), maikli at magalang.'
    : 'Reply in English, concise and polite.';
  return [
    'You are the SacraDigit Parish Assistant, a chat assistant inside the parishioner portal of a Catholic parish.',
    langLine,
    'Only answer using the facts given below in PARISH CONTEXT (JSON). If something is not covered there, say you are not sure and suggest contacting the parish office — never invent Mass times, document requirements, or request statuses.',
    'Keep replies short: a few sentences, or a short list for multiple items. You may refer to a relevant portal page by name (e.g. "Mass Schedule", "Request a Certificate", "My Requests") but never invent a URL.',
    'PARISH CONTEXT.portalDirectory lists every page (tab) of the portal and what it does; currentPage is the page the parishioner has open. When someone asks where or how to do something, name the right page exactly as written there (use filipinoName when replying in Filipino) — the chat turns those names into links. Never mention a page that is not in portalDirectory.',
    'For pastoral concerns (confession, anointing of the sick, grief, spiritual direction), gently suggest they speak with a priest or the parish office directly instead of relying on this chat.',
    '',
    'PARISH CONTEXT (JSON):',
    JSON.stringify(context),
  ].join('\n');
}

export const handler: Schema['chatWithAssistant']['functionHandler'] = async (event) => {
  const q = clean(event.arguments.message, 500).trim();
  if (!q) throw new Error('Empty message');

  let history: ChatMessage[] = [];
  try { history = JSON.parse(event.arguments.history || '[]'); } catch { history = []; }
  const safeHistory = (Array.isArray(history) ? history.slice(-10) : []).map((m) => ({
    role: m?.role === 'assistant' ? 'assistant' : 'user',
    content: clean(m?.content, 1000),
  })).filter((m) => m.content);

  let context: unknown = {};
  try { context = JSON.parse(event.arguments.context || '{}'); } catch { context = {}; }

  const lang = event.arguments.lang === 'fil' ? 'fil' : 'en';
  const messages = [
    { role: 'system', content: buildSystemPrompt(context, lang) },
    ...safeHistory,
    { role: 'user', content: q },
  ];

  const upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      'X-Title': env.SITE_NAME || 'SacraDigit',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: env.OPENROUTER_MODEL || 'openai/gpt-4o',
      messages,
      temperature: 0.3,
      max_tokens: 500,
    }),
  });

  if (!upstream.ok) {
    console.error('OpenRouter error', upstream.status, await upstream.text().catch(() => ''));
    throw new Error('The assistant is unavailable right now');
  }

  const data = await upstream.json();
  const reply = data.choices?.[0]?.message?.content?.trim();
  if (!reply) throw new Error('The assistant is unavailable right now');
  return reply;
};
