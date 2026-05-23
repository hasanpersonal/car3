// --- FIREBASE CONFIGURATION ---
const firebaseConfig = {
    apiKey: "AIzaSyCKqsxIC2aGBR0UnejiXlIaJeKAfdW_Zp0",
    authDomain: "online-ha.firebaseapp.com",
    databaseURL: "https://online-ha-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "online-ha",
    storageBucket: "online-ha.firebasestorage.app",
    messagingSenderId: "1033988386517",
    appId: "1:1033988386517:web:ff4c6befb8fcee7e84bc5c",
    measurementId: "G-QLLSTFR1XX"
};
firebase.initializeApp(firebaseConfig);
const database = firebase.database();

// --- GAME & MULTIPLAYER STATE ---
let myId = Math.random().toString(36).substr(2, 9);
let myName = "";
let currentRoom = null;
let isHost = false;
let opponentsData = {};
let lastSyncTime = 0;
let isMultiplayer = false;

let gameActive = false;
let score = 0, speed = 0, targetSpeed = 0;
let nitro = 0, bullets = 0;
let isNitro = false;
let screenShake = 0, roadOffset = 0, screenFlash = 0;
let player;
let enemies = [], stars = [], activeBullets = [], particles = [];

let raceTimeLeft = 60;
let timerInterval = null;

// ─── CANVAS SETUP ───
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const gameWidth  = 480;
const gameHeight = 640;   // tighter height for the new viewport ratio
canvas.width  = gameWidth;
canvas.height = gameHeight;

const hud = document.getElementById('hud');

// ─── NEW TRACKPAD CONTROLLER ───
const trackpad  = document.getElementById('trackpad');
const puck      = document.getElementById('ctrl-puck');
const ammoTxt   = document.getElementById('ammo-count-txt');
const shootBtn  = document.getElementById('shoot-btn');

let tpActive = false, tpTouchId = null;
let tpCenterX = 0, tpCenterY = 0;
let tpDX = 0, tpDY = 0;
const TP_RADIUS = 55; // max puck travel (px)

function getTrackpadCenter() {
    const r = trackpad.getBoundingClientRect();
    tpCenterX = r.left + r.width  / 2;
    tpCenterY = r.top  + r.height / 2;
}

trackpad.addEventListener('touchstart', (e) => {
    if (!gameActive) return;
    e.preventDefault();
    if (tpActive) return;
    const t = e.changedTouches[0];
    tpActive  = true;
    tpTouchId = t.identifier;
    getTrackpadCenter();
    movePuck(t.clientX, t.clientY);
}, { passive: false });

trackpad.addEventListener('touchmove', (e) => {
    if (!tpActive) return;
    e.preventDefault();
    for (let i = 0; i < e.touches.length; i++) {
        if (e.touches[i].identifier === tpTouchId) {
            movePuck(e.touches[i].clientX, e.touches[i].clientY);
            break;
        }
    }
}, { passive: false });

trackpad.addEventListener('touchend', (e) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === tpTouchId) {
            tpActive = false; tpTouchId = null;
            tpDX = 0; tpDY = 0;
            resetPuck();
            break;
        }
    }
}, { passive: false });

trackpad.addEventListener('touchcancel', () => {
    tpActive = false; tpTouchId = null;
    tpDX = 0; tpDY = 0;
    resetPuck();
});

function movePuck(cx, cy) {
    let dx = cx - tpCenterX;
    let dy = cy - tpCenterY;
    const dist = Math.sqrt(dx*dx + dy*dy);
    if (dist > TP_RADIUS) {
        dx = (dx / dist) * TP_RADIUS;
        dy = (dy / dist) * TP_RADIUS;
    }
    tpDX = dx; tpDY = dy;

    // Move the puck visually (offset from its center which is already at 50%,50% via CSS)
    puck.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;

    // Direction classes for arrow highlights
    trackpad.classList.toggle('pressing-up',    dy < -14);
    trackpad.classList.toggle('pressing-down',  dy >  14);
    trackpad.classList.toggle('pressing-left',  dx < -14);
    trackpad.classList.toggle('pressing-right', dx >  14);

    // Nitro glow on puck
    puck.classList.toggle('nitro-active', dy < -14 && nitro > 0);
}

