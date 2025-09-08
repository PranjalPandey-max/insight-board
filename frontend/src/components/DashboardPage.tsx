import React, { useState, useEffect } from 'react';

// Definimos a "forma" (Type) dos nossos dados do cache
interface MetricsData {
  total_repos?: { count: number };
  total_stars?: { count: number };
  message?: string; // Para o caso do worker não ter rodado
}

// --- A CORREÇÃO DO SONARLINT ESTÁ AQUI ---
// 1. Definimos um tipo dedicado para as Props do Card, marcando-as como "readonly"
type MetricCardProps = {
  readonly title: string;
  readonly value: string | number;
};

// Componente simples para mostrar um "Card" de métrica
// 2. Agora usamos nosso "MetricCardProps" como o tipo
function MetricCard({ title, value }: MetricCardProps) {
  return (
    <div style={{ 
        border: '1px solid #ddd', 
        borderRadius: '8px', 
        padding: '20px', 
        margin: '10px', 
        minWidth: '200px',
        textAlign: 'center',
        boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
      }}>
      <h3 style={{ margin: 0, color: '#555' }}>{title}</h3>
      <p style={{ fontSize: '2.5rem', margin: '10px 0 0', color: '#111', fontWeight: 600 }}>
        {value}
      </p>
    </div>
  );
}
// --- FIM DA CORREÇÃO ---


export function DashboardPage() {
  // Criamos estados para guardar os dados (metrics) e o status de loading
  const [metrics, setMetrics] = useState<MetricsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // useEffect com array vazio [] roda UMA VEZ quando o componente carrega
  useEffect(() => {
    
    async function fetchMetrics() {
      try {
        setIsLoading(true);
        
        // Graças ao "proxy" no package.json, podemos usar uma URL relativa.
        // O React vai enviar esta chamada para "http://localhost:8080/api/metrics"
        // O navegador enviará AUTOMATICAMENTE o cookie "auth_token" junto.
        const response = await fetch('/api/metrics');

        if (!response.ok) {
          // Se a API retornar um erro (ex: 401 Unauthorized se o cookie for inválido)
          throw new Error(`Failed to fetch metrics: ${response.statusText}`);
        }

        const data: MetricsData = await response.json();
        setMetrics(data);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setIsLoading(false);
      }
    }

    fetchMetrics();
  }, []); // Array de dependência vazio = Roda 1x no "mount"

  // --- Renderização ---

  if (isLoading) {
    return <div>Carregando seu Dashboard...</div>;
  }

  if (error) {
    return <div>Erro ao carregar dados: {error} (Você pode ter sido deslogado. Tente voltar ao Login.)</div>;
  }

  if (metrics?.message) {
      return <div>{metrics.message}</div>; // Ex: "Métricas estão sendo processadas..."
  }
  
  if (!metrics) {
    return <div>Nenhuma métrica encontrada.</div>;
  }

  // Se tudo deu certo:
  return (
    <div style={{ padding: '2rem' }}>
      <h1>Seu Dashboard</h1>
      <p>Seus dados do GitHub, atualizados pelo nosso Worker!</p>
      
      <div style={{ display: 'flex', flexWrap: 'wrap' }}>
        <MetricCard 
          title="Total de Repositórios" 
          value={metrics.total_repos?.count ?? 'N/A'} 
        />
        <MetricCard 
          title="Total de Estrelas (Recebidas)" 
          value={metrics.total_stars?.count ?? 'N/A'} 
        />
        {/* Adicione mais cards aqui quando o worker buscar mais dados */}
      </div>
    </div>
  );
}