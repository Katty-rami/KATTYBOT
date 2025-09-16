// plugins/tourl2.js
// Comando: .tourl / .tourl2
// Sube el adjunto/citado a https://cdn.skyultraplus.com (API)

const path = require("path");
const fetch = require("node-fetch");
const FormData = require("form-data");
const { downloadContentFromMessage } = require("@whiskeysockets/baileys");

const UPLOAD_ENDPOINT = "https://cdn.skyultraplus.com/api/upload.php"; // <- API real
const API_KEY = "TU_API_KEY_AQUI";

/* Helpers */
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
  const nodes = [m.extendedTextMessage, m.imageMessage, m.videoMessage, m.documentMessage, m.audioMessage, m.stickerMessage, m.buttonsMessage, m.templateMessage];
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

function deriveName({ args, caption, origFileName }) {
  const fromArgs = (args && args.length ? String(args.join(" ")).trim() : "");
  if (fromArgs) return fromArgs.slice(0, 120);
  if (caption)  return String(caption).trim().slice(0, 120);
  const base = (origFileName || "").replace(/\.[^.]+$/, "").trim();
  if (base) return base.slice(0, 120);
  const ts = new Date(); const pad=n=>String(n).padStart(2,'0');
  return `archivo ${ts.getFullYear()}-${pad(ts.getMonth()+1)}-${pad(ts.getDate())} ${pad(ts.getHours())}:${pad(ts.getMinutes())}`;
}

/* Handler */
module.exports = async (msg, { conn, args }) => {
  const chatId = msg.key.remoteJid;
  try { await conn.sendMessage(chatId, { react: { text: "⏳", key: msg.key } }); } catch {}

  let target = getQuotedMessage(msg) || msg.message;
  let media  = findMediaNode(target);

  let buffer = null;
  let filename = `upload_${Date.now()}`;
  let contentType = "application/octet-stream";
  let caption = unwrapMessage(target)?.extendedTextMessage?.text || "";

  try {
    if (media) {
      filename =
        media.content?.fileName ||
        media.content?.fileNameWithExt ||
        media.content?.fileNameWithExtension ||
        filename;
      contentType = media.content?.mimetype || contentType;
      caption = media.content?.caption || caption;
      buffer = await downloadToBuffer(media.type, media.content);
    }
  } catch (e) {
    console.error("[tourl2] error descargando media:", e);
  }

  // Si no hay media, permitir URL como arg
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
        await conn.sendMessage(chatId, { text: `❌ No encontré archivo ni pude bajar la URL: ${e.message}`, quoted: msg });
        try { await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } }); } catch {}
        return;
      }
    } else {
      await conn.sendMessage(chatId, { text: "❌ No detecté archivo. Responde un archivo o pasa una URL.", quoted: msg });
      try { await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } }); } catch {}
      return;
    }
  }

  // ===== Subir =====
  const form = new FormData();
  form.append("file", buffer, { filename, contentType });
  form.append("name", deriveName({ args, caption, origFileName: filename })); // ← IMPORTANTE

  let resp, json, text;
  try {
    resp = await fetch(UPLOAD_ENDPOINT, {
      method: "POST",
      headers: { "x-api-key": API_KEY, ...form.getHeaders() },
      body: form,
      timeout: 120000,
    });
    text = await resp.text();
    try { json = JSON.parse(text); } catch { json = { text }; }
  } catch (e) {
    await conn.sendMessage(chatId, { text: `❌ Error al subir: ${e.message}`, quoted: msg });
    try { await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } }); } catch {}
    return;
  }

  if (!resp.ok || !json || json.ok === false) {
    const msgErr = (json && (json.error || json.message)) ? json.error || json.message : `HTTP ${resp?.status}`;
    await conn.sendMessage(chatId, { text: `❌ Upload falló: ${msgErr}\n${text ? "Respuesta:\n```"+String(text).slice(0,900)+"```" : ""}`, quoted: msg });
    try { await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } }); } catch {}
    return;
  }

  // URL final (formato de nuestra API)
  const url = json?.file?.url || json?.url || json?.data?.url || null;
  if (!url) {
    await conn.sendMessage(chatId, { text: `✅ Subido pero no encontré la URL.\nRespuesta:\n\`\`\`${text?.slice(0,900)}\`\`\``, quoted: msg });
    try { await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } }); } catch {}
    return;
  }

  await conn.sendMessage(chatId, { text: `✅ Archivo subido:\n${url}`, quoted: msg });
  try { await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } }); } catch {}
};

module.exports.command = ["tourl2", "tourl"];
