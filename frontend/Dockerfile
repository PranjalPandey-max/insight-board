### STAGE 1: Build ###
FROM node:18-alpine AS build
WORKDIR /app
COPY package*.json ./
# (Install comentado)
# RUN npm install
COPY . .
# (Build comentado)
# RUN npm run build

### STAGE 2: Serve ###
FROM nginx:1.23-alpine
# Nosso placeholder HTML para provar que funciona
RUN echo '<h1>Frontend (React App) vai viver aqui</h1>' > /usr/share/nginx/html/index.html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]