function resetPuck() {
    puck.style.transform = 'translate(-50%, -50%)';
    trackpad.classList.remove('pressing-up','pressing-down','pressing-left','pressing-right');
    puck.classList.remove('nitro-active');
}

// ─── KEYBOARD FALLBACK ───
const keys = { a: false, d: false, w: false, s: false };
window.addEventListener('keydown', e => {
    if (e.key === 'a' || e.key === 'ArrowLeft')  keys.a = true;
    if (e.key === 'd' || e.key === 'ArrowRight') keys.d = true;
    if (e.key === 'w' || e.key === 'ArrowUp')   keys.w = true;
    if (e.key === 's' || e.key === 'ArrowDown') keys.s = true;
    if (e.code === 'Space') { shootBullet(); e.preventDefault(); }
});
window.addEventListener('keyup', e => {
    if (e.key === 'a' || e.key === 'ArrowLeft')  keys.a = false;
    if (e.key === 'd' || e.key === 'ArrowRight') keys.d = false;
    if (e.key === 'w' || e.key === 'ArrowUp')   keys.w = false;
    if (e.key === 's' || e.key === 'ArrowDown') keys.s = false;
});

// Shoot button
shootBtn.addEventListener('touchstart', (e) => {
    shootBullet();
    e.preventDefault();
    e.stopPropagation();
}, { passive: false });

// ─── AUDIO ───
let audioCtx, engineOsc, engineGain;

function setupAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    engineOsc = audioCtx.createOscillator();
    engineGain = audioCtx.createGain();
    engineOsc.type = 'sawtooth';
    engineOsc.frequency.setValueAtTime(40, audioCtx.currentTime);
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(180, audioCtx.currentTime);
    engineOsc.connect(filter);
    filter.connect(engineGain);
    engineGain.connect(audioCtx.destination);
    engineGain.gain.setValueAtTime(0.015, audioCtx.currentTime);
    engineOsc.start(0);
}

function playSfx(freq, type, dur, vol) {
    if (!audioCtx) return;
    const osc  = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(vol, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + dur);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + dur);
}

// ─── MULTIPLAYER ───
function createRoom() {
    myName = document.getElementById('host-name').value.trim();
    if (!myName) return alert("Enter Host Name!");
    currentRoom = Math.floor(1000 + Math.random() * 9000).toString();
    isHost = true;
    isMultiplayer = true;

    database.ref('car_rooms/' + currentRoom).set({
        status: "waiting",
        hostId: myId,
        players: {
            [myId]: { name: myName, score: 0, x: gameWidth/2, color: '#00f0ff' }
        }
    }).then(() => {
        document.getElementById('display-room-code').innerText = currentRoom;
        document.getElementById('btn-start').style.display = 'inline-block';
        document.getElementById('waiting-msg').style.display = 'none';
        document.getElementById('start-screen').classList.add('hidden');
        document.getElementById('waiting-screen').classList.remove('hidden');
        listenToRoom();
    });
}

function joinRoom() {
    myName = document.getElementById('joiner-name').value.trim();
    currentRoom = document.getElementById('room-code-input').value.trim();
    if (!myName || !currentRoom) return alert("Enter Player Name and Room Code!");
    isMultiplayer = true;

    database.ref('car_rooms/' + currentRoom).once('value', snap => {
        if (!snap.exists()) return alert("Room not found!");
        if (snap.val().status !== "waiting") return alert("Game already running/ended!");

        const c = ['#a200ff','#ff00aa','#ffea00','#00ff66'][Math.floor(Math.random()*4)];
        database.ref('car_rooms/' + currentRoom + '/players/' + myId).set({
            name: myName, score: 0, x: gameWidth/2, color: c
        }).then(() => {
            document.getElementById('display-room-code').innerText = currentRoom;
            document.getElementById('start-screen').classList.add('hidden');
            document.getElementById('waiting-screen').classList.remove('hidden');
            listenToRoom();
        });
    });
}

