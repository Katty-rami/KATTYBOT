// plugins/menuowner.js
const fs = require("fs");
const path = require("path");

const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;
  const pref = global.prefixes?.[0] || ".";

  // Reacción única
  await conn.sendMessage(chatId, {
    react: { text: "👑", key: msg.key }
  });

  // 1) Intentar menú personalizado global (setmenu.json → texto_owner / imagen_owner)
  try {
    const filePath = path.resolve("./setmenu.json");
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8")) || {};
      const rawTexto = typeof data.texto_owner === "string" ? data.texto_owner : null;
      const imgB64   = data.imagen_owner || null;

      if ((rawTexto && rawTexto.trim()) || imgB64) {
        // Reemplaza {pref} por el prefijo actual
        const caption = (rawTexto || "").replace(/\{pref\}/g, pref).trim();

        if (imgB64) {
          const buffer = Buffer.from(imgB64, "base64");
          await conn.sendMessage(chatId, { image: buffer, caption: caption || undefined }, { quoted: msg });
        } else {
          await conn.sendMessage(chatId, { text: caption || " " }, { quoted: msg });
        }
        return; // ✅ Se envió el personalizado; no seguir
      }
    }
  } catch (e) {
    console.error("[menuowner] Error leyendo menú owner personalizado:", e);
    // Si falla, seguimos con el oficial
  }

  // 2) Menú oficial (fallback)
  const caption = `╔════════════════╗
   👑 𝙼𝙴𝙽𝚄 𝙳𝙴 𝙾𝚆𝙽𝙴𝚁 👑
╚════════════════╝

🧩 *COMANDOS EXCLUSIVOS*
╭─────◆
│๛ ${pref}bc
│๛ ${pref}bc2
│๛ ${pref}rest
│๛ ${pref}carga
│๛ ${pref}modoprivado on/off
│๛ ${pref}botfoto
│๛ ${pref}botname
│๛ ${pref}setprefix
│๛ ${pref}git
│๛ ${pref}re
│๛ ${pref}unre
│๛ ${pref}autoadmins
│๛ ${pref}antideletepri on/off
│๛ ${pref}apagado
│๛ ${pref}addlista
│๛ ${pref}dellista
│๛ ${pref}vergrupos
│๛ ${pref}addowner
│๛ ${pref}delowner
│๛ ${pref}dar
│๛ ${pref}deleterpg
│๛ ${pref}addfactura
│๛ ${pref}delfactura
│๛ ${pref}facpaga
│๛ ${pref}verfac
│๛ ${pref}setmenu
│๛ ${pref}setmenugrupo
│๛ ${pref}setmenuowner
│๛ ${pref}delmenu
│๛ ${pref}delmenugrupo 
│๛ ${pref}delmenuowner
╰─────◆

🤖 *La Suki Bot - Modo Dios activado*
`.trim();

  await conn.sendMessage(chatId, {
    video: { url: "https://cdn.russellxz.click/a0b60c86.mp4" },
    gifPlayback: true,
    caption
  }, { quoted: msg });
};

handler.command = ["menuowner", "ownermenu"];
handler.help = ["menuowner"];
handler.tags = ["menu"];

module.exports = handler;
