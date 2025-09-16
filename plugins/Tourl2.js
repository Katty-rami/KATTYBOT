// plugins/tourl2.js
// Comando: .tourl / .tourl2
// Sube el archivo adjunto (o el citado) a https://cdn.skyultraplus.com
// API key: russellxzomega

const fs = require("fs");
const path = require("path");
const os = require("os");
const fetch = require("node-fetch");
const FormData = require("form-data");
const { downloadContentFromMessage } = require("@whiskeysockets/baileys");

const UPLOAD_ENDPOINT = "https://cdn.skyultraplus.com/upload";
const API_KEY = "russellxzomega";

/* ——— Helpers ——— */

// Desenvuelve wrappers (ephemeral / viewOnce) hasta llegar al nodo real
function unwrapMessage(msgObj) {
  if (!msgObj) return null;
  if (msgObj.ephemeralMessage?.message) return unwrapMessage(msgObj.ephemeralMessage.message);
  if (msgObj.viewOnceMessageV2?.message) return unwrapMessage(msgObj.viewOnceMessageV2.message);
  if (msgObj.viewOnceMessageV2Extension?.message) return unwrapMessage(msgObj.viewOnceMessageV2Extension.message);
  return msgObj;
}

// Devuelve un array con todos los contextInfo existentes en el mensaje
function collectContextInfos(msg) {
  const m = unwrapMessage(msg?.message) || {};
  const ctxs = [];

  const nodes = [
    m.extendedTextMessage,
    m.imageMessage,
    m.videoMessage,
    m.documentMessage,
    m.audioMessage,
    m.stickerMessage,
    // algunos clientes usan estos con contextInfo:
    m.buttonsMessage,
    m.templateMessage,
  ];

  for (const n of nodes) {
    if (n?.contextInfo) ctxs.push(n.contextInfo);
  }
  return ctxs;
}

// Obtiene el quotedMessage ya desenvuelto (si existe)
function getQuotedMessage(msg) {
  const ctxs = collectContextInfos(msg);
  for (const c of ctxs) {
    if (c?.quotedMessage) return unwrapMessage(c.quotedMessage);
  }
  return null;
}

// Busca el primer media node disponible y devuelve { type, content }
function findMediaNode(messageLike) {
  const m = unwrapMessage(messageLike) || {};
  const order = [
    ["documentMessage", "document"],
    ["imageMessage", "image"],
    ["videoMessage", "video"],
    ["audioMessage", "audio"],
    ["stickerMessage", "sticker"],
  ];
  for (const [k, t] of order) {
    if (m[k]) return { type: t, content: m[k] };
  }
  return null;
}

// Descarga a Buffer usando downloadContentFromMessage
async function downloadToBuffer(type, content) {
  const stream = await downloadContentFromMessage(content, type);
  let buf = Buffer.alloc(0);
  for await (const chunk of stream) buf = Buffer.concat([buf, chunk]);
  return buf;
}

/* ——— Handler principal ——— */
module.exports = async (msg, { conn, args }) => {
  const chatId = msg.key.remoteJid;

  // Reacción inicial
  try { await conn.sendMessage(chatId, { react: { text: "⏳", key: msg.key } }); } catch (_) {}

  // 1) Preferimos multimedia CITADO; si no hay, usamos el del propio mensaje
  let target = getQuotedMessage(msg);
  if (!target) target = msg.message;

  // 2) Sacar media node del citado o del propio mensaje
  let media = findMediaNode(target);

  // Si no hallamos media, permitir pasar una URL como argumento
  let buffer = null;
  let filename = `upload_${Date.now()}`;
  let contentType = "application/octet-stream";

  try {
    if (media) {
      // nombre/mimetype si existen
      filename =
        media.content?.fileName ||
        media.content?.fileNameWithExt ||
        media.content?.fileNameWithExtension ||
        filename;

      contentType =
        media.content?.mimetype ||
        contentType;

      buffer = await downloadToBuffer(media.type, media.content);
    }
  } catch (e) {
    console.error("[tourl2] error descargando media:", e);
  }

  // 3) Si no hay media detectado, intentar descargar desde un argumento URL
  if (!buffer) {
    const maybeUrl = args && args[0] ? String(args[0]).trim() : null;
    if (maybeUrl && /^https?:\/\//i.test(maybeUrl)) {
      try {
        const r = await fetch(maybeUrl);
        if (!r.ok) throw new Error(`No se pudo descargar la URL (${r.status})`);
        buffer = await r.buffer();
        // puede que el content-type venga en headers
        contentType = r.headers.get("content-type") || contentType;
        const u = new URL(maybeUrl);
        const base = path.basename(u.pathname) || "archivo";
        filename = base.includes(".") ? base : `${base}_${Date.now()}`;
      } catch (e) {
        await conn.sendMessage(chatId, {
          text: `❌ No encontré archivo en el mensaje ni pude descargar la URL: ${e.message}`,
          quoted: msg
        });
        try { await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } }); } catch (_) {}
        return;
      }
    } else {
      await conn.sendMessage(chatId, {
        text: "❌ No detecté archivo en el mensaje ni en la cita. Responde un archivo o adjunta uno, o pasa una URL.",
        quoted: msg
      });
      try { await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } }); } catch (_) {}
      return;
    }
  }

  // 4) Subir al CDN
  const form = new FormData();
  form.append("file", buffer, { filename, contentType });

  const sender = msg.key.participant || msg.key.remoteJid || "";
  const numero = String(sender).replace(/\D/g, "");
  form.append("uploader", numero);

  let resp;
  try {
    resp = await fetch(UPLOAD_ENDPOINT, {
      method: "POST",
      headers: {
        "x-api-key": API_KEY,
        ...form.getHeaders(),
      },
      body: form,
      timeout: 120000,
    });
  } catch (e) {
    console.error("[tourl2] error fetch upload:", e);
    await conn.sendMessage(chatId, { text: `❌ Error al subir el archivo: ${e.message}`, quoted: msg });
    try { await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } }); } catch (_) {}
    return;
  }

  let json = null;
  try {
    const text = await resp.text();
    try { json = JSON.parse(text); } catch { json = { text }; }
  } catch (_) {}

  if (!resp.ok) {
    await conn.sendMessage(chatId, {
      text: `❌ Upload falló (HTTP ${resp.status}). Respuesta: ${JSON.stringify(json)}`,
      quoted: msg
    });
    try { await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } }); } catch (_) {}
    return;
  }

  let url = null;
  if (json) url = json.url || json?.data?.url || json?.result?.url || null;
  if (!url && typeof json?.text === "string" && /^https?:\/\//.test(json.text.trim())) url = json.text.trim();
  if (!url && typeof json === "string" && /^https?:\/\//.test(json.trim())) url = json.trim();

  if (!url) {
    await conn.sendMessage(chatId, {
      text: `✅ Archivo subido pero no pude identificar la URL en la respuesta del servidor.\nRespuesta completa:\n\`\`\`${JSON.stringify(json, null, 2)}\`\`\``,
      quoted: msg
    });
    try { await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } }); } catch (_) {}
    return;
  }

  await conn.sendMessage(chatId, {
    text: `✅ Archivo subido correctamente:\n${url}`,
    quoted: msg
  });

  try { await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } }); } catch (_) {}
};

// Acepta ambos alias
module.exports.command = ["tourl2", "tourl"];
