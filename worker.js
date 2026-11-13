
export default {
  async fetch(request, env) {
    if (request.method === "GET") {
      return new Response("CRCVoiBot работает!");
    }

    if (request.method !== "POST") {
      return new Response("OK");
    }

    try {
      if (!env.BOT_TOKEN || !env.ELEVENLABS_API_KEY) {
        throw new Error("Не найдены секреты BOT_TOKEN или ELEVENLABS_API_KEY");
      }

      const update = await request.json();

      if (update.callback_query) {
        await handleCallback(update.callback_query, env, request.url);
      } else if (update.message) {
        await handleMessage(update.message, env, request.url);
      }

      return new Response("OK");
    } catch (error) {
      console.error("Worker error:", error.message);
      return new Response("Ошибка", { status: 500 });
    }
  }
};

async function telegram(method, data, env) {
  const response = await fetch(
    `https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    }
  );

  const result = await response.json();

  if (!result.ok) {
    throw new Error("Ошибка Telegram: " + JSON.stringify(result));
  }

  return result;
}

async function sendMessage(chatId, text, env, extra = {}) {
  return telegram("sendMessage", {
    chat_id: chatId,
    text,
    ...extra
  }, env);
}

function voiceCacheKey(requestUrl, chatId) {
  const origin = new URL(requestUrl).origin;
  return new Request(`${origin}/__voice_selection/${chatId}`);
}

async function saveVoice(chatId, voiceId, requestUrl) {
  const cache = caches.default;
  const key = voiceCacheKey(requestUrl, chatId);

  await cache.put(
    key,
    new Response(JSON.stringify({ voiceId }), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=86400"
      }
    })
  );
}

async function getVoice(chatId, requestUrl) {
  const cache = caches.default;
  const saved = await cache.match(voiceCacheKey(requestUrl, chatId));

  if (!saved) return null;

  const data = await saved.json();
  return data.voiceId || null;
}

async function clearVoice(chatId, requestUrl) {
  const cache = caches.default;
  await cache.delete(voiceCacheKey(requestUrl, chatId));
}

async function handleMessage(message, env, requestUrl) {
  const chatId = message.chat.id;
  const text = (message.text || "").trim();

  if (!text) return;

  const command = text.split(/\s+/)[0].split("@")[0].toLowerCase();

  if (command === "/start" || command === "/help") {
    await sendMessage(
      chatId,
      "Привет! 🎙 Я бот для озвучки текста.\n\n" +
      "Как пользоваться:\n" +
      "1. Напиши /voice и выбери голос.\n" +
      "2. Отправь мне любой текст.\n" +
      "3. Я верну тебе озвучку в MP3.\n\n" +
      "Команды:\n" +
      "/voice — выбрать голос\n" +
      "/cancel — сбросить выбранный голос\n" +
      "/help — помощь",
      env
    );
    return;
  }

  if (command === "/voice") {
    await sendMessage(chatId, "Загружаю голоса ElevenLabs...", env);

    const response = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: {
        "xi-api-key": env.ELEVENLABS_API_KEY
      }
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("ElevenLabs voices error:", error);
      await sendMessage(chatId, "Не удалось загрузить голоса. Попробуй позже.", env);
      return;
    }

    const data = await response.json();
    const voices = (data.voices || []).slice(0, 10);

    if (!voices.length) {
      await sendMessage(chatId, "ElevenLabs не вернул список голосов.", env);
      return;
    }

    const keyboard = [];

    for (const voice of voices) {
      keyboard.push([{
        text: voice.name,
        callback_data: "voice:" + voice.voice_id
      }]);
    }

    await sendMessage(chatId, "Выбери голос:", env, {
      reply_markup: {
        inline_keyboard: keyboard
      }
    });
    return;
  }

  if (command === "/cancel") {
    await clearVoice(chatId, requestUrl);
    await sendMessage(chatId, "Выбранный голос сброшен. Напиши /voice, чтобы выбрать другой.", env);
    return;
  }

  if (text.startsWith("/")) {
    await sendMessage(chatId, "Неизвестная команда. Напиши /help.", env);
    return;
  }

  const voiceId = await getVoice(chatId, requestUrl);

  if (!voiceId) {
    await sendMessage(chatId, "Сначала выбери голос командой /voice.", env);
    return;
  }

  await sendMessage(chatId, "🎙 Озвучиваю текст, подожди...", env);

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_22050_32`,
    {
      method: "POST",
      headers: {
        "xi-api-key": env.ELEVENLABS_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2"
      })
    }
  );

  if (!response.ok) {
    const error = await response.text();
    console.error("ElevenLabs TTS error:", error);
    await sendMessage(chatId, "Не получилось создать озвучку. Проверь доступность голоса и лимиты ElevenLabs.", env);
    return;
  }

  const audioBuffer = await response.arrayBuffer();
  const form = new FormData();

  form.append("chat_id", String(chatId));
  form.append(
    "audio",
    new Blob([audioBuffer], { type: "audio/mpeg" }),
    "voice.mp3"
  );

  const telegramResponse = await fetch(
    `https://api.telegram.org/bot${env.BOT_TOKEN}/sendAudio`,
    {
      method: "POST",
      body: form
    }
  );

  const result = await telegramResponse.json();

  if (!result.ok) {
    console.error("Telegram audio error:", JSON.stringify(result));
    await sendMessage(chatId, "Не удалось отправить аудио в Telegram.", env);
  }
}

async function handleCallback(callback, env, requestUrl) {
  const chatId = callback.message?.chat?.id;
  const data = callback.data || "";

  await telegram("answerCallbackQuery", {
    callback_query_id: callback.id
  }, env);

  if (!chatId || !data.startsWith("voice:")) return;

  const voiceId = data.slice("voice:".length);

  if (!voiceId) return;

  await saveVoice(chatId, voiceId, requestUrl);

  await sendMessage(
    chatId,
    "✅ Голос выбран!\n\nТеперь отправь мне текст, который нужно озвучить.",
    env
  );
      }
