// server.js
const express = require('express');
const multer = require('multer');
const { VertexAI } = require('@google-cloud/vertexai');
const dotenv = require('dotenv');
const path = require('path');
// --- Añadido para Prometheus ---
const client = require('prom-client');
// --- Fin Añadido para Prometheus ---

// Carga las variables de entorno del archivo .env
dotenv.config();
console.log('Variables de entorno cargadas.');

// Verifica que las variables de entorno necesarias estén configuradas
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error('La variable de entorno GOOGLE_APPLICATION_CREDENTIALS no está configurada.');
    console.error('Por favor, crea un archivo .env con la ruta a tu clave JSON de Google Cloud.');
    process.exit(1);
} else {
    console.log(`GOOGLE_APPLICATION_CREDENTIALS configurada.`); // No loggear la ruta completa por seguridad
}

if (!process.env.GOOGLE_CLOUD_PROJECT) {
    console.error('La variable de entorno GOOGLE_CLOUD_PROJECT no está configurada.');
    console.error('Por favor, añade GOOGLE_CLOUD_PROJECT=tu-id-de-proyecto a tu archivo .env');
    process.exit(1);
} else {
    console.log(`GOOGLE_CLOUD_PROJECT configurado a: ${process.env.GOOGLE_CLOUD_PROJECT}`);
}

// --- Añadido para Prometheus ---
// Configura un registro de métricas por defecto y recopila métricas estándar de Node.js
const Registry = client.Registry;
const register = new Registry();
client.collectDefaultMetrics({ register });

// Define métricas personalizadas
const httpRequestDurationMicroseconds = new client.Histogram({
    name: 'http_request_duration_ms',
    help: 'Duración de las peticiones HTTP en milisegundos',
    labelNames: ['method', 'route', 'code'], // Etiquetas para filtrar/agrupar
    buckets: [0.1, 5, 15, 50, 100, 200, 300, 400, 500, 1000, 2000, 5000] // Buckets de tiempo
});
register.registerMetric(httpRequestDurationMicroseconds);

const imageUploadCounter = new client.Counter({
    name: 'image_upload_total',
    help: 'Número total de imágenes subidas',
    labelNames: ['status'] // 'success', 'fail'
});
register.registerMetric(imageUploadCounter);

const aiApiCallCounter = new client.Counter({
    name: 'ai_api_call_total',
    help: 'Número total de llamadas a la API de IA',
    labelNames: ['status'] // 'success', 'fail'
});
register.registerMetric(aiApiCallCounter);
// --- Fin Añadido para Prometheus ---


const app = express();
const port = 3000; // Puerto donde correrá el servidor

// --- Añadido para Prometheus ---
// Middleware para medir la duración de las peticiones HTTP
app.use((req, res, next) => {
    // Ignora el endpoint de métricas para evitar medirlo a sí mismo o causar loops
    if (req.path === '/metrics') {
        return next();
    }
    const end = httpRequestDurationMicroseconds.startTimer();
    res.on('finish', () => {
        // Captura la ruta si está disponible, de lo contrario usa el path
        const route = req.route ? req.route.path : req.path;
        end({ method: req.method, route: route, code: res.statusCode });
    });
    next();
});
// --- Fin Añadido para Prometheus ---


// Configura Multer para manejar la subida del archivo
const upload = multer({ storage: multer.memoryStorage() });
console.log('Multer configurado para almacenar en memoria.');

// Inicializa el cliente de Vertex AI
let vertexAIClient;
const project = process.env.GOOGLE_CLOUD_PROJECT; // Tu ID de proyecto de GCP
const location = 'us-central1'; // Región de GCP donde está disponible el modelo (puedes cambiarla si usas otra)

try {
    vertexAIClient = new VertexAI({ project: project, location: location });
    console.log(`Cliente de Vertex AI inicializado para el proyecto "${project}" en la región "${location}".`);
} catch (error) {
    console.error('Error al inicializar el cliente de Vertex AI:', error);
    console.error('Asegúrate de que Vertex AI API está habilitada y las credenciales son correctas.');
    process.exit(1); // Detener si hay un error crítico aquí
}

// Selecciona el modelo generativo a usar (ej: Gemini Pro Vision o Gemini 1.5 Flash)
// Verifica la disponibilidad del modelo en la región que elegiste
// 'gemini-1.0-pro-vision-001' o 'gemini-1.5-flash-001' son buenas opciones multimodales
const modelId = 'gemini-2.0-flash-lite-001'; // Puedes cambiar a 'gemini-1.5-flash-001'
let generativeModel;
try {
    generativeModel = vertexAIClient.getGenerativeModel({ model: modelId });
    console.log(`Modelo generativo "${modelId}" seleccionado.`);
} catch (error) {
    console.error(`Error al obtener el modelo generativo "${modelId}":`, error);
    console.error('Asegúrate de que el modelo está disponible en la región especificada.');
    process.exit(1); // Detener si el modelo no se puede cargar
}


