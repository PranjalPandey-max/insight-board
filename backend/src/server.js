const express = require("express");
const axios = require("axios");
const { pool, connectWithRetry } = require("./db"); // IMPORTA do nosso util
const { encrypt } = require("./crypto"); // IMPORTA do nosso util

// --- Configuração das Variáveis de Ambiente ---
const PORT = process.env.PORT || 8080;
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;

// --- Inicialização do Servidor Express ---
const app = express();
app.use(express.json());

app.get("/api/health", (req, res) => {
  res.json({ status: "API is running and healthy!" });
});

// === O ENDPOINT DE CALLBACK (Exatamente como antes) ===
app.get("/api/auth/github/callback", async (req, res) => {
  const { code } = req.query;
  if (!code) {
    return res.status(400).send("Error: No code provided from GitHub.");
  }
  console.log("[API-OAuth] Received code from GitHub:", code);

  try {
    // 2. Troca o código pelo Token
    const tokenResponse = await axios.post(
      "https://github.com/login/oauth/access_token",
      {
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code: code,
      },
      { headers: { Accept: "application/json" } }
    );

    const accessToken = tokenResponse.data.access_token;
    if (!accessToken) {
      throw new Error("Failed to retrieve access token.");
    }
    console.log("[API-OAuth] Access Token received!");

    // 3. Busca o perfil
    const userResponse = await axios.get("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const { id: github_id, login: username, avatar_url } = userResponse.data;
    console.log(`[API-OAuth] User profile received: ${username}`);

    // 4. Criptografa o token
    const encryptedToken = encrypt(accessToken);

    // 5. Salva no DB
    let connection;
    try {
      connection = await pool.getConnection(); // Pega uma conexão do POOL exportado
      await connection.beginTransaction();

      const userQuery = `INSERT INTO users (github_id, username, avatar_url) VALUES (?, ?, ?)
                         ON DUPLICATE KEY UPDATE username = VALUES(username), avatar_url = VALUES(avatar_url), updated_at = CURRENT_TIMESTAMP;`;
      const [userResult] = await connection.execute(userQuery, [
        github_id,
        username,
        avatar_url,
      ]);

      const userIdQuery =
        userResult.insertId === 0
          ? (
              await connection.execute(
                "SELECT id FROM users WHERE github_id = ?",
                [github_id]
              )
            )[0][0].id
          : userResult.insertId;
      const userId = userIdQuery;

      const tokenQuery = `INSERT INTO user_tokens (user_id, access_token_encrypted) VALUES (?, ?)
                          ON DUPLICATE KEY UPDATE access_token_encrypted = VALUES(access_token_encrypted), updated_at = CURRENT_TIMESTAMP;`;
      await connection.execute(tokenQuery, [userId, encryptedToken]);

      await connection.commit();
      console.log(`[API-DB] Successfully UPSERTED user ${username} and token.`);
    } finally {
      if (connection) connection.release();
    }

    // (TODO: Na próxima etapa, em vez de redirecionar, a API deve disparar o Worker (talvez via webhook ou fila))

    // 7. Redireciona para o Dashboard
    res.redirect("http://localhost:3000/dashboard");
  } catch (error) {
    console.error(
      "[API-OAuth Error] Failed the auth callback process:",
      error.message
    );
    res.redirect("http://localhost:3000/login?error=auth_failed");
  }
});

// --- Início do Servidor ---
async function startApiServer() {
  await connectWithRetry(); // Usa nossa função de retry exportada

  app.listen(PORT, () => {
    console.log(
      `[SERVER-API] Backend API is running on http://localhost:${PORT}`
    );
  });
}

startApiServer();
