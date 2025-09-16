// plugins/tourl2.js
// Comando: .tourl / .tourl2
// Sube el archivo adjunto (o el citado) al CDN de SkyUltraPlus vía API
// API key (tuya): cambia API_KEY por la de tu cuenta en el panel si es necesario.

const path = require("path");
const fetch = require("node-fetch");            // v2.x
const FormData = require("form-data");
const { downloadContentFromMessage } = require("@whiskeysockets/baileys");

// IMPORTANTES: usa el endpoint de API y manda 'name'
const UPLOAD_ENDPOINT = "https://cdn.skyultraplus.com/api/upload.php";
const API_KEY = "russellxzomega";

/* ================== Helpers ================== */

// Quita wrappers de WhatsApp hasta llegar al nodo real
function unwrapMessage(msgObj) {
  if (!msgObj) return null;
  if (msgObj.ephemeralMessage?.message) return unwrapMessage(msgObj.ephemeralMessage.message);
  if (msgObj.viewOnceMessageV2?.message) return unwrapMessage(msgObj.viewOnceMessageV2.message);
  if (msgObj.viewOnceMessageV2Extension?.message) return unwrapMessage(msgObj.viewOnceMessageV2Extension.message);
  return msgObj;
}

// Recolecta todos los contextInfo de un mensaje (para encontrar el quoted)
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
    m.buttonsMessage,
    m.templateMessage,
  ];
  for (const n of nodes) if (n?.contextInfo) ctxs.push(n.contextInfo);
  return ctxs;
}

// Obtiene el mensaje citado (ya desenvuelto) si existe
function getQuotedMessage(msg) {
  const ctxs = collectContextInfos(msg);
  for (const c of ctxs) {
    if (c?.quotedMessage) return unwrapMessage(c.quotedMessage);
  }
  return null;
}

// Busca el primer media node disponible
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

// Descarga a Buffer usando Baileys
async function downloadToBuffer(type, content) {
  const stream = await downloadContentFromMessage(content, type);
  let buf = Buffer.alloc(0);
  for await (const chunk of stream) buf = Buffer.concat([buf, chunk]);
  return buf;
}

// Saca un "name" para el archivo (API lo requiere)
function deriveName({ media, args, fallbackFilename }) {
  // 1) Si el media trae caption, úsalo
  const cap =
    media?.content?.caption ||
    media?.content?.fileName ||
    media?.content?.fileNameWithExt ||
    media?.content?.fileNameWithExtension ||
    "";

  // 2) Si el usuario pasó texto como argumento, úsalo (pero ignora si es URL)
  const argsText = (args || []).join(" ").trim();
  const firstArg = (args && args[0]) ? String(args[0]).trim() : "";
  const firstIsUrl = /^https?:\/\//i.test(firstArg);
  let label = argsText || cap || fallbackFilename || `archivo_${Date.now()}`;

  if (firstIsUrl) {
    // Si el primer arg es URL, intenta usar el resto como nombre
    const rest = (args || []).slice(1).join(" ").trim();
    if (rest) label = rest;
  }

  // Limpieza básica como hace el backend: recorta longitud y espacios múltiples
  label = label.replace(/\s+/g, " ").trim();
  if (label.length > 120) label = label.slice(0, 120);
  return label || `archivo_${Date.now()}`;
}

