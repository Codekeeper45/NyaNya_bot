import { generateText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { config } from '../config.js';
import { createChildLogger } from '../lib/logger.js';

const log = createChildLogger('graphrag:extraction');

const openrouter = createOpenRouter({ apiKey: config.openrouterApiKey });
const EXTRACTION_MODEL = 'google/gemini-2.5-flash:free';

interface Triplet {
  subject: string;
  predicate: string;
  object: string;
}

const EXTRACTION_PROMPT = `Извлеки из текста ключевые сущности и связи между ними.

Правила:
- Сущности: конкретные люди, места, объекты, концепции, организации, события
- Связи: действия, отношения, атрибуты (работает в, живёт в, любит, имеет, создал и т.д.)
- Игнорируй общие фразы без конкретики
- Ответь ТОЛЬКО в формате JSON массива триплетов

Формат ответа:
[
  {"subject": "Имя сущности", "predicate": "связь", "object": "имя другой сущности"}
]

Если сущностей нет — верни пустой массив [].`;

export async function extractTriplets(text: string): Promise<Triplet[]> {
  if (!config.openrouterApiKey) {
    log.warn('OpenRouter key missing, skipping extraction');
    return [];
  }

  try {
    const { text: raw } = await generateText({
      model: openrouter.chat(EXTRACTION_MODEL),
      system: EXTRACTION_PROMPT,
      prompt: text.slice(0, 4000), // Limit to avoid token overflow
    });

    // Extract JSON from response (model may add markdown fences)
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      log.debug({ raw: raw.slice(0, 200) }, 'No JSON array found in extraction response');
      return [];
    }

    const triplets = JSON.parse(jsonMatch[0]) as Triplet[];
    const valid = triplets.filter(
      t => typeof t.subject === 'string' && typeof t.predicate === 'string' && typeof t.object === 'string'
    );

    log.debug({ count: valid.length }, 'Triplets extracted');
    return valid;
  } catch (err) {
    log.error({ err }, 'Extraction failed');
    return [];
  }
}
