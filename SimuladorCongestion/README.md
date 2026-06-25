# Simulador de Control de Congestión en Enrutadores

Un simulador interactivo construido con React para visualizar y analizar el comportamiento de las colas de red bajo diferentes políticas y matemáticas de control de congestión (AQM - Active Queue Management).

## 🚀 Tecnologías Utilizadas

- **React (Vite)**: Framework principal para la interfaz y el motor de simulación.
- **Recharts**: Librería de gráficos para renderizar los cambios en la cola $Q(t)$, la derivada y el *delay* en tiempo real.
- **Lucide React**: Iconografía moderna.
- **JavaScript (ES6+)**: Lenguaje principal de la lógica de simulación matemática continua.
- **CSS3 Avanzado**: Estilos personalizados que incluyen el soporte nativo para **Modo Claro / Modo Oscuro** utilizando variables CSS.

## 💡 Modelos Matemáticos Implementados

Este simulador expone explícitamente las matemáticas detrás del control de tráfico en redes modernas.

1. **Modelo de Continuidad (Tail Drop)**: Simulación de la acumulación de paquetes y límite de memoria estricto donde ocurre la pérdida matemática (paquetes descartados por exceso).
2. **RED (Random Early Detection)**: Una implementación temprana usando la **Primera Derivada**.
   - **Cálculo**: $\frac{dQ}{dt} = \frac{Q_t - Q_{t-1}}{\Delta t}$.
   - **Descarte**: Si la derivada supera un umbral, $P_{drop} = k \cdot (dQ/dt - umbral)$.
3. **PIE (Proportional Integral controller Enhanced)**: Estándar moderno (RFC 8033).
   - Utiliza la teoría de control clásico. En lugar de derivar el tamaño de la cola, calcula el **Sojourn Time (Delay)** = $Q / \mu$.
   - **Ecuación Diferencial**: Actualiza la probabilidad iterativamente sumando el error proporcional y la derivada del error (error integral en el tiempo).
   - $P_{drop} = P_{drop} + \alpha(Delay - Target) + \beta(\Delta Delay)$
4. **CoDel (Controlled Delay)**: El algoritmo "No-Knobs" de Van Jacobson.
   - Rastrea el **mínimo** delay en una ventana de tiempo deslizante ($Min(Delay)$).
   - Si la red está crónicamente congestionada (el mínimo no baja del límite), aplica un descarte que escala matemáticamente usando la raíz cuadrada del conteo de caídas para vaciar la cola.

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
5. Abre el enlace proporcionado en tu navegador web.

## 📊 Instrucciones de Uso

- Ajusta los controles de **Velocidad de Entrada ($\lambda$)** y **Procesamiento ($\mu$)** para provocar cuellos de botella.
- Observa la gráfica de Delay y Tamaño de la Cola llenándose gradualmente.
- Selecciona un Algoritmo AQM en el panel (RED, PIE o CoDel).
- Observa el panel de **Telemetría Matemática en Vivo** para ver el código, las derivadas y los cálculos de integrales funcionando y cambiando de color en tiempo real según las decisiones que toma el enrutador.