// Extrae una posible URL desde un texto cualquiera
function extractUrlFromText(t = "") {
  const m = String(t).match(/https?:\/\/[^\s"'<>]+/i);
  return m ? m[0] : null;
}

/* ================== Handler principal ================== */
module.exports = async (msg, { conn, args }) => {
  const chatId = msg.key.remoteJid;

  // Reacción inicial
  try { await conn.sendMessage(chatId, { react: { text: "⏳", key: msg.key } }); } catch {}

  // Preferir media citado; si no hay, usar el propio mensaje
  let target = getQuotedMessage(msg) || msg.message;

  // Media node
  let media = findMediaNode(target);

  let buffer = null;
  let filename = `upload_${Date.now()}`;
  let contentType = "application/octet-stream";

  // Descarga media si existe
  try {
    if (media) {
      filename =
        media.content?.fileName ||
        media.content?.fileNameWithExt ||
        media.content?.fileNameWithExtension ||
        filename;

      contentType = media.content?.mimetype || contentType;
      buffer = await downloadToBuffer(media.type, media.content);
    }
  } catch (e) {
    console.error("[tourl2] error descargando media:", e);
  }

  // Si no hubo media, permite pasar una URL como argumento
  if (!buffer) {
    const maybeUrl = args && args[0] ? String(args[0]).trim() : null;
    if (maybeUrl && /^https?:\/\//i.test(maybeUrl)) {
      try {
        const r = await fetch(maybeUrl);
        if (!r.ok) throw new Error(`No se pudo descargar la URL (HTTP ${r.status})`);
        buffer = await r.buffer();
        contentType = r.headers.get("content-type") || contentType;

        const u = new URL(maybeUrl);
        const base = path.basename(u.pathname) || "archivo";
        filename = base.includes(".") ? base : `${base}_${Date.now()}`;
      } catch (e) {
        await conn.sendMessage(chatId, {
          text: `❌ No encontré archivo en el mensaje ni pude descargar la URL: ${e.message}`,
          quoted: msg
        });
        try { await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } }); } catch {}
        return;
      }
    } else {
      await conn.sendMessage(chatId, {
        text: "❌ No detecté archivo en el mensaje ni en la cita. Responde un archivo o adjunta uno, o pasa una URL.",
        quoted: msg
      });
      try { await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } }); } catch {}
      return;
    }
  }

  // Derivar un "name" para el API
  const nameForApi = deriveName({ media, args, fallbackFilename: filename });

  // Construir form
  const form = new FormData();
  form.append("name", nameForApi);                              // ← REQUERIDO por la API
  form.append("file", buffer, { filename, contentType });       // archivo

  // (Opcional) enviar quién subió
  const sender = msg.key.participant || msg.key.remoteJid || "";
  const numero = String(sender).replace(/\D/g, "");
  form.append("uploader", numero);

  // Subir al API
  let resp, text, json = null;
  try {
    resp = await fetch(UPLOAD_ENDPOINT, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "X-API-Key": API_KEY,     // ← La API lo espera así (también acepta variantes)
        ...form.getHeaders(),
      },
      body: form,
      timeout: 120000,
    });

    text = await resp.text();
    try { json = JSON.parse(text); } catch {
      json = { raw: text }; // por si llega HTML u otro
    }
  } catch (e) {
    console.error("[tourl2] error fetch upload:", e);
    await conn.sendMessage(chatId, { text: `❌ Error al subir el archivo: ${e.message}`, quoted: msg });
    try { await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } }); } catch {}
    return;
  }

  // Manejo de errores HTTP
  if (!resp.ok) {
    const hint = typeof json?.error === "string" ? `\n• Detalle: ${json.error}` : "";
    await conn.sendMessage(chatId, {
      text: `❌ Upload falló (HTTP ${resp.status}).${hint}`,
      quoted: msg
    });
    try { await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } }); } catch {}
    return;
  }

  // Extraer URL según el formato real del API que nos pasaste
  // Respuesta esperada: { ok: true, file: { url, name, mime, orig } }
  let url =
    json?.file?.url ||
    json?.url ||
    json?.data?.url ||
    json?.result?.url ||
    extractUrlFromText(text) ||
    null;

  if (!url) {
    await conn.sendMessage(chatId, {
      text:
        `✅ Archivo subido, pero no pude identificar la URL en la respuesta.\n` +
        `Respuesta completa:\n\`\`\`${(typeof json === "string" ? json : JSON.stringify(json, null, 2))}\`\`\``,
      quoted: msg
    });
    try { await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } }); } catch {}
    return;
  }

  // OK
  await conn.sendMessage(chatId, {
    text: `✅ Archivo subido:\n${url}`,
    quoted: msg
  });
  try { await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } }); } catch {}
};

// Alias
module.exports.command = ["tourl2", "tourl"];
