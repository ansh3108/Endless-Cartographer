class Noise {
  constructor(seed) {
    this.p = new Uint8Array(512);
    let p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      p[i] = i;
    }
    let s = seed || 1337;
    for (let i = 255; i > 0; i--) {
      s = (s * 16807) % 2147483647;
      let n = s % (i + 1);
      let tmp = p[i];
      p[i] = p[n];
      p[n] = tmp;
    }
    for (let i = 0; i < 512; i++) {
      this.p[i] = p[i & 255];
    }
  }

  fade(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  lerp(a, b, t) {
    return a + t * (b - a);
  }

  grad(hash, x, y) {
    let h = hash & 3;
    let u = h < 2 ? x : y;
    let v = h < 2 ? y : x;
    return (h & 1 ? -u : u) + (h & 2 ? -2 * v : 2 * v);
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
    return (
      this.lerp(
        this.lerp(
          this.grad(this.p[A], x, y),
          this.grad(this.p[B], x - 1, y),
          u,
        ),
        this.lerp(
          this.grad(this.p[A + 1], x, y - 1),
          this.grad(this.p[B + 1], x - 1, y - 1),
          u,
        ),
        v,
      ) / 3
    );
  }
}

function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function showNotification(text) {
  let n = document.getElementById("notification");
  n.innerText = text;
  n.classList.add("show");
  setTimeout(() => {
    n.classList.remove("show");
  }, 3000);
}

let floatingTexts = [];

