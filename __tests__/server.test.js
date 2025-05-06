// __tests__/server.test.js

// Importa supertest para probar las rutas HTTP
const request = require('supertest');
// Importa tu aplicación Express (server.js) - Jest cargará este archivo
// Asegúrate de que server.js exporta la instancia 'app' de Express.
// Si no la exporta, necesitarás modificar server.js ligeramente:
// Al final de server.js, antes de app.listen, añade: module.exports = app;
let app;
// Carga el módulo server.js. Jest reinicia los módulos para cada archivo de prueba/describe.
// Las variables de entorno de .env deben cargarse ANTES de importar server.js
// Puedes añadir dotenv.config() aquí o asegurarte de que el script de test en package.json lo haga (más avanzado).
// Para simplicidad local, puedes poner dotenv.config() aquí, pero recuerda que en CI ya se manejan las credenciales.
require('dotenv').config(); // Descomentar si necesitas que las credenciales se carguen para la inicialización de Vision/Vertex AI en el test

// Mockea las librerías de Google Cloud que no queremos llamar en los tests unitarios/de integración básicos
// Esto es CRUCIAL para evitar llamadas reales a GCP durante las pruebas.
// Jest permite mockear módulos completos.
jest.mock('@google-cloud/vertexai', () => {
    // Retorna una "implementación" falsa del módulo
    return {
        VertexAI: jest.fn().mockImplementation(() => {
            console.log('Mock VertexAI Client Initialized'); // Log para confirmar que el mock se usa
            return {
                getGenerativeModel: jest.fn().mockImplementation(() => {
                    console.log('Mock Generative Model Obtained'); // Log para confirmar el mock
                    // Retorna un objeto que simula el modelo y su método generateContent
                    return {
                        generateContent: jest.fn(), // Mockea el método generateContent
                    };
                }),
            };
        }),
    };
});

// Necesitamos el objeto mockeado del modelo para controlar su comportamiento en tests específicos
let mockGenerateContent;


// Antes de ejecutar todas las pruebas, importa la aplicación Express
beforeAll(() => {
    // Requiere server.js *después* de mockear VertexAI
    app = require('../server'); // Asume server.js está un directorio arriba
    console.log('Express app loaded for testing.'); // Log para confirmar la carga de la app
    // Obtiene la referencia al mock del método generateContent después de importar la app
    const { VertexAI } = require('@google-cloud/vertexai');
    mockGenerateContent = VertexAI.mock.results[0].value.getGenerativeModel.mock.results[0].value.generateContent;
});

// Después de todas las pruebas, puedes cerrar el servidor si es necesario (opcional para supertest)
// afterAll((done) => {
//   // Si tu server.js retorna la instancia del servidor (ej: const server = app.listen(...); module.exports = server;)
//   // puedes cerrarla aquí con server.close(done);
//   done();
// });

// --- Pruebas para la ruta /metrics ---
describe('GET /metrics', () => {
    test('Debería devolver métricas en formato Prometheus', async () => {
        console.log('Testing GET /metrics...'); // Log de prueba

        const response = await request(app)
            .get('/metrics');

        expect(response.statusCode).toBe(200);
        expect(response.header['content-type']).toContain('text/plain'); // Prometheus content type
        expect(response.text).toContain('# HELP'); // Contenido típico de métricas Prometheus
        expect(response.text).toContain('# TYPE');
        expect(response.text).toContain('image_upload_total'); // Verificar métrica personalizada
        expect(response.text).toContain('ai_api_call_total'); // Verificar métrica personalizada

        console.log('GET /metrics test passed.'); // Log de prueba exitosa
    });
});

// --- Pruebas para la ruta /upload (con mocking de Vertex AI) ---
describe('POST /upload', () => {

    // Reinicia el mock de generateContent antes de cada prueba
    beforeEach(() => {
        mockGenerateContent.mockClear(); // Limpia llamadas anteriores
    });

    test('Debería subir una imagen y devolver una descripción exitosa', async () => {
        console.log('Testing POST /upload with successful AI response...'); // Log de prueba

        // Define la respuesta mockeada que generateContent debería retornar
        const mockApiResponse = {
            response: {
                candidates: [{
                    content: {
                        parts: [{ text: 'Esta es una descripción generada por IA (mockeada).' }],
                    },
                }],
            },
        };
        mockGenerateContent.mockResolvedValue(mockApiResponse); // Hace que el mock retorne esta respuesta exitosa

        // Envía una petición POST con un archivo mockeado
        const response = await request(app)
            .post('/upload')
            .attach('image', Buffer.from('fake image data'), 'fake_image.jpg'); // Adjunta un archivo falso

        expect(response.statusCode).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.description).toBe('Esta es una descripción generada por IA (mockeada).');

        // Verifica que generateContent fue llamado exactamente una vez
        expect(mockGenerateContent).toHaveBeenCalledTimes(1);
        // Opcional: Verificar argumentos de la llamada mockeada si es necesario

        console.log('POST /upload successful AI response test passed.'); // Log de prueba exitosa
    });

    test('Debería devolver un error si no se sube ningún archivo', async () => {
        console.log('Testing POST /upload with no file...'); // Log de prueba

        const response = await request(app)
            .post('/upload'); // No adjunta archivo

        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe('No se ha subido ningún archivo.'); // O ajusta si tu error es JSON
        // Verifica que generateContent NO fue llamado
        expect(mockGenerateContent).not.toHaveBeenCalled();

        console.log('POST /upload no file test passed.'); // Log de prueba exitosa
    });


    test('Debería devolver un error si la llamada a la IA falla', async () => {
        console.log('Testing POST /upload with AI API error...'); // Log de prueba

        // Hace que el mock de generateContent rechace la promesa con un error
        const mockApiError = new Error('Error simulado de la API de Vertex AI');
        mockGenerateContent.mockRejectedValue(mockApiError);

        // Envía una petición POST con un archivo mockeado
        const response = await request(app)
            .post('/upload')
            .attach('image', Buffer.from('fake image data'), 'fake_image_error.png');

        expect(response.statusCode).toBe(500); // Espera un error 500 del backend
        expect(response.body.success).toBe(false);
        // Verifica que el mensaje de error sea el que envías en el catch de server.js
        expect(response.body.error).toContain('Error al generar descripción con IA: Error simulado de la API de Vertex AI');

        // Verifica que generateContent fue llamado una vez
        expect(mockGenerateContent).toHaveBeenCalledTimes(1);

        console.log('POST /upload AI API error test passed.'); // Log de prueba exitosa
    });

    // Puedes añadir más pruebas para diferentes escenarios de respuesta de la IA (ej: respuesta bloqueada, sin candidatos, etc.)
});