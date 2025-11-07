// ====== SOUND SYSTEM (WEB AUDIO API) ======
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

// High double beep = LIVE (APPROVED)
function playLiveSound() {
    _beep({ freq: 880, dur: 0.09, type: 'sine', vol: 0.18 });
    setTimeout(() => _beep({ freq: 1046, dur: 0.11, type: 'sine', vol: 0.18 }), 110);
}

// Low short buzz = ERROR
function playErrorSound() {
    _beep({ freq: 220, dur: 0.18, type: 'square', vol: 0.16 });
}

// Backend URL (Flask)
const FLASK_URL = 'https://doughtier-merilyn-catamenial.ngrok-free.dev';

// --- GLOBAL STATE ---
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

// --- DOM REFS ---
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

// --- UI & UTILS ---

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
        creditBadge.innerHTML = `<span class="dot"></span> Active session - <b>30 CREDITS</b>`;
    }
}

// Show CCs by status (APPROVED / DECLINED / EXPIRED)
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
        const names = {
            all: 'All',
            VIVA: 'Approved',
            MUERTA: 'Declined',
            ERROR: 'Errors'
        };
        logFilterTitle.textContent = names[currentFilter] || 'All';
    }

    filteredLogs.slice().reverse().forEach(log => {
        const item = document.createElement('div');
        item.className = 'log-item';

        let displayText = '';
        let emoji = '';

        if (log.estado === 'VIVA') {
            emoji = '✅';
            displayText = 'APPROVED';
        } else if (log.estado === 'MUERTA') {
            emoji = '❌';
            displayText = 'DECLINED';
        } else if (log.estado === 'COOKIE_EXPIRADA' || log.estado === 'ERROR' || log.estado === 'DESCONOCIDO') {
            emoji = '⚠️';
            displayText = 'EXPIRED';
        } else {
            emoji = '❌';
            displayText = 'DECLINED';
        }

        item.innerHTML = `
            <div class="log-cc">
                ${log.cc}
                <span class="log-result">${emoji} ${displayText}</span>
            </div>
        `;

        if (logContainer) logContainer.appendChild(item);
    });
}

function formatCard(cc) {
    return cc.replace(/[^0-9|]/g, '').trim();
}

// --- CHECKER LOGIC ---

async function checkCard(cc) {
    const cookie = cookieArea ? cookieArea.value.trim() : '';
    const formattedCC = formatCard(cc);

    if (!cookie || !formattedCC) {
        results.logs.push({ estado: 'ERROR', cc: formattedCC || cc });
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
            results.logs.push({ estado: 'COOKIE_EXPIRADA', cc: formattedCC, raw: data.mensaje });
            playErrorSound();
            return 'COOKIE_EXPIRADA';
        }

        if (!response.ok || data.estado === 'ERROR' || data.estado === 'DESCONOCIDO') {
            results.logs.push({
                estado: data.estado === 'ERROR' ? 'ERROR' : 'UNKNOWN',
                cc: formattedCC,
                raw: data.mensaje || `HTTP Error: ${response.status}`
            });
            playErrorSound();
            return 'ERROR';
        }

        results.logs.push({
            estado: data.estado,
            cc: formattedCC,
            raw: data.raw || ''
        });

        if (data.estado === 'VIVA') playLiveSound();

        return data.estado;

    } catch (error) {
        console.error("Card check error (Network/CORS):", error);
        results.logs.push({
            estado: 'ERROR',
            cc: formattedCC,
            raw: 'Connection error with backend.'
        });
        playErrorSound();
        return 'ERROR';
    }
}

async function startChecking() {
    if (running) return;

    // ✅ Reinicia los contadores al volver a iniciar
    results.TESTED = 0;
    currentIndex = 0;

    ccList = ccListArea ? ccListArea.value.split('\n').map(c => c.trim()).filter(c => c.length > 0) : [];
    results.TOTAL = ccList.length;

    if (results.TOTAL === 0) {
        updateStatus("Error: Empty list.", false);
        return;
    }

    running = true;
    paused = false;

    if (startBtn) startBtn.disabled = true;
    if (pauseBtn) pauseBtn.disabled = false;
    if (stopBtn) stopBtn.disabled = false;
    updateStatus(`Starting check... Total: ${results.TOTAL}`, true);

    for (; currentIndex < ccList.length; currentIndex++) {
        if (!running || paused) break;

        const cc = ccList[currentIndex];
        await new Promise(r => setTimeout(r, 150));

        updateStatus(`Checking ${currentIndex + 1}/${results.TOTAL}: ${cc.substring(0, 6)}...`, true);
        const status = await checkCard(cc);
        results.TESTED++;

        if (status === 'VIVA') {
            results.VIVA++;
        } else if (status === 'MUERTA') {
            results.MUERTA++;
        } else if (status === 'COOKIE_EXPIRADA') {
            results.COOKIE_EXPIRADA++;
            updateStatus("Cookie expired. Stopped.", false);
            running = false;
            paused = false;
            break;
        } else {
            results.ERROR++;
        }

        updateStats();
        updateLogDisplay();

        // ✅ Quita del textarea la tarjeta ya chequeada
        if (ccListArea) {
            const lines = ccListArea.value.split('\n');
            lines.shift();
            ccListArea.value = lines.join('\n');
        }
    }

    if (running) updateStatus("Check complete.", false);

    if (!paused) {
        running = false;
        if (startBtn) startBtn.disabled = false;
        if (pauseBtn) pauseBtn.disabled = true;
        if (stopBtn) stopBtn.disabled = true;
    } else {
        updateStatus(`Paused at ${currentIndex + 1}/${ccList.length}`, false);
    }
}

// --- EVENT LISTENERS ---
document.addEventListener('DOMContentLoaded', () => {
    loadCredits();
    updateStats();
    updateStatus("Stopped. Waiting list + cookie.", false);
    updateLogDisplay();

    if (startBtn) {
        startBtn.addEventListener('click', () => {
            paused = false;
            startChecking();
        });
    }

    if (pauseBtn) {
        pauseBtn.addEventListener('click', () => {
            if (running) {
                running = false;
                paused = true;
                updateStatus(`Paused at ${currentIndex + 1}/${ccList.length}`, false);
                if (startBtn) startBtn.disabled = false;
                if (pauseBtn) pauseBtn.disabled = true;
                if (stopBtn) stopBtn.disabled = false;
            }
        });
    }

    if (stopBtn) {
        stopBtn.addEventListener('click', () => {
            running = false;
            paused = false;
            currentIndex = 0;
            updateStatus("Stopped. Press start again.", false);
            if (startBtn) startBtn.disabled = false;
            if (pauseBtn) pauseBtn.disabled = true;
            if (stopBtn) stopBtn.disabled = true;
        });
    }

    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            if (running) return;
            Object.keys(results).forEach(key => {
                if (typeof results[key] === 'number') results[key] = 0;
            });
            results.logs = [];
            if (ccListArea) ccListArea.value = '';
            currentIndex = 0;
            updateStats();
            updateLogDisplay();
            updateStatus("Cleared all data.", false);
        });
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            alert("Session closed (mock).");
        });
    }

    document.querySelectorAll('.iconbar .icon').forEach(icon => {
        icon.addEventListener('click', function () {
            document.querySelectorAll('.iconbar .icon').forEach(i => i.classList.remove('active'));
            this.classList.add('active');
            currentFilter = this.getAttribute('data-filter');
            updateLogDisplay();
        });
    });
});
