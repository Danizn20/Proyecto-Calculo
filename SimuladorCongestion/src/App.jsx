import React, { useState, useEffect, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';
import { Moon, Sun, Play, Pause, RefreshCw, Activity, AlertTriangle, CheckCircle, Calculator } from 'lucide-react';

const TICK_MS = 500;
const TICK_SEC = TICK_MS / 1000;
const MAX_DATA_POINTS = 40;

function App() {
  const [theme, setTheme] = useState('dark');
  const [isRunning, setIsRunning] = useState(false);
  
  // Parámetros de la simulación
  const [baseLambda, setBaseLambda] = useState(50); // Tasa de llegada base (paquetes/seg)
  const [mu, setMu] = useState(40); // Tasa de procesamiento (paquetes/seg)
  const [qMax, setQMax] = useState(100); // Tamaño máximo de la cola
  const [aqmEnabled, setAqmEnabled] = useState(false);
  const [dqThreshold, setDqThreshold] = useState(5); // Umbral de derivada dQ/dt
  
  // Estado dinámico
  const [data, setData] = useState([]);
  const [droppedTailDrop, setDroppedTailDrop] = useState(0);
  const [droppedAQM, setDroppedAQM] = useState(0); // Descartes preventivos
  const [aqmStatus, setAqmStatus] = useState('stable');

  // Valores instantáneos para telemetría
  const [telemetry, setTelemetry] = useState({ q: 0, prevQ: 0, dq: 0, pDrop: 0 });

  // Refs para el motor de simulación (evita re-renders en cascada)
  const dataRef = useRef([]);
  const dropsTdRef = useRef(0);
  const dropsAqmRef = useRef(0);
  const timeRef = useRef(0);
  const configRefs = useRef({ baseLambda, mu, qMax, aqmEnabled, dqThreshold });

  const currentQ = data.length > 0 ? data[data.length - 1].q : 0;
  const currentDq = data.length > 0 ? data[data.length - 1].dq : 0;

  // Sincronizar configuración con refs
  useEffect(() => {
    configRefs.current = { baseLambda, mu, qMax, aqmEnabled, dqThreshold };
  }, [baseLambda, mu, qMax, aqmEnabled, dqThreshold]);

  // Manejo del tema
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };

  // Motor de simulación
  useEffect(() => {
    if (!isRunning) return;

    const interval = setInterval(() => {
      const cfg = configRefs.current;
      timeRef.current += TICK_SEC;
      
      let prevData = dataRef.current;
      const lastQ = prevData.length > 0 ? prevData[prevData.length - 1].q : 0;
      
      // 1. Calculamos potencial de paquetes entrantes y salientes
      let incomingPotential = cfg.baseLambda * TICK_SEC;
      let processed = cfg.mu * TICK_SEC;
      
      // Calculamos Q como si no hubiera AQM para estimar la derivada pura
      let qNatural = lastQ + incomingPotential - processed;
      if (qNatural > cfg.qMax) qNatural = cfg.qMax;
      if (qNatural < 0) qNatural = 0;

      // 2. Cálculo Explícito de la Derivada dQ/dt natural
      let dq = (qNatural - lastQ) / TICK_SEC;

      // 3. Algoritmo RED (Random Early Detection) con Derivadas
      let status = 'stable';
      let pDrop = 0; // Probabilidad de descarte preventivo (0 a 1)
      let droppedAqmNow = 0;

      if (cfg.aqmEnabled) {
        if (dq > cfg.dqThreshold && lastQ > cfg.qMax * 0.1) {
          // "positiva y alta" -> congestionando rápidamente
          status = 'warning';
          // Probabilidad de descarte escala matemáticamente con la derivada
          pDrop = Math.min(0.9, 0.05 * (dq - cfg.dqThreshold)); 
          droppedAqmNow = incomingPotential * pDrop;
        }
      }

      // Los paquetes que logran entrar a la cola (Tasa Efectiva)
      let incomingActual = incomingPotential - droppedAqmNow;
      
      // 4. Recalculamos la nueva Q real (Modelo continuo a trozos)
      let newQ = lastQ + incomingActual - processed;

      // 5. Políticas de Descarte Físico (Tail Drop - Discontinuidad)
      let droppedTdNow = 0;
      if (newQ > cfg.qMax) {
        droppedTdNow = newQ - cfg.qMax;
        newQ = cfg.qMax; // Discontinuidad matemática: se capa el valor abruptamente
      }
      if (newQ < 0) newQ = 0;

      // Derivada final real tras aplicar políticas
      let finalDq = (newQ - lastQ) / TICK_SEC;

      // Actualizar Refs de acumuladores
      if (droppedAqmNow > 0) dropsAqmRef.current += droppedAqmNow;
      if (droppedTdNow > 0) dropsTdRef.current += droppedTdNow;

      // Actualizar el historial
      const newDataPoint = {
        time: Number(timeRef.current.toFixed(1)),
        q: Number(newQ.toFixed(1)),
        dq: Number(finalDq.toFixed(1))
      };

      const newData = [...prevData, newDataPoint];
      if (newData.length > MAX_DATA_POINTS) {
        newData.shift();
      }
      dataRef.current = newData;

      // Actualizar React State de golpe (Batching)
      setData(newData);
      setDroppedAQM(dropsAqmRef.current);
      setDroppedTailDrop(dropsTdRef.current);
      setAqmStatus(status);
      setTelemetry({ q: newQ, prevQ: lastQ, dq: finalDq, pDrop: pDrop });

    }, TICK_MS);

    return () => clearInterval(interval);
  }, [isRunning]);

  const resetSimulation = () => {
    dataRef.current = [];
    dropsTdRef.current = 0;
    dropsAqmRef.current = 0;
    timeRef.current = 0;
    setData([]);
    setDroppedTailDrop(0);
    setDroppedAQM(0);
    setAqmStatus('stable');
    setTelemetry({ q: 0, prevQ: 0, dq: 0, pDrop: 0 });
  };

  const queuePercentage = Math.min(100, Math.max(0, (currentQ / qMax) * 100));

  return (
    <div className="app-container">
      <header className="header">
        <h1>Simulador AQM Avanzado</h1>
        <button className="theme-toggle" onClick={toggleTheme}>
          {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
          {theme === 'dark' ? 'Modo Claro' : 'Modo Oscuro'}
        </button>
      </header>

      <div className="metrics">
        <div className="metric-card">
          <div className="label">Paquetes en Espera (Tamaño Q)</div>
          <div className="value">{currentQ.toFixed(1)} / {qMax}</div>
        </div>
        <div className="metric-card">
          <div className="label">Velocidad de Llenado (Derivada dQ/dt)</div>
          <div className="value" style={{ color: currentDq > dqThreshold ? 'var(--danger-color)' : 'var(--text-primary)' }}>
            {currentDq > 0 ? '+' : ''}{currentDq.toFixed(1)}
          </div>
        </div>
        <div className="metric-card">
          <div className="label">Paquetes Perdidos (Memoria Llena / Tail Drop)</div>
          <div className="value" style={{ color: droppedTailDrop > 0 ? 'var(--danger-color)' : 'var(--text-primary)' }}>
            {droppedTailDrop.toFixed(0)}
          </div>
        </div>
      </div>

      <div className="grid">
        {/* Panel de Control y Telemetría */}
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          {/* Controles Básicos */}
          <div>
            <h2>Controles de Simulación 
              <div style={{ display: 'flex', gap: '10px' }}>
                <button className="button" onClick={() => setIsRunning(!isRunning)} style={{ padding: '6px 12px', width: 'auto' }}>
                  {isRunning ? <Pause size={16} /> : <Play size={16} />}
                </button>
                <button className="button danger" onClick={resetSimulation} style={{ padding: '6px 12px', width: 'auto' }}>
                  <RefreshCw size={16} />
                </button>
              </div>
            </h2>
            
            <div className="control-group">
              <label>Velocidad de Entrada de Datos (λ) <span className="value">{baseLambda} pkts/s</span></label>
              <input type="range" min="10" max="100" value={baseLambda} onChange={(e) => setBaseLambda(Number(e.target.value))} />
            </div>

            <div className="control-group">
              <label>Velocidad de Procesamiento del Router (μ) <span className="value">{mu} pkts/s</span></label>
              <input type="range" min="10" max="100" value={mu} onChange={(e) => setMu(Number(e.target.value))} />
            </div>

            <div className="control-group">
              <label>Memoria Máxima del Enrutador (Capacidad Q) <span className="value">{qMax} pkts</span></label>
              <input type="range" min="50" max="200" value={qMax} onChange={(e) => setQMax(Number(e.target.value))} />
            </div>
            
            <div style={{ marginTop: '20px' }}>
              <label style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Estado Físico de la Memoria</label>
              <div className="queue-visualizer">
                <div className={`queue-fill ${queuePercentage > 90 ? 'full' : queuePercentage > 60 ? 'warning' : ''}`} style={{ width: `${queuePercentage}%` }}></div>
              </div>
            </div>
          </div>

          <hr style={{ borderColor: 'var(--border-color)', margin: '0' }} />

          {/* Sección AQM (Derivadas) */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: '0 0 5px 0' }}>Protección Inteligente (AQM - RED)</h3>
                <small style={{ color: 'var(--text-secondary)' }}>Control activo usando derivadas matemáticas</small>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                <input 
                  type="checkbox" 
                  checked={aqmEnabled} 
                  onChange={(e) => setAqmEnabled(e.target.checked)} 
                  style={{ width: '20px', height: '20px', accentColor: 'var(--accent-color)' }}
                />
                <span style={{ marginLeft: '10px', fontWeight: 'bold' }}>Habilitar AQM</span>
              </label>
            </div>

            {aqmEnabled && (
              <div style={{ marginTop: '15px' }}>
                <div className="control-group" style={{ marginBottom: '10px' }}>
                  <label>Umbral Crítico de Derivada (sensibilidad) <span className="value">{dqThreshold}</span></label>
                  <input type="range" min="1" max="20" value={dqThreshold} onChange={(e) => setDqThreshold(Number(e.target.value))} />
                  <small style={{ color: 'var(--text-secondary)' }}>Si dQ/dt supera este valor, inicia el descarte preventivo.</small>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px', background: 'var(--bg-color)', borderRadius: '8px', marginBottom: '10px' }}>
                  <Activity size={18} /> <strong>Estado RED:</strong> 
                  <span className={`aqm-status ${aqmStatus}`}>
                    {aqmStatus === 'stable' ? (
                      <><CheckCircle size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '4px' }}/> Tráfico Estable</>
                    ) : (
                      <><AlertTriangle size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '4px' }}/> Descarte Preventivo Activo</>
                    )}
                  </span>
                </div>

                <div style={{ padding: '10px', borderRadius: '8px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
                  <strong style={{ color: 'var(--danger-color)', display: 'block', marginBottom: '5px' }}>Paquetes Descartados Preventivamente (RED):</strong>
                  <span style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--danger-color)' }}>{droppedAQM.toFixed(1)} pkts</span>
                  <small style={{ display: 'block', color: 'var(--text-secondary)', marginTop: '5px' }}>
                    Probabilidad de descarte actual (P_drop): <strong>{(telemetry.pDrop * 100).toFixed(1)}%</strong>
                  </small>
                </div>

                {/* Telemetría Matemática en Vivo */}
                <div className="math-telemetry">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', color: '#fff' }}>
                    <Calculator size={16} /> <strong>Telemetría Matemática (Tiempo Real)</strong>
                  </div>
                  <pre>
<span className="comment">// 1. Cálculo de la Derivada dQ/dt</span>
<span className="keyword">let</span> <span className="variable">dt</span> = <span className="number">{TICK_SEC}</span>s;
<span className="keyword">let</span> <span className="variable">Q_t</span> = <span className="number">{telemetry.q.toFixed(1)}</span>;
<span className="keyword">let</span> <span className="variable">Q_prev</span> = <span className="number">{telemetry.prevQ.toFixed(1)}</span>;
<span className="keyword">let</span> <span className="variable">dQ_dt</span> = (Q_t - Q_prev) / dt; 
<span className="comment">// dQ_dt = {telemetry.dq.toFixed(1)} pkts/s</span>

<span className="comment">// 2. Lógica del Algoritmo de Control (RED)</span>
<div className={telemetry.dq > dqThreshold ? 'highlight-active' : ''}><span className="keyword">if</span> (<span className="variable">dQ_dt</span> &gt; <span className="variable">umbral_crítico</span> ({dqThreshold})) {'{'}
  <span className="comment">// Derivada "positiva y alta" -&gt; Congestión</span>
  <span className="variable">P_drop</span> = k * (dQ_dt - umbral); <span className="comment">// {(telemetry.pDrop*100).toFixed(1)}%</span>
  descartarPreventivamente(P_drop);
{'}'}</div><div className={telemetry.dq <= 0 ? 'highlight-active' : ''}><span className="keyword">else if</span> (<span className="variable">dQ_dt</span> &lt;= <span className="number">0</span>) {'{'}
  <span className="comment">// Tráfico estable</span>
  <span className="variable">P_drop</span> = <span className="number">0</span>;
{'}'}</div>
                  </pre>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Panel de Gráficos */}
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          <div style={{ flex: 1 }}>
            <h2>Cantidad de Paquetes en Espera (Q)</h2>
            <div className="chart-container" style={{ height: '220px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                  <XAxis dataKey="time" stroke="var(--text-secondary)" tick={{fontSize: 12}} />
                  <YAxis domain={[0, Math.max(qMax + 20, 100)]} stroke="var(--text-secondary)" tick={{fontSize: 12}} />
                  <Tooltip contentStyle={{ backgroundColor: 'var(--panel-bg)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }} />
                  <Legend />
                  <ReferenceLine y={qMax} label="Capacidad (Tail Drop)" stroke="var(--danger-color)" strokeDasharray="3 3" />
                  <Line type="monotone" dataKey="q" name="Tamaño Q" stroke="var(--accent-color)" strokeWidth={3} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div style={{ flex: 1 }}>
            <h2>Velocidad a la que se llena la memoria (Derivada)</h2>
            <div className="chart-container" style={{ height: '220px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                  <XAxis dataKey="time" stroke="var(--text-secondary)" tick={{fontSize: 12}} />
                  <YAxis domain={[-20, 20]} stroke="var(--text-secondary)" tick={{fontSize: 12}} />
                  <Tooltip contentStyle={{ backgroundColor: 'var(--panel-bg)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }} />
                  <Legend />
                  <ReferenceLine y={dqThreshold} label="Umbral AQM" stroke="#f59e0b" strokeDasharray="3 3" />
                  <ReferenceLine y={0} stroke="var(--text-secondary)" />
                  <Line type="stepAfter" dataKey="dq" name="Derivada" stroke="#10b981" strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

export default App;
