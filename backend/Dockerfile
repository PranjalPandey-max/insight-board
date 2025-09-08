# Imagem base Node LTS (Alpine é uma versão leve do Linux)
FROM node:18-alpine

# Diretório de trabalho no container
WORKDIR /app

# Copia os arquivos de dependência
COPY package*.json ./

# (Vamos manter o install comentado por enquanto)
# RUN npm install --omit=dev

# Copia o resto do código-fonte
COPY . .

# Expõe a porta que a API vai rodar
EXPOSE 8080

# Comando para manter o container vivo (placeholder)
CMD ["tail", "-f", "/dev/null"]