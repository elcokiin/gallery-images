# Dockerfile

# Usa una imagen base liviana de Node.js
FROM node:22-alpine

# Establece /app como directorio de trabajo
WORKDIR /app

# Copia package.json y package-lock.json para aprovechar caché
COPY package*.json ./

# Instala las dependencias
RUN npm install

# Copia el resto del código (no incluirá node_modules porque .dockerignore lo ignora)
COPY . .

# Expone el puerto que usa la aplicación
EXPOSE 3000

# Comando para arrancar la app
CMD ["node", "server.js"]
