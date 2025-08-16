const fetch = require('node-fetch');

const handler = async (msg, { conn, args, command }) => {
  const chatId = msg.key.remoteJid;
  const text = args.join(" ");
  const participant = msg.key.participant || msg.key.remoteJid;

  if (!text) {
    return conn.sendMessage(chatId, {
      text: `⚠️ *Uso:* ${command} <prompt del video>`,
    }, { quoted: msg });
  }

  try {
    // Reacción inicial
    if (msg?.key) await conn.sendMessage(chatId, { react: { text: "🎨", key: msg.key } });
    if (msg?.key) await conn.sendMessage(chatId, { react: { text: "🕕", key: msg.key } });

    // Llamada a la API
    const apiURL = `https://myapiadonix.vercel.app/api/veo3?prompt=${encodeURIComponent(text)}&apikey=adonixveo3`;
    const res = await fetch(apiURL);
    const json = await res.json();

    if (!json.success || !json.video_url) throw new Error(json.message || "No se pudo generar el video");

    // Limpiar URL por si hay espacios
    const videoUrl = json.video_url.trim();

    // Descargar video
    const videoRes = await fetch(videoUrl);
    const buffer = await videoRes.arrayBuffer().then(ab => Buffer.from(ab));

    // Enviar video
    await conn.sendMessage(chatId, {
      video: buffer,
      caption: `
━━━━━━━━━━━━━━
🎬 *VIDEO GENERADO*
━━━━━━━━━━━━━━
📌 *Prompt:* ${json.prompt}
🦖 *API:* myapiadonix.vercel.app
━━━━━━━━━━━━━━
      `,
      gifPlayback: false
    }, { quoted: msg.key ? msg : null });

    // Reacción final
    if (msg?.key) await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });

  } catch (err) {
    console.error("❌ Error en comando AI video:", err);

    if (msg?.key) {
      await conn.sendMessage(chatId, { react: { text: "⚠️", key: msg.key } });
    }

    conn.sendMessage(chatId, {
      text: "❌ Ocurrió un error al generar el video.",
    }, { quoted: msg });
  }
};

handler.command = ["aivideo", "videoai", "iavideo"];
handler.tags = ["ia"];
handler.help = ["aivideo <prompt>"];
module.exports = handler;