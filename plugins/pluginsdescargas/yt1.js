const axios = require("axios");
const fs = require("fs");
const path = require("path");

const API_BASE = process.env.API_BASE || "https://russellskyapi.ultraplus.click";
const API_KEY  = process.env.API_KEY  || "Russellxz"; // prod: usa variables de entorno

const handler = async (msg, { conn, args, command }) => {
  const jid = msg.key.remoteJid;
  const text = args.join(" ").trim();
  const pref = global.prefixes?.[0] || ".";

  if (!text) {
    return conn.sendMessage(jid, {
      text: `✳️ *Usa:*\n${pref}${command} <url> [--video]\nEj: ${pref}${command} https://youtu.be/xxxxxx`
    }, { quoted: msg });
  }

  // flags
  const wantVideo = /\b(--video|-v)\b/i.test(text);
  const url = text.replace(/\s+(--video|-v)\b/i, "").trim();

  if (!/^https?:\/\//i.test(url) ||
      (!/youtube\.com|youtu\.be|music\.youtube\.com/i.test(url))) {
    return conn.sendMessage(jid, {
      text: "❌ *URL de YouTube inválida.*"
    }, { quoted: msg });
  }

  try {
    await conn.sendMessage(jid, { react: { text: "⏱️", key: msg.key } });

    // Llamada a TU API (con descuenta de soli en servidor)
    const r = await axios.get(`${API_BASE}/api/download/yt.php`, {
      params: { url, format: wantVideo ? "video" : "audio" },
      headers: { Authorization: `Bearer ${API_KEY}` },
      timeout: 30000
    });

    const payload = r.data;
    if (!payload?.data) throw new Error("Respuesta inválida del API");

    const { title, video, audio } = payload.data;

    const mediaUrl = wantVideo ? (video || audio) : (audio || video);
    if (!mediaUrl) throw new Error("No se encontró media para enviar.");

    // Descarga a /tmp local para chequear tamaño
    const tmpDir = path.resolve("./tmp");
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);
    const ext = wantVideo ? "mp4" : "mp3";
    const filePath = path.join(tmpDir, `yt-${Date.now()}.${ext}`);

    const stream = await axios.get(mediaUrl, { responseType: "stream" });
    const writer = fs.createWriteStream(filePath);
    await new Promise((resolve, reject) => {
      stream.data.pipe(writer);
      writer.on("finish", resolve);
      writer.on("error", reject);
    });

    // Límite típico de WhatsApp 100 MB aprox.
    const sizeMB = fs.statSync(filePath).size / (1024 * 1024);
    if (sizeMB > 99) {
      fs.unlinkSync(filePath);
      await conn.sendMessage(jid, { text: `❌ Archivo de ${sizeMB.toFixed(2)}MB excede 99MB.` }, { quoted: msg });
      await conn.sendMessage(jid, { react: { text: "❌", key: msg.key } });
      return;
    }

    const caption = `📺 *YouTube DL* ${wantVideo ? "(video)" : "(audio)"}\n` +
                    `• *Título:* ${title || "Sin título"}\n` +
                    `• *API:* SkyUltraPlus`;

    if (wantVideo) {
      await conn.sendMessage(jid, {
        video: fs.readFileSync(filePath),
        mimetype: "video/mp4",
        caption
      }, { quoted: msg });
    } else {
      await conn.sendMessage(jid, {
        audio: fs.readFileSync(filePath),
        mimetype: "audio/mpeg",
        ptt: false
      }, { quoted: msg });
      await conn.sendMessage(jid, { text: caption }, { quoted: msg });
    }

    fs.unlinkSync(filePath);
    await conn.sendMessage(jid, { react: { text: "✅", key: msg.key } });

  } catch (err) {
    console.error("yt2 error:", err?.message || err);
    try {
      await conn.sendMessage(jid, { text: "❌ Ocurrió un error procesando el enlace." }, { quoted: msg });
      await conn.sendMessage(jid, { react: { text: "❌", key: msg.key } });
    } catch {}
  }
};

handler.command = ["yt1", "ytdl"];
module.exports = handler;
