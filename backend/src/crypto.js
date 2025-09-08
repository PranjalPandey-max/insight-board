const crypto = require("crypto");
const TOKEN_SECRET_KEY = process.env.TOKEN_SECRET_KEY;

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const KEY = crypto.scryptSync(TOKEN_SECRET_KEY, "salt", 32);

function encrypt(text) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag();
  return iv.toString("hex") + authTag.toString("hex") + encrypted;
}

function decrypt(encryptedText) {
  try {
    const data = Buffer.from(encryptedText, "hex");
    const iv = data.slice(0, IV_LENGTH);
    const authTag = data.slice(IV_LENGTH, IV_LENGTH + 16);
    const encrypted = data.slice(IV_LENGTH + 16);

    const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (err) {
    console.error("[Crypto] Decryption failed:", err.message);
    return null; // Falha na descriptografia
  }
}

module.exports = { encrypt, decrypt };
