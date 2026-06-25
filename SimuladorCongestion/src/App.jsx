import React, { useState, useEffect, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';
import { Moon, Sun, Play, Pause, RefreshCw, Activity, AlertTriangle, CheckCircle } from 'lucide-react';

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
  
  // Estado dinámico
  const [data, setData] = useState([]);
  const [time, setTime] = useState(0);
  const [effectiveLambda, setEffectiveLambda] = useState(50);
  const [droppedPackets, setDroppedPackets] = useState(0);
  const [aqmStatus, setAqmStatus] = useState('stable');

  const currentQ = data.length > 0 ? data[data.length - 1].q : 0;
  const currentDq = data.length > 0 ? data[data.length - 1].dq : 0;

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
      setTime(t => {
        const newTime = t + TICK_SEC;
        
        setData(prevData => {
          const lastQ = prevData.length > 0 ? prevData[prevData.length - 1].q : 0;
          let currentEffLambda = effectiveLambda;
          
          // 1. Modelo Fluido: Q(t+dt) = Q(t) + (lambda - mu) * dt
          let incoming = currentEffLambda * TICK_SEC;
          let processed = mu * TICK_SEC;
          let newQ = lastQ + incoming - processed;
          
          // 2. Derivada (dQ/dt)
          let dq = (newQ - lastQ) / TICK_SEC;

          // 3. Algoritmo de Control de Flujo Activo (AQM)
          let status = 'stable';
          if (aqmEnabled) {
            // Si la cola crece rápidamente y ya tiene carga
            if (dq > 5 && newQ > qMax * 0.3) {
              // Simulación de TCP: Multiplicative Decrease
              currentEffLambda = Math.max(10, currentEffLambda * 0.6); 
              status = 'warning';
            } else if (currentEffLambda < baseLambda) {
              // Simulación de TCP: Additive Increase
              currentEffLambda = Math.min(baseLambda, currentEffLambda + 5);
            }
          } else {
            currentEffLambda = baseLambda;
          }
          
          setEffectiveLambda(currentEffLambda);
          setAqmStatus(status);

          // 4. Políticas de Descarte (Tail Drop)
          let droppedNow = 0;
          if (newQ > qMax) {
            droppedNow = newQ - qMax;
            newQ = qMax; // Discontinuidad matemática: se capa el valor
          }
          if (newQ < 0) newQ = 0;

          if (droppedNow > 0) {
            setDroppedPackets(prev => prev + droppedNow);
          }

          const newDataPoint = {
            time: Number(newTime.toFixed(1)),
            q: Number(newQ.toFixed(1)),
            dq: Number(dq.toFixed(1)),
            lambda: Number(currentEffLambda.toFixed(1)),
            dropped: droppedNow
          };

          const newData = [...prevData, newDataPoint];
          if (newData.length > MAX_DATA_POINTS) {
            newData.shift();
          }
          
          return newData;
        });

        return newTime;
      });
    }, TICK_MS);

    return () => clearInterval(interval);
  }, [isRunning, baseLambda, mu, qMax, aqmEnabled, effectiveLambda]);

  const resetSimulation = () => {
    setData([]);
    setTime(0);
    setDroppedPackets(0);
    setEffectiveLambda(baseLambda);
    setAqmStatus('stable');
  };

  // Cuando cambia la lambda base, actualizamos la efectiva si AQM no está frenando
  useEffect(() => {
    if (!aqmEnabled) setEffectiveLambda(baseLambda);
  }, [baseLambda, aqmEnabled]);

  const queuePercentage = Math.min(100, Math.max(0, (currentQ / qMax) * 100));

  return (
    <div className="app-container">
      <header className="header">
        <h1>Simulador AQM</h1>
        <button className="theme-toggle" onClick={toggleTheme}>
          {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
          {theme === 'dark' ? 'Modo Claro' : 'Modo Oscuro'}
        </button>
      </header>

      <div className="metrics">
        <div className="metric-card">
          <div className="label">Tamaño de Cola Q(t)</div>
          <div className="value">{currentQ.toFixed(1)} / {qMax}</div>
        </div>
        <div className="metric-card">
          <div className="label">Derivada dQ/dt</div>
          <div className="value" style={{ color: currentDq > 5 ? 'var(--danger-color)' : 'var(--text-primary)' }}>
            {currentDq > 0 ? '+' : ''}{currentDq.toFixed(1)}
          </div>
        </div>
        <div className="metric-card">
          <div className="label">Paquetes Descartados (Tail Drop)</div>
          <div className="value" style={{ color: droppedPackets > 0 ? 'var(--danger-color)' : 'var(--text-primary)' }}>
            {droppedPackets.toFixed(0)}
          </div>
        </div>
      </div>

      <div className="grid">
        {/* Panel de Control */}
        <div className="panel">
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
            <label>Tasa de Llegada Base (λ) [Paquetes/s] <span className="value">{baseLambda}</span></label>
            <input type="range" min="10" max="100" value={baseLambda} onChange={(e) => setBaseLambda(Number(e.target.value))} />
            <small style={{ color: 'var(--text-secondary)' }}>Tasa Efectiva: {effectiveLambda.toFixed(1)} pkts/s</small>
          </div>

          <div className="control-group">
            <label>Tasa de Procesamiento (μ) [Paquetes/s] <span className="value">{mu}</span></label>
            <input type="range" min="10" max="100" value={mu} onChange={(e) => setMu(Number(e.target.value))} />
          </div>

          <div className="control-group">
            <label>Capacidad Máxima de Cola (Q_max) <span className="value">{qMax}</span></label>
            <input type="range" min="50" max="200" value={qMax} onChange={(e) => setQMax(Number(e.target.value))} />
          </div>

          <hr style={{ borderColor: 'var(--border-color)', margin: '20px 0' }} />

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h3 style={{ margin: '0 0 5px 0' }}>Algoritmo AQM (Derivadas)</h3>
              <small style={{ color: 'var(--text-secondary)' }}>Prevención de congestión activa</small>
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
            <div style={{ marginTop: '15px', padding: '10px', background: 'var(--bg-color)', borderRadius: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' }}>
                <Activity size={18} /> <strong>Estado AQM:</strong> 
                <span className={`aqm-status ${aqmStatus}`}>
                  {aqmStatus === 'stable' ? (
                    <><CheckCircle size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '4px' }}/> Tráfico Estable</>
                  ) : (
                    <><AlertTriangle size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '4px' }}/> Reducción Preventiva (Congestión)</>
                  )}
                </span>
              </div>
              <small style={{ color: 'var(--text-secondary)' }}>
                Si dQ/dt es alta y la cola está llena al 30%, el enrutador notifica a la fuente TCP para que baje su velocidad (λ), evitando el descarte Tail Drop.
              </small>
            </div>
          )}

          <div style={{ marginTop: '20px' }}>
            <label style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Estado Físico de la Memoria</label>
            <div className="queue-visualizer">
              <div className={`queue-fill ${queuePercentage > 90 ? 'full' : queuePercentage > 60 ? 'warning' : ''}`} style={{ width: `${queuePercentage}%` }}></div>
            </div>
          </div>

        </div>

        {/* Panel de Gráficos */}
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          <div style={{ flex: 1 }}>
            <h2>Tamaño de la Cola Q(t)</h2>
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
            <h2>Derivada dQ/dt</h2>
            <div className="chart-container" style={{ height: '220px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                  <XAxis dataKey="time" stroke="var(--text-secondary)" tick={{fontSize: 12}} />
                  <YAxis domain={[-20, 20]} stroke="var(--text-secondary)" tick={{fontSize: 12}} />
                  <Tooltip contentStyle={{ backgroundColor: 'var(--panel-bg)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }} />
                  <Legend />
                  <ReferenceLine y={5} label="Umbral AQM" stroke="#f59e0b" strokeDasharray="3 3" />
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
