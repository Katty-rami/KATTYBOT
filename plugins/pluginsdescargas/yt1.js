// yt1.js — YouTube -> AUDIO
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const API_BASE = process.env.API_BASE || "https://russellskyapi.ultraplus.click";
const API_KEY  = process.env.API_KEY  || "Russellxz";

function isYouTube(u){
  return /^https?:\/\//i.test(u) && /(youtube\.com|youtu\.be|music\.youtube\.com)/i.test(u);
}

function pickAudioMime(filePath, fallback="audio/mpeg"){
  const ext = path.extname(filePath).toLowerCase().replace(".", "");
  if (ext === "m4a") return "audio/mp4";
  if (ext === "mp3") return "audio/mpeg";
  if (ext === "webm") return "audio/webm";
  return fallback;
}

const handler = async (msg, { conn, args, command }) => {
  const jid  = msg.key.remoteJid;
  const url  = (args.join(" ") || "").trim();
  const pref = global.prefixes?.[0] || ".";

  if (!url) {
    return conn.sendMessage(jid, {
      text: `✳️ *Usa:*\n${pref}${command} <url>\nEj: ${pref}${command} https://youtu.be/xxxxxx`
    }, { quoted: msg });
  }
  if (!isYouTube(url)) {
    return conn.sendMessage(jid, { text: "❌ *URL de YouTube inválida.*" }, { quoted: msg });
  }

  try {
    await conn.sendMessage(jid, { react: { text: "⏱️", key: msg.key } });

    // Llamada a TU API (audio)
    const r = await axios.get(`${API_BASE}/api/download/yt.php`, {
      params: { url, format: "audio" },
      headers: { Authorization: `Bearer ${API_KEY}`, "X-API-Key": API_KEY },
      timeout: 30000,
      validateStatus: s => s < 500
    });

    if (r.status !== 200 || r.data?.status !== "true") {
      throw new Error(`API ${r.status}: ${JSON.stringify(r.data)}`);
    }

    const { title, audio } = r.data.data || {};
    if (!audio) throw new Error("El API no devolvió audio.");

    // Descargar a tmp
    const tmpDir = path.resolve("./tmp");
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);
    const ext = path.extname(new URL(audio).pathname) || ".mp3";
    const filePath = path.join(tmpDir, `yt-a-${Date.now()}${ext}`);

    const resp = await axios.get(audio, { responseType: "stream" });
    await new Promise((res, rej) => {
      const w = fs.createWriteStream(filePath);
      resp.data.pipe(w); w.on("finish", res); w.on("error", rej);
    });

    const sizeMB = fs.statSync(filePath).size / (1024 * 1024);
    if (sizeMB > 99) {
      fs.unlinkSync(filePath);
      await conn.sendMessage(jid, { text: `❌ Archivo de ${sizeMB.toFixed(2)}MB excede 99MB.` }, { quoted: msg });
      await conn.sendMessage(jid, { react: { text: "❌", key: msg.key } });
      return;
    }

    const caption = `🎵 *YouTube DL (audio)*\n• *Título:* ${title || "Sin título"}\n• *API:* SkyUltraPlus`;
    await conn.sendMessage(jid, {
      audio: fs.readFileSync(filePath),
      mimetype: pickAudioMime(filePath),
      ptt: false
    }, { quoted: msg });
    await conn.sendMessage(jid, { text: caption }, { quoted: msg });

    fs.unlinkSync(filePath);
    await conn.sendMessage(jid, { react: { text: "✅", key: msg.key } });

  } catch (err) {
    console.error("yt1 error:", err?.message || err);
    try {
      await conn.sendMessage(jid, { text: `❌ ${err?.message || "Error procesando el enlace."}` }, { quoted: msg });
      await conn.sendMessage(jid, { react: { text: "❌", key: msg.key } });
    } catch {}
  }
};

handler.command = ["yt1"];
module.exports = handler;
