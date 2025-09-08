const express = require("express");
const axios = require("axios");
const mysql = require("mysql2/promise"); // Usamos /promise para Async/Await
const crypto = require("crypto"); // Módulo nativo do Node para criptografia

// --- Configuração das Variáveis de Ambiente ---
// Pegamos todas as nossas chaves do arquivo .env (que o Docker Compose injeta)
const PORT = process.env.PORT || 8080;
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const TOKEN_SECRET_KEY = process.env.TOKEN_SECRET_KEY; // Nossa chave para criptografar

// Configuração do Banco de Dados
const dbConfig = {
  host: process.env.DB_HOST, // Nome do serviço Docker ('db')
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
};

// Criamos um "pool" de conexões. É mais eficiente que criar uma conexão por request.
const pool = mysql.createPool(dbConfig);

// --- Funções de Criptografia (Segurança) ---
// NUNCA salve tokens em texto puro. Vamos criptografá-los.
// Usaremos AES-256-GCM, um algoritmo forte.
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16; // O vetor de inicialização (IV) precisa ter 16 bytes para AES-GCM
const KEY = crypto.scryptSync(TOKEN_SECRET_KEY, "salt", 32); // Gera uma chave de 32 bytes a partir da nossa key do .env

function encrypt(text) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag();
  // Retornamos o IV + Tag + Conteúdo Criptografado, tudo junto em uma string hex
  return iv.toString("hex") + authTag.toString("hex") + encrypted;
}

// (Função de decrypt - não precisaremos dela hoje, mas é assim que seria)
/*
function decrypt(encryptedText) {
  const data = Buffer.from(encryptedText, 'hex');
  const iv = data.slice(0, IV_LENGTH);
  const authTag = data.slice(IV_LENGTH, IV_LENGTH + 16);
  const encrypted = data.slice(IV_LENGTH + 16);
  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
*/

// --- Inicialização do Servidor Express ---
const app = express();
app.use(express.json());

// Endpoint de Teste (para ver se a API está viva)
app.get("/api/health", (req, res) => {
  res.json({ status: "API is running and healthy!" });
});

// === O ENDPOINT MÁGICO (O CORAÇÃO DA ISSUE #2) ===
// O GitHub redireciona o usuário para cá após o login
app.get("/api/auth/github/callback", async (req, res) => {
  // 1. Pegamos o código temporário que o GitHub nos deu
  const { code } = req.query;

  if (!code) {
    return res.status(400).send("Error: No code provided from GitHub.");
  }

  console.log("[OAuth] Received code from GitHub:", code);

  try {
    // 2. Trocamos o código temporário pelo Access Token permanente
    // Esta é uma chamada Servidor-para-Servidor (POST)
    const tokenResponse = await axios.post(
      "https://github.com/login/oauth/access_token",
      {
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code: code,
      },
      {
        headers: { Accept: "application/json" }, // Pedimos a resposta em JSON
      }
    );

    const accessToken = tokenResponse.data.access_token;
    if (!accessToken) {
      throw new Error("Failed to retrieve access token.");
    }

    console.log("[OAuth] Access Token received!");

    // 3. Com o Access Token, buscamos o perfil do usuário
    const userResponse = await axios.get("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const githubUser = userResponse.data;
    const { id: github_id, login: username, avatar_url } = githubUser;

    console.log(
      `[OAuth] User profile received: ${username} (ID: ${github_id})`
    );

    // 4. Criptografamos o token antes de salvar no DB
    const encryptedToken = encrypt(accessToken);

    // 5. Salvamos o Usuário e o Token no Banco de Dados (MySQL)
    // Usamos "INSERT ... ON DUPLICATE KEY UPDATE" (UPSERT)
    // Isso significa: Tente INSERIR. Se o usuário (github_id) já existir, apenas ATUALIZE.
    let connection;
    try {
      connection = await pool.getConnection();

      // Usamos transações para garantir que ambas as tabelas sejam atualizadas ou nenhuma
      await connection.beginTransaction();

      // Tabela 1: Users
      const userQuery = `
        INSERT INTO users (github_id, username, avatar_url)
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE
          username = VALUES(username),
          avatar_url = VALUES(avatar_url),
          updated_at = CURRENT_TIMESTAMP;
      `;
      const [userResult] = await connection.execute(userQuery, [
        github_id,
        username,
        avatar_url,
      ]);

      // Pegamos o ID do usuário (seja ele novo ou antigo)
      const userId =
        userResult.insertId === 0
          ? (
              await connection.execute(
                "SELECT id FROM users WHERE github_id = ?",
                [github_id]
              )
            )[0][0].id
          : userResult.insertId;

      // Tabela 2: Tokens
      const tokenQuery = `
        INSERT INTO user_tokens (user_id, access_token_encrypted)
        VALUES (?, ?)
        ON DUPLICATE KEY UPDATE
          access_token_encrypted = VALUES(access_token_encrypted),
          updated_at = CURRENT_TIMESTAMP;
      `;
      await connection.execute(tokenQuery, [userId, encryptedToken]);

      // Se tudo deu certo, commitamos a transação
      await connection.commit();
      console.log(`[DB] Successfully UPSERTED user ${username} and token.`);
    } finally {
      if (connection) connection.release(); // Libera a conexão de volta para o pool
    }

    // 6. (TODO: Gerar um JWT nosso para manter o usuário logado no frontend)

    // 7. Por fim, redirecionamos o navegador do usuário de volta para o nosso Frontend
    // (que construiremos na Issue #3)
    res.redirect("http://localhost:3000/dashboard"); // Redireciona para o dashboard do React
  } catch (error) {
    console.error(
      "[OAuth Error] Failed the auth callback process:",
      error.message
    );
    // Se algo der errado, mandamos o usuário de volta para o login com um erro
    res.redirect("http://localhost:3000/login?error=auth_failed");
  }
});

// --- Teste de Conexão RESILIENTE e Início do Servidor ---

const MAX_RETRIES = 10; // Tentar conectar 10 vezes
const RETRY_DELAY = 3000; // Esperar 3 segundos (3000ms) entre as tentativas

// Função helper simples para "dormir"
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startServer() {
  let retries = MAX_RETRIES;

  // Inicia um loop de tentativas
  while (retries > 0) {
    try {
      // Tenta pegar uma conexão do pool
      const connection = await pool.getConnection();
      console.log("[DB] Successfully connected to MySQL database!");
      connection.release(); // Devolve a conexão imediatamente

      // Se a conexão foi um sucesso, QUEBRA o loop
      break;
    } catch (err) {
      // Se a conexão falhar (provavelmente porque o DB ainda está ligando)
      console.error(
        `[DB Error] Failed to connect (Attempt ${
          MAX_RETRIES - retries + 1
        }/${MAX_RETRIES}):`,
        err.message
      );
      retries--; // Decrementa a tentativa

      if (retries === 0) {
        console.error(
          "[DB Error] Max connection retries reached. Exiting application."
        );
        process.exit(1); // Desiste e desliga o app
      }

      console.log(
        `[DB] Retrying connection in ${RETRY_DELAY / 1000} seconds...`
      );
      await sleep(RETRY_DELAY); // Espera 3 segundos antes de tentar de novo
    }
  }

  // Se o loop 'while' foi quebrado (significa que conectamos ao DB):
  // Inicia o servidor Express.
  app.listen(PORT, () => {
    console.log(`[SERVER] Backend API is running on http://localhost:${PORT}`);
  });
}

// Inicia o processo
startServer();
