const schedule = require("node-schedule");
const axios = require("axios");
const { pool, connectWithRetry } = require("./db");
const { decrypt } = require("./crypto");

console.log("[WORKER] Worker process starting...");

/**
 * O trabalho principal de coleta de dados.
 */
async function runDataCollectionJob() {
  console.log(
    `[WORKER-JOB] Starting hourly data collection job at ${new Date().toISOString()}`
  );

  let connection;
  try {
    // 1. Pegar todos os usuários e seus tokens
    connection = await pool.getConnection();
    const [users] = await connection.query(
      `SELECT u.id, u.username, t.access_token_encrypted 
       FROM users u 
       JOIN user_tokens t ON u.id = t.user_id`
    );

    console.log(`[WORKER-JOB] Found ${users.length} users to process.`);

    // 2. Iterar sobre cada usuário
    for (const user of users) {
      console.log(`[WORKER-JOB] Processing user: ${user.username}`);

      // 3. Descriptografar o token
      const accessToken = decrypt(user.access_token_encrypted);
      if (!accessToken) {
        console.error(
          `[WORKER-JOB] Failed to decrypt token for user ${user.username}. Skipping.`
        );
        continue; // Pula para o próximo usuário
      }

      const githubApi = axios.create({
        baseURL: "https://api.github.com",
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      // 4. Buscar dados REAIS do GitHub (Exemplo: Contagem de Repos)
      let repoCount = 0;
      let totalStars = 0;
      try {
        const reposResponse = await githubApi.get("/user/repos?per_page=100"); // Pega até 100 repos
        const repos = reposResponse.data;
        repoCount = repos.length;

        // Exemplo de agregação: somar todas as estrelas
        totalStars = repos.reduce(
          (acc, repo) => acc + repo.stargazers_count,
          0
        );

        console.log(
          `[WORKER-JOB] User ${user.username}: Found ${repoCount} repos and ${totalStars} total stars.`
        );
      } catch (err) {
        console.error(
          `[WORKER-JOB] Failed to fetch data for ${user.username}: ${err.message}. Token might be invalid.`
        );
        continue; // Pula este usuário se a API do GitHub falhar
      }

      // 5. Salvar os dados processados no Cache (JSON)
      // Criamos nossos objetos de métrica
      const metricsToSave = [
        { key: "total_repos", value: { count: repoCount } },
        { key: "total_stars", value: { count: totalStars } },
        // (Aqui é onde você adicionaria "commits_this_month", "top_language", etc.)
      ];

      // Query de "UPSERT" para o cache.
      // Desta vez, passaremos uma STRING JSON completa para a coluna metric_value.
      const cacheQuery = `
  INSERT INTO metrics_cache (user_id, metric_key, metric_value, last_refreshed_at)
  VALUES (?, ?, ?, NOW())
  ON DUPLICATE KEY UPDATE
    metric_value = ?,
    last_refreshed_at = NOW();
`;

      // (Este loop insere/atualiza cada métrica no DB)
      for (const metric of metricsToSave) {
        // Converte nosso objeto JS (ex: { count: 7 }) em uma string JSON literal.
        const jsonValue = JSON.stringify(metric.value);

        // Passamos a string JSON duas vezes (uma para o INSERT, outra para o UPDATE)
        await connection.execute(cacheQuery, [
          user.id,
          metric.key,
          jsonValue,
          jsonValue,
        ]);
      }
      console.log(
        `[WORKER-JOB] Successfully cached ${metricsToSave.length} metrics for ${user.username}.`
      );
    } // Fim do loop 'for users'
  } catch (err) {
    console.error("[WORKER-JOB] Fatal error during job execution:", err);
  } finally {
    if (connection) connection.release();
    console.log("[WORKER-JOB] Data collection job finished.");
  }
}

/**
 * Função principal que inicia o worker.
 */
async function initializeWorker() {
  console.log("[WORKER] Worker connecting to database...");
  await connectWithRetry(); // Garante que o DB está pronto

  console.log("[WORKER] Database connected. Starting scheduler.");

  // Roda o trabalho imediatamente na inicialização
  runDataCollectionJob();

  // E agenda para rodar a cada 5 minutos (para testes)
  // (Em produção, isso seria '0 * * * *' para rodar 1x por hora)
  schedule.scheduleJob("*/5 * * * *", runDataCollectionJob);

  console.log(
    "[WORKER] Scheduler is running. Waiting for next job (every 5 mins)..."
  );
}

initializeWorker();
