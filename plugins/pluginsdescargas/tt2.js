// comandos/tiktok2.js
const axios = require("axios");

const API_BASE = process.env.API_BASE || "https://russellskyapi.ultraplus.click";
const API_KEY  = process.env.API_KEY  || "Russellxz"; // <-- tu API Key

const handler = async (msg, { conn, args, command }) => {
  const chatId = msg.key.remoteJid;
  const text   = (args || []).join(" ");
  const pref   = (global.prefixes && global.prefixes[0]) || ".";

  if (!text) {
    return conn.sendMessage(chatId, {
      text: `✳️ *Usa:*\n${pref}${command} <enlace>\nEj: *${pref}${command}* https://vm.tiktok.com/xxxxxx/`
    }, { quoted: msg });
  }

  const url = args[0];
  if (!/^https?:\/\//i.test(url) || !/tiktok\.com|vt\.tiktok\.com|vm\.tiktok\.com/i.test(url)) {
    return conn.sendMessage(chatId, { text: "❌ *Enlace de TikTok inválido.*" }, { quoted: msg });
  }

  try {
    await conn.sendMessage(chatId, { react: { text: "⏱️", key: msg.key } });

    // Llamada a tu endpoint protegido con API Key (GET + header Authorization)
    const { data: res } = await axios.get(`${API_BASE}/api/download/tiktok.php`, {
      params: { url },
      headers: { Authorization: `Bearer ${API_KEY}` },
      timeout: 25000,
      validateStatus: s => s >= 200 && s < 500
    });

    if (!res || res.status !== "true" || !res.data || !res.data.video) {
      throw new Error(res?.error || "La API no devolvió un video válido.");
    }

    const data = res.data;
    const title    = data.title || "TikTok";
    const author   = (data.author && (data.author.name || data.author.username)) || "Desconocido";
    const duration = data.duration ? `${data.duration}s` : "—";
    const likes    = data.likes ?? 0;
    const comments = data.comments ?? 0;

    const caption =
`🎵 *TikTok descargado*
• *Título:* ${title}
• *Autor:* ${author}
• *Duración:* ${duration}
• 👍 ${likes}  ·  💬 ${comments}
— SkyUltraPlus API`;

    // Enviar directo por URL (sin guardar a disco)
    await conn.sendMessage(chatId, {
      video: { url: data.video },
      mimetype: "video/mp4",
      caption
    }, { quoted: msg });

    // Si quieres enviar también el audio, descomenta:
    // if (data.audio) {
    //   await conn.sendMessage(chatId, {
    //     audio: { url: data.audio },
    //     mimetype: "audio/mpeg",
    //     ptt: false
    //   }, { quoted: msg });
    // }

    await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });

  } catch (err) {
    console.error("❌ Error en tiktok2:", err?.message || err);
    await conn.sendMessage(chatId, {
      text: "❌ *Ocurrió un error al procesar el TikTok.*"
    }, { quoted: msg });
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
  }
};

handler.command = ["tiktok2","tt2"];
module.exports = handler;
