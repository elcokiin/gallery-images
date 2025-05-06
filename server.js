// server.js
const express = require('express');
const multer = require('multer');
const path = require('path');
const dotenv = require('dotenv');

// Carga las variables de entorno del archivo .env
dotenv.config();
console.log('Variables de entorno cargadas.');

// Detectar si estamos en entorno de prueba
const isTestEnvironment = process.env.NODE_ENV === 'test';
console.log(`Ejecutando en entorno: ${isTestEnvironment ? 'test' : 'producción'}`);

// Inicializa las dependencias según el entorno
let client, register, httpRequestDurationMicroseconds, imageUploadCounter, aiApiCallCounter;
let vertexAIClient, generativeModel;

if (!isTestEnvironment) {
    // --- Configuración de Prometheus en entorno de producción ---
    client = require('prom-client');
    const Registry = client.Registry;
    register = new Registry();
    client.collectDefaultMetrics({ register });

    // Define métricas personalizadas
    httpRequestDurationMicroseconds = new client.Histogram({
        name: 'http_request_duration_ms',
        help: 'Duración de las peticiones HTTP en milisegundos',
        labelNames: ['method', 'route', 'code'],
        buckets: [0.1, 5, 15, 50, 100, 200, 300, 400, 500, 1000, 2000, 5000]
    });
    register.registerMetric(httpRequestDurationMicroseconds);

    imageUploadCounter = new client.Counter({
        name: 'image_upload_total',
        help: 'Número total de imágenes subidas',
        labelNames: ['status']
    });
    register.registerMetric(imageUploadCounter);

    aiApiCallCounter = new client.Counter({
        name: 'ai_api_call_total',
        help: 'Número total de llamadas a la API de IA',
        labelNames: ['status']
    });
    register.registerMetric(aiApiCallCounter);

    // --- Configuración de Vertex AI en entorno de producción ---
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        console.error('La variable de entorno GOOGLE_APPLICATION_CREDENTIALS no está configurada.');
        process.exit(1);
    } else {
        console.log(`GOOGLE_APPLICATION_CREDENTIALS configurada.`);
    }

    if (!process.env.GOOGLE_CLOUD_PROJECT) {
        console.error('La variable de entorno GOOGLE_CLOUD_PROJECT no está configurada.');
        process.exit(1);
    } else {
        console.log(`GOOGLE_CLOUD_PROJECT configurado a: ${process.env.GOOGLE_CLOUD_PROJECT}`);
    }

    try {
        const { VertexAI } = require('@google-cloud/vertexai');
        const project = process.env.GOOGLE_CLOUD_PROJECT;
        const location = 'us-central1';
        vertexAIClient = new VertexAI({ project: project, location: location });
        console.log(`Cliente de Vertex AI inicializado para el proyecto "${project}" en la región "${location}".`);

        const modelId = 'gemini-2.0-flash-lite-001';
        generativeModel = vertexAIClient.getGenerativeModel({ model: modelId });
        console.log(`Modelo generativo "${modelId}" seleccionado.`);
    } catch (error) {
        console.error('Error al inicializar el cliente de Vertex AI:', error);
        process.exit(1);
    }
} else {
    // --- Versiones mock para entorno de prueba ---
    console.log('Usando versiones mock de Prometheus y Vertex AI para pruebas');

    // Dummy Prometheus
    client = {};
    register = {
        contentType: 'text/plain',
        metrics: async () => 'mock_metrics'
    };

    // Dummy counters
    imageUploadCounter = { labels: () => ({ inc: () => { } }) };
    aiApiCallCounter = { labels: () => ({ inc: () => { } }) };
    httpRequestDurationMicroseconds = {
        startTimer: () => (() => { })
    };

    // Dummy VertexAI
    vertexAIClient = {};
    generativeModel = {
        generateContent: async () => ({
            response: {
                candidates: [{
                    content: {
                        parts: [{ text: 'Descripción de prueba generada por mock.' }]
                    }
                }]
            }
        })
    };
}

const app = express();
const port = process.env.PORT || 3000;

// Middleware para Prometheus (solo en producción)
if (!isTestEnvironment) {
    app.use((req, res, next) => {
        if (req.path === '/metrics') {
            return next();
        }
        const end = httpRequestDurationMicroseconds.startTimer();
        res.on('finish', () => {
            const route = req.route ? req.route.path : req.path;
            end({ method: req.method, route: route, code: res.statusCode });
        });
        next();
    });
}

// Configura Multer para manejar la subida del archivo
const upload = multer({ storage: multer.memoryStorage() });
console.log('Multer configurado para almacenar en memoria.');

// Sirve archivos estáticos desde la carpeta 'public'
const publicPath = path.join(__dirname, 'public');
app.use(express.static(publicPath));

// Ruta para exponer las métricas (solo en producción)
if (!isTestEnvironment) {
    app.get('/metrics', async (req, res) => {
        console.log('GET /metrics recibido. Sirviendo métricas.');
        res.setHeader('Content-Type', register.contentType);
        res.send(await register.metrics());
    });
}

// Ruta para manejar la subida de la imagen
app.post('/upload', upload.single('image'), async (req, res) => {
    console.log('POST /upload recibido.');

    if (!req.file) {
        console.warn('No se ha subido ningún archivo en /upload.');
        if (!isTestEnvironment) {
            imageUploadCounter.labels('fail').inc();
        }
        return res.status(400).json({ message: 'No se ha subido ningún archivo.' });
    }

    console.log(`Archivo recibido: ${req.file.originalname}, tipo: ${req.file.mimetype}, tamaño: ${req.file.size} bytes.`);

    const imageBuffer = req.file.buffer;
    const mimeType = req.file.mimetype;
    let generatedDescription = 'No se pudo obtener una descripción generada por IA.';

    try {
        // En entorno de prueba, usamos una descripción fija
        if (isTestEnvironment) {
            generatedDescription = 'Descripción de prueba generada por mock.';
            return res.json({ success: true, description: generatedDescription });
        }

        // Procesamiento real con Vertex AI en producción
        const base64Image = imageBuffer.toString('base64');
        const prompt = "Describe esta imagen detalladamente en un párrafo coherente y fluido en español.";

        const contents = [
            {
                role: 'user', parts: [
                    { text: prompt },
                    { inlineData: { mimeType: mimeType, data: base64Image } }
                ],
            },
        ];

        const result = await generativeModel.generateContent({ contents });

        if (result.response && result.response.candidates && result.response.candidates.length > 0) {
            generatedDescription = result.response.candidates[0].content.parts
                .map(part => part.text)
                .join('');
            imageUploadCounter.labels('success').inc();
            aiApiCallCounter.labels('success').inc();
        } else {
            console.warn('El modelo no devolvió una descripción válida en la respuesta.');
            imageUploadCounter.labels('success').inc();
            aiApiCallCounter.labels('fail').inc();
        }

        res.json({ success: true, description: generatedDescription });

    } catch (error) {
        console.error('Error al llamar a Vertex AI:', error);
        return res.status(500).json({
            success: false,
            error: `Error al generar descripción con IA: ${error.message}`,
        });
    }
});

// Iniciar el servidor solo si no estamos en modo test
let server;
if (!isTestEnvironment) {
    server = app.listen(port, () => {
        console.log(`Servidor escuchando en http://localhost:${port}`);
        console.log(`Frontend disponible en http://localhost:${port}/`);
    });
}

// Exportar para testing
module.exports = { app, server };