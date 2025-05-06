// public/script.js
document.addEventListener('DOMContentLoaded', () => {
    const imageInput = document.getElementById('imageInput');
    const uploadButton = document.getElementById('uploadButton');
    const imagePreview = document.getElementById('imagePreview');
    const statusElement = document.getElementById('status');
    const resultElement = document.getElementById('result');
    const loaderContainer = document.querySelector('.loader-container');

    // Ocultar la previsualización inicialmente
    document.getElementById('imagePreviewContainer').style.display = 'none';

    // Mostrar previsualización cuando se selecciona un archivo
    imageInput.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                imagePreview.src = e.target.result;
                document.getElementById('imagePreviewContainer').style.display = 'block';
                statusElement.innerText = `Archivo seleccionado: ${file.name}`;
                resultElement.innerText = ''; // Limpiar resultado anterior
                resultElement.classList.remove('error'); // Limpiar estilo de error
            }
            reader.readAsDataURL(file); // Leer el archivo como URL para la previsualización
        } else {
            imagePreview.src = '#';
            document.getElementById('imagePreviewContainer').style.display = 'none';
            statusElement.innerText = 'Ningún archivo seleccionado.';
            resultElement.innerText = '';
            resultElement.classList.remove('error');
        }
    });

    // Manejar el clic del botón de subida
    uploadButton.addEventListener('click', async () => {
        const file = imageInput.files[0]; // Obtener el archivo seleccionado

        if (!file) {
            statusElement.innerText = 'Por favor, selecciona una imagen primero.';
            resultElement.innerText = '';
            resultElement.classList.remove('error');
            return;
        }

        statusElement.innerText = 'Subiendo y procesando imagen...';
        resultElement.innerText = ''; // Limpiar resultado anterior
        resultElement.classList.remove('error');
        loaderContainer.style.display = 'flex'; // Mostrar el loader

        // Usar FormData para enviar el archivo
        const formData = new FormData();
        formData.append('image', file); // El nombre 'image' debe coincidir con upload.single('image') en el backend

        try {
            // Enviar la imagen al backend
            const response = await fetch('/upload', {
                method: 'POST',
                body: formData,
                // No necesitas establecer 'Content-Type' para FormData, fetch lo hace automáticamente
            });

            const data = await response.json(); // Esperar la respuesta JSON del servidor
            loaderContainer.style.display = 'none'; // Ocultar el loader

            if (response.ok && data.success) {
                // Mostrar la descripción generada por la IA
                resultElement.innerText = data.description;
                statusElement.innerText = 'Descripción generada.';
            } else {
                // Manejar errores del backend
                resultElement.innerText = `Error: ${data.error || 'Error desconocido al procesar la imagen.'}`;
                resultElement.classList.add('error');
                statusElement.innerText = 'Error en el procesamiento.';
                console.error('Backend Error:', data.error);
            }

        } catch (error) {
            // Manejar errores de red o de la llamada fetch
            loaderContainer.style.display = 'none'; // Ocultar el loader
            resultElement.innerText = 'Error al conectar con el servidor o enviar la imagen.';
            resultElement.classList.add('error');
            statusElement.innerText = 'Error de conexión.';
            console.error('Fetch Error:', error);
        }
    });
});