// plugins/tourl2.js  — FIX
const path = require("path");
const fetch = require("node-fetch");
const FormData = require("form-data");
const { downloadContentFromMessage } = require("@whiskeysockets/baileys");

const UPLOAD_ENDPOINT = "https://cdn.skyultraplus.com/upload.php"; // 👈 importante .php
const API_KEY = "russellxzomega";

// Helpers (igual que antes)
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
        const base = path.basename(u.pathname) || "archivo";
        filename = base.includes(".") ? base : `${base}_${Date.now()}`;
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

  // Derivar 'name' (sin extensión, limpio)
  const baseNoExt = filename.replace(/\.[^.]+$/,'').slice(0,120) || `archivo_${Date.now()}`;

  // Subir
  const form = new FormData();
  form.append("file", buffer, { filename, contentType });
  form.append("name", baseNoExt);             // 👈 REQUERIDO por el backend (o lo inferirá si olvidamos)
  form.append("uploader", (msg.key.participant || msg.key.remoteJid || "").replace(/\D/g,'')); // opcional

  let resp, text;
  try {
    resp = await fetch(UPLOAD_ENDPOINT, {
      method: "POST",
      headers: { "x-api-key": API_KEY, ...form.getHeaders() }, // 👈 API KEY
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

  // La URL correcta está en file.url
  let url = json?.file?.url || json?.url || json?.data?.url || null;
  if (!url && typeof json?.text === "string" && /^https?:\/\//.test(json.text.trim())) url = json.text.trim();
  if (!url && typeof json === "string" && /^https?:\/\//.test(json.trim())) url = json.trim();

  if (!url) {
    await conn.sendMessage(chatId, { text: `✅ Subido pero no encontré URL en la respuesta:\n\`\`\`${text}\`\`\``, quoted: msg });
    try { await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } }); } catch {}
    return;
  }

  await conn.sendMessage(chatId, { text: `✅ Archivo subido:\n${url}`, quoted: msg });
  try { await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } }); } catch {}
};

module.exports.command = ["tourl2","tourl"];
