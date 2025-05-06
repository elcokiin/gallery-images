# Dockerfile

# Usa una imagen base ligera de Node.js
FROM node:20-slim

# Establece el directorio de trabajo en el contenedor
WORKDIR /app

# Copia package.json y package-lock.json (o yarn.lock)
# Esto permite que Docker use el caché si las dependencias no cambian
COPY package*.json ./

# Instala las dependencias de Node.js
RUN npm install

# Copia el resto del código de la aplicación
COPY . .

# ¡Importante! No copies la carpeta de credenciales ni .env al contenedor
# El acceso a GCP desde Cloud Run se hará a través de la identidad de la cuenta de servicio de Cloud Run
# La variable GOOGLE_APPLICATION_CREDENTIALS no se usa aquí.
# Necesitas configurar el servicio de Cloud Run para que se ejecute con una cuenta de servicio que tenga permisos para llamar a Vertex AI.


# Expone el puerto en el que escucha tu aplicación
EXPOSE 3000

# Comando para iniciar la aplicación
CMD ["node", "server.js"]