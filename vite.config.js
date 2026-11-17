import { defineConfig } from 'vite';

// main.js usa await en el nivel superior (carga de modelos): requiere es2022.
export default defineConfig({
  build: { target: 'es2022' },
});
