import React, { useState, useEffect, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';
import { Moon, Sun, Play, Pause, RefreshCw, Activity, AlertTriangle, CheckCircle, Calculator, Info, Wifi, WifiOff } from 'lucide-react';

const TICK_MS = 500;
const TICK_SEC = TICK_MS / 1000;
const MAX_DATA_POINTS = 40;
const CODEL_WINDOW = 20;

function App() {
  const [theme, setTheme] = useState('light');
  const [isRunning, setIsRunning] = useState(false);
  
  // Parámetros de la simulación manual
  const [baseLambda, setBaseLambda] = useState(50);
  const [mu, setMu] = useState(40);
  const [qMax, setQMax] = useState(100);
  
  // Integración Red Real / Simulada
  const [useRealNetwork, setUseRealNetwork] = useState(false);
  const [netInfo, setNetInfo] = useState({ downlink: 50, rtt: 35, type: '4g', isRealApi: false });
  
  // AQM Selector
  const [aqmAlgorithm, setAqmAlgorithm] = useState('none');
  const [dqThreshold, setDqThreshold] = useState(5); 
  const [targetDelay, setTargetDelay] = useState(0.5); 
  
  // Estado dinámico
  const [data, setData] = useState([]);
  const [droppedTailDrop, setDroppedTailDrop] = useState(0);
  const [droppedAQM, setDroppedAQM] = useState(0); 
  const [aqmStatus, setAqmStatus] = useState('stable');

  // Telemetría
  const [telemetry, setTelemetry] = useState({ 
    q: 0, prevQ: 0, dq: 0, pDrop: 0, delay: 0, minDelay: 0, pieError: 0, pieDeriv: 0, count: 0,
    currentLambda: 0, currentMu: 0 
  });

  const dataRef = useRef([]);
  const dropsTdRef = useRef(0);
  const dropsAqmRef = useRef(0);
  const timeRef = useRef(0);
  const configRefs = useRef({ baseLambda, mu, qMax, aqmAlgorithm, dqThreshold, targetDelay, useRealNetwork, netInfo });
  
  const pieRef = useRef({ pDrop: 0, oldDelay: 0 });
  const codelRef = useRef({ delayWindow: [], dropState: false, dropCount: 0 });

  const currentQ = data.length > 0 ? data[data.length - 1].q : 0;
  const currentDq = data.length > 0 ? data[data.length - 1].dq : 0;

  // Escuchar a la Tarjeta de Red del Usuario o crear un Emulador realista
  useEffect(() => {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    
    if (conn && conn.downlink !== undefined) {
      // Soporte API Real nativa
      const updateNetInfo = () => {
        setNetInfo({
          downlink: conn.downlink || 50,
          rtt: conn.rtt || 40,
          type: conn.effectiveType || 'wifi',
          isRealApi: true
        });
      };
      updateNetInfo();
      conn.addEventListener('change', updateNetInfo);
      return () => conn.removeEventListener('change', updateNetInfo);
    } else {
      // Fallback Avanzado: Medir el Ping real haciendo peticiones HTTP invisibles
      // y emular el Ancho de Banda basado en ese Ping físico.
      let currentDownlink = 50;
      
      const measureRealPing = async () => {
        const start = performance.now();
        try {
          // Petición ligera a un servidor global (Cloudflare) para medir latencia real
          await fetch('https://1.1.1.1/cdn-cgi/trace?t=' + Date.now(), { mode: 'no-cors', cache: 'no-store' });
          const end = performance.now();
          const realPing = Math.floor(end - start);
          
          setNetInfo(prev => {
            // Emulamos el ancho de banda, pero la fluctuación se ancla al PING REAL
            const jitterDownlink = (Math.random() - 0.5) * (realPing / 10);
            currentDownlink = Math.max(10, Math.min(100, currentDownlink + jitterDownlink));
            
            return {
              downlink: Number(currentDownlink.toFixed(1)),
              rtt: realPing,
              type: realPing < 50 ? 'Fibra/Wi-Fi' : '4G/Inestable',
              isRealApi: false // Es una mezcla: Ping real, Mbps emulado
            };
          });
        } catch (e) {
          // Si no hay internet, fallback estocástico
          setNetInfo(prev => ({ ...prev, rtt: prev.rtt + (Math.random() - 0.5) * 20 }));
        }
      };

      measureRealPing();
      const pingInterval = setInterval(measureRealPing, 2000);
      
      return () => clearInterval(pingInterval);
    }
  }, []);

  useEffect(() => {
    configRefs.current = { baseLambda, mu, qMax, aqmAlgorithm, dqThreshold, targetDelay, useRealNetwork, netInfo };
  }, [baseLambda, mu, qMax, aqmAlgorithm, dqThreshold, targetDelay, useRealNetwork, netInfo]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };

  useEffect(() => {
    if (!isRunning) return;

    const interval = setInterval(() => {
      const cfg = configRefs.current;
      timeRef.current += TICK_SEC;
      
      let prevData = dataRef.current;
      const lastQ = prevData.length > 0 ? prevData[prevData.length - 1].q : 0;
      
      // === INYECCIÓN DE DATOS DE RED REAL O EMULADA ===
      let activeLambda = cfg.baseLambda;
      let activeMu = cfg.mu;

      if (cfg.useRealNetwork) {
        // Mapeo: Capacidad de Salida = Ancho de banda (Downlink)
        activeMu = Math.max(20, Math.min(150, cfg.netInfo.downlink * 1.5));
        
        // Mapeo: Tráfico Entrante = Variabilidad caótica impulsada por la Latencia (Ping RTT)
        let jitter = (Math.random() - 0.2) * (cfg.netInfo.rtt / 3); 
        activeLambda = Math.max(10, Math.min(200, activeMu + jitter + 5)); // Tendencia a congestionarse levemente
      }

      let incomingPotential = activeLambda * TICK_SEC;
      let processed = activeMu * TICK_SEC;
      
      let qNatural = lastQ + incomingPotential - processed;
      if (qNatural > cfg.qMax) qNatural = cfg.qMax;
      if (qNatural < 0) qNatural = 0;

      let dq = (qNatural - lastQ) / TICK_SEC;
      let currentDelay = activeMu > 0 ? qNatural / activeMu : 0;

      let status = 'stable';
      let pDrop = 0; 
      let droppedAqmNow = 0;
      let tPieError = 0;
      let tPieDeriv = 0;
      let tMinDelay = currentDelay;
      let tCount = 0;

      if (cfg.aqmAlgorithm === 'red') {
        if (dq > cfg.dqThreshold && lastQ > cfg.qMax * 0.1) {
          status = 'warning';
          pDrop = Math.min(0.9, 0.05 * (dq - cfg.dqThreshold)); 
          droppedAqmNow = incomingPotential * pDrop;
        }
      } 
      else if (cfg.aqmAlgorithm === 'pie') {
        const alpha = 0.05; 
        const beta = 0.5;   
        
        let error = currentDelay - cfg.targetDelay;
        let delayDerivative = currentDelay - pieRef.current.oldDelay;
        
        let pCalc = pieRef.current.pDrop + alpha * error + beta * delayDerivative;
        
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
        codelRef.current.delayWindow.push(currentDelay);
        if (codelRef.current.delayWindow.length > CODEL_WINDOW) {
          codelRef.current.delayWindow.shift();
        }
        
        const minDelayInWindow = Math.min(...codelRef.current.delayWindow);
        tMinDelay = minDelayInWindow;

        if (codelRef.current.delayWindow.length >= CODEL_WINDOW && minDelayInWindow > cfg.targetDelay) {
          status = 'warning';
          if (!codelRef.current.dropState) {
            codelRef.current.dropState = true;
            codelRef.current.dropCount = 1;
          } else {
            codelRef.current.dropCount += 1;
          }
          pDrop = Math.min(0.9, 0.1 * Math.sqrt(codelRef.current.dropCount));
          droppedAqmNow = incomingPotential * pDrop;
        } else {
          codelRef.current.dropState = false;
          codelRef.current.dropCount = 0;
          pDrop = 0;
        }
        tCount = codelRef.current.dropCount;
      }

      let incomingActual = incomingPotential - droppedAqmNow;
      let newQ = lastQ + incomingActual - processed;

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
        delay: currentDelay, minDelay: tMinDelay, pieError: tPieError, pieDeriv: tPieDeriv, count: tCount,
        currentLambda: activeLambda, currentMu: activeMu
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
    setTelemetry({ q: 0, prevQ: 0, dq: 0, pDrop: 0, delay: 0, minDelay: 0, pieError: 0, pieDeriv: 0, count: 0, currentLambda: 0, currentMu: 0 });
  };

  const queuePercentage = Math.min(100, Math.max(0, (currentQ / qMax) * 100));

  const getAlgorithmDescription = () => {
    switch(aqmAlgorithm) {
      case 'red': return "Detecta congestión usando la velocidad de llenado (1ra derivada). Bueno para reaccionar a picos repentinos.";
      case 'pie': return "Usa Control Proporcional-Integral. Evalúa qué tan lejos estamos del objetivo y cómo cambia esa distancia (derivada del error) para ajustarse suavemente.";
      case 'codel': return "No usa derivadas explícitas, sino una ventana de tiempo. Se asegura de que la cola siempre tenga momentos vacíos, evitando el estancamiento crónico.";
      default: return "Sin inteligencia. Los paquetes entran hasta que la memoria física se desborda y se pierden datos abruptamente (Tail Drop).";
    }
  };

  return (
    <div className="app-container">
      <header className="header">
        <h1>Router AQM Sim: Análisis Matemático</h1>
        <button className="theme-toggle" onClick={toggleTheme}>
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          {theme === 'dark' ? 'Modo Crema' : 'Modo Nocturno'}
        </button>
      </header>

      <div className="metrics">
        <div className="metric-card">
          <div className="label">Cola Actual (Paquetes)</div>
          <div className="value">{currentQ.toFixed(1)} <span style={{fontSize: '1rem', color: 'var(--text-secondary)'}}>/ {qMax}</span></div>
        </div>
        <div className="metric-card">
          <div className="label">Tiempo de Retraso (Delay)</div>
          <div className="value" style={{ color: telemetry.delay > targetDelay && aqmAlgorithm !== 'none' ? 'var(--warning-color)' : 'var(--text-primary)' }}>
            {telemetry.delay.toFixed(2)}s
          </div>
        </div>
        <div className="metric-card">
          <div className="label" style={{color: 'var(--danger-color)'}}>Pérdidas Reales (Fallo Físico)</div>
          <div className="value" style={{ color: droppedTailDrop > 0 ? 'var(--danger-color)' : 'var(--text-primary)' }}>
            {droppedTailDrop.toFixed(0)}
          </div>
        </div>
      </div>

      <div className="grid">
        {/* Panel de Control y Telemetría */}
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '25px' }}>
          
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2 style={{margin: 0}}>Panel de Control</h2>
              <div style={{ display: 'inline-flex', gap: '10px' }}>
                <button className="button" onClick={() => setIsRunning(!isRunning)} style={{ padding: '8px 16px' }}>
                  {isRunning ? <Pause size={18} style={{marginRight: '6px'}}/> : <Play size={18} style={{marginRight: '6px'}}/>} 
                  {isRunning ? 'Pausar' : 'Simular'}
                </button>
                <button className="button danger" onClick={resetSimulation} style={{ padding: '8px 16px' }}>
                  <RefreshCw size={18} />
                </button>
              </div>
            </div>

            {/* INTEGRACIÓN RED REAL / EMULADA */}
            <div style={{ padding: '15px', borderRadius: '16px', border: '2px solid', borderColor: useRealNetwork ? 'var(--success-color)' : 'var(--border-color)', background: useRealNetwork ? 'rgba(16, 185, 129, 0.05)' : 'transparent', marginBottom: '20px', transition: 'all 0.3s ease' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: useRealNetwork ? 'var(--success-color)' : 'var(--text-primary)' }}>
                  {useRealNetwork ? <Wifi size={24} /> : <WifiOff size={24} color="var(--text-secondary)" />}
                  <div>
                    <strong style={{display: 'block'}}>Sincronizar con Hardware Dinámico</strong>
                    {!netInfo.isRealApi && <small style={{color: 'var(--warning-color)', fontSize: '0.75rem'}}>API No soportada: Usando motor de emulación estocástica</small>}
                  </div>
                </div>
                <label className="switch" style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                  <input type="checkbox" checked={useRealNetwork} onChange={(e) => setUseRealNetwork(e.target.checked)} style={{ width: '20px', height: '20px', accentColor: 'var(--success-color)' }} />
                  <span style={{ marginLeft: '10px', fontWeight: 'bold' }}>{useRealNetwork ? 'CONECTADO' : 'MANUAL'}</span>
                </label>
              </div>
              
              {useRealNetwork && (
                <div style={{ marginTop: '10px', fontSize: '0.9rem', color: 'var(--text-secondary)', display: 'flex', gap: '15px', padding: '10px', background: 'var(--bg-color)', borderRadius: '8px' }}>
                  <div><strong>Ancho de Banda:</strong> {netInfo.downlink} Mbps</div>
                  <div><strong>Latencia (Ping):</strong> {netInfo.rtt} ms</div>
                  <div><strong>Red:</strong> {netInfo.type.toUpperCase()}</div>
                </div>
              )}
            </div>
            
            <div className="control-group">
              <label>
                Tráfico Entrante (Descargas/Streaming) 
                <span className="value">
                  {useRealNetwork && isRunning ? telemetry.currentLambda.toFixed(1) : baseLambda} pkts/s
                </span>
              </label>
              <input type="range" min="10" max="100" value={baseLambda} onChange={(e) => setBaseLambda(Number(e.target.value))} disabled={useRealNetwork} style={{ opacity: useRealNetwork ? 0.4 : 1 }} />
              {useRealNetwork && <small style={{color:'var(--success-color)'}}>Oscilando dinámicamente según latencia ({netInfo.rtt}ms)</small>}
            </div>

            <div className="control-group">
              <label>
                Capacidad de Salida del Router 
                <span className="value">
                  {useRealNetwork && isRunning ? telemetry.currentMu.toFixed(1) : mu} pkts/s
                </span>
              </label>
              <input type="range" min="10" max="100" value={mu} onChange={(e) => setMu(Number(e.target.value))} disabled={useRealNetwork} style={{ opacity: useRealNetwork ? 0.4 : 1 }} />
              {useRealNetwork && <small style={{color:'var(--success-color)'}}>Limitado por ancho de banda ({netInfo.downlink} Mbps)</small>}
            </div>

            <div className="control-group">
              <label>Memoria Física Máxima <span className="value">{qMax} pkts</span></label>
              <input type="range" min="50" max="200" value={qMax} onChange={(e) => setQMax(Number(e.target.value))} />
            </div>
            
            <div style={{ marginTop: '25px' }}>
              <label style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', fontWeight: 600 }}>Estado Físico de la Memoria Ram del Router</label>
              <div className="queue-visualizer">
                <div className={`queue-fill ${queuePercentage > 90 ? 'full' : queuePercentage > 60 ? 'warning' : ''}`} style={{ width: `${queuePercentage}%` }}></div>
              </div>
              {queuePercentage > 95 && <div style={{ fontSize: '0.85rem', color: 'var(--danger-color)', marginTop: '6px', fontWeight: 'bold' }}>¡ALERTA: MEMORIA LLENA! Se están perdiendo datos vitales.</div>}
            </div>
          </div>

          <hr style={{ borderColor: 'var(--border-color)', margin: '0' }} />

          {/* Sección AQM */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <div>
                <h3 style={{ margin: '0 0 5px 0' }}>Cerebro del Enrutador (AQM)</h3>
              </div>
              <select 
                value={aqmAlgorithm} 
                onChange={(e) => {
                  setAqmAlgorithm(e.target.value);
                  resetSimulation();
                }}
              >
                <option value="none">Sin Inteligencia (Tail Drop)</option>
                <option value="red">RED (1ra Derivada)</option>
                <option value="pie">PIE (Prop-Integral)</option>
                <option value="codel">CoDel (Tiempo de Vida)</option>
              </select>
            </div>
            <div style={{fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '20px', display: 'flex', gap: '8px', alignItems: 'flex-start'}}>
              <Info size={16} style={{flexShrink: 0, marginTop: '2px'}}/>
              <span>{getAlgorithmDescription()}</span>
            </div>

            {aqmAlgorithm !== 'none' && (
              <div style={{ background: 'rgba(0,0,0,0.02)', padding: '15px', borderRadius: '16px', border: '1px solid var(--border-color)' }}>
                {aqmAlgorithm === 'red' && (
                  <div className="control-group" style={{ marginBottom: '15px' }}>
                    <label>Umbral de Tolerancia a Subidas <span className="value">{dqThreshold}</span></label>
                    <input type="range" min="1" max="20" value={dqThreshold} onChange={(e) => setDqThreshold(Number(e.target.value))} />
                  </div>
                )}
                
                {(aqmAlgorithm === 'pie' || aqmAlgorithm === 'codel') && (
                  <div className="control-group" style={{ marginBottom: '15px' }}>
                    <label>Objetivo Máximo de Retraso <span className="value">{targetDelay}s</span></label>
                    <input type="range" min="0.1" max="1.5" step="0.1" value={targetDelay} onChange={(e) => setTargetDelay(Number(e.target.value))} />
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div className={`aqm-status ${aqmStatus}`}>
                    {aqmStatus === 'stable' ? (
                      <><CheckCircle size={16} style={{ marginRight: '6px' }}/> Red Estable</>
                    ) : (
                      <><AlertTriangle size={16} style={{ marginRight: '6px' }}/> Interviniendo Red...</>
                    )}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Prevención Activa</div>
                    <strong style={{ color: 'var(--danger-color)', fontSize: '1.2rem' }}>{droppedAQM.toFixed(1)} <span style={{fontSize: '0.9rem'}}>pkts frenados</span></strong>
                  </div>
                </div>

                {/* Telemetría Matemática Rediseñada */}
                <div className="telemetry-container">
                  <div className="telemetry-header">
                    <Calculator size={16} color="var(--accent-color)" /> Telemetría Analítica en Vivo
                  </div>
                  <div className="telemetry-body">
                    {/* Columna Izquierda: Código */}
                    <div className="telemetry-math">
{aqmAlgorithm === 'red' && (
<>
<span className="comment">// Derivada (Crecimiento actual)</span>
<span className="keyword">let</span> <span className="variable">dQ_dt</span> = <span className="number">{telemetry.dq.toFixed(1)}</span>;

<div className={telemetry.dq > dqThreshold ? 'highlight-active' : ''}><span className="keyword">if</span> (<span className="variable">dQ_dt</span> &gt; <span className="variable">umbral</span> ({dqThreshold})) {'{'}
  <span className="comment">// Descarte Proporcional a la Derivada</span>
  <span className="variable">P_drop</span> = k * (dQ_dt - umbral);
{'}'}</div><div className={telemetry.dq <= 0 ? 'highlight-active' : ''}><span className="keyword">else</span> {'{'} <span className="variable">P_drop</span> = 0; {'}'}</div>
</>
)}

{aqmAlgorithm === 'pie' && (
<>
<span className="comment">// Error (Delay actual vs Meta)</span>
<span className="keyword">let</span> <span className="variable">err</span> = <span className="number">{telemetry.pieError.toFixed(3)}</span>;

<span className="comment">// Integral (Evolución del error)</span>
<span className="keyword">let</span> <span className="variable">derr</span> = <span className="number">{telemetry.pieDeriv.toFixed(3)}</span>;

<div className={telemetry.pDrop > 0 ? 'highlight-active' : ''}><span className="comment">// Controlador PI</span>
<span className="variable">P</span> = <span className="variable">P</span> + <span className="number">0.05</span>*err + <span className="number">0.5</span>*derr;</div>
<span className="comment">// P_drop_actual = {(telemetry.pDrop*100).toFixed(1)}%</span>
</>
)}

{aqmAlgorithm === 'codel' && (
<>
<span className="comment">// Mínimo Local en Ventana (10s)</span>
<span className="keyword">let</span> <span className="variable">minDelay</span> = <span className="number">{telemetry.minDelay.toFixed(2)}</span>s;

<div className={telemetry.minDelay > targetDelay ? 'highlight-active' : ''}><span className="keyword">if</span> (<span className="variable">minDelay</span> &gt; <span className="variable">target</span>) {'{'}
  <span className="variable">count</span> = <span className="number">{telemetry.count}</span>;
  <span className="variable">P_drop</span> = k * <span className="keyword">sqrt</span>(<span className="variable">count</span>);
{'}'}</div><div className={telemetry.minDelay <= targetDelay ? 'highlight-active' : ''}><span className="keyword">else</span> {'{'} <span className="variable">P_drop</span> = 0; {'}'}</div>
</>
)}
                    </div>

                    {/* Columna Derecha: Traductor Humano */}
                    <div className="telemetry-human">
                      {aqmAlgorithm === 'red' && (
                        <>
                          <div className={`human-block ${telemetry.dq > dqThreshold ? 'warning' : 'success'}`}>
                            <strong>¿Qué está pasando?</strong><br/>
                            {telemetry.dq > dqThreshold 
                              ? `La memoria se está llenando muy rápido (Derivada: +${telemetry.dq.toFixed(1)}). El algoritmo frena el ${ (telemetry.pDrop*100).toFixed(1) }% del tráfico preventivamente.`
                              : `La entrada de tráfico es estable o está bajando. No se aplican frenos preventivos.`}
                          </div>
                        </>
                      )}
                      {aqmAlgorithm === 'pie' && (
                        <>
                          <div className={`human-block ${telemetry.pieError > 0 ? 'warning' : 'success'}`}>
                            <strong>¿Qué está pasando?</strong><br/>
                            {telemetry.pieError > 0 
                              ? `Estamos excediendo el límite de tiempo. PIE frena suavemente un ${(telemetry.pDrop*100).toFixed(1)}% analizando si el problema empeora o mejora.`
                              : `El tiempo de espera es óptimo. El controlador afloja las restricciones.`}
                          </div>
                        </>
                      )}
                      {aqmAlgorithm === 'codel' && (
                        <>
                          <div className={`human-block ${telemetry.minDelay > targetDelay ? 'warning' : 'success'}`}>
                            <strong>¿Qué está pasando?</strong><br/>
                            {telemetry.minDelay > targetDelay 
                              ? `¡Congestión Crónica! La cola no se ha vaciado en los últimos 10s. Aplicando frenos incrementales (Raíz Cuadrada).`
                              : `Respiración saludable: La cola logró vaciarse o acercarse a cero en los últimos 10s. Todo en orden.`}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>

              </div>
            )}
          </div>
        </div>

        {/* Panel de Gráficos */}
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
          
          <div style={{ flex: 1 }}>
            <h2 style={{fontSize: '1.2rem'}}>Retraso Experimentado por el Usuario (Latencia)</h2>
            <div className="chart-container" style={{ height: '240px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" vertical={false} />
                  <XAxis dataKey="time" stroke="var(--text-secondary)" tick={{fontSize: 12, fill: 'var(--text-secondary)'}} tickLine={false} />
                  <YAxis domain={[0, 'auto']} stroke="var(--text-secondary)" tick={{fontSize: 12, fill: 'var(--text-secondary)'}} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ backgroundColor: 'var(--panel-bg)', borderColor: 'var(--border-color)', color: 'var(--text-primary)', borderRadius: '12px', backdropFilter: 'blur(10px)' }} />
                  <Legend iconType="circle" wrapperStyle={{paddingTop: '10px'}}/>
                  {(aqmAlgorithm === 'pie' || aqmAlgorithm === 'codel') && (
                    <ReferenceLine y={targetDelay} label={{position: 'insideTopLeft', value: 'Objetivo Ideal', fill: 'var(--warning-color)', fontSize: 12}} stroke="var(--warning-color)" strokeDasharray="5 5" />
                  )}
                  <Line type="monotone" dataKey="delay" name="Segundos de Espera" stroke="var(--accent-color)" strokeWidth={4} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div style={{ flex: 1 }}>
            <h2 style={{fontSize: '1.2rem'}}>Estrés en Memoria Física (Queue Size)</h2>
            <div className="chart-container" style={{ height: '240px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" vertical={false} />
                  <XAxis dataKey="time" stroke="var(--text-secondary)" tick={{fontSize: 12, fill: 'var(--text-secondary)'}} tickLine={false} />
                  <YAxis domain={[0, Math.max(qMax + 20, 100)]} stroke="var(--text-secondary)" tick={{fontSize: 12, fill: 'var(--text-secondary)'}} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ backgroundColor: 'var(--panel-bg)', borderColor: 'var(--border-color)', color: 'var(--text-primary)', borderRadius: '12px', backdropFilter: 'blur(10px)' }} />
                  <Legend iconType="circle" wrapperStyle={{paddingTop: '10px'}}/>
                  <ReferenceLine y={qMax} label={{position: 'insideTopLeft', value: 'Colapso Físico', fill: 'var(--danger-color)', fontSize: 12}} stroke="var(--danger-color)" strokeDasharray="5 5" />
                  <Line type="monotone" dataKey="q" name="Paquetes" stroke="var(--success-color)" strokeWidth={3} dot={false} isAnimationActive={false} fill="url(#colorUv)" />
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