function listenToRoom() {
    database.ref('car_rooms/' + currentRoom).on('value', snap => {
        const data = snap.val();
        if (!data) return;

        if (data.status === "waiting") {
            document.getElementById('gameover-screen').classList.add('hidden');
            document.getElementById('waiting-screen').classList.remove('hidden');
            hud.style.display = 'none';

            const list = document.getElementById('players-list');
            list.innerHTML = "";
            Object.keys(data.players).forEach(pid => {
                const li = document.createElement('li');
                li.innerText = "🏎️ " + data.players[pid].name + (pid === data.hostId ? " (Host)" : "");
                list.appendChild(li);
            });

            const chatBox = document.getElementById('chat-messages');
            chatBox.innerHTML = "";
            if (data.chats) {
                Object.keys(data.chats).forEach(msgId => {
                    const msg = data.chats[msgId];
                    const p = document.createElement('p');
                    p.innerHTML = `<strong style="color:#ff0055;">${msg.sender}:</strong> <span style="color:#fff;">${msg.text}</span>`;
                    chatBox.appendChild(p);
                });
                chatBox.scrollTop = chatBox.scrollHeight;
            }
        } else if (data.status === "playing" && !gameActive) {
            initGameAndFullscreen();
        }

        if (data.players) {
            opponentsData = data.players;
            updateDistanceTrackerUI();
            if (data.status === "finished" && !gameActive) {
                showFinalLeaderboard();
            }
        }
    });

    document.getElementById('chat-input').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') sendChatMessage();
    });
}

function sendChatMessage() {
    const input = document.getElementById('chat-input');
    const msgText = input.value.trim();
    if (!msgText) return;
    database.ref('car_rooms/' + currentRoom + '/chats').push({
        sender: myName, text: msgText, timestamp: Date.now()
    });
    input.value = "";
}

function startMultiplayerGame() {
    let updates = { status: "playing" };
    Object.keys(opponentsData).forEach(id => { updates[`players/${id}/score`] = 0; });
    database.ref('car_rooms/' + currentRoom).update(updates);
}

function playSolo() {
    isMultiplayer = false;
    initGameAndFullscreen();
}

function updateDistanceTrackerUI() {
    if (!opponentsData) return;
    const laneBg = document.getElementById('tracker-lanes');
    laneBg.innerHTML = "";

    if (opponentsData[myId]) {
        const myKM = (opponentsData[myId].score / 1000).toFixed(2);
        const kmEl = document.getElementById('km-txt');
        if (kmEl) kmEl.innerText = `${myKM} KM`;
    }

    const scores = Object.keys(opponentsData).map(id => opponentsData[id].score);
    const maxScore = Math.max(...scores, 1000);

    Object.keys(opponentsData).forEach(id => {
        const p = opponentsData[id];
        const pKM = (p.score / 1000).toFixed(2);
        const dot = document.createElement('div');
        dot.className = "player-progress-dot";
        dot.style.color = p.color || '#00f0ff';
        dot.style.backgroundColor = p.color || '#00f0ff';
        const pct = (p.score / maxScore) * 82;
        dot.style.left = `${pct}%`;
        dot.innerHTML = `<span style="position:absolute;top:-18px;left:-10px;font-size:8px;color:#fff;white-space:nowrap;background:rgba(0,0,0,0.8);padding:1px 4px;border-radius:3px;border:1px solid ${p.color||'#00f0ff'}">${p.name.substring(0,3)}:${pKM}K</span>`;
        laneBg.appendChild(dot);
    });
}

function initGameAndFullscreen() {
    const container = document.getElementById('game-viewport');
    if (container.requestFullscreen) container.requestFullscreen().catch(() => {});
    setupAudio();
    document.getElementById('start-screen').classList.add('hidden');
    document.getElementById('waiting-screen').classList.add('hidden');
    hud.style.display = 'block';
    restartGame();
}

