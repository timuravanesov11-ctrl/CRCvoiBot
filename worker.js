
export default {
  async fetch(request, env) {
    if (request.method === "GET") {
      return new Response("CRVoiceBot работает!");
    }

    if (request.method === "POST") {
      try {
        const update = await request.json();

        // Показываем, что именно Telegram отправил боту
        console.log("TELEGRAM UPDATE:", JSON.stringify(update));

        if (update.message?.text?.startsWith("/start")) {
          const chatId = update.message.chat.id;

          if (!env.BOT_TOKEN) {
            console.error("ОШИБКА: BOT_TOKEN не найден!");
            return new Response("Token missing");
          }

          const response = await fetch(
            `https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                chat_id: chatId,
                text: "Привет! 🎙 CRVoiceBot готов к работе!"
              })
            }
          );

          const result = await response.json();

          console.log("Telegram API:", JSON.stringify(result));
        }

        return new Response("OK");
      } catch (error) {
        console.error("Worker error:", error.message);
        return new Response("Error", { status: 500 });
      }
    }

    return new Response("OK");
  }
};
