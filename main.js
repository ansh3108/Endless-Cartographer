class Noise {
    constructor(seed) {
        this.p = new Uint8Array(512);
        let p = new Uint8Array(256);
        for (let i = 0; i < 256; i++) p[i] = i;
        let s = seed || 1337;
        for (let i = 255; i > 0; i--) {
            s = (s * 16807) % 2147483647;
            let n = s % (i + 1);
            let tmp = p[i];
            p[i] = p[n];
            p[n] = tmp;
        }
        for (let i = 0; i < 512; i++) this.p[i] = p[i & 255];
    }
    fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
    lerp(a, b, t) { return a + t * (b - a); }
    grad(hash, x, y) {
        let h = hash & 3;
        let u = h < 2 ? x : y;
        let v = h < 2 ? y : x;
        return ((h & 1) ? -u : u) + ((h & 2) ? -2 * v : 2 * v);
    }
    get(x, y) {
        let X = Math.floor(x) & 255;
        let Y = Math.floor(y) & 255;
        x -= Math.floor(x);
        y -= Math.floor(y);
        let u = this.fade(x);
        let v = this.fade(y);
        let A = this.p[X] + Y;
        let B = this.p[X + 1] + Y;
        return this.lerp(
            this.lerp(this.grad(this.p[A], x, y), this.grad(this.p[B], x - 1, y), u),
            this.lerp(this.grad(this.p[A + 1], x, y - 1), this.grad(this.p[B + 1], x - 1, y - 1), u),
            v
        ) / 3;
    }
}

