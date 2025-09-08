import React from 'react';
import './LoginPage.css'; // Vamos criar este CSS

const CLIENT_ID = process.env.REACT_APP_GITHUB_CLIENT_ID;
const REDIRECT_URI = 'http://localhost:8080/api/auth/github/callback';
const SCOPE = 'read:user repo';
const AUTH_URL = `https://github.com/login/oauth/authorize?client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_URI}&scope=${SCOPE}`;

export function LoginPage() {
  return (
    <div className="login-container">
      <div className="login-box">
        <h1>InsightBoard</h1>
        <p>Analise sua produtividade no GitHub.</p>
        <a href={AUTH_URL} className="login-button">
          Sign in with GitHub
        </a>
      </div>
    </div>
  );
}