function showFloatingText(wx, wy, text) {
  floatingTexts.push({
    wx: wx,
    wy: wy,
    text: text,
    life: 1.0,
  });
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

    let buf = this.actx.createBuffer(
      1,
      this.actx.sampleRate * 2,
      this.actx.sampleRate,
    );
    let d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) {
      d[i] = Math.random() * 2 - 1;
    }

    this.wind = this.actx.createBufferSource();
    this.wind.buffer = buf;
    this.wind.loop = true;

    let lp = this.actx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 300;

    this.wind.connect(lp);
    lp.connect(this.windGain);
    this.wind.start();

    this.waterGain = this.actx.createGain();
    this.waterGain.gain.value = 0;
    this.waterGain.connect(this.master);

    let osc1 = this.actx.createOscillator();
    osc1.type = "sine";
    osc1.frequency.value = 55;

    let osc2 = this.actx.createOscillator();
    osc2.type = "sine";
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

    if (biome.t === "desert" || biome.t === "mountain" || biome.t === "snow") {
      wTarget = 0.6;
    }
    if (biome.t === "grass") {
      wTarget = 0.15;
    }
    if (biome.t === "water" || biome.t === "shallow") {
      waTarget = 0.5;
    }

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
    this.keys = {};
    this.pinMode = false;
    this.drawMode = false;
    this.drawing = false;

    window.addEventListener("keydown", (e) => {
      this.keys[e.key.toLowerCase()] = true;
      if (e.target.tagName === "INPUT") return;
      if (e.key === "j" || e.key === "J") {
        document.getElementById("journal").classList.toggle("open");
      }
      if (e.key === "p" || e.key === "P") {
        this.togglePin();
      }
      if (e.key === "l" || e.key === "L") {
        this.toggleDraw();
      }
    });

    window.addEventListener("keyup", (e) => {
      this.keys[e.key.toLowerCase()] = false;
    });

    window.addEventListener("mousedown", (e) => {
      if (
        e.target.closest("#journal") ||
        e.target.closest("#toolbar") ||
        e.target.closest("#start") ||
        e.target.closest("#pin-box") ||
        e.target.closest("#inventory") ||
        e.target.id === "mini"
      ) {
        return;
      }

      if (this.pinMode) {
        let rect = cvs.getBoundingClientRect();
        let mx = e.clientX - rect.left;
        let my = e.clientY - rect.top;
        let wx = this.x + mx / this.z;
        let wy = this.y + my / this.z;

        let box = document.getElementById("pin-box");
        box.style.left = e.clientX + 15 + "px";
        box.style.top = e.clientY + 15 + "px";
        box.style.display = "block";

        let input = document.getElementById("pin-input");
        input.value = "";
        input.focus();
        window.pendingPin = {
          wx: wx / 32,
          wy: wy / 32,
        };
        return;
      }

      if (this.drawMode) {
        let rect = cvs.getBoundingClientRect();
        let mx = e.clientX - rect.left;
        let my = e.clientY - rect.top;
        let wx = this.x + mx / this.z;
        let wy = this.y + my / this.z;
        world.startPath(wx / 32, wy / 32);
        this.drawing = true;
        return;
      }

      this.drag = true;
      this.lx = e.clientX;
      this.ly = e.clientY;
      this.sx = e.clientX;
      this.sy = e.clientY;
    });

    window.addEventListener("mouseup", (e) => {
      let wasDragging =
        this.drag &&
        (Math.abs(e.clientX - this.sx) > 5 ||
          Math.abs(e.clientY - this.sy) > 5);
      this.drag = false;

      if (this.drawing) {
        world.endPath();
        this.drawing = false;
      }

      if (!wasDragging && !this.pinMode && !this.drawMode) {
        let rect = cvs.getBoundingClientRect();
        let mx = e.clientX - rect.left;
        let my = e.clientY - rect.top;
        let wx = this.x + mx / this.z;
        let wy = this.y + my / this.z;
        if (!world.gatherResource(wx / 32, wy / 32)) {
          world.checkDiscovery(wx / 32, wy / 32);
        }
      }
    });

    window.addEventListener("mousemove", (e) => {
      if (this.drag) {
        this.x -= (e.clientX - this.lx) / this.z;
        this.y -= (e.clientY - this.ly) / this.z;
        this.lx = e.clientX;
        this.ly = e.clientY;
      }
      if (this.drawing) {
        let rect = cvs.getBoundingClientRect();
        let mx = e.clientX - rect.left;
        let my = e.clientY - rect.top;
        let wx = this.x + mx / this.z;
        let wy = this.y + my / this.z;
        world.updatePath(wx / 32, wy / 32);
      }
    });

    cvs.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        let f = Math.exp(-e.deltaY * 0.001);
        let rect = cvs.getBoundingClientRect();
        let mx = e.clientX - rect.left;
        let my = e.clientY - rect.top;
        let wx = this.x + mx / this.z;
        let wy = this.y + my / this.z;

        this.z *= f;
        this.z = Math.max(0.02, Math.min(8, this.z));
        this.x = wx - mx / this.z;
        this.y = wy - my / this.z;
      },
      { passive: false },
    );
  }

  togglePin() {
    this.pinMode = !this.pinMode;
    if (this.pinMode) {
      this.drawMode = false;
    }
    document.getElementById("btn-pin").classList.toggle("active", this.pinMode);
    document
      .getElementById("btn-draw")
      .classList.toggle("active", this.drawMode);

    if (this.pinMode) {
      cvs.style.cursor = "crosshair";
    } else if (this.drawMode) {
      cvs.style.cursor = "crosshair";
    } else {
      cvs.style.cursor = "grab";
    }
  }

  toggleDraw() {
    this.drawMode = !this.drawMode;
    if (this.drawMode) {
      this.pinMode = false;
    }
    document.getElementById("btn-pin").classList.toggle("active", this.pinMode);
    document
      .getElementById("btn-draw")
      .classList.toggle("active", this.drawMode);

    if (this.drawMode) {
      cvs.style.cursor = "crosshair";
    } else if (this.pinMode) {
      cvs.style.cursor = "crosshair";
    } else {
      cvs.style.cursor = "grab";
    }
  }
}

class Chunk {
  constructor(cx, cy, world) {
    this.cx = cx;
    this.cy = cy;
    this.cvs = document.createElement("canvas");
    this.cvs.width = 512;
    this.cvs.height = 512;
    this.landmarks = [];
    this.creatures = [];
    this.resources = [];
    this.gathered = new Set();

    for (let ty = 0; ty < 16; ty++) {
      for (let tx = 0; tx < 16; tx++) {
        let wx = this.cx * 16 + tx;
        let wy = this.cy * 16 + ty;
        if (world.gatheredGlobal.has(wx + "," + wy)) {
          this.gathered.add(wx + "," + wy);
        }
      }
    }

    this.render(world);
  }