// ─── GAME LOGIC ───
function restartGame() {
    player = new Player();
    enemies = []; stars = []; particles = []; activeBullets = [];
    score = 0; speed = 0; nitro = 0; bullets = 0;
    raceTimeLeft = 60;
    gameActive = true;
    tpActive = false; tpTouchId = null;
    screenFlash = 0;
    resetPuck();
    updateAmmoUI();
    document.getElementById('gameover-screen').classList.add('hidden');
    document.getElementById('leaderboard-box').style.display = 'none';

    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        if (gameActive) {
            raceTimeLeft--;
            document.getElementById('timer-txt').innerText = `${raceTimeLeft}s`;
            if (raceTimeLeft <= 0) endRaceDuration();
        }
    }, 1000);
}

function endRaceDuration() {
    gameActive = false;
    clearInterval(timerInterval);
    if (engineGain) engineGain.gain.setValueAtTime(0, audioCtx.currentTime);

    const myKM = (score / 1000).toFixed(2);
    document.getElementById('final-score-lbl').innerText = `SCORE: ${Math.floor(score)} · ${myKM} KM`;

    if (isMultiplayer && isHost) {
        database.ref('car_rooms/' + currentRoom).update({ status: "finished" });
    }

    if (isMultiplayer) {
        showFinalLeaderboard();
    } else {
        const box  = document.getElementById('leaderboard-box');
        const list = document.getElementById('leaderboard-list');
        list.innerHTML = `<li><strong style="color:#00f0ff;">${myName||'Driver'}</strong> — ${Math.floor(score)} pts (${myKM} KM)</li>`;
        box.style.display = 'block';
    }
    document.getElementById('gameover-screen').classList.remove('hidden');
    hud.style.display = 'none';
}

function backToLobby() {
    if (isMultiplayer) {
        if (isHost) {
            database.ref('car_rooms/' + currentRoom).update({ status: "waiting" });
        } else {
            document.getElementById('gameover-screen').classList.add('hidden');
            document.getElementById('waiting-screen').classList.remove('hidden');
        }
    } else {
        document.getElementById('gameover-screen').classList.add('hidden');
        document.getElementById('start-screen').classList.remove('hidden');
    }
}

function shootBullet() {
    if (!gameActive || bullets <= 0) return;
    bullets--;
    playSfx(600, 'triangle', 0.15, 0.3);
    activeBullets.push({ x: player.x + player.w / 2, y: player.y, w: 6, h: 22 });
    updateAmmoUI();
}

function updateAmmoUI() {
    ammoTxt.innerText = `${bullets} BULLETS`;
    if (bullets <= 0) {
        shootBtn.classList.add('empty');
    } else {
        shootBtn.classList.remove('empty');
    }
}

function triggerCrash() {
    screenShake = 30; screenFlash = 0.5;
    playSfx(120, 'sawtooth', 0.5, 0.4);
    score = Math.max(0, score - 800);
    speed = 0;
    player.y = Math.min(gameHeight - 80, player.y + 120);
    resetPuck();
}

function showFinalLeaderboard() {
    const box  = document.getElementById('leaderboard-box');
    const list = document.getElementById('leaderboard-list');
    list.innerHTML = "";
    box.style.display = 'block';

    const arr = Object.keys(opponentsData).map(id => opponentsData[id]);
    arr.sort((a, b) => b.score - a.score);
    arr.forEach(p => {
        const pKM = (p.score / 1000).toFixed(2);
        const li  = document.createElement('li');
        li.innerHTML = `<strong style="color:${p.color||'#fff'}">${p.name}</strong> — ${Math.floor(p.score)} pts <span style="color:#00ff66;">(${pKM} KM)</span>`;
        list.appendChild(li);
    });
    document.getElementById('gameover-screen').classList.remove('hidden');
    hud.style.display = 'none';
}

