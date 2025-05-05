// server.js
const express = require('express');
const multer = require('multer');
const { VertexAI } = require('@google-cloud/vertexai'); // Importa el cliente de Vertex AI
const dotenv = require('dotenv');
const path = require('path');

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


const app = express();
const port = 3000; // Puerto donde correrá el servidor

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
// 'gemini-2.0-flash-lite-001' es un modelo multimodal estable
// 'gemini-1.5-flash-001' es más rápido y a menudo más económico para muchas tareas, también multimodal
const modelId = 'gemini-2.0-flash-lite-001';
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

// Ruta para manejar la subida de la imagen
app.post('/upload', upload.single('image'), async (req, res) => {
    console.log('POST /upload recibido.');

    if (!req.file) {
        console.warn('No se ha subido ningún archivo en /upload.');
        return res.status(400).send('No se ha subido ningún archivo.');
    }

    console.log(`Archivo recibido: ${req.file.originalname}, tipo: ${req.file.mimetype}, tamaño: ${req.file.size} bytes.`);

    const imageBuffer = req.file.buffer;
    const mimeType = req.file.mimetype;
    let generatedDescription = 'No se pudo obtener una descripción generada por IA.'; // Mensaje por defecto

    try {
        // --- Paso 1: Codificar la imagen a Base64 ---
        // Los modelos multimodales a menudo aceptan la imagen como datos inline (Base64)
        const base64Image = imageBuffer.toString('base64');
        console.log(`Imagen codificada a Base64 (${base64Image.substring(0, 30)}...).`); // Log los primeros chars

        // --- Paso 2: Definir el prompt en español ---
        // Le damos una instrucción clara a la IA sobre qué describir y en qué idioma
        const prompt = "Describe esta imagen detalladamente en un párrafo coherente y fluido en español.";
        console.log(`Prompt para el modelo: "${prompt}"`);

        // --- Paso 3: Preparar el contenido para la llamada al modelo ---
        const contents = [
            {
                role: 'user', parts: [ // El rol 'user' es para la entrada del usuario
                    { text: prompt }, // La instrucción de texto
                    { inlineData: { mimeType: mimeType, data: base64Image } } // La imagen como datos inline
                ],
            },
        ];
        console.log('Contenido para el modelo preparado (texto + imagen).');


        // --- Paso 4: Llamar al modelo generativo de Vertex AI ---
        console.log(`Llamando al método generateContent del modelo "${modelId}"...`);
        const result = await generativeModel.generateContent({ contents });
        console.log('Respuesta del modelo generativo recibida.');
        // console.log('Respuesta completa del modelo:', JSON.stringify(result, null, 2)); // Log respuesta completa si quieres debuggear

        // --- Paso 5: Extraer el texto generado de la respuesta ---
        // La respuesta contiene 'candidates', cada uno con 'content' y dentro 'parts'
        if (result.response && result.response.candidates && result.response.candidates.length > 0) {
            // Concatenar todas las partes de texto de la primera respuesta candidata
            generatedDescription = result.response.candidates[0].content.parts
                .map(part => part.text)
                .join('');
            console.log(`Descripción generada exitosamente (longitud: ${generatedDescription.length}).`);
            // console.log('Descripción generada:', generatedDescription); // Log la descripción completa si quieres debuggear
        } else {
            console.warn('El modelo no devolvió una descripción válida en la respuesta.');
            // Manejar posibles bloqueos de seguridad u otros problemas
            if (result.response && result.response.promptFeedback && result.response.promptFeedback.blockReason) {
                console.warn(`El prompt fue bloqueado por: ${result.response.promptFeedback.blockReason}`);
                generatedDescription = `La IA no pudo generar una descripción (bloqueada por seguridad: ${result.response.promptFeedback.blockReason}).`;
            } else {
                generatedDescription = 'La IA no pudo generar una descripción para esta imagen.';
            }
        }


        // Envía la descripción generada (el párrafo) al cliente (frontend)
        console.log('Enviando respuesta JSON al cliente con la descripción generada.');
        res.json({ success: true, description: generatedDescription });

    } catch (error) {
        console.error('Error DETECTADO al llamar a Vertex AI:', error);

        // Intenta enviar un mensaje de error más amigable al frontend
        let errorMessage = 'Error interno del servidor al procesar la imagen.';
        if (error.message && error.message.includes('429 Resource Exhausted')) {
            errorMessage = 'Error de cuota: has excedido el límite de peticiones. Inténtalo de nuevo más tarde.';
        } else if (error.message) {
            errorMessage = `Error de IA: ${error.message}`; // Envía el mensaje de error de la API
        }


        res.status(500).json({ success: false, error: errorMessage });
    }
});

// Inicia el servidor
app.listen(port, () => {
    console.log(`Servidor escuchando en http://localhost:${port}`);
    console.log(`Frontend disponible en http://localhost:${port}/`);
});