  render(world) {
    let ctx = this.cvs.getContext("2d");
    ctx.clearRect(0, 0, 512, 512);

    let seed = ((world.seed + this.cx * 73856093) ^ (this.cy * 19349663)) | 0;
    let rand = mulberry32(seed);
    this.resources = [];

    for (let ty = 0; ty < 16; ty++) {
      for (let tx = 0; tx < 16; tx++) {
        let wx = this.cx * 16 + tx;
        let wy = this.cy * 16 + ty;
        let b = world.getBiome(wx, wy);
        ctx.fillStyle = b.c;
        ctx.fillRect(tx * 32, ty * 32, 32, 32);

        let rCheck = rand();
        let rX = rand();
        let rY = rand();

        if (b.t === "forest" && rCheck < 0.3) {
          let px = tx * 32 + rX * 24 + 4;
          let py = ty * 32 + rY * 24 + 4;
          if (!this.gathered.has(wx + "," + wy)) {
            ctx.fillStyle = "#1a2e1a";
            ctx.beginPath();
            ctx.arc(px, py, 10, 0, 6.28);
            ctx.fill();
            ctx.fillStyle = "#2d4c2b";
            ctx.beginPath();
            ctx.arc(px - 2, py - 2, 7, 0, 6.28);
            ctx.fill();
            this.resources.push({ x: wx, y: wy, type: "wood" });
          }
        } else if (b.t === "desert" && rCheck < 0.1) {
          let px = tx * 32 + rX * 24 + 4;
          let py = ty * 32 + rY * 24 + 4;
          ctx.fillStyle = "#8b7355";
          ctx.beginPath();
          ctx.arc(px, py, 5, 0, 6.28);
          ctx.fill();
        } else if (b.t === "mountain" && rCheck < 0.2) {
          let px = tx * 32 + rX * 24 + 4;
          let py = ty * 32 + rY * 24 + 4;
          if (!this.gathered.has(wx + "," + wy)) {
            ctx.fillStyle = "#ccc";
            ctx.beginPath();
            ctx.moveTo(px, py - 8);
            ctx.lineTo(px - 6, py + 4);
            ctx.lineTo(px + 6, py + 4);
            ctx.fill();
            this.resources.push({ x: wx, y: wy, type: "stone" });
          }
        }

        let cCheck = rand();
        if ((b.t === "forest" || b.t === "grass") && cCheck < 0.05) {
          this.creatures.push({
            tx: tx,
            ty: ty,
            type: rand() < 0.5 ? "deer" : "wisp",
            seed: rand() * 10000,
          });
        }
      }
    }

    let lmCheck = rand();
    if (lmCheck < 0.04) {
      let px = rand() * 440 + 36;
      let py = rand() * 440 + 36;
      ctx.fillStyle = "#444";
      ctx.fillRect(px - 14, py - 14, 28, 28);
      ctx.fillStyle = "#111";
      ctx.fillRect(px - 10, py - 10, 20, 20);
      ctx.fillStyle = "#ffcc00";
      ctx.fillRect(px - 3, py - 12, 6, 6);

      let wx = this.cx * 16 + Math.floor(px / 32);
      let wy = this.cy * 16 + Math.floor(py / 32);
      this.landmarks.push({
        x: wx,
        y: wy,
        name: world.genName(rand),
        type: world.getBiome(wx, wy).t,
      });
      this.resources.push({ x: wx, y: wy, type: "artifact" });
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
    this.discoveries = new Map();
    this.pins = [];
    this.paths = [];
    this.currentPath = null;
    this.inventory = { wood: 0, stone: 0, artifact: 0 };
    this.gatheredGlobal = new Set();
    this.load();
  }

  load() {
    let f = localStorage.getItem("cartographer_fog");
    if (f) {
      this.explored = new Set(JSON.parse(f));
    }

    let d = localStorage.getItem("cartographer_disc");
    if (d) {
      this.discoveries = new Map(JSON.parse(d).map((obj) => [obj.name, obj]));
      this.updateJournalUI();
    }

    let p = localStorage.getItem("cartographer_pins");
    if (p) {
      this.pins = JSON.parse(p);
    }

    let pa = localStorage.getItem("cartographer_paths");
    if (pa) {
      this.paths = JSON.parse(pa);
    }

    let inv = localStorage.getItem("cartographer_inv");
    if (inv) {
      this.inventory = JSON.parse(inv);
    }

    let g = localStorage.getItem("cartographer_gathered");
    if (g) {
      this.gatheredGlobal = new Set(JSON.parse(g));
    }

    this.updateInventoryUI();
  }

  save() {
    localStorage.setItem(
      "cartographer_fog",
      JSON.stringify(Array.from(this.explored)),
    );
    localStorage.setItem(
      "cartographer_disc",
      JSON.stringify(Array.from(this.discoveries.values())),
    );
    localStorage.setItem("cartographer_pins", JSON.stringify(this.pins));
    localStorage.setItem("cartographer_paths", JSON.stringify(this.paths));
    localStorage.setItem("cartographer_inv", JSON.stringify(this.inventory));
    localStorage.setItem(
      "cartographer_gathered",
      JSON.stringify(Array.from(this.gatheredGlobal)),
    );
  }

  updateInventoryUI() {
    document.getElementById("inv-wood").innerText = this.inventory.wood;
    document.getElementById("inv-stone").innerText = this.inventory.stone;
    document.getElementById("inv-art").innerText = this.inventory.artifact;
  }

  genName(rand) {
    let p = [
      "Sunken",
      "Shattered",
      "Ancient",
      "Forgotten",
      "Crystal",
      "Obsidian",
      "Silent",
    ];
    let n = [
      "Spire",
      "Ruin",
      "Monolith",
      "Obelisk",
      "Altar",
      "Citadel",
      "Vault",
    ];
    let s = ["Velundra", "Kael", "Oth", "Xyr", "Marn", "Aethel", "Nyx"];
    return `The ${p[Math.floor(rand() * p.length)]} ${n[Math.floor(rand() * n.length)]} of ${s[Math.floor(rand() * s.length)]}`;
  }

  genLore(name, type, rand) {
    let events = [
      "the Great Sundering",
      "the Long Winter",
      "the Silence",
      "the Sky Fire",
    ];
    let features = [
      "crystalline waters",
      "obsidian stones",
      "whispering winds",
      "ancient roots",
    ];
    let entities = [
      "a nameless guardian",
      "the last of its kind",
      "a wandering spirit",
      "the shadow of the king",
    ];
    let templates = [
      `Legends say this ${type} was abandoned when ${events[Math.floor(rand() * events.length)]} occurred.`,
      `Scholars believe the ${features[Math.floor(rand() * features.length)]} here holds mystical properties.`,
      `It is whispered that ${entities[Math.floor(rand() * entities.length)]} still guards the secrets within.`,
    ];
    return templates[Math.floor(rand() * templates.length)];
  }

  getBiomeDetails(x, y) {
    let b = this.getBiome(x, y);
    let details = [];
    if (b.t === "forest") details.push("Wood", "Deer", "Wisps");
    else if (b.t === "mountain") details.push("Stone");
    else if (b.t === "desert") details.push("Sandstorms");
    else if (b.t === "grass") details.push("Deer", "Wisps");
    else if (b.t === "snow") details.push("Snowstorms");
    else if (b.t === "water" || b.t === "shallow") details.push("Water");
    else details.push("Nothing of note");
    return details;
  }

  getBiome(x, y) {
    let e = this.elev.get(x * 0.008, y * 0.008);
    let m = this.moist.get(x * 0.012 + 100, y * 0.012 + 100);

    if (e < -0.2) return { t: "water", c: "#1a3c5e" };
    if (e < -0.1) return { t: "shallow", c: "#2b5c8a" };
    if (e < 0.0) return { t: "sand", c: "#d4b872" };
    if (e > 0.4) return { t: "mountain", c: "#666" };
    if (e > 0.6) return { t: "snow", c: "#eee" };
    if (m < -0.1) return { t: "desert", c: "#c2b280" };
    if (m > 0.2) return { t: "forest", c: "#2d4c2b" };
    return { t: "grass", c: "#4a7c59" };
  }

  gatherResource(wx, wy) {
    let tileX = Math.floor(wx);
    let tileY = Math.floor(wy);

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        let checkX = tileX + dx;
        let checkY = tileY + dy;
        let cx = Math.floor(checkX / 16);
        let cy = Math.floor(checkY / 16);
        let k = cx + "," + cy;

        let chunk = this.chunks.get(k);
        if (!chunk) continue;

        for (let i = chunk.resources.length - 1; i >= 0; i--) {
          let r = chunk.resources[i];
          if (r.x === checkX && r.y === checkY) {
            this.inventory[r.type]++;
            this.gatheredGlobal.add(r.x + "," + r.y);
            chunk.resources.splice(i, 1);
            chunk.gathered.add(r.x + "," + r.y);
            chunk.render(this);
            this.save();
            this.updateInventoryUI();
            showFloatingText(r.x, r.y, `+1 ${r.type.toUpperCase()}`);
            return true;
          }
        }
      }
    }
    return false;
  }

  checkDiscovery(wx, wy) {
    let tileX = Math.floor(wx);
    let tileY = Math.floor(wy);

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        let checkX = tileX + dx;
        let checkY = tileY + dy;
        let cx = Math.floor(checkX / 16);
        let cy = Math.floor(checkY / 16);
        let k = cx + "," + cy;

        let chunk = this.chunks.get(k);
        if (!chunk) continue;

        for (let lm of chunk.landmarks) {
          if (lm.x === checkX && lm.y === checkY) {
            if (!this.discoveries.has(lm.name)) {
              let timeStr = (dayTime * 24).toFixed(1) + "h";
              let loreRand = mulberry32(lm.x * 1000 + lm.y);
              let data = {
                name: lm.name,
                type: lm.type,
                x: Math.round(lm.x),
                y: Math.round(lm.y),
                time: timeStr,
                lore: this.genLore(lm.name, lm.type, loreRand),
                details: this.getBiomeDetails(lm.x, lm.y),
              };
              this.discoveries.set(lm.name, data);
              this.addJournalEntry(data);
              this.save();
              showNotification("Discovered: " + lm.name);
            }
          }
        }
      }
    }
  }

  addJournalEntry(data) {
    let ul = document.getElementById("j-list");
    let li = document.createElement("li");
    li.innerHTML = `
            <strong>${data.name}</strong>
            <span>${data.type} biome | x:${data.x} y:${data.y} | ${data.time}</span>
            <span class="journal-lore">"${data.lore}"</span>
            <span class="journal-details">Available: ${data.details.join(", ")}</span>
            <button class="journal-teleport" data-x="${data.x}" data-y="${data.y}">Teleport</button>
        `;
    ul.prepend(li);
  }

  updateJournalUI() {
    let ul = document.getElementById("j-list");
    ul.innerHTML = "";
    let entries = Array.from(this.discoveries.values()).reverse();
    for (let data of entries) {
      let li = document.createElement("li");
      li.innerHTML = `
                <strong>${data.name}</strong>
                <span>${data.type} | x:${data.x} y:${data.y} | ${data.time}</span>
                <span class="journal-lore">"${data.lore}"</span>
                <span class="journal-details">Available: ${data.details.join(", ")}</span>
                <button class="journal-teleport" data-x="${data.x}" data-y="${data.y}">Teleport</button>
            `;
      ul.appendChild(li);
    }
  }

  addPin(x, y, label) {
    this.pins.push({ x: Math.round(x), y: Math.round(y), label });
    this.save();
  }

  startPath(x, y) {
    this.currentPath = [{ x: Math.round(x), y: Math.round(y) }];
  }

  updatePath(x, y) {
    if (this.currentPath) {
      let last = this.currentPath[this.currentPath.length - 1];
      if (Math.hypot(x - last.x, y - last.y) > 1) {
        this.currentPath.push({ x: Math.round(x), y: Math.round(y) });
      }
    }
  }

  endPath() {
    if (this.currentPath && this.currentPath.length > 1) {
      this.paths.push(this.currentPath);
      this.save();
    }
    this.currentPath = null;
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
        queue.push({ cx, cy });
      }
      if (queue.length >= limit) break;
    }

    let active = new Set();
    let centerBiome = this.getBiome(
      Math.floor(cam.x / 32),
      Math.floor(cam.y / 32),
    );

    for (let { cx, cy } of queue) {
      let k = cx + "," + cy;
      active.add(k);
      let chunk = this.chunks.get(k);

      if (!chunk) {
        chunk = new Chunk(cx, cy, this);
        this.chunks.set(k, chunk);
      }

      let px = (cx * CP - cam.x) * cam.z;
      let py = (cy * CP - cam.y) * cam.z;
      let ps = CP * cam.z;

      if (px + ps < 0 || px > cvs.width || py + ps < 0 || py > cvs.height)
        continue;

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
        ctx.fillStyle = "#050508";
        ctx.fillRect(px, py, ps + 1, ps + 1);
        this.explored.add(k);
      }
    }

    if (cam.z >= 0.3) {
      for (let { cx, cy } of queue) {
        let chunk = this.chunks.get(cx + "," + cy);
        if (!chunk || !chunk.creatures) continue;
        for (let c of chunk.creatures) {
          let n1 = this.elev.get(c.seed + dayTime * 0.5, c.seed * 2);
          let n2 = this.elev.get(c.seed * 3, c.seed + dayTime * 0.5);
          let baseX = (cx * 16 + c.tx) * 32 + 16;
          let baseY = (cy * 16 + c.ty) * 32 + 16;
          let cpx = (baseX + n1 * 40 - cam.x) * cam.z;
          let cpy = (baseY + n2 * 40 - cam.y) * cam.z;

          if (
            cpx < -50 ||
            cpx > cvs.width + 50 ||
            cpy < -50 ||
            cpy > cvs.height + 50
          )
            continue;

          if (c.type === "deer") {
            ctx.fillStyle = "#8b4513";
            ctx.beginPath();
            ctx.arc(cpx, cpy, 4 * cam.z, 0, 6.28);
            ctx.fill();
            ctx.fillStyle = "#fff";
            ctx.fillRect(
              cpx - 1 * cam.z,
              cpy - 6 * cam.z,
              2 * cam.z,
              3 * cam.z,
            );
          } else {
            ctx.fillStyle = `rgba(150, 255, 200, ${0.5 + Math.sin(dayTime * 20 + c.seed) * 0.3})`;
            ctx.beginPath();
            ctx.arc(cpx, cpy, 3 * cam.z, 0, 6.28);
            ctx.fill();
          }
        }
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

  drawOverlays(cam, cvs, ctx) {
    ctx.strokeStyle = "#ff5555";
    ctx.lineWidth = 3 / cam.z;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    let allPaths = [...this.paths];
    if (this.currentPath) allPaths.push(this.currentPath);

    for (let path of allPaths) {
      ctx.beginPath();
      for (let i = 0; i < path.length; i++) {
        let px = (path[i].x * 32 - cam.x) * cam.z;
        let py = (path[i].y * 32 - cam.y) * cam.z;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }

    ctx.fillStyle = "#ffcc00";
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 1;
    let fontSize = Math.max(10, 16 / cam.z);
    ctx.font = `bold ${fontSize}px monospace`;
    ctx.textAlign = "center";

    for (let pin of this.pins) {
      let px = (pin.x * 32 - cam.x) * cam.z;
      let py = (pin.y * 32 - cam.y) * cam.z;
      let r = Math.max(4, 8 / cam.z);
      ctx.beginPath();
      ctx.arc(px, py, r, 0, 6.28);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.fillText(pin.label, px, py - (r + 5 / cam.z));
      ctx.fillStyle = "#ffcc00";
    }
  }
}

const cvs = document.getElementById("c");
const mini = document.getElementById("mini");
const ctx = cvs.getContext("2d");
const mctx = mini.getContext("2d");

function resize() {
  cvs.width = innerWidth;
  cvs.height = innerHeight;
}
addEventListener("resize", resize);
resize();

const cam = new Camera(cvs);
let params = new URLSearchParams(window.location.search);
let seed = params.get("seed")
  ? parseInt(params.get("seed"))
  : Math.floor(Math.random() * 10000);
const world = new World(seed);

if (params.get("x")) cam.x = parseFloat(params.get("x"));
if (params.get("y")) cam.y = parseFloat(params.get("y"));
if (params.get("z")) cam.z = parseFloat(params.get("z"));

let audio = null;
let dayTime = 0.25;
let lastSave = 0;
let particles = [];

mini.addEventListener("mousedown", (e) => {
  let rect = mini.getBoundingClientRect();
  let mx = e.clientX - rect.left;
  let my = e.clientY - rect.top;
  let pcx = Math.floor(cam.x / 512);
  let pcy = Math.floor(cam.y / 512);
  let chunkDx = (mx - 100) / 2;
  let chunkDy = (my - 100) / 2;
  cam.x = (pcx + chunkDx) * 512;
  cam.y = (pcy + chunkDy) * 512;
});

document.getElementById("j-search").addEventListener("input", (e) => {
  let q = e.target.value.toLowerCase();
  document.querySelectorAll("#j-list li").forEach((li) => {
    li.style.display = li.innerText.toLowerCase().includes(q)
      ? "block"
      : "none";
  });
});

document.getElementById("j-list").addEventListener("click", (e) => {
  if (e.target.classList.contains("journal-teleport")) {
    let tx = parseFloat(e.target.dataset.x);
    let ty = parseFloat(e.target.dataset.y);
    cam.x = tx * 32 - cvs.width / (2 * cam.z);
    cam.y = ty * 32 - cvs.height / (2 * cam.z);
  }
});

function updateParticles(biome, cam, cvs) {
  if (particles.length < 150) {
    if (biome.t === "snow") {
      particles.push({
        x: cam.x + (Math.random() * cvs.width) / cam.z,
        y: cam.y - 20,
        vx: -0.5,
        vy: 2,
        life: 1,
        type: "snow",
      });
    } else if (biome.t === "desert") {
      particles.push({
        x: cam.x - 20,
        y: cam.y + (Math.random() * cvs.height) / cam.z,
        vx: 3,
        vy: -0.2,
        life: 1,
        type: "sand",
      });
    } else if (biome.t === "forest") {
      particles.push({
        x: cam.x + (Math.random() * cvs.width) / cam.z,
        y: cam.y + (Math.random() * cvs.height) / cam.z,
        vx: Math.random() - 0.5,
        vy: Math.random() - 0.5,
        life: 1,
        type: "pollen",
      });
    }
  }
  for (let p of particles) {
    p.x += p.vx;
    p.y += p.vy;
    p.life -= 0.005;
  }
  particles = particles.filter((p) => p.life > 0);
}

function drawParticles(ctx, cam) {
  for (let p of particles) {
    let px = (p.x - cam.x) * cam.z;
    let py = (p.y - cam.y) * cam.z;
    if (p.type === "snow") {
      ctx.fillStyle = `rgba(255,255,255,${p.life})`;
    } else if (p.type === "sand") {
      ctx.fillStyle = `rgba(210,180,140,${p.life * 0.5})`;
    } else {
      ctx.fillStyle = `rgba(150,255,150,${p.life * 0.8})`;
    }
    ctx.fillRect(px, py, 2 * cam.z, 2 * cam.z);
  }
}

function drawMini() {
  mctx.fillStyle = "#000";
  mctx.fillRect(0, 0, 200, 200);
  let pcx = Math.floor(cam.x / 512);
  let pcy = Math.floor(cam.y / 512);
  let r = 50;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      let cx = pcx + dx;
      let cy = pcy + dy;
      if (world.explored.has(cx + "," + cy)) {
        let b = world.getBiome(cx * 16 + 8, cy * 16 + 8);
        mctx.fillStyle = b.c;
        mctx.fillRect(100 + dx * 2, 100 + dy * 2, 2, 2);
      }
    }
  }
  mctx.fillStyle = "#fff";
  mctx.fillRect(98, 98, 4, 4);
}

