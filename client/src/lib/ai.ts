export type AiProvider = 'openrouter' | 'gemini' | 'deepseek' | 'openai'
export type AiMode = 'sentence' | 'bullet' | 'table'

export type ModelOption = {
  id: string
  label: string
  badge: string
}

export type ProviderConfig = {
  name: string
  placeholder: string
  hint: string
  tag: string
  tagColor: string
  icon: string
  models: ModelOption[]
}

export const PROVIDERS: Record<AiProvider, ProviderConfig> = {
  openrouter: {
    name: 'OpenRouter',
    placeholder: 'sk-or-v1-...',
    hint: 'All-in-one gateway: 1 single key gives access to Claude 3.5, Gemini 2.0, DeepSeek V3/R1, GPT-4o, and Llama 3.3.',
    tag: 'All-in-One',
    tagColor: '#2563eb',
    icon: '🌐',
    models: [
      { id: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet', badge: '⭐ Recommended' },
      { id: 'google/gemini-2.0-flash-001', label: 'Gemini 2.0 Flash', badge: '⚡ Ultra Fast' },
      { id: 'deepseek/deepseek-chat', label: 'DeepSeek V3', badge: '🔥 Popular' },
      { id: 'deepseek/deepseek-r1', label: 'DeepSeek R1', badge: '🧠 Reasoning' },
      { id: 'openai/gpt-4o', label: 'GPT-4o', badge: 'Flagship' },
      { id: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B', badge: 'Open' },
    ],
  },
  gemini: {
    name: 'Google Gemini',
    placeholder: 'AIzaSy...',
    hint: 'Direct Google AI Studio API key (free tier available at aistudio.google.com).',
    tag: 'Direct API',
    tagColor: '#db2777',
    icon: '✨',
    models: [
      { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', badge: '⚡ Ultra Fast' },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', badge: '⚡ Fast & Capable' },
      { id: 'gemini-flash-latest', label: 'Gemini Flash Latest', badge: '⚡ Auto-Updating' },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', badge: '🧠 Deep Reasoning' },
    ],
  },
  deepseek: {
    name: 'DeepSeek Direct',
    placeholder: 'sk-...',
    hint: 'Direct DeepSeek API key from platform.deepseek.com.',
    tag: 'Direct API',
    tagColor: '#059669',
    icon: '⚡',
    models: [
      { id: 'deepseek-chat', label: 'DeepSeek-V3', badge: '⚡ Fast & Crisp' },
      { id: 'deepseek-reasoner', label: 'DeepSeek-R1', badge: '🧠 Deep Reasoner' },
    ],
  },
  openai: {
    name: 'OpenAI Direct',
    placeholder: 'sk-proj-...',
    hint: 'Direct OpenAI API key from platform.openai.com.',
    tag: 'Direct API',
    tagColor: '#0f172a',
    icon: '🤖',
    models: [
      { id: 'gpt-4o', label: 'GPT-4o', badge: '⭐ Flagship' },
      { id: 'gpt-4o-mini', label: 'GPT-4o Mini', badge: '⚡ Fast' },
      { id: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo', badge: 'Legacy' },
    ],
  },
}

export function sanitizeTableHtml(rawHtml: string): string {
  if (!rawHtml || !rawHtml.includes('<table')) return rawHtml

  try {
    if (typeof DOMParser === 'undefined') return rawHtml

    const parser = new DOMParser()
    const doc = parser.parseFromString(rawHtml, 'text/html')
    const table = doc.querySelector('table')
    if (!table) return rawHtml

    // Remove any rows where all cells are empty, whitespace, &nbsp;, or filler dashes
    const allRows = table.querySelectorAll('tr')
    allRows.forEach((row) => {
      const cells = row.querySelectorAll('th, td')
      if (cells.length === 0) {
        row.remove()
        return
      }

      const allCellsEmpty = Array.from(cells).every((cell) => {
        const text = (cell.textContent || '')
          .replace(/[\u00a0\s\r\n\t]/g, '')
          .trim()
        return text === '' || text === '-' || text === '—' || text === 'N/A' || text === 'n/a'
      })

      if (allCellsEmpty) {
        row.remove()
      }
    })

    // Remove empty tbody elements if any
    const tbodies = table.querySelectorAll('tbody')
    tbodies.forEach((tbody) => {
      if (tbody.querySelectorAll('tr').length === 0) {
        tbody.remove()
      }
    })

    return table.outerHTML
  } catch {
    return rawHtml
  }
}

export function cleanAiFences(raw: string): string {
  let text = raw.trim()
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:html)?\s*\n?/, '').replace(/\n?```\s*$/, '').trim()
  }
  if (text.includes('<table')) {
    text = sanitizeTableHtml(text)
  }
  return text
}

export function getAiConfig(): {
  provider: AiProvider
  key: string
  model: string
  isLive: boolean
} {
  const provider = (localStorage.getItem('dx_ai_provider') as AiProvider) || 'openrouter'
  const key = (localStorage.getItem(`dx_key_${provider}`) || '').trim()
  let model =
    localStorage.getItem(`dx_model_${provider}`) || PROVIDERS[provider].models[0].id

  // Migrate any stored deprecated/invalid Gemini model id to a real API model.
  if (provider === 'gemini') {
    const validGemini = new Set([
      'gemini-2.0-flash',
      'gemini-2.5-flash',
      'gemini-flash-latest',
      'gemini-2.5-pro',
    ])
    if (!validGemini.has(model)) {
      model = 'gemini-2.0-flash'
      try {
        localStorage.setItem('dx_model_gemini', model)
      } catch {
        // ignore
      }
    }
  }

  const isLive = key.length > 5

  return { provider, key, model, isLive }
}

export function saveAiConfig(provider: AiProvider, key: string, model: string) {
  localStorage.setItem('dx_ai_provider', provider)
  localStorage.setItem(`dx_key_${provider}`, key.trim())
  localStorage.setItem(`dx_model_${provider}`, model)
}

export async function transformText(params: {
  text: string
  mode: AiMode
  contextBefore?: string
  contextAfter?: string
  customInstruction?: string
}): Promise<string> {
  const { text, mode, contextBefore, contextAfter, customInstruction } = params
  const { provider, key, model, isLive } = getAiConfig()

  let systemPrompt = ''
  if (mode === 'sentence') {
    systemPrompt =
      'You are an expert editor. Rewrite the given text into crisp, clear, and impactful sentence(s) while retaining all underlying information and key details without omission. If any statement is ambiguous, use the provided surrounding document context to resolve the ambiguity into precise meaning. Ensure seamless narrative flow and logical coherence where each statement connects naturally to the next. Eliminate all gibberish, filler words, redundancy, and unwanted text. Output ONLY the polished rewritten text without markdown fences, greetings, or commentary.'
  } else if (mode === 'bullet') {
    systemPrompt =
      'You are an expert editor. Convert the given text into crisp, clear, and well-structured bullet points while retaining all underlying information and key details without omission. If any statement is ambiguous, use the provided surrounding document context to resolve the ambiguity into precise meaning. Ensure logical progression and smooth flow between points. Eliminate all gibberish, filler words, redundancy, and unwanted text. Output ONLY an HTML unordered list (<ul><li>...</li></ul>) without markdown code fences, greetings, or commentary.'
  } else {
    // mode === 'table'
    systemPrompt =
      'You are an expert data analyst and editor. Your task is to evaluate the SELECTED TEXT and, if appropriate, convert its key data points into a clean, compact, perfectly fitted HTML table (<table><thead><tr><th>...</th></tr></thead><tbody><tr><td>...</td></tr></tbody></table>).\n\n' +
      'CRITICAL RULES:\n' +
      '1. FEASIBILITY CHECK: First evaluate if the SELECTED TEXT genuinely contains multiple distinct data points, metrics, parameters, or structured facts suitable for a table. If the text is purely narrative prose, opinion, broad discussion, or an unstructured thought that cannot be meaningfully tabulated, DO NOT generate a table. Instead, return ONLY:\n' +
      '⚠️ This content cannot be meaningfully tabularized as it does not contain distinct structured data points or metrics. Consider using Crispify or Bulletize instead.\n' +
      '2. CONDENSE & COMPACT: Keep cell contents condensed into short phrases, numbers, and key terms. Never write long narrative paragraphs inside table cells so the table stays neat and compact without overflowing.\n' +
      '3. COLUMN EFFICIENCY: Use between 2 to 4 concise column headers (e.g. "Item", "Owner", "Metric / Status", "Timeline") to guarantee the table fits standard document width without horizontal distortion.\n' +
      '4. STRICT SCOPE: Tabularize ONLY data points from the SELECTED TEXT. Use the BEFORE CONTEXT and AFTER CONTEXT strictly for background interpretation (e.g. resolving pronouns, system names, or units).\n' +
      '5. NO EMPTY ROWS OR GHOST ROWS: Absolutely DO NOT output any empty rows, blank trailing rows, or placeholder cells (e.g. <tr><td></td><td></td></tr> or cells with just spaces, dashes, or &nbsp;). Every row in <tbody> MUST contain substantive data directly from the text.\n' +
      '6. OUTPUT FORMAT: If generating a table, output ONLY the HTML table starting with <table> and ending with </table>. No markdown code fences, greetings, or explanations.'
  }

  const userContent =
    `[DOCUMENT CONTEXT BEFORE (UP TO 1000 CHARACTERS)]\n` +
    `${contextBefore?.trim() ? contextBefore.trim() : '(None)'}\n\n` +
    `[SELECTED TEXT TO TRANSFORM]\n` +
    `${text.trim()}\n\n` +
    `[DOCUMENT CONTEXT AFTER (UP TO 1000 CHARACTERS)]\n` +
    `${contextAfter?.trim() ? contextAfter.trim() : '(None)'}` +
    (customInstruction ? `\n\n[USER INSTRUCTION]\n${customInstruction}` : '')

  if (isLive) {
    if (provider === 'gemini') {
      const callGemini = async (targetModel: string) => {
        return fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${key}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              system_instruction: { parts: [{ text: systemPrompt }] },
              contents: [{ parts: [{ text: userContent }] }],
              generationConfig: { temperature: mode === 'table' ? 0.2 : 0.3 },
            }),
          },
        )
      }

      let res = await callGemini(model)
      // Auto-fallback to a resilient model if a 503 high-demand spike occurs
      if (res.status === 503 && model !== 'gemini-2.0-flash') {
        res = await callGemini('gemini-2.0-flash')
      }

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error?.message || 'Gemini API failed')
      }
      const data = await res.json()
      const out = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
      if (out) return cleanAiFences(out)
      throw new Error('Gemini returned an empty response')
    } else if (provider === 'deepseek') {
      const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent },
          ],
          temperature: mode === 'table' ? 0.2 : 0.3,
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error?.message || 'DeepSeek API failed')
      }
      const data = await res.json()
      const out = data.choices?.[0]?.message?.content?.trim()
      if (out) return cleanAiFences(out)
      throw new Error('DeepSeek returned an empty response')
    } else if (provider === 'openai') {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent },
          ],
          temperature: mode === 'table' ? 0.2 : 0.3,
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error?.message || 'OpenAI API failed')
      }
      const data = await res.json()
      const out = data.choices?.[0]?.message?.content?.trim()
      if (out) return cleanAiFences(out)
      throw new Error('OpenAI returned an empty response')
    } else {
      // OpenRouter universal
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
          'HTTP-Referer': window.location.href,
          'X-Title': 'DXEditor AI Rewrite',
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent },
          ],
          temperature: mode === 'table' ? 0.2 : 0.3,
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error?.message || 'OpenRouter API failed')
      }
      const data = await res.json()
      const out = data.choices?.[0]?.message?.content?.trim()
      if (out) return cleanAiFences(out)
      throw new Error('OpenRouter returned an empty response')
    }
  }

  // No live key configured — do NOT silently echo the text back. The AI key is
  // mandatory; surface a clear error so the user knows why nothing happened.
  throw new Error(
    'No valid AI API key configured. Open AI Settings (⚙️) and add your key to use AI features.',
  )
}

