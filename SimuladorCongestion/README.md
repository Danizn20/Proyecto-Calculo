# Simulador de Control de Congestión en Enrutadores

Este proyecto es un simulador web interactivo diseñado para visualizar y entender el comportamiento de la cola de paquetes en un enrutador bajo diferentes políticas de control de congestión, enfocándose en el uso matemático de **derivadas** aplicadas al control de flujo.

## 🚀 Tecnologías Utilizadas

Este proyecto fue desarrollado utilizando un stack moderno para el desarrollo frontend, asegurando alto rendimiento y una interfaz fluida:

- **[React 18](https://react.dev/)**: Librería principal para la construcción de la interfaz de usuario. Permite un manejo eficiente del estado de la simulación (tasas de llegada, procesamiento, memoria) mediante "Hooks" como `useState` y `useEffect`.
- **[Vite](https://vitejs.dev/)**: Herramienta de construcción (Build Tool) y servidor de desarrollo local. Seleccionada por su extrema rapidez al iniciar y compilar módulos en caliente (HMR).
- **[Recharts](https://recharts.org/)**: Librería de gráficos basada en React y D3.js. Utilizada para renderizar en tiempo real tanto el "Tamaño de la Cola $Q(t)$" como la gráfica matemática de la "Derivada $dQ/dt$".
- **[Lucide React](https://lucide.dev/)**: Colección de íconos SVG limpios y modernos, utilizados para mejorar la experiencia de usuario en los paneles de control y estados del sistema.
- **JavaScript (ES6+)**: Lenguaje principal de la lógica de simulación matemática continua, cálculo de algoritmos y actualización de tasas por segundo.
- **CSS3 Avanzado**: Estilos personalizados que incluyen el soporte nativo para **Modo Claro / Modo Oscuro** utilizando variables CSS (`:root`), Grid/Flexbox para diseño responsivo y micro-animaciones fluidas.

## 💡 Características Principales y Modelado Matemático

1. **Modelo de Continuidad (Tail Drop)**: Simulación de la acumulación de paquetes y límite de memoria estricto donde ocurre la pérdida matemática (paquetes descartados por exceso).
2. **Algoritmo de Control RED (Random Early Detection)**: Una implementación completa del protocolo RED usando derivadas.
   - **Cálculo de Derivada**: El sistema lee en tiempo real $\frac{dQ}{dt} = \frac{Q_t - Q_{t-1}}{\Delta t}$.
   - **Descarte Preventivo Probabilístico**: Si la derivada supera el **"Umbral Crítico"**, significa que la red se está congestionando rápidamente. El sistema reacciona calculando una Probabilidad de Descarte $P_{drop} = k \cdot (dQ/dt - umbral)$, descartando paquetes proactivamente *antes* de que la memoria se llene.
3. **Telemetría Matemática en Vivo**: Un panel interactivo tipo "pizarra de código" que expone exactamente cómo las matemáticas están gobernando el simulador. Muestra las variables calculadas en tiempo real y resalta qué condición del bloque lógico (`if dQ/dt > umbral` vs `else if dQ/dt <= 0`) se está ejecutando.
4. **Simulación Dinámica**: Bucle de alta frecuencia reflejando inmediatamente los cambios introducidos por el usuario mediante los paneles interactivos.

## ⚙️ Cómo ejecutar localmente

1. Clona este repositorio o descarga los archivos.
2. Abre una terminal en la carpeta `SimuladorCongestion`.
3. Instala las dependencias:
   ```bash
   npm install
   ```
4. Ejecuta el servidor de desarrollo:
   ```bash
   npm run dev
   ```
5. Abre el enlace proporcionado (usualmente `http://localhost:5173`) en tu navegador web.
