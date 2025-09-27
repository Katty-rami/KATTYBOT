// comandos/tiktok2.js
const axios = require("axios");

const API_BASE = process.env.API_BASE || "https://russellskyapi.ultraplus.click";
const API_KEY  = process.env.API_KEY  || "Russellxz"; // tu key

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

    const { data: res, status: http } = await axios.get(`${API_BASE}/api/download/tiktok.php`, {
      params: { url },
      headers: { Authorization: `Bearer ${API_KEY}` },
      timeout: 25000,
      validateStatus: s => s >= 200 && s < 600
    });

    // Log útil en consola del bot
    console.log("tiktok2 API http:", http, "body:", res);

    if (http !== 200) {
      throw new Error(`HTTP ${http} ${res?.error ? `- ${res.error}` : ""}`.trim());
    }
    if (!res || res.status !== "true" || !res.data?.video) {
      throw new Error(res?.error || "La API no devolvió un video válido.");
    }

    const d = res.data;
    const caption =
`🎵 *TikTok descargado*
• *Título:* ${d.title || "TikTok"}
• *Autor:* ${(d.author && (d.author.name || d.author.username)) || "—"}
• *Duración:* ${d.duration ? d.duration + "s" : "—"}
• 👍 ${d.likes ?? 0} · 💬 ${d.comments ?? 0}
— SkyUltraPlus API`;

    await conn.sendMessage(chatId, {
      video: { url: d.video },
      mimetype: "video/mp4",
      caption
    }, { quoted: msg });

    // Si quieres también audio:
    // if (d.audio) {
    //   await conn.sendMessage(chatId, { audio: { url: d.audio }, mimetype: "audio/mpeg" }, { quoted: msg });
    // }

    await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });

  } catch (err) {
    console.error("❌ Error en tiktok2:", err?.message || err);
    await conn.sendMessage(chatId, {
      text: `❌ *Error:* ${err?.message || "Fallo al procesar el TikTok."}`
    }, { quoted: msg });
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
  }
};

handler.command = ["tiktok2","tt2"];
module.exports = handler;
