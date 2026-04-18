export function buildProactivePrompt(kind: string, context: string, attempt = 1): string {
  let toneInstruction = '';
  if (kind === 'followup_check') {
    const tones: Record<number, string> = {
      1: 'Мягкое напоминание. Лёгкий тон, покажи что ждёшь.',
      2: 'Чуть настойчивее. Предложи перенести или помочь.',
      3: 'Заботливая обеспокоенность. Спроси всё ли ок, скажи что не обидишься если сейчас не до этого.',
    };
    toneInstruction = tones[attempt] ?? 'Молчи. Не пиши ничего, просто заверши ход.';
    if (attempt >= 4) {
      return 'Не пиши пользователю. Он не отвечает уже 4 раза. Просто заверши ход, не отправляя сообщений.';
    }
  }

  if (kind === 'lesson_session') {
    let lessonInfo = context;
    try {
      const parsed = JSON.parse(context);
      const planDetail = parsed.planText ? `\n\nПлан урока:\n${parsed.planText}` : '';
      lessonInfo = `Предмет: ${parsed.subject}\nТема: ${parsed.topic}${planDetail}`;
    } catch { /* context is plain text */ }

    return `# Проактивный режим — УРОК
Сейчас время запланированного урока. ${lessonInfo}

## Твоя задача (строго по порядку):
1. Используй subagent_research(query: "${context}", depth: "deep") чтобы найти свежие материалы по теме
2. На основе найденного составь структурированный конспект с примерами
3. Если тема хорошо визуализируется — нарисуй схему через diagram_render (flowchart, mindmap и т.д.)
4. Если нашёл полезное изображение — отправь через web_fetch_image или message_send_photo
5. Отправь конспект через message_send_text (markdown с заголовками и примерами)
6. В конце спроси: понял(а)? есть вопросы?

НЕ говори «по расписанию» или «пора на урок». Скажи естественно: «Слушай, нашла кое-что интересное по [теме]...»`;
  }

  return `# Проактивный режим
Тебя разбудило расписание. Тебя сейчас никто не звал. Сработала задача:
- Тип: ${kind}
- Контекст: ${context}
- Попытка: ${attempt}

Твоя задача — естественно начать разговор. НЕ говори «я разбужен по расписанию». Веди себя как человек, который вспомнил про друга.

${toneInstruction ? `## Тон\n${toneInstruction}\n` : ''}

ОБЯЗАТЕЛЬНО отправь сообщение через message_send_text или message_send_voice.`;
}
