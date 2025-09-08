const express = require("express");
const axios = require("axios");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const { pool, connectWithRetry } = require("./db");
const { encrypt } = require("./crypto");
const authMiddleware = require("./authMiddleware");

// --- Configuração das Variáveis de Ambiente ---
const PORT = process.env.PORT || 8080;
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const TOKEN_SECRET_KEY = process.env.TOKEN_SECRET_KEY; // Usaremos esta key para assinar nossos JWTs

// --- Inicialização do Servidor Express ---
const app = express();
app.use(express.json());
app.use(cookieParser());

// Endpoint de Teste
app.get("/api/health", (req, res) => {
  res.json({ status: "API is running and healthy!" });
});

// === ENDPOINT DE CALLBACK (Atualizado com JWT e Cookies) ===
app.get("/api/auth/github/callback", async (req, res) => {
  const { code } = req.query;
  if (!code) {
    return res.status(400).send("Error: No code provided.");
  }
  console.log("[API-OAuth] Received code from GitHub...");

  try {
    // 1 & 2. Troca de Token e Busca de Perfil
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

    const userResponse = await axios.get("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const { id: github_id, login: username, avatar_url } = userResponse.data;

    // 3 & 4. Criptografar e Salvar no DB
    const encryptedToken = encrypt(accessToken);

    let connection;
    let userId; // Precisamos do ID do usuário para o JWT
    try {
      connection = await pool.getConnection();
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
      userId = userIdQuery; // Captura o ID do usuário

      const tokenQuery = `INSERT INTO user_tokens (user_id, access_token_encrypted) VALUES (?, ?)
                          ON DUPLICATE KEY UPDATE access_token_encrypted = VALUES(access_token_encrypted), updated_at = CURRENT_TIMESTAMP;`;
      await connection.execute(tokenQuery, [userId, encryptedToken]);

      await connection.commit();
      console.log(`[API-DB] Successfully UPSERTED user ${username} and token.`);
    } finally {
      if (connection) connection.release();
    }

    // === 5. A NOVA LÓGICA DE SESSÃO ===
    // Criamos um Token de Sessão (JWT) para o nosso *próprio* app.
    const payload = { userId: userId, username: username };
    const sessionToken = jwt.sign(payload, TOKEN_SECRET_KEY, {
      expiresIn: "7d",
    }); // Token dura 7 dias

    // 6. Colocamos esse token em um Cookie HttpOnly (seguro)
    res.cookie("auth_token", sessionToken, {
      httpOnly: true, // O JavaScript do frontend NÃO PODE ler este cookie (segurança contra XSS)
      secure: false, // Em produção, isso DEVE ser 'true' (só envia cookie sobre HTTPS)
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 dias em milissegundos
    });

    console.log(`[API-Auth] JWT Session Cookie set for ${username}.`);

    // 7. Redireciona para o Dashboard
    res.redirect("http://localhost:3000/dashboard");
  } catch (error) {
    console.error(
      "[API-OAuth Error] Failed the auth callback process:",
      error.response ? error.response.data : error.message
    );
    res.redirect("http://localhost:3000/login?error=auth_failed");
  }
});

// === NOVO ENDPOINT DE DADOS (ISSUE #5) ===
// Este endpoint é PROTEGIDO pelo nosso authMiddleware (o "porteiro").
app.get("/api/metrics", authMiddleware, async (req, res) => {
  // Graças ao porteiro (middleware), nós sabemos quem está pedindo os dados.
  // O middleware colocou o payload do JWT dentro de 'req.user'.
  const userId = req.user.userId;
  const username = req.user.username;

  console.log(
    `[API-Metrics] Metrics requested by user ${username} (ID: ${userId})`
  );

  try {
    // 1. Buscamos no CACHE (que o Worker da Issue #4 criou)
    const query = `SELECT metric_key, metric_value FROM metrics_cache WHERE user_id = ?`;
    const [rows] = await pool.execute(query, [userId]);

    if (rows.length === 0) {
      // Isso acontece se o usuário logar, mas o Worker (que roda a cada 5 min) ainda não rodou.
      console.warn(
        `[API-Metrics] No cache found for user ${userId}. Worker might not have run yet.`
      );
      return res.status(200).json({
        message:
          "Suas métricas estão sendo processadas. Atualize em alguns instantes.",
      });
    }

    // 2. Transformamos as linhas do DB (formato array) em um objeto JSON bonito
    // De: [{ metric_key: 'total_repos', metric_value: { count: 7 } }, ...]
    // Para: { total_repos: { count: 7 }, ... }

    const metrics = rows.reduce((acc, row) => {
      acc[row.metric_key] = row.metric_value; // O driver mysql2 já converte o JSON automaticamente para nós
      return acc;
    }, {});

    // 3. Enviamos os dados para o Frontend
    res.status(200).json(metrics);
  } catch (err) {
    console.error(
      `[API-Metrics] Error fetching metrics for user ${userId}:`,
      err.message
    );
    res
      .status(500)
      .json({ error: "Internal server error while fetching metrics." });
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
