const DEFAULT_MODEL = process.env.REACT_APP_OPENAI_MODEL || 'gpt-4o-mini';
const DEFAULT_MAX_TOKENS = 900;
const API_URL = process.env.REACT_APP_OPENAI_API_URL || 'https://api.openai.com/v1/chat/completions';
const API_KEY = process.env.REACT_APP_OPENAI_API_KEY || '';

function isBrowser() {
  return typeof window !== 'undefined' && typeof window.fetch === 'function';
}

async function callChatCompletion({ messages, temperature = 0.8, maxTokens = DEFAULT_MAX_TOKENS, responseFormat = null }) {
  if (!API_KEY) {
    console.warn('[OpenAI] API key not configured. Set REACT_APP_OPENAI_API_KEY to enable AI headlines.');
    return null;
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('callChatCompletion requires at least one message.');
  }

  if (!isBrowser()) {
    console.warn('[OpenAI] Chat completion attempted outside browser environment.');
    return null;
  }

  try {
    const payload = {
      model: DEFAULT_MODEL,
      messages,
      temperature,
      max_tokens: maxTokens,
    };
    if (responseFormat) {
      payload.response_format = { type: responseFormat };
    }

    const response = await window.fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[OpenAI] Request failed', response.status, errorText);
      return null;
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return null;
    return content.trim();
  } catch (err) {
    console.error('[OpenAI] Error requesting completion', err);
    return null;
  }
}

function extractJsonPayload(text) {
  if (!text) return null;
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\n([\s\S]*?)```/i);
  const jsonText = fenceMatch ? fenceMatch[1] : trimmed;
  try {
    return JSON.parse(jsonText);
  } catch (err) {
    console.warn('[OpenAI] Failed to parse JSON response', err);
    return null;
  }
}

export { callChatCompletion, extractJsonPayload };
