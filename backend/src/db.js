const mysql = require("mysql2/promise");

// Configuração do Banco de Dados
const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  waitForConnections: true,
  connectionLimit: 10, // Pool de 10 conexões
  queueLimit: 0,
};

// Criamos o Pool e o EXPORTAMOS, para que qualquer arquivo possa usá-lo
const pool = mysql.createPool(dbConfig);

// Função helper para retentativa (que já criamos)
const MAX_RETRIES = 10;
const RETRY_DELAY = 3000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Função de conexão resiliente (agora exportável)
async function connectWithRetry() {
  let retries = MAX_RETRIES;
  while (retries > 0) {
    try {
      const connection = await pool.getConnection();
      console.log("[DB] (Pool) Successfully connected to MySQL database!");
      connection.release();
      return; // Sucesso, sai da função
    } catch (err) {
      console.error(
        `[DB Error] Failed to connect (Attempt ${
          MAX_RETRIES - retries + 1
        }/${MAX_RETRIES}):`,
        err.message
      );
      retries--;
      if (retries === 0) {
        console.error(
          "[DB Error] Max connection retries reached. Exiting process."
        );
        process.exit(1); // Desiste (mata o container)
      }
      console.log(
        `[DB] Retrying connection in ${RETRY_DELAY / 1000} seconds...`
      );
      await sleep(RETRY_DELAY);
    }
  }
}

// Exportamos o pool e a função de conexão
module.exports = { pool, connectWithRetry };
