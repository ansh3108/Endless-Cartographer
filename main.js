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

class Camera {
    constructor(cvs) {
        this.cvs = cvs;
        this.x = 0;
        this.y = 0;
        this.z = 1;
        this.drag = false;
        this.lx = 0;
        this.ly = 0;
        
        cvs.onmousedown = (e) => {
            this.drag = true;
            this.lx = e.clientX;
            this.ly = e.clientY;
        };

        window.onmouseup = () => this.drag = false;

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
}

class Chunk {
    constructor(cx, cy, world) {
        this.cx = cx;
        this.cy = cy;
        this.cvs = document.createElement('canvas');
        this.cvs.width = 512;
        this.cvs.height = 512;
        let ctx = this.cvs.getContext('2d');
        
        for (let ty = 0; ty < 16; ty++) {
            for (let tx = 0; tx < 16; tx++) {
                let wx = cx * 16 + tx;
                let wy = cy * 16 + ty;
                ctx.fillStyle = world.getColor(wx, wy);
                ctx.fillRect(tx * 32, ty * 32, 32, 32);
            }
        }
    }
}

class World {
    constructor(seed) {
        this.chunks = new Map();
        this.n = new Noise(seed);
    }

    getColor(x, y) {
        let v = this.n.get(x * 0.015, y * 0.015);
        if (v < -0.2) return '#1a3c5e';
        if (v < -0.05) return '#2b5c8a';
        if (v < 0.05) return '#d4b872';
        if (v < 0.2) return '#4a7c59';
        if (v < 0.3) return '#2f4f4f';
        return '#8b7355';
    }

    draw(cam, cvs, ctx) {
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

            if (cam.z < 0.2) {
                let wx = cx * 16 + 8;
                let wy = cy * 16 + 8;
                ctx.fillStyle = this.getColor(wx, wy);
                ctx.fillRect(px, py, ps + 1, ps + 1);
            } else {
                ctx.drawImage(chunk.cvs, px, py, ps, ps);
            }
        }

        for (let k of this.chunks.keys()) {
            if (!active.has(k)) this.chunks.delete(k);
        }
    }
}

const cvs = document.getElementById('c');
const ctx = cvs.getContext('2d');

function resize() {
    cvs.width = innerWidth;
    cvs.height = innerHeight;
}
addEventListener('resize', resize);
resize();

const cam = new Camera(cvs);
const world = new World(42);

function loop() {
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, cvs.width, cvs.height);

    world.draw(cam, cvs, ctx);

    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(10, 10, 200, 30);
    ctx.fillStyle = '#fff';
    ctx.font = '12px monospace';
    ctx.fillText(`x:${cam.x.toFixed(0)} y:${cam.y.toFixed(0)} z:${cam.z.toFixed(2)}`, 20, 30);

    requestAnimationFrame(loop);
}
loop();

