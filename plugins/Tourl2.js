// plugins/tourl2.js  — FIX con extensión por mimetype
const path = require("path");
const fetch = require("node-fetch");
const FormData = require("form-data");
const { downloadContentFromMessage } = require("@whiskeysockets/baileys");

const UPLOAD_ENDPOINT = "https://cdn.skyultraplus.com/upload.php"; // 👈 importante .php
const API_KEY = "russellxzomega";

// ---- helpers ----
function unwrapMessage(msgObj) {
  if (!msgObj) return null;
  if (msgObj.ephemeralMessage?.message) return unwrapMessage(msgObj.ephemeralMessage.message);
  if (msgObj.viewOnceMessageV2?.message) return unwrapMessage(msgObj.viewOnceMessageV2.message);
  if (msgObj.viewOnceMessageV2Extension?.message) return unwrapMessage(msgObj.viewOnceMessageV2Extension.message);
  return msgObj;
}
function collectContextInfos(msg) {
  const m = unwrapMessage(msg?.message) || {};
  const ctxs = [];
  const nodes = [ m.extendedTextMessage, m.imageMessage, m.videoMessage, m.documentMessage, m.audioMessage, m.stickerMessage, m.buttonsMessage, m.templateMessage ];
  for (const n of nodes) if (n?.contextInfo) ctxs.push(n.contextInfo);
  return ctxs;
}
function getQuotedMessage(msg) {
  for (const c of collectContextInfos(msg)) if (c?.quotedMessage) return unwrapMessage(c.quotedMessage);
  return null;
}
function findMediaNode(messageLike) {
  const m = unwrapMessage(messageLike) || {};
  const order = [
    ["documentMessage", "document"],
    ["imageMessage", "image"],
    ["videoMessage", "video"],
    ["audioMessage", "audio"],
    ["stickerMessage", "sticker"],
  ];
  for (const [k, t] of order) if (m[k]) return { type: t, content: m[k] };
  return null;
}
async function downloadToBuffer(type, content) {
  const stream = await downloadContentFromMessage(content, type);
  let buf = Buffer.alloc(0);
  for await (const chunk of stream) buf = Buffer.concat([buf, chunk]);
  return buf;
}

// Derivar extensión desde mimetype
function extFromMime(m) {
  if (!m) return null;
  m = String(m).toLowerCase();
  const map = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
    "audio/mpeg": "mp3",
    "audio/aac": "aac",
    "audio/ogg": "ogg",
    "audio/wav": "wav",
    "application/pdf": "pdf",
    "application/zip": "zip",
    "application/x-zip-compressed": "zip",
    "application/vnd.android.package-archive": "apk",
  };
  return map[m] || null;
}
function ensureExt(filename, contentType, isSticker=false) {
  const hasExt = /\.[^.]+$/.test(filename || "");
  if (hasExt) return filename;
  let ext = extFromMime(contentType);
  if (!ext && isSticker) ext = "webp"; // WhatsApp stickers casi siempre webp
  if (!ext) ext = "bin";               // último recurso
  return `${filename}.${ext}`;
}

/* ——— Handler ——— */
module.exports = async (msg, { conn, args }) => {
  const chatId = msg.key.remoteJid;
  try { await conn.sendMessage(chatId, { react: { text: "⏳", key: msg.key } }); } catch {}

  // Preferir citado
  let target = getQuotedMessage(msg) || msg.message;
  let media = findMediaNode(target);

  let buffer = null;
  let filename = `upload_${Date.now()}`;
  let contentType = "application/octet-stream";

  try {
    if (media) {
      filename = media.content?.fileName || media.content?.fileNameWithExt || media.content?.fileNameWithExtension || filename;
      contentType = media.content?.mimetype || contentType;
      buffer = await downloadToBuffer(media.type, media.content);
      // 👇 asegura extensión cuando viene de WhatsApp
      filename = ensureExt(filename, contentType, media.type === "sticker");
    }
  } catch (e) {
    console.error("[tourl2] error descargando media:", e);
  }

  // Si no hay media, permitir URL en args[0]
  if (!buffer) {
    const maybeUrl = args && args[0] ? String(args[0]).trim() : null;
    if (maybeUrl && /^https?:\/\//i.test(maybeUrl)) {
      try {
        const r = await fetch(maybeUrl);
        if (!r.ok) throw new Error(`No se pudo descargar la URL (${r.status})`);
        buffer = await r.buffer();
        contentType = r.headers.get("content-type") || contentType;
        const u = new URL(maybeUrl);
        let base = path.basename(u.pathname) || "archivo";
        // si la URL no trae extensión, la inferimos por mimetype
        if (!/\.[^.]+$/.test(base)) {
          const ext = extFromMime(contentType) || "bin";
          base = `${base}.${ext}`;
        }
        filename = base;
      } catch (e) {
        await conn.sendMessage(chatId, { text: `❌ No encontré archivo ni pude descargar la URL: ${e.message}`, quoted: msg });
        try { await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } }); } catch {}
        return;
      }
    } else {
      await conn.sendMessage(chatId, { text: "❌ Responde un archivo o pasa una URL para subir.", quoted: msg });
      try { await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } }); } catch {}
      return;
    }
  }

  // Derivar 'name' (label sin extensión, el backend lo usa sólo para buscar)
  const baseNoExt = filename.replace(/\.[^.]+$/,'').slice(0,120) || `archivo_${Date.now()}`;

  // Subir
  const form = new FormData();
  form.append("file", buffer, { filename, contentType }); // 👈 ahora filename SIEMPRE tiene extensión
  form.append("name", baseNoExt);
  form.append("uploader", (msg.key.participant || msg.key.remoteJid || "").replace(/\D/g,'')); // opcional

  let resp, text;
  try {
    resp = await fetch(UPLOAD_ENDPOINT, {
      method: "POST",
      headers: { "x-api-key": API_KEY, ...form.getHeaders() },
      body: form,
      timeout: 120000,
    });
    text = await resp.text();
  } catch (e) {
    await conn.sendMessage(chatId, { text: `❌ Error al subir: ${e.message}`, quoted: msg });
    try { await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } }); } catch {}
    return;
  }

  let json = null;
  try { json = JSON.parse(text); } catch { json = { text }; }

  if (!resp.ok || json?.ok === false) {
    const err = (json && (json.error || json.hint)) || `HTTP ${resp.status}`;
    await conn.sendMessage(chatId, { text: `❌ Upload falló: ${err}`, quoted: msg });
    try { await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } }); } catch {}
    return;
  }

  const url = json?.file?.url || json?.url || json?.data?.url || null;
  if (!url) {
    await conn.sendMessage(chatId, { text: `✅ Subido pero no encontré URL en la respuesta:\n\`\`\`${text}\`\`\``, quoted: msg });
    try { await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } }); } catch {}
    return;
  }

  await conn.sendMessage(chatId, { text: `✅ Archivo subido:\n${url}`, quoted: msg });
  try { await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } }); } catch {}
};

module.exports.command = ["tourl2","tourl"];
