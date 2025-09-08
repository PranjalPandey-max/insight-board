# Imagem base Node LTS (Alpine é uma versão leve do Linux)
FROM node:18-alpine

# Diretório de trabalho no container
WORKDIR /app

# Copia os arquivos de dependência PRIMEIRO (para cache do Docker)
COPY package*.json ./

# Instala SOMENTE as dependências de produção
RUN npm install --omit=dev

# Copia o resto do código-fonte (incluindo a pasta /src)
COPY . .

# Expõe a porta que a API vai rodar
EXPOSE 8080

# Comando REAL para iniciar o servidor
CMD [ "npm", "start" ]