// Sirve archivos estáticos desde la carpeta 'public'
const publicPath = path.join(__dirname, 'public');
console.log(`Configurando Express para servir archivos estáticos desde: ${publicPath}`);
app.use(express.static(publicPath));
console.log('Middleware de archivos estáticos configurado.');

// --- Añadido para Prometheus ---
// Ruta para exponer las métricas - ¡Prometheus raspará este endpoint!
app.get('/metrics', async (req, res) => {
    console.log('GET /metrics recibido. Sirviendo métricas.');
    res.setHeader('Content-Type', register.contentType);
    res.send(await register.metrics());
});
// --- Fin Añadido para Prometheus ---


// Ruta para manejar la subida de la imagen
app.post('/upload', upload.single('image'), async (req, res) => {
    console.log('POST /upload recibido.');

    if (!req.file) {
        console.warn('No se ha subido ningún archivo en /upload.');
        // --- Añadido para Prometheus ---
        imageUploadCounter.labels('fail').inc();
        // --- Fin Añadido para Prometheus ---
        return res.status(400).json({ message: 'No se ha subido ningún archivo.' });
    }

    console.log(`Archivo recibido: ${req.file.originalname}, tipo: ${req.file.mimetype}, tamaño: ${req.file.size} bytes.`);

    const imageBuffer = req.file.buffer;
    const mimeType = req.file.mimetype;
    let generatedDescription = 'No se pudo obtener una descripción generada por IA.'; // Mensaje por defecto

    try {
        // --- Paso 1: Codificar la imagen a Base64 ---
        const base64Image = imageBuffer.toString('base64');
        console.log(`Imagen codificada a Base64 (${base64Image.substring(0, 30)}...).`);

        // --- Paso 2: Definir el prompt en español ---
        const prompt = "Describe esta imagen detalladamente en un párrafo coherente y fluido en español.";
        console.log(`Prompt para el modelo: "${prompt}"`);

        // --- Paso 3: Preparar el contenido para la llamada al modelo ---
        const contents = [
            {
                role: 'user', parts: [
                    { text: prompt },
                    { inlineData: { mimeType: mimeType, data: base64Image } }
                ],
            },
        ];
        console.log('Contenido para el modelo preparado (texto + imagen).');

        // --- Paso 4: Llamar al modelo generativo de Vertex AI ---
        console.log(`Llamando al método generateContent del modelo "${modelId}"...`);
        const result = await generativeModel.generateContent({ contents });
        console.log('Respuesta del modelo generativo recibida.');

        // --- Paso 5: Extraer el texto generado de la respuesta ---
        if (result.response && result.response.candidates && result.response.candidates.length > 0) {
            generatedDescription = result.response.candidates[0].content.parts
                .map(part => part.text)
                .join('');
            console.log(`Descripción generada exitosamente (longitud: ${generatedDescription.length}).`);
            // --- Añadido para Prometheus ---
            imageUploadCounter.labels('success').inc(); // Incrementa contador de subida exitosa
            aiApiCallCounter.labels('success').inc(); // Incrementa contador de llamada a IA exitosa
            // --- Fin Añadido para Prometheus ---
        } else {
            console.warn('El modelo no devolvió una descripción válida en la respuesta.');
            if (result.response && result.response.promptFeedback && result.response.promptFeedback.blockReason) {
                console.warn(`El prompt fue bloqueado por: ${result.response.promptFeedback.blockReason}`);
                generatedDescription = `La IA no pudo generar una descripción (bloqueada por seguridad: ${result.response.promptFeedback.blockReason}).`;
            } else {
                generatedDescription = 'La IA no pudo generar una descripción para esta imagen.';
            }
            // --- Añadido para Prometheus ---
            imageUploadCounter.labels('success').inc(); // La subida fue exitosa, pero la IA falló
            aiApiCallCounter.labels('fail').inc(); // Incrementa contador de llamada a IA fallida
            // --- Fin Añadido para Prometheus ---
        }

        // Envía la descripción generada (el párrafo) al cliente (frontend)
        console.log('Enviando respuesta JSON al cliente con la descripción generada.');
        res.json({ success: true, description: generatedDescription });

    } catch (error) {
        console.error('Error DETECTADO al llamar a Vertex AI:', error);
        return res.status(500).json({
            success: false,
            error: `Error al generar descripción con IA: ${error.message}`,
        });
    }
});

module.exports = app;

// Inicia el servidor
app.listen(port, () => {
    console.log(`Servidor escuchando en http://localhost:${port}`);
    console.log(`Frontend disponible en http://localhost:${port}/`);
});