function mulberry32(a) {
    return function() {
        let t = a += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
}

class AudioEngine {
    constructor() {
        this.actx = new (window.AudioContext || window.webkitAudioContext)();
        this.master = this.actx.createGain();
        this.master.gain.value = 0.25;
        this.master.connect(this.actx.destination);

        this.windGain = this.actx.createGain();
        this.windGain.gain.value = 0;
        this.windGain.connect(this.master);

        let buf = this.actx.createBuffer(1, this.actx.sampleRate * 2, this.actx.sampleRate);
        let d = buf.getChannelData(0);
        for(let i=0; i<d.length; i++) d[i] = Math.random() * 2 - 1;
        
        this.wind = this.actx.createBufferSource();
        this.wind.buffer = buf;
        this.wind.loop = true;
        let lp = this.actx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 300;
        this.wind.connect(lp);
        lp.connect(this.windGain);
        this.wind.start();

        this.waterGain = this.actx.createGain();
        this.waterGain.gain.value = 0;
        this.waterGain.connect(this.master);
        
        let osc1 = this.actx.createOscillator();
        osc1.type = 'sine';
        osc1.frequency.value = 55;
        let osc2 = this.actx.createOscillator();
        osc2.type = 'sine';
        osc2.frequency.value = 57;
        osc1.connect(this.waterGain);
        osc2.connect(this.waterGain);
        osc1.start();
        osc2.start();
    }

    update(biome) {
        let t = this.actx.currentTime;
        let wTarget = 0;
        let waTarget = 0;
        
        if (biome.t === 'desert' || biome.t === 'mountain' || biome.t === 'snow') wTarget = 0.6;
        if (biome.t === 'grass') wTarget = 0.15;
        if (biome.t === 'water' || biome.t === 'shallow') waTarget = 0.5;
        
        this.windGain.gain.linearRampToValueAtTime(wTarget, t + 2);
        this.waterGain.gain.linearRampToValueAtTime(waTarget, t + 2);
    }
}

class Camera {
    constructor(cvs) {
        this.cvs = cvs;
        this.x = 0;
        this.y = 0;
        this.z = 1;
        this.drag = false;
        this.lx = 0;
        this.ly = 0;
        this.sx = 0;
        this.sy = 0;
        
        cvs.onmousedown = (e) => {
            this.drag = true;
            this.lx = e.clientX;
            this.ly = e.clientY;
            this.sx = e.clientX;
            this.sy = e.clientY;
        };

        window.onmouseup = (e) => {
            this.drag = false;
            let dx = e.clientX - this.sx;
            let dy = e.clientY - this.sy;
            if (dx*dx + dy*dy < 25) {
                this.handleClick(e);
            }
        };

        window.onmousemove = (e) => {
            if (this.drag) {
                this.x -= (e.clientX - this.lx) / this.z;
                this.y -= (e.clientY - this.ly) / this.z;
                this.lx = e.clientX;
                this.ly = e.clientY;
            }
        };

        cvs.onwheel = (e) => {
            e.preventDefault();
            let f = Math.exp(-e.deltaY * 0.001);
            let mx = e.clientX;
            let my = e.clientY;
            let wx = this.x + mx / this.z;
            let wy = this.y + my / this.z;
            this.z *= f;
            this.z = Math.max(0.02, Math.min(8, this.z));
            this.x = wx - mx / this.z;
            this.y = wy - my / this.z;
        };
    }

    handleClick(e) {
        let wx = this.x + e.offsetX / this.z;
        let wy = this.y + e.offsetY / this.z;
        world.checkDiscovery(wx, wy);
    }
}

class Chunk {
    constructor(cx, cy, world) {
        this.cx = cx;
        this.cy = cy;
        this.landmarks = [];
        this.cvs = document.createElement('canvas');
        this.cvs.width = 512;
        this.cvs.height = 512;
        let ctx = this.cvs.getContext('2d');
        
        let seed = (world.seed + cx * 73856093 ^ cy * 19349663) | 0;
        let rand = mulberry32(seed);

        for (let ty = 0; ty < 16; ty++) {
            for (let tx = 0; tx < 16; tx++) {
                let wx = cx * 16 + tx;
                let wy = cy * 16 + ty;
                let b = world.getBiome(wx, wy);
                ctx.fillStyle = b.c;
                ctx.fillRect(tx * 32, ty * 32, 32, 32);
                
                if (b.t === 'forest' && rand() < 0.3) {
                    let px = tx * 32 + rand() * 24 + 4;
                    let py = ty * 32 + rand() * 24 + 4;
                    ctx.fillStyle = '#1a2e1a';
                    ctx.beginPath(); ctx.arc(px, py, 10, 0, 6.28); ctx.fill();
                    ctx.fillStyle = '#2d4c2b';
                    ctx.beginPath(); ctx.arc(px - 2, py - 2, 7, 0, 6.28); ctx.fill();
                } else if (b.t === 'desert' && rand() < 0.1) {
                    let px = tx * 32 + rand() * 24 + 4;
                    let py = ty * 32 + rand() * 24 + 4;
                    ctx.fillStyle = '#8b7355';
                    ctx.beginPath(); ctx.arc(px, py, 5, 0, 6.28); ctx.fill();
                } else if (b.t === 'mountain' && rand() < 0.2) {
                    let px = tx * 32 + rand() * 24 + 4;
                    let py = ty * 32 + rand() * 24 + 4;
                    ctx.fillStyle = '#ccc';
                    ctx.beginPath(); ctx.moveTo(px, py - 8); ctx.lineTo(px - 6, py + 4); ctx.lineTo(px + 6, py + 4); ctx.fill();
                }
            }
        }
        
        if (rand() < 0.04) {
            let px = rand() * 440 + 36;
            let py = rand() * 440 + 36;
            ctx.fillStyle = '#444';
            ctx.fillRect(px - 14, py - 14, 28, 28);
            ctx.fillStyle = '#111';
            ctx.fillRect(px - 10, py - 10, 20, 20);
            ctx.fillStyle = '#ffcc00';
            ctx.fillRect(px - 3, py - 12, 6, 6);
            
            let wx = cx * 16 + Math.floor(px / 32);
            let wy = cy * 16 + Math.floor(py / 32);
            this.landmarks.push({
                x: wx,
                y: wy,
                name: world.genName(rand),
                type: world.getBiome(wx, wy).t
            });
        }
    }
}

class World {
    constructor(seed) {
        this.seed = seed || 42;
        this.chunks = new Map();
        this.elev = new Noise(this.seed);
        this.moist = new Noise(this.seed + 100);
        this.explored = new Set();
        this.discoveries = new Set();
        this.load();
    }

    load() {
        let f = localStorage.getItem('cartographer_fog');
        if (f) this.explored = new Set(JSON.parse(f));
        let d = localStorage.getItem('cartographer_disc');
        if (d) {
            this.discoveries = new Set(JSON.parse(d));
            this.updateJournalUI();
        }
    }

    save() {
        localStorage.setItem('cartographer_fog', JSON.stringify(Array.from(this.explored)));
        localStorage.setItem('cartographer_disc', JSON.stringify(Array.from(this.discoveries)));
    }

    genName(rand) {
        let p = ["Sunken", "Shattered", "Ancient", "Forgotten", "Crystal", "Obsidian", "Silent"];
        let n = ["Spire", "Ruin", "Monolith", "Obelisk", "Altar", "Citadel", "Vault"];
        let s = ["Velundra", "Kael", "Oth", "Xyr", "Marn", "Aethel", "Nyx"];
        return `The ${p[Math.floor(rand()*p.length)]} ${n[Math.floor(rand()*n.length)]} of ${s[Math.floor(rand()*s.length)]}`;
    }

    getBiome(x, y) {
        let e = this.elev.get(x * 0.008, y * 0.008);
        let m = this.moist.get(x * 0.012 + 100, y * 0.012 + 100);
        
        if (e < -0.2) return { t: 'water', c: '#1a3c5e' };
        if (e < -0.1) return { t: 'shallow', c: '#2b5c8a' };
        if (e < 0.0) return { t: 'sand', c: '#d4b872' };
        if (e > 0.4) return { t: 'mountain', c: '#666' };
        if (e > 0.6) return { t: 'snow', c: '#eee' };
        if (m < -0.1) return { t: 'desert', c: '#c2b280' };
        if (m > 0.2) return { t: 'forest', c: '#2d4c2b' };
        return { t: 'grass', c: '#4a7c59' };
    }

    checkDiscovery(wx, wy) {
        for (let [k, chunk] of this.chunks) {
            for (let lm of chunk.landmarks) {
                let dx = lm.x - wx;
                let dy = lm.y - wy;
                if (dx*dx + dy*dy < 150) {
                    if (!this.discoveries.has(lm.name)) {
                        this.discoveries.add(lm.name);
                        this.addJournalEntry(lm.name, lm.type);
                        this.save();
                    }
                }
            }
        }
    }

    addJournalEntry(name, type) {
        let ul = document.getElementById('j-list');
        let li = document.createElement('li');
        li.innerHTML = `${name}<span>Discovered in ${type} biome</span>`;
        ul.prepend(li);
    }

    updateJournalUI() {
        let ul = document.getElementById('j-list');
        ul.innerHTML = '';
        for (let name of this.discoveries) {
            let li = document.createElement('li');
            li.innerHTML = `${name}<span>Previously discovered</span>`;
            ul.appendChild(li);
        }
    }

    draw(cam, cvs, ctx, dayTime) {
        let CP = 512;
        let sx = Math.floor(cam.x / CP) - 1;
        let sy = Math.floor(cam.y / CP) - 1;
        let ex = Math.ceil((cam.x + cvs.width / cam.z) / CP) + 1;
        let ey = Math.ceil((cam.y + cvs.height / cam.z) / CP) + 1;

        let queue = [];
        let limit = 2500;

        for (let cy = sy; cy <= ey; cy++) {
            for (let cx = sx; cx <= ex; cx++) {
                if (queue.length >= limit) break;
                queue.push({cx, cy});
            }
            if (queue.length >= limit) break;
        }

        let active = new Set();
        let centerBiome = this.getBiome(Math.floor(cam.x / 32), Math.floor(cam.y / 32));

        for (let {cx, cy} of queue) {
            let k = cx + ',' + cy;
            active.add(k);
            
            let chunk = this.chunks.get(k);
            if (!chunk) {
                chunk = new Chunk(cx, cy, this);
                this.chunks.set(k, chunk);
            }

            let px = (cx * CP - cam.x) * cam.z;
            let py = (cy * CP - cam.y) * cam.z;
            let ps = CP * cam.z;

            if (px + ps < 0 || px > cvs.width || py + ps < 0 || py > cvs.height) continue;

            let isExplored = this.explored.has(k);
            
            if (isExplored) {
                if (cam.z < 0.2) {
                    let b = this.getBiome(cx * 16 + 8, cy * 16 + 8);
                    ctx.fillStyle = b.c;
                    ctx.fillRect(px, py, ps + 1, ps + 1);
                } else {
                    ctx.drawImage(chunk.cvs, px, py, ps, ps);
                }
            } else {
                ctx.fillStyle = '#050508';
                ctx.fillRect(px, py, ps + 1, ps + 1);
                this.explored.add(k);
            }
        }

        let dark = (Math.cos(dayTime * 6.28) + 1) / 2;
        ctx.fillStyle = `rgba(5, 10, 35, ${dark * 0.75})`;
        ctx.fillRect(0, 0, cvs.width, cvs.height);

        for (let k of this.chunks.keys()) {
            if (!active.has(k)) this.chunks.delete(k);
        }

        return centerBiome;
    }
}

const cvs = document.getElementById('c');
const mini = document.getElementById('mini');
const ctx = cvs.getContext('2d');
const mctx = mini.getContext('2d');

function resize() {
    cvs.width = innerWidth;
    cvs.height = innerHeight;
}
addEventListener('resize', resize);
resize();

const cam = new Camera(cvs);
const world = new World(Math.floor(Math.random() * 10000));
let audio = null;
let dayTime = 0.25;
let lastSave = 0;

function drawMini() {
    mctx.fillStyle = '#000';
    mctx.fillRect(0, 0, 200, 200);
    let pcx = Math.floor(cam.x / 512);
    let pcy = Math.floor(cam.y / 512);
    let r = 50;
    for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
            let cx = pcx + dx;
            let cy = pcy + dy;
            if (world.explored.has(cx + ',' + cy)) {
                let b = world.getBiome(cx * 16 + 8, cy * 16 + 8);
                mctx.fillStyle = b.c;
                mctx.fillRect(100 + dx * 2, 100 + dy * 2, 2, 2);
            }
        }
    }
    mctx.fillStyle = '#fff';
    mctx.fillRect(98, 98, 4, 4);
}

function loop() {
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, cvs.width, cvs.height);

    dayTime += 0.00015;
    if (dayTime > 1) dayTime = 0;

    let currentBiome = world.draw(cam, cvs, ctx, dayTime);
    drawMini();

    if (audio) audio.update(currentBiome);

    let now = Date.now();
    if (now - lastSave > 5000) {
        world.save();
        lastSave = now;
    }

    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(10, 10, 280, 30);
    ctx.fillStyle = '#fff';
    ctx.font = '12px monospace';
    ctx.fillText(`x:${cam.x.toFixed(0)} y:${cam.y.toFixed(0)} z:${cam.z.toFixed(2)} time:${(dayTime*24).toFixed(1)}h`, 20, 30);

    requestAnimationFrame(loop);
}
window.onkeydown = (e) => {

    if (e.key === 'j' || e.key === 'J') {
        document.getElementById('journal').classList.toggle('open');
    }
}

document.getElementById('start').onclick = () => {
    document.getElementById('start').style.opacity = '0';
    setTimeout(() => document.getElementById('start').style.display = 'none', 500);
    audio = new AudioEngine();
    loop();
}



