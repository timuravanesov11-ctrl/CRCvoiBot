export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET") {
      return new Response("CRVoiceBot работает!");
    }

    if (request.method === "POST") {
      const update = await request.json();

      if (update.message) {
        const chatId = update.message.chat.id;
        const text = update.message.text || "";

        if (text === "/start") {
          await fetch(
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
        }
      }

      return new Response("OK");
    }

    return new Response("OK");
  }
};