// ─── GAME CLASSES ───
class Player {
    constructor() {
        this.w = 40; this.h = 76;
        this.x = gameWidth / 2 - this.w / 2;
        this.y = gameHeight - 140;
        this.vx = 0; this.angle = 0;
    }
    update() {
        // Trackpad input
        let targetVX = 0;
        if (tpActive) {
            targetVX = (tpDX / TP_RADIUS) * 9;
        } else {
            targetVX = keys.a ? -8 : keys.d ? 8 : 0;
        }
        this.vx += (targetVX - this.vx) * 0.25;
        this.x  += this.vx;
        this.angle = this.vx * 0.04;

        if (this.x < 22) { this.x = 22; this.vx = 0; }
        if (this.x > gameWidth - 22 - this.w) { this.x = gameWidth - 22 - this.w; this.vx = 0; }

        if (speed > 40 && Math.random() < 0.6) {
            particles.push(new Particle(
                this.x + this.w/2, this.y + this.h,
                isNitro ? '#00f0ff' : '#ff0055',
                -speed * 0.03,
                Math.random() * 4 + 1
            ));
        }
        this.y += ((gameHeight - 140) - this.y) * 0.05;
    }
    draw() {
        ctx.save();
        ctx.translate(this.x + this.w/2, this.y + this.h/2);
        ctx.rotate(this.angle);
        ctx.shadowBlur = 20; ctx.shadowColor = isNitro ? '#00f0ff' : '#ff0055';
        ctx.fillStyle = '#0a0a18'; ctx.strokeStyle = isNitro ? '#00f0ff' : '#ff0055'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.rect(-this.w/2, -this.h/2, this.w, this.h); ctx.fill(); ctx.stroke();
        ctx.shadowBlur = 0; ctx.fillStyle = '#1a1a3a'; ctx.strokeStyle = '#8da1d6';
        ctx.beginPath(); ctx.rect(-this.w/3, -this.h/6, (this.w/3)*2, this.h/2.5); ctx.fill(); ctx.stroke();
        ctx.restore();
    }
}

class Enemy {
    constructor() {
        this.w = 40; this.h = 76;
        const lanes = [35, 120, 215, 310, 390];
        this.x = lanes[Math.floor(Math.random() * lanes.length)] + (Math.random()*8 - 4);
        this.y = -200; this.vShift = Math.random() * 3 + 2;
        this.color = ['#a200ff','#00ff66','#ff8800','#ff00aa'][Math.floor(Math.random() * 4)];
    }
    update() { this.y += this.vShift + speed * 0.08; }
    draw() {
        ctx.save();
        ctx.shadowBlur = 15; ctx.shadowColor = this.color;
        ctx.fillStyle = '#050510'; ctx.strokeStyle = this.color; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.rect(this.x, this.y, this.w, this.h); ctx.fill(); ctx.stroke();
        ctx.restore();
    }
}

class Star {
    constructor() {
        this.r = 16;
        const lanes = [45, 130, 225, 320, 405];
        this.x = lanes[Math.floor(Math.random() * lanes.length)];
        this.y = -200; this.rot = 0;
    }
    update() { this.y += speed * 0.08; this.rot += 0.05; }
    draw() {
        ctx.save();
        ctx.translate(this.x, this.y); ctx.rotate(this.rot);
        ctx.shadowBlur = 20; ctx.shadowColor = '#ffea00'; ctx.fillStyle = '#ffea00';
        ctx.beginPath();
        for (let i = 0; i < 5; i++) {
            ctx.lineTo(Math.cos((18 + i*72) * Math.PI/180) * this.r,  -Math.sin((18 + i*72) * Math.PI/180) * this.r);
            ctx.lineTo(Math.cos((54 + i*72) * Math.PI/180) * (this.r/2), -Math.sin((54 + i*72) * Math.PI/180) * (this.r/2));
        }
        ctx.closePath(); ctx.fill(); ctx.restore();
    }
}

