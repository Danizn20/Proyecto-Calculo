import React, { useState, useEffect, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';
import { Moon, Sun, Play, Pause, RefreshCw, Activity, AlertTriangle, CheckCircle, Calculator, Settings } from 'lucide-react';

const TICK_MS = 500;
const TICK_SEC = TICK_MS / 1000;
const MAX_DATA_POINTS = 40;
const CODEL_WINDOW = 20; // 10 seconds at 0.5s tick

function App() {
  const [theme, setTheme] = useState('dark');
  const [isRunning, setIsRunning] = useState(false);
  
  // Parámetros de la simulación
  const [baseLambda, setBaseLambda] = useState(50); // Tasa de llegada base
  const [mu, setMu] = useState(40); // Tasa de procesamiento
  const [qMax, setQMax] = useState(100); // Tamaño máximo de cola
  
  // AQM Selector
  const [aqmAlgorithm, setAqmAlgorithm] = useState('none'); // 'none', 'red', 'pie', 'codel'
  
  // Parámetros RED
  const [dqThreshold, setDqThreshold] = useState(5); 
  // Parámetros PIE/CoDel
  const [targetDelay, setTargetDelay] = useState(0.5); // 500ms target
  
  // Estado dinámico
  const [data, setData] = useState([]);
  const [droppedTailDrop, setDroppedTailDrop] = useState(0);
  const [droppedAQM, setDroppedAQM] = useState(0); 
  const [aqmStatus, setAqmStatus] = useState('stable');

  // Valores instantáneos para telemetría
  const [telemetry, setTelemetry] = useState({ 
    q: 0, prevQ: 0, dq: 0, pDrop: 0, delay: 0, minDelay: 0, pieError: 0, pieDeriv: 0 
  });

  // Refs para el motor de simulación (evita re-renders en cascada)
  const dataRef = useRef([]);
  const dropsTdRef = useRef(0);
  const dropsAqmRef = useRef(0);
  const timeRef = useRef(0);
  const configRefs = useRef({ baseLambda, mu, qMax, aqmAlgorithm, dqThreshold, targetDelay });
  
  // Refs internos para algoritmos
  const pieRef = useRef({ pDrop: 0, oldDelay: 0 });
  const codelRef = useRef({ delayWindow: [], dropState: false, dropCount: 0 });

  const currentQ = data.length > 0 ? data[data.length - 1].q : 0;
  const currentDq = data.length > 0 ? data[data.length - 1].dq : 0;

  // Sincronizar configuración con refs
  useEffect(() => {
    configRefs.current = { baseLambda, mu, qMax, aqmAlgorithm, dqThreshold, targetDelay };
  }, [baseLambda, mu, qMax, aqmAlgorithm, dqThreshold, targetDelay]);

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
      
      let incomingPotential = cfg.baseLambda * TICK_SEC;
      let processed = cfg.mu * TICK_SEC;
      
      let qNatural = lastQ + incomingPotential - processed;
      if (qNatural > cfg.qMax) qNatural = cfg.qMax;
      if (qNatural < 0) qNatural = 0;

      let dq = (qNatural - lastQ) / TICK_SEC;
      let currentDelay = cfg.mu > 0 ? qNatural / cfg.mu : 0;

      let status = 'stable';
      let pDrop = 0; 
      let droppedAqmNow = 0;
      let tPieError = 0;
      let tPieDeriv = 0;
      let tMinDelay = currentDelay;

      // === SELECCIÓN DE ALGORITMO AQM ===
      if (cfg.aqmAlgorithm === 'red') {
        if (dq > cfg.dqThreshold && lastQ > cfg.qMax * 0.1) {
          status = 'warning';
          pDrop = Math.min(0.9, 0.05 * (dq - cfg.dqThreshold)); 
          droppedAqmNow = incomingPotential * pDrop;
        }
      } 
      else if (cfg.aqmAlgorithm === 'pie') {
        // PIE: Controlador Proporcional-Integral
        const alpha = 0.05; // Ganancia proporcional
        const beta = 0.5;   // Ganancia integral
        
        let error = currentDelay - cfg.targetDelay;
        let delayDerivative = currentDelay - pieRef.current.oldDelay;
        
        // P(t) = P(t-1) + alpha * error + beta * derivada
        let pCalc = pieRef.current.pDrop + alpha * error + beta * delayDerivative;
        
        // Acotar probabilidad entre 0 y 0.99
        if (pCalc < 0) pCalc = 0;
        if (pCalc > 0.99) pCalc = 0.99;
        
        pieRef.current.pDrop = pCalc;
        pieRef.current.oldDelay = currentDelay;
        
        pDrop = pCalc;
        if (pDrop > 0.01) status = 'warning';
        droppedAqmNow = incomingPotential * pDrop;
        tPieError = error;
        tPieDeriv = delayDerivative;
      }
      else if (cfg.aqmAlgorithm === 'codel') {
        // CoDel: Basado en Minimum Sojourn Time
        codelRef.current.delayWindow.push(currentDelay);
        if (codelRef.current.delayWindow.length > CODEL_WINDOW) {
          codelRef.current.delayWindow.shift();
        }
        
        const minDelayInWindow = Math.min(...codelRef.current.delayWindow);
        tMinDelay = minDelayInWindow;

        // Si la ventana está llena y el mínimo histórico sigue por encima del target
        if (codelRef.current.delayWindow.length >= CODEL_WINDOW && minDelayInWindow > cfg.targetDelay) {
          status = 'warning';
          if (!codelRef.current.dropState) {
            codelRef.current.dropState = true;
            codelRef.current.dropCount = 1;
          } else {
            codelRef.current.dropCount += 1;
          }
          // CoDel usa una raíz cuadrada inversa matemática para escalar drops
          pDrop = Math.min(0.9, 0.1 * Math.sqrt(codelRef.current.dropCount));
          droppedAqmNow = incomingPotential * pDrop;
        } else {
          codelRef.current.dropState = false;
          codelRef.current.dropCount = 0;
          pDrop = 0;
        }
      }

      // 4. Recalculamos la nueva Q real (Modelo continuo a trozos)
      let incomingActual = incomingPotential - droppedAqmNow;
      let newQ = lastQ + incomingActual - processed;

      // 5. Políticas de Descarte Físico (Tail Drop - Discontinuidad)
      let droppedTdNow = 0;
      if (newQ > cfg.qMax) {
        droppedTdNow = newQ - cfg.qMax;
        newQ = cfg.qMax;
      }
      if (newQ < 0) newQ = 0;

      let finalDq = (newQ - lastQ) / TICK_SEC;

      if (droppedAqmNow > 0) dropsAqmRef.current += droppedAqmNow;
      if (droppedTdNow > 0) dropsTdRef.current += droppedTdNow;

      const newDataPoint = {
        time: Number(timeRef.current.toFixed(1)),
        q: Number(newQ.toFixed(1)),
        dq: Number(finalDq.toFixed(1)),
        delay: Number(currentDelay.toFixed(2))
      };

      const newData = [...prevData, newDataPoint];
      if (newData.length > MAX_DATA_POINTS) {
        newData.shift();
      }
      dataRef.current = newData;

      setData(newData);
      setDroppedAQM(dropsAqmRef.current);
      setDroppedTailDrop(dropsTdRef.current);
      setAqmStatus(status);
      setTelemetry({ 
        q: newQ, prevQ: lastQ, dq: finalDq, pDrop: pDrop, 
        delay: currentDelay, minDelay: tMinDelay, pieError: tPieError, pieDeriv: tPieDeriv 
      });

    }, TICK_MS);

    return () => clearInterval(interval);
  }, [isRunning]);

  const resetSimulation = () => {
    dataRef.current = [];
    dropsTdRef.current = 0;
    dropsAqmRef.current = 0;
    timeRef.current = 0;
    pieRef.current = { pDrop: 0, oldDelay: 0 };
    codelRef.current = { delayWindow: [], dropState: false, dropCount: 0 };
    setData([]);
    setDroppedTailDrop(0);
    setDroppedAQM(0);
    setAqmStatus('stable');
    setTelemetry({ q: 0, prevQ: 0, dq: 0, pDrop: 0, delay: 0, minDelay: 0, pieError: 0, pieDeriv: 0 });
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
          <div className="value" style={{ color: currentDq > 0 ? 'var(--danger-color)' : 'var(--text-primary)' }}>
            {currentDq > 0 ? '+' : ''}{currentDq.toFixed(1)}
          </div>
        </div>
        <div className="metric-card">
          <div className="label">Retraso en Cola (Delay t)</div>
          <div className="value" style={{ color: telemetry.delay > targetDelay ? 'var(--danger-color)' : 'var(--text-primary)' }}>
            {telemetry.delay.toFixed(2)}s
          </div>
        </div>
      </div>

      <div className="grid">
        {/* Panel de Control y Telemetría */}
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
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
              <label>Entrada (λ) <span className="value">{baseLambda} pkts/s</span></label>
              <input type="range" min="10" max="100" value={baseLambda} onChange={(e) => setBaseLambda(Number(e.target.value))} />
            </div>

            <div className="control-group">
              <label>Procesamiento (μ) <span className="value">{mu} pkts/s</span></label>
              <input type="range" min="10" max="100" value={mu} onChange={(e) => setMu(Number(e.target.value))} />
            </div>

            <div className="control-group">
              <label>Memoria QMax <span className="value">{qMax} pkts</span></label>
              <input type="range" min="50" max="200" value={qMax} onChange={(e) => setQMax(Number(e.target.value))} />
            </div>
            
            <div style={{ marginTop: '20px' }}>
              <label style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Estado de Memoria</label>
              <div className="queue-visualizer">
                <div className={`queue-fill ${queuePercentage > 90 ? 'full' : queuePercentage > 60 ? 'warning' : ''}`} style={{ width: `${queuePercentage}%` }}></div>
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--danger-color)', marginTop: '4px' }}>Tail Drops (Pérdidas Reales): {droppedTailDrop.toFixed(0)}</div>
            </div>
          </div>

          <hr style={{ borderColor: 'var(--border-color)', margin: '0' }} />

          {/* Sección AQM */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
              <div>
                <h3 style={{ margin: '0 0 5px 0' }}>Algoritmo AQM</h3>
                <small style={{ color: 'var(--text-secondary)' }}>Estrategia activa para evitar Bufferbloat</small>
              </div>
              <select 
                value={aqmAlgorithm} 
                onChange={(e) => {
                  setAqmAlgorithm(e.target.value);
                  resetSimulation();
                }}
                style={{ padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-color)', color: 'var(--text-primary)' }}
              >
                <option value="none">Desactivado (Tail Drop)</option>
                <option value="red">RED (Derivada)</option>
                <option value="pie">PIE (Prop-Integral)</option>
                <option value="codel">CoDel (Min Delay)</option>
              </select>
            </div>

            {aqmAlgorithm !== 'none' && (
              <div>
                {aqmAlgorithm === 'red' && (
                  <div className="control-group" style={{ marginBottom: '10px' }}>
                    <label>Umbral Crítico (dQ/dt) <span className="value">{dqThreshold}</span></label>
                    <input type="range" min="1" max="20" value={dqThreshold} onChange={(e) => setDqThreshold(Number(e.target.value))} />
                  </div>
                )}
                
                {(aqmAlgorithm === 'pie' || aqmAlgorithm === 'codel') && (
                  <div className="control-group" style={{ marginBottom: '10px' }}>
                    <label>Delay Objetivo <span className="value">{targetDelay}s</span></label>
                    <input type="range" min="0.1" max="1.5" step="0.1" value={targetDelay} onChange={(e) => setTargetDelay(Number(e.target.value))} />
                  </div>
                )}

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px', background: 'var(--bg-color)', borderRadius: '8px', marginBottom: '10px' }}>
                  <Activity size={18} /> <strong>Estado AQM:</strong> 
                  <span className={`aqm-status ${aqmStatus}`}>
                    {aqmStatus === 'stable' ? (
                      <><CheckCircle size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '4px' }}/> Tráfico Estable</>
                    ) : (
                      <><AlertTriangle size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '4px' }}/> Descarte Preventivo Activo</>
                    )}
                  </span>
                </div>

                <div style={{ padding: '10px', borderRadius: '8px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
                  <strong style={{ color: 'var(--danger-color)', display: 'block', marginBottom: '5px' }}>Paquetes Descartados Preventivamente (AQM):</strong>
                  <span style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--danger-color)' }}>{droppedAQM.toFixed(1)} pkts</span>
                  <small style={{ display: 'block', color: 'var(--text-secondary)', marginTop: '5px' }}>
                    Probabilidad de descarte actual (P_drop): <strong>{(telemetry.pDrop * 100).toFixed(1)}%</strong>
                  </small>
                </div>

                {/* Telemetría Matemática en Vivo */}
                <div className="math-telemetry">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', color: '#fff' }}>
                    <Calculator size={16} /> <strong>Telemetría: {aqmAlgorithm.toUpperCase()}</strong>
                  </div>
                  <pre>
{aqmAlgorithm === 'red' && (
<>
<span className="comment">// Algoritmo RED usando la primera derivada</span>
<span className="keyword">let</span> <span className="variable">dQ_dt</span> = <span className="number">{telemetry.dq.toFixed(1)}</span>;

<div className={telemetry.dq > dqThreshold ? 'highlight-active' : ''}><span className="keyword">if</span> (<span className="variable">dQ_dt</span> &gt; <span className="variable">umbral</span> ({dqThreshold})) {'{'}
  <span className="comment">// Derivada Alta -> Crecimiento rápido</span>
  <span className="variable">P_drop</span> = k * (dQ_dt - umbral);
{'}'}</div><div className={telemetry.dq <= 0 ? 'highlight-active' : ''}><span className="keyword">else</span> {'{'} <span className="variable">P_drop</span> = 0; {'}'}</div>
</>
)}

{aqmAlgorithm === 'pie' && (
<>
<span className="comment">// Algoritmo PIE: Controlador Proporcional-Integral</span>
<span className="keyword">let</span> <span className="variable">delay</span> = Q / <span className="variable">mu</span> = <span className="number">{telemetry.delay.toFixed(2)}</span>s;
<span className="keyword">let</span> <span className="variable">target</span> = <span className="number">{targetDelay.toFixed(2)}</span>s;

<span className="comment">// 1. Error Proporcional (Instante actual)</span>
<span className="keyword">let</span> <span className="variable">err</span> = delay - target = <span className="number">{telemetry.pieError.toFixed(3)}</span>;

<span className="comment">// 2. Error Integral (Tendencia / Derivada del error)</span>
<span className="keyword">let</span> <span className="variable">derr</span> = delay - oldDelay = <span className="number">{telemetry.pieDeriv.toFixed(3)}</span>;

<div className={telemetry.pDrop > 0 ? 'highlight-active' : ''}><span className="comment">// Actualización de Ecuación PI</span>
<span className="variable">P_drop</span> = <span className="variable">P_drop</span> + <span className="number">0.05</span>*err + <span className="number">0.5</span>*derr;
<span className="comment">// Nuevo P_drop = {(telemetry.pDrop*100).toFixed(1)}%</span></div>
</>
)}

{aqmAlgorithm === 'codel' && (
<>
<span className="comment">// Algoritmo CoDel: Minimum Sojourn Time</span>
<span className="keyword">let</span> <span className="variable">delay</span> = Q / <span className="variable">mu</span> = <span className="number">{telemetry.delay.toFixed(2)}</span>s;
<span className="keyword">let</span> <span className="variable">target</span> = <span className="number">{targetDelay.toFixed(2)}</span>s;

<span className="comment">// Rastrear el MÍNIMO delay en ventana deslizante</span>
<span className="keyword">let</span> <span className="variable">minDelay</span> = Min(ultimos_10s) = <span className="number">{telemetry.minDelay.toFixed(2)}</span>s;

<div className={telemetry.minDelay > targetDelay ? 'highlight-active' : ''}><span className="keyword">if</span> (<span className="variable">minDelay</span> &gt; <span className="variable">target</span>) {'{'}
  <span className="comment">// La cola está crónicamente congestionada</span>
  <span className="variable">count</span>++;
  <span className="variable">P_drop</span> = k * <span className="keyword">sqrt</span>(<span className="variable">count</span>); <span className="comment">// {(telemetry.pDrop*100).toFixed(1)}%</span>
{'}'}</div><div className={telemetry.minDelay <= targetDelay ? 'highlight-active' : ''}><span className="keyword">else</span> {'{'} <span className="variable">P_drop</span> = 0; {'}'}</div>
</>
)}
                  </pre>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Panel de Gráficos */}
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          <div style={{ flex: 1 }}>
            <h2>Delay Estimado en Cola (Tiempo de Permanencia)</h2>
            <div className="chart-container" style={{ height: '220px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                  <XAxis dataKey="time" stroke="var(--text-secondary)" tick={{fontSize: 12}} />
                  <YAxis domain={[0, 'auto']} stroke="var(--text-secondary)" tick={{fontSize: 12}} />
                  <Tooltip contentStyle={{ backgroundColor: 'var(--panel-bg)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }} />
                  <Legend />
                  {(aqmAlgorithm === 'pie' || aqmAlgorithm === 'codel') && (
                    <ReferenceLine y={targetDelay} label="Target Delay" stroke="#f59e0b" strokeDasharray="3 3" />
                  )}
                  <Line type="monotone" dataKey="delay" name="Delay (s)" stroke="var(--accent-color)" strokeWidth={3} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

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
                  <ReferenceLine y={qMax} label="Memoria Física Max" stroke="var(--danger-color)" strokeDasharray="3 3" />
                  <Line type="monotone" dataKey="q" name="Tamaño Q" stroke="#10b981" strokeWidth={2} dot={false} isAnimationActive={false} />
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
