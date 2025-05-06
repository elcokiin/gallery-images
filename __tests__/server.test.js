// __tests__/server.test.js

// Importa supertest para probar las rutas HTTP
const request = require('supertest');
const dotenv = require('dotenv');

// Configuramos NODE_ENV para test antes de importar el módulo
process.env.NODE_ENV = 'test';
dotenv.config();

// Importa la app desde server.js
const { app } = require('../server');

// Mock simple para la respuesta de IA
const mockDescription = 'Descripción de prueba generada por mock.';

describe('Rutas principales', () => {
    // Prueba para la ruta de upload
    test('POST /upload debería procesar correctamente una imagen', async () => {
        console.log('Testing POST /upload...');

        const response = await request(app)
            .post('/upload')
            .attach('image', Buffer.from('fake image data'), 'test-image.jpg');

        expect(response.statusCode).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.description).toBe(mockDescription);
    });

    test('POST /upload debería fallar si no se envía una imagen', async () => {
        const response = await request(app)
            .post('/upload');

        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe('No se ha subido ningún archivo.');
    });
});

// Limpieza después de todas las pruebas
afterAll(() => {
    console.log('Pruebas completadas, cerrando...');
});