class Particle {
    constructor(x, y, color, vy, size) {
        this.x = x; this.y = y; this.color = color;
        this.vx = Math.random()*4 - 2; this.vy = vy;
        this.alpha = 1; this.size = size;
    }
    update() { this.x += this.vx; this.y += this.vy; this.alpha -= 0.05; }
    draw() {
        ctx.save();
        ctx.globalAlpha = this.alpha; ctx.fillStyle = this.color;
        ctx.beginPath(); ctx.arc(this.x, this.y, this.size, 0, Math.PI*2); ctx.fill();
        ctx.restore();
    }
}

function drawOpponents() {
    if (!isMultiplayer || !opponentsData) return;
    for (let id in opponentsData) {
        if (id === myId) continue;
        const opp  = opponentsData[id];
        const drawY = player.y - (opp.score - score) * 3;
        if (drawY > -300 && drawY < gameHeight + 100) {
            ctx.save();
            ctx.translate(opp.x + 20, drawY + 38);
            ctx.globalAlpha = 0.5;
            ctx.shadowBlur = 20; ctx.shadowColor = opp.color || '#a200ff';
            ctx.fillStyle = '#0a0a18'; ctx.strokeStyle = opp.color || '#a200ff'; ctx.lineWidth = 3;
            ctx.beginPath(); ctx.rect(-20, -38, 40, 76); ctx.fill(); ctx.stroke();
            ctx.globalAlpha = 0.85;
            ctx.shadowBlur = 0; ctx.fillStyle = '#fff';
            ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center';
            ctx.fillText(opp.name, 0, -46);
            ctx.restore();
        }
    }
}