function loop() {
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, cvs.width, cvs.height);
  dayTime += 0.00015;
  if (dayTime > 1) dayTime = 0;

  let speed = 15 / cam.z;
  if (cam.keys["w"] || cam.keys["arrowup"]) cam.y -= speed;
  if (cam.keys["s"] || cam.keys["arrowdown"]) cam.y += speed;
  if (cam.keys["a"] || cam.keys["arrowleft"]) cam.x -= speed;
  if (cam.keys["d"] || cam.keys["arrowright"]) cam.x += speed;

  let currentBiome = world.draw(cam, cvs, ctx, dayTime);
  updateParticles(currentBiome, cam, cvs);
  drawParticles(ctx, cam);
  world.drawOverlays(cam, cvs, ctx);

  for (let ft of floatingTexts) {
    let px = (ft.wx * 32 - cam.x) * cam.z;
    let py = (ft.wy * 32 - cam.y) * cam.z;
    ctx.textAlign = "center";
    ctx.font = "bold 14px monospace";
    ctx.fillStyle = `rgba(255, 255, 255, ${ft.life})`;
    ctx.fillText(ft.text, px, py);
    ft.life -= 0.02;
    ft.wy -= 0.05;
  }
  floatingTexts = floatingTexts.filter((ft) => ft.life > 0);

  drawMini();
  if (audio) audio.update(currentBiome);

  let now = Date.now();
  if (now - lastSave > 5000) {
    world.save();
    lastSave = now;
  }

  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.font = "14px monospace";
  ctx.fillStyle = "rgba(0,0,0,0.8)";
  ctx.fillRect(10, 10, 380, 35);
  ctx.fillStyle = "#fff";
  ctx.fillText(
    `X:${Math.round(cam.x)} Y:${Math.round(cam.y)} | Z:${cam.z.toFixed(1)}x | Time:${(dayTime * 24).toFixed(1)}h | Seed:${world.seed}`,
    20,
    20,
  );

  requestAnimationFrame(loop);
}

