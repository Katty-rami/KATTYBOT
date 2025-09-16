// plugins/tourl2.js
// Comando: .tourl2
// Sube el archivo adjunto (o el archivo del mensaje citado) a https://cdn.skyultraplus.com
// Usa la API key: russellxzomega
//
// Requisitos: instalar `node-fetch` y `form-data`
// npm i node-fetch form-data

const fs = require("fs");
const path = require("path");
const os = require("os");
const fetch = require("node-fetch");
const FormData = require("form-data");

const UPLOAD_ENDPOINT = "https://cdn.skyultraplus.com/upload"; // Ajusta si tu endpoint es otro
const API_KEY = "russellxzomega";

async function tryDownloadMedia(conn, messageObj) {
  // Intentamos varias helpers que suelen existir en distintos clientes/daemons de WA
  // y devolvemos un Buffer con el contenido del archivo.
  if (!messageObj) return null;

  // 1) Si la conexión tiene downloadAndSaveMediaMessage (Baileys-style helper)
  try {
    if (typeof conn.downloadAndSaveMediaMessage === "function") {
      // Esta función suele guardar en disco; la usamos en un tmp y leemos
      const tmp = path.join(os.tmpdir(), `tourl2_${Date.now()}`);
      await conn.downloadAndSaveMediaMessage(messageObj, tmp);
      const data = fs.readFileSync(tmp);
      try { fs.unlinkSync(tmp); } catch (e) {}
      return data;
    }
  } catch (e) { /* ignore */ }

  // 2) downloadMediaMessage (otros forks)
  try {
    if (typeof conn.downloadMediaMessage === "function") {
      const res = await conn.downloadMediaMessage(messageObj);
      if (Buffer.isBuffer(res)) return res;
      if (res && res.data) return Buffer.from(res.data);
    }
  } catch (e) { /* ignore */ }

  // 3) downloadMedia (alguna implementaciones)
  try {
    if (typeof conn.downloadMedia === "function") {
      const res = await conn.downloadMedia(messageObj);
      if (Buffer.isBuffer(res)) return res;
      if (res && res.data) return Buffer.from(res.data);
    }
  } catch (e) { /* ignore */ }

  // 4) Si messageObj.message tiene base64 en algún campo (documentMessage, imageMessage, etc.)
  try {
    const m = messageObj.message || {};
    // recorrer tipos comunes
    const types = [
      "documentMessage",
      "imageMessage",
      "videoMessage",
      "audioMessage",
      "stickerMessage"
    ];
    for (const t of types) {
      const msgt = m[t];
      if (msgt) {
        // algunos frameworks guardan `fileEncSha256` y `fileLength`, pero no base64.
        // si existe `m[t].file` o `m[t].mimetype` y `m[t].file` (raro), lo manejamos:
        if (msgt.file && typeof msgt.file === "string") {
          return Buffer.from(msgt.file, "base64");
        }
        // En textos extendidos algunos libs ponen `m[t].content` (no estándar)
        if (msgt.content && typeof msgt.content === "string") {
          return Buffer.from(msgt.content, "base64");
        }
      }
    }
  } catch (e) { /* ignore */ }

  // 5) No pudimos descargar
  return null;
}

