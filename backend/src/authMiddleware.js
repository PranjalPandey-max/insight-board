const jwt = require("jsonwebtoken");
const TOKEN_SECRET_KEY = process.env.TOKEN_SECRET_KEY;

// Este é o nosso "Porteiro"
const authMiddleware = (req, res, next) => {
  // 1. Pegamos o token do cookie que a API enviou (precisamos do cookie-parser no server.js para isso)
  const token = req.cookies.auth_token;

  if (!token) {
    // Se não tem token, o usuário não está logado.
    console.warn(
      "[Auth] Acesso negado. Motivo: Token (cookie) não encontrado."
    );
    return res.status(401).json({ error: "Unauthorized: No token provided" });
  }

  try {
    // 2. Verificamos se o token é válido (usando a mesma SECRET KEY)
    const decodedPayload = jwt.verify(token, TOKEN_SECRET_KEY);

    // 3. Se for válido, anexamos os dados do usuário (payload) na requisição (req)
    // para que o próximo endpoint saiba quem está fazendo a chamada.
    req.user = decodedPayload; // ex: req.user = { userId: 5, username: 'AgnesMillie' }

    // 4. Deixa a requisição passar para o endpoint final (o /api/metrics)
    next();
  } catch (err) {
    // Se o token for inválido, expirado ou falso
    console.error("[Auth] Token inválido ou expirado:", err.message);
    return res.status(401).json({ error: "Unauthorized: Invalid token" });
  }
};

module.exports = authMiddleware;