document.getElementById("pin-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    let val = e.target.value.trim();
    if (val && window.pendingPin) {
      world.addPin(window.pendingPin.wx, window.pendingPin.wy, val);
    }
    document.getElementById("pin-box").style.display = "none";
    cam.togglePin();
  } else if (e.key === "Escape") {
    document.getElementById("pin-box").style.display = "none";
    cam.togglePin();
  }
});

document.getElementById("btn-export").onclick = () => {
  let exportCvs = document.createElement("canvas");
  let size = 1000;
  exportCvs.width = size;
  exportCvs.height = size;
  let ectx = exportCvs.getContext("2d");
  ectx.fillStyle = "#050508";
  ectx.fillRect(0, 0, size, size);
  let pcx = Math.floor(cam.x / 512);
  let pcy = Math.floor(cam.y / 512);
  let r = 250;
  let scale = 2;

  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      let cx = pcx + dx;
      let cy = pcy + dy;
      if (world.explored.has(cx + "," + cy)) {
        let b = world.getBiome(cx * 16 + 8, cy * 16 + 8);
        ectx.fillStyle = b.c;
        ectx.fillRect(
          size / 2 + dx * scale,
          size / 2 + dy * scale,
          scale,
          scale,
        );
      }
    }
  }

  ectx.fillStyle = "#ffcc00";
  for (let pin of world.pins) {
    let dx = pin.x / 16 - pcx;
    let dy = pin.y / 16 - pcy;
    let px = size / 2 + dx * 16 * scale;
    let py = size / 2 + dy * 16 * scale;
    ectx.beginPath();
    ectx.arc(px, py, 4, 0, 6.28);
    ectx.fill();
  }

  ectx.strokeStyle = "#ff5555";
  ectx.lineWidth = 2;
  for (let path of world.paths) {
    ectx.beginPath();
    for (let i = 0; i < path.length; i++) {
      let dx = path[i].x / 16 - pcx;
      let dy = path[i].y / 16 - pcy;
      let px = size / 2 + dx * 16 * scale;
      let py = size / 2 + dy * 16 * scale;
      if (i === 0) ectx.moveTo(px, py);
      else ectx.lineTo(px, py);
    }
    ectx.stroke();
  }

  let link = document.createElement("a");
  link.download = `cartographer_map_${world.seed}.png`;
  link.href = exportCvs.toDataURL();
  link.click();
};

document.getElementById("btn-share").onclick = () => {
  let url = new URL(window.location.href);
  url.searchParams.set("seed", world.seed);
  url.searchParams.set("x", Math.round(cam.x));
  url.searchParams.set("y", Math.round(cam.y));
  url.searchParams.set("z", cam.z.toFixed(2));
  navigator.clipboard
    .writeText(url.toString())
    .then(() => {
      showNotification("Shareable link copied to clipboard!");
    })
    .catch(() => {
      prompt("Copy this link:", url.toString());
    });
};

document.getElementById("btn-clear").onclick = () => {
  if (confirm("Clear all pins and drawn paths?")) {
    world.pins = [];
    world.paths = [];
    world.save();
  }
};

document.getElementById("start").onclick = () => {
  document.getElementById("start").style.opacity = "0";
  setTimeout(() => {
    document.getElementById("start").style.display = "none";
  }, 500);
  audio = new AudioEngine();
  loop();
};