module.exports = async (msg, { conn, args }) => {
  const chatId = msg.key.remoteJid;

  // Reacción inicial
  try { await conn.sendMessage(chatId, { react: { text: "⏳", key: msg.key } }); } catch(_) {}

  // Determinar el mensaje que contiene el archivo: preferir citado, sino el propio
  const ctx = msg.message?.extendedTextMessage?.contextInfo;
  const quotedMsg = ctx?.quotedMessage ? { message: ctx.quotedMessage, key: { remoteJid: ctx.participant || chatId, id: ctx.stanzaId || ("quoted_"+Date.now()) } } : null;

  // Construimos un objeto "messageObj" compatible con helpers
  let messageObj = null;

  if (quotedMsg) {
    messageObj = quotedMsg;
  } else {
    messageObj = msg;
  }

  // Intentar descargar media a Buffer
  let buffer = null;
  try {
    buffer = await tryDownloadMedia(conn, messageObj);
  } catch (e) {
    console.error("[tourl2] error al descargar media:", e);
  }

  if (!buffer) {
    // si no hay media, intentar si el usuario pegó una URL en args
    const maybeUrl = args && args[0] ? String(args[0]).trim() : null;
    if (maybeUrl && /^https?:\/\//i.test(maybeUrl)) {
      // Intentamos descargar esa URL y subirla directamente
      try {
        const r = await fetch(maybeUrl);
        if (!r.ok) throw new Error(`No se pudo descargar la URL (${r.status})`);
        buffer = await r.buffer();
      } catch (e) {
        await conn.sendMessage(chatId, { text: `❌ No encontré archivo en el mensaje ni pude descargar la URL: ${e.message}`, quoted: msg });
        try { await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } }); } catch(_) {}
        return;
      }
    } else {
      await conn.sendMessage(chatId, { text: "❌ No detecté archivo en el mensaje ni en la cita. Responde un archivo o adjunta uno, o pasa una URL.", quoted: msg });
      try { await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } }); } catch(_) {}
      return;
    }
  }

  // Construir form-data
  const form = new FormData();
  // field 'file' por convención; ajusta si tu endpoint espera otro nombre
  form.append("file", buffer, {
    filename: (messageObj.message?.documentMessage?.fileName)
              || (messageObj.message?.imageMessage?.fileName)
              || (messageObj.message?.videoMessage?.fileName)
              || `upload_${Date.now()}`,
    contentType: (messageObj.message?.documentMessage?.mimetype)
              || (messageObj.message?.imageMessage?.mimetype)
              || (messageObj.message?.videoMessage?.mimetype)
              || "application/octet-stream"
  });

  // Si quieres enviar metadata adicional, por ejemplo: uploader numero, la puedes agregar:
  const sender = msg.key.participant || msg.key.remoteJid || "";
  const numero = (sender || "").toString().replace(/\D/g,"");
  form.append("uploader", numero);

  // Realizar petición POST
  let resp;
  try {
    resp = await fetch(UPLOAD_ENDPOINT, {
      method: "POST",
      headers: {
        "x-api-key": API_KEY,
        // form.getHeaders() contiene el content-type con boundary
        ...form.getHeaders()
      },
      body: form,
      timeout: 120000
    });
  } catch (e) {
    console.error("[tourl2] error fetch upload:", e);
    await conn.sendMessage(chatId, { text: `❌ Error al subir el archivo: ${e.message}`, quoted: msg });
    try { await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } }); } catch(_) {}
    return;
  }

  // Procesar respuesta
  let json = null;
  try {
    const text = await resp.text();
    try { json = JSON.parse(text); } catch { json = { text }; }
  } catch (e) {
    json = null;
  }

  if (!resp.ok) {
    await conn.sendMessage(chatId, {
      text: `❌ Upload falló (HTTP ${resp.status}). Respuesta: ${JSON.stringify(json)}`,
      quoted: msg
    });
    try { await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } }); } catch(_) {}
    return;
  }

  // Intentar sacar la URL del JSON
  let url = null;
  if (json) {
    url = json.url || (json.data && json.data.url) || (json.result && json.result.url) || null;
  }
  // Si no hay URL pero la respuesta es un texto y parece una URL, usarla
  if (!url && typeof json === "object" && json.text && typeof json.text === "string" && /^https?:\/\//.test(json.text.trim())) {
    url = json.text.trim();
  }
  // Si aún nada, intentar si el endpoint devolvió la URL como cadena pura
  if (!url && typeof json === "string" && /^https?:\/\//.test(json.trim())) url = json.trim();

  if (!url) {
    // Si no encontramos, devolvemos todo el body por si sirve
    await conn.sendMessage(chatId, {
      text: `✅ Archivo subido pero no pude identificar la URL en la respuesta del servidor.\nRespuesta completa:\n\`\`\`${JSON.stringify(json, null, 2)}\`\`\``,
      quoted: msg
    });
    try { await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } }); } catch(_) {}
    return;
  }

  // Responder con la URL (citado al mensaje original)
  await conn.sendMessage(chatId, {
    text: `✅ Archivo subido correctamente:\n${url}`,
    quoted: msg
  });

  // Reacción final
  try { await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } }); } catch(_) {}
};

module.exports.command = ["tourl2", "tourl"];
