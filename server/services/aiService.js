/**
 * AI provider abstraction. The rest of the app only calls getProvider().analyze().
 * To switch providers, add a class with the same analyze() method and register it in getProvider().
 * NOTE: the model you configure must accept image input. If the AI call fails the image is NOT
 * stored (fail-closed), so nothing unchecked ever reaches your collection.
 */
class AiError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'AiError';
    this.isLimit = !!options.isLimit;
    this.status = options.status || null;
  }
}

const SYSTEM = `You are a content-safety and fashion-catalogue classifier.
Only judge: (1) is the image sexually explicit or does it contain nudity, (2) which clothing category fits best.
Never infer or mention gender, ethnicity, age, identity or who the person is.
Reply with JSON only: {"explicit": boolean, "reason": string, "category": string, "confidence": number 0-1, "labels": string[]}.
"category" must be exactly one of the allowed categories given by the user.`;

function normalise(raw, allowed) {
  return {
    explicit: raw.explicit === true,
    reason: String(raw.reason || '').slice(0, 500),
    category: allowed.includes(raw.category) ? raw.category : 'Other',
    confidence: Math.min(1, Math.max(0, Number(raw.confidence) || 0)),
    labels: Array.isArray(raw.labels) ? raw.labels.slice(0, 10).map(String) : [],
  };
}

class DeepSeekProvider {
  name = 'deepseek';
  async analyze(jpeg, allowed) {
    const key = process.env.DEEPSEEK_API_KEY;
    if (!key) throw new AiError('AI service is not configured (missing DEEPSEEK_API_KEY)');
    const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 30000);
    let res;
    try {
      res = await fetch(`${process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'}/chat/completions`, {
        method: 'POST', signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: process.env.DEEPSEEK_MODEL || 'deepseek-chat', temperature: 0,
          response_format: { type: 'json_object' },
          messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: [
            { type: 'text', text: `Allowed categories: ${allowed.join(', ')}` },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${jpeg.toString('base64')}` } }] }],
        }),
      });
    } catch { throw new AiError('Could not reach the AI service. Check your connection and try again.'); }
    finally { clearTimeout(timer); }
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      const isLimit = res.status === 429 || res.status === 503 || errText.toLowerCase().includes('quota') || errText.toLowerCase().includes('rate');
      throw new AiError(isLimit ? `AI service limit reached (${res.status}).` : `AI service error (${res.status}). The image was not saved.`, { isLimit, status: res.status });
    }
    try { return normalise(JSON.parse((await res.json()).choices[0].message.content), allowed); }
    catch { throw new AiError('AI service returned an unreadable answer. The image was not saved.'); }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class GeminiProvider {
  name = 'gemini';

  // Fallback model chain — tried in order if the primary model returns 404/503
  // Last verified: gemini-3.5-flash ✅, gemini-3.6-flash ✅, gemini-3.1-flash-lite ✅
  static FALLBACK_MODELS = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.1-flash-lite'];

  async #tryModel(model, jpeg, allowed, key, baseUrl) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 45000);
    let res;
    try {
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST', signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model, temperature: 0,
          response_format: { type: 'json_object' },
          messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: [
            { type: 'text', text: `Allowed categories: ${allowed.join(', ')}` },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${jpeg.toString('base64')}` } }] }],
        }),
      });
    } catch { throw new AiError('Could not reach the Gemini AI service. Check your connection and try again.'); }
    finally { clearTimeout(timer); }
    return res;
  }

  async analyze(jpeg, allowed) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new AiError('AI service is not configured (missing GEMINI_API_KEY)');
    const baseUrl = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai';
    const primaryModel = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

    // Build model chain: configured model first, then fallbacks (skip duplicates)
    const modelChain = [primaryModel, ...GeminiProvider.FALLBACK_MODELS.filter((m) => m !== primaryModel)];

    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 1000; // doubles each retry

    for (const model of modelChain) {
      let lastErr = null;
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        const res = await this.#tryModel(model, jpeg, allowed, key, baseUrl);

        if (res.ok) {
          try {
            const json = await res.json();
            const result = normalise(JSON.parse(json.choices[0].message.content), allowed);
            // Capture token usage when the API returns it
            if (json.usage) {
              result.inputTokens  = json.usage.prompt_tokens     ?? json.usage.input_tokens  ?? null;
              result.outputTokens = json.usage.completion_tokens ?? json.usage.output_tokens ?? null;
            }
            result.model = model;
            return result;
          } catch { throw new AiError('Gemini AI returned an unreadable answer. The image was not saved.'); }
        }

        const status = res.status;
        const errBody = await res.text().catch(() => '');

        // 404 = model deprecated/unavailable → skip to next model immediately
        if (status === 404) { lastErr = `model ${model} not found (404)`; break; }

        // 503 = overloaded → retry with backoff
        if (status === 503 && attempt < MAX_RETRIES) {
          console.warn(`[AI] Gemini 503 on ${model} (attempt ${attempt}/${MAX_RETRIES}), retrying in ${RETRY_DELAY_MS * attempt}ms…`);
          await sleep(RETRY_DELAY_MS * attempt);
          continue;
        }

        // Other errors (400, 401, 429, 500, 503 after retries) → throw
        const isLimit = status === 429 || status === 503 ||
          errBody.toLowerCase().includes('resource_exhausted') ||
          errBody.toLowerCase().includes('quota') ||
          errBody.toLowerCase().includes('rate');
        throw new AiError(
          isLimit ? `AI service limit reached (${status}): Quota or rate limit exceeded.` : `Gemini AI error (${status}): ${errBody.slice(0, 200)}. The image was not saved.`,
          { isLimit, status }
        );
      }
      if (lastErr) console.warn(`[AI] Skipping model: ${lastErr}`);
    }

    throw new AiError('All Gemini models are currently unavailable (503).', { isLimit: true, status: 503 });
  }
}

class MockProvider { // development only: approves everything as "Other"
  name = 'mock';
  async analyze(_j, allowed) { return normalise({ explicit: false, category: 'Other', confidence: 0.5, reason: 'mock provider' }, allowed); }
}

function getProvider() {
  const p = process.env.AI_PROVIDER || 'deepseek';
  if (p === 'mock') {
    if (process.env.NODE_ENV === 'production') throw new AiError('Mock AI provider is disabled in production');
    return new MockProvider();
  }
  if (p === 'gemini') return new GeminiProvider();
  return new DeepSeekProvider();
}
module.exports = { getProvider, AiError };