// ─── RENDER LOOP ───
function render() {
    ctx.clearRect(0, 0, gameWidth, gameHeight);
    ctx.save();

    if (screenShake > 0) {
        ctx.translate((Math.random()-0.5)*screenShake, (Math.random()-0.5)*screenShake);
        screenShake *= 0.88;
        if (screenShake < 0.5) screenShake = 0;
    }

    if (gameActive) {
        const nitroReq = (tpActive && tpDY < -14) || keys.w;
        const brakeReq = (tpActive && tpDY >  14) || keys.s;
        isNitro = nitroReq && nitro > 0;

        if (isNitro) {
            targetSpeed = 370; nitro -= 0.24;
            if (nitro < 0) nitro = 0;
            screenShake = Math.max(screenShake, 2);
            puck.classList.add('nitro-active');
        } else if (brakeReq) {
            targetSpeed = 60;
            puck.classList.remove('nitro-active');
        } else {
            targetSpeed = 130;
            puck.classList.remove('nitro-active');
        }

        speed += (targetSpeed - speed) * 0.08;
        score += speed * 0.015;
        roadOffset += speed * 0.08;

        if (engineOsc) engineOsc.frequency.setValueAtTime(40 + (speed/270)*140, audioCtx.currentTime);

        document.getElementById('score-txt').innerText = String(Math.floor(score)).padStart(5,'0');
        document.getElementById('speed-txt').innerText = Math.floor(speed);
        document.getElementById('nitro-fill').style.width  = `${nitro}%`;
        document.getElementById('nitro-pct').innerText = `${Math.floor(nitro)}%`;

        if (isMultiplayer && Date.now() - lastSyncTime > 100) {
            database.ref('car_rooms/' + currentRoom + '/players/' + myId).update({
                x: player.x, score: score
            });
            lastSyncTime = Date.now();
        }
    } else {
        speed += (0 - speed) * 0.1;
        roadOffset += speed * 0.08;
    }

    // Draw road
    ctx.fillStyle = '#020206'; ctx.fillRect(0, 0, gameWidth, gameHeight);
    ctx.fillStyle = '#060612'; ctx.fillRect(18, 0, gameWidth - 36, gameHeight);

    // Road edge glow
    ctx.shadowBlur = 12; ctx.shadowColor = '#00f0ff'; ctx.fillStyle = '#00f0ff';
    ctx.fillRect(16, 0, 3, gameHeight);
    ctx.shadowColor = '#ff0055'; ctx.fillStyle = '#ff0055';
    ctx.fillRect(gameWidth - 19, 0, 3, gameHeight);
    ctx.shadowBlur = 0;

    // Lane dashes
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    const lineY = roadOffset % 80;
    for (let y = -80; y < gameHeight; y += 80) {
        ctx.fillRect(gameWidth * 0.25, y + lineY, 2, 36);
        ctx.fillRect(gameWidth * 0.50 - 1, y + lineY, 3, 36);
        ctx.fillRect(gameWidth * 0.75, y + lineY, 2, 36);
    }

    // Bullets
    ctx.save();
    ctx.fillStyle = '#ffea00'; ctx.shadowBlur = 14; ctx.shadowColor = '#ffea00';
    for (let i = activeBullets.length - 1; i >= 0; i--) {
        const b = activeBullets[i];
        b.y -= 18;
        ctx.fillRect(b.x - b.w/2, b.y, b.w, b.h);
        for (let j = enemies.length - 1; j >= 0; j--) {
            const e = enemies[j];
            if (b.x > e.x && b.x < e.x + e.w && b.y > e.y && b.y < e.y + e.h) {
                for (let k = 0; k < 25; k++) {
                    particles.push(new Particle(e.x + e.w/2, e.y + e.h/2, '#ff0055', (Math.random()-0.5)*12, Math.random()*5+2));
                }
                playSfx(300, 'sawtooth', 0.2, 0.25);
                enemies.splice(j, 1); activeBullets.splice(i, 1);
                score += 100; break;
            }
        }
        if (activeBullets[i] && activeBullets[i].y < -50) activeBullets.splice(i, 1);
    }
    ctx.restore();

    // Particles
    for (let i = particles.length - 1; i >= 0; i--) {
        particles[i].update(); particles[i].draw();
        if (particles[i].alpha <= 0) particles.splice(i, 1);
    }

    // Stars
    if (gameActive && Math.random() < 0.015 && stars.length < 2) stars.push(new Star());
    for (let i = stars.length - 1; i >= 0; i--) {
        stars[i].update(); stars[i].draw();
        if (gameActive && player) {
            const px = player.x + player.w/2, py = player.y + player.h/2;
            if (Math.abs(px - stars[i].x) < player.w/2 + stars[i].r &&
                Math.abs(py - stars[i].y) < player.h/2 + stars[i].r) {
                nitro = Math.min(100, nitro + 20);
                bullets++;
                updateAmmoUI();
                score += 150;
                playSfx(900, 'sine', 0.25, 0.3);
                for (let k = 0; k < 15; k++) {
                    particles.push(new Particle(stars[i].x, stars[i].y, '#ffea00', (Math.random()-0.5)*8, Math.random()*4+2));
                }
                stars.splice(i, 1); continue;
            }
        }
        if (stars[i].y > gameHeight + 100) stars.splice(i, 1);
    }

    // Enemies
    if (gameActive && Math.random() < 0.038 && enemies.length < 5) enemies.push(new Enemy());
    for (let i = enemies.length - 1; i >= 0; i--) {
        enemies[i].update(); enemies[i].draw();
        if (gameActive && player &&
            player.x < enemies[i].x + enemies[i].w - 5 &&
            player.x + player.w > enemies[i].x + 5 &&
            player.y < enemies[i].y + enemies[i].h - 5 &&
            player.y + player.h > enemies[i].y + 6) {
            triggerCrash();
            enemies.splice(i, 1); continue;
        }
        if (enemies[i].y > gameHeight + 100) {
            enemies.splice(i, 1);
            if (gameActive) score += 30;
        }
    }

    drawOpponents();

    if (player) {
        if (gameActive) player.update();
        player.draw();
    }

    if (screenFlash > 0) {
        ctx.fillStyle = `rgba(255,255,255,${screenFlash})`;
        ctx.fillRect(0, 0, gameWidth, gameHeight);
        screenFlash -= 0.05;
    }

    ctx.restore();
    requestAnimationFrame(render);
}

// ─── INIT ───
player = new Player();
requestAnimationFrame(render);
