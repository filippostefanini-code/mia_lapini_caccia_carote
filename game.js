(() => {
  'use strict';

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const startScreen = document.getElementById('startScreen');
  const winScreen = document.getElementById('winScreen');
  const playBtn = document.getElementById('playBtn');
  const playAgainBtn = document.getElementById('playAgainBtn');
  const restartBtn = document.getElementById('restartBtn');
  const soundBtn = document.getElementById('soundBtn');
  const hint = document.getElementById('hint');

  const miaImg = new Image();
  miaImg.src = 'assets/mia_manga.png';

  let W = 1000;
  let H = 700;
  let running = false;
  let last = performance.now();
  let caught = 0;
  let soundOn = true;
  let audioCtx = null;
  let confetti = [];
  let pointerDown = false;
  let pointerTarget = null;
  let hintTimer = 0;
  let stinkUntil = 0;

  const keys = new Set();

  const mia = {
    x: 170,
    y: 430,
    r: 42,
    speed: 350,
    carrying: null
  };

  const basket = {
    x: 865,
    y: 535,
    w: 108,
    h: 96
  };

  const carrots = [];
  const goal = 5;
  const onions = [];
  const bunnies = [];
  const flowers = [];
  const clouds = [];

  const palette = {
    grass1: '#9fda6f',
    grass2: '#87ca5d',
    path: '#f7e3b2',
    fence: '#fff8dc',
    fenceLine: '#e7c99b',
    hill: '#7dbb61',
    sky: '#bcecff',
    carrot: '#ff7b2d',
    leaf: '#4ba85c',
    ink: '#493536'
  };

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    W = rect.width;
    H = rect.height;
    // Keep entities inside after orientation changes.
    mia.x = clamp(mia.x, 55, W - 55);
    mia.y = clamp(mia.y, 95, H - 55);
    basket.x = W - 125;
    basket.y = H - 125;
  }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function rand(a, b) { return a + Math.random() * (b - a); }

  function roundedRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  }

  function beep(freq=660, duration=.08, type='sine', gain=.045) {
    if (!soundOn) return;
    try {
      audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      g.gain.value = gain;
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
      osc.connect(g);
      g.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + duration);
    } catch (_) {}
  }

  function happyChime() {
    [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => beep(f, .18, 'triangle', .05), i * 110));
  }

  function stinkSound() {
    // A short, deliberately silly descending buzz.
    [260, 175, 105].forEach((f, i) => setTimeout(() => beep(f, .18, 'sawtooth', .055), i * 115));
  }

  function resetGame() {
    caught = 0;
    mia.x = Math.max(85, W * .16);
    mia.y = H * .62;
    mia.carrying = null;
    carrots.length = 0;
    onions.length = 0;
    stinkUntil = 0;
    bunnies.length = 0;
    confetti.length = 0;

    for (let i = 0; i < 3; i++) {
      carrots.push(makeCarrot(i));
    }
    for (let i = 0; i < 2; i++) {
      onions.push({
        x: W * (i ? .70 : .35), y: H * (i ? .67 : .43), r: 24,
        vx: i ? -44 : 48, vy: i ? -28 : 32, phase: i * 2
      });
    }

    // Gentle difficulty: the Lapini are deliberately slower than Mia.
    const bunnyCount = 5;
    for (let i = 0; i < bunnyCount; i++) {
      bunnies.push({
        x: W * (.34 + (i % 3) * .18),
        y: H * (.29 + Math.floor(i / 3) * .37),
        r: 29,
        speed: 51 + i * 4,
        bob: Math.random() * Math.PI * 2,
        targetIndex: i % carrots.length,
        blink: 0
      });
    }

    updateScore();
    hint.classList.remove('hidden');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => hint.classList.add('hidden'), 7000);
  }

  function makeCarrot(i) {
    const spots = [
      {x: .43, y: .36},
      {x: .67, y: .48},
      {x: .49, y: .72},
      {x: .76, y: .29},
      {x: .30, y: .56}
    ];
    const s = spots[i % spots.length];
    return {
      x: W * s.x + rand(-35, 35),
      y: H * s.y + rand(-25, 25),
      r: 22,
      state: 'ground', // ground | carried | respawn
      respawn: 0,
      wiggle: Math.random() * 6
    };
  }

  function repositionCarrot(c) {
    const safeX = rand(W * .28, W * .78);
    const safeY = rand(H * .24, H * .78);
    c.x = safeX;
    c.y = safeY;
    c.state = 'ground';
  }

  function updateScore() {
    for (let i = 1; i <= goal; i++) {
      document.getElementById(`carrot${i}`).classList.toggle('on', i <= caught);
    }
  }

  function start() {
    startScreen.classList.remove('visible');
    winScreen.classList.remove('visible');
    resetGame();
    running = true;
    last = performance.now();
    requestAnimationFrame(loop);
  }

  function win() {
    running = false;
    happyChime();
    makeConfetti();
    setTimeout(() => winScreen.classList.add('visible'), 400);
  }

  function update(dt) {
    // Keyboard movement.
    let dx = 0, dy = 0;
    if (keys.has('ArrowLeft') || keys.has('a')) dx -= 1;
    if (keys.has('ArrowRight') || keys.has('d')) dx += 1;
    if (keys.has('ArrowUp') || keys.has('w')) dy -= 1;
    if (keys.has('ArrowDown') || keys.has('s')) dy += 1;
    if (dx || dy) {
      const len = Math.hypot(dx, dy) || 1;
      mia.x += dx / len * mia.speed * dt;
      mia.y += dy / len * mia.speed * dt;
    }

    // Touch/mouse target.
    if (pointerTarget) {
      const vx = pointerTarget.x - mia.x;
      const vy = pointerTarget.y - mia.y;
      const d = Math.hypot(vx, vy);
      if (d > 5) {
        const step = Math.min(d, mia.speed * dt);
        mia.x += vx / d * step;
        mia.y += vy / d * step;
      }
    }

    mia.x = clamp(mia.x, 46, W - 46);
    mia.y = clamp(mia.y, 82, H - 48);

    // Onions wander around the field and bounce at its edges.
    for (const o of onions) {
      o.phase += dt;
      o.x += o.vx * dt;
      o.y += (o.vy + Math.sin(o.phase * 2) * 16) * dt;
      if (o.x < 35 || o.x > W - 35) { o.vx *= -1; o.x = clamp(o.x, 35, W - 35); }
      if (o.y < H * .24 || o.y > H - 38) { o.vy *= -1; o.y = clamp(o.y, H * .24, H - 38); }
      if (performance.now() > stinkUntil && dist(mia, o) < mia.r + o.r - 5) {
        stinkUntil = performance.now() + 1600;
        stinkSound();
        caught = Math.max(0, caught - 1);
        updateScore();
        // Send the onion elsewhere so one touch cannot trigger it repeatedly.
        o.x = clamp(o.x + (o.x > W / 2 ? -190 : 190), 35, W - 35);
        o.y = clamp(o.y + (o.y > H / 2 ? -110 : 110), H * .24, H - 38);
      }
    }

    // Auto-pickup a carrot when Mia reaches it.
    if (!mia.carrying) {
      for (const c of carrots) {
        if (c.state === 'ground' && dist(mia, c) < mia.r + c.r + 7) {
          c.state = 'carried';
          mia.carrying = c;
          beep(760, .1, 'triangle', .045);
          break;
        }
      }
    }

    // Carry carrot above Mia.
    if (mia.carrying) {
      mia.carrying.x = mia.x + 27;
      mia.carrying.y = mia.y - 52;

      const basketCenter = { x: basket.x + basket.w/2, y: basket.y + basket.h/2 };
      if (Math.hypot(mia.x - basketCenter.x, mia.y - basketCenter.y) < 88) {
        const c = mia.carrying;
        mia.carrying = null;
        c.state = 'respawn';
        c.respawn = 1000;
        caught += 1;
        updateScore();
        beep(880, .1, 'triangle', .06);
        setTimeout(() => beep(1175, .12, 'triangle', .05), 100);

        if (caught >= goal) {
          win();
          return;
        }

        // New carrot appears elsewhere after a short celebration.
        setTimeout(() => {
          if (caught < goal) repositionCarrot(c);
        }, 650);
      }
    }

    // Lapini chase nearest free carrot, but slowly enough for a child to beat them.
    for (let i = 0; i < bunnies.length; i++) {
      const b = bunnies[i];
      b.bob += dt * 5;

      let best = null;
      let bestD = Infinity;
      for (const c of carrots) {
        if (c.state !== 'ground') continue;
        const d = dist(b, c);
        if (d < bestD) { bestD = d; best = c; }
      }

      if (best) {
        const vx = best.x - b.x;
        const vy = best.y - b.y;
        const d = Math.hypot(vx, vy) || 1;
        const speed = b.speed * (bestD < 120 ? .92 : 1);
        b.x += vx / d * speed * dt;
        b.y += vy / d * speed * dt;

        if (bestD < b.r + best.r - 2) {
          best.state = 'respawn';
          best.respawn = 900;
          beep(210, .1, 'square', .025);
          setTimeout(() => {
            if (caught < goal && best.state === 'respawn') repositionCarrot(best);
          }, 900);
          // Hop away from the center after stealing.
          b.x = clamp(b.x + rand(-60, 60), 40, W - 40);
          b.y = clamp(b.y + rand(-50, 50), 90, H - 40);
        }
      }
    }

    // Keep dynamic background moving.
    clouds.forEach(c => {
      c.x += c.speed * dt;
      if (c.x > W + 150) c.x = -160;
    });
  }

  function drawBackground(t) {
    // Sky.
    ctx.fillStyle = palette.sky;
    ctx.fillRect(0, 0, W, H * .22);

    // Clouds.
    if (!clouds.length) {
      clouds.push(
        {x: W*.18,y:50,s:.8,speed:7},
        {x: W*.55,y:76,s:1.05,speed:5},
        {x: W*.82,y:44,s:.65,speed:8}
      );
    }
    for (const c of clouds) drawCloud(c.x, c.y, c.s);

    // Distant hills.
    ctx.fillStyle = '#82c669';
    ctx.beginPath();
    ctx.moveTo(0, H*.23);
    ctx.quadraticCurveTo(W*.16,H*.13,W*.32,H*.23);
    ctx.quadraticCurveTo(W*.50,H*.10,W*.68,H*.23);
    ctx.quadraticCurveTo(W*.84,H*.15,W,H*.23);
    ctx.lineTo(W,H*.36);
    ctx.lineTo(0,H*.36);
    ctx.closePath();
    ctx.fill();

    // Grass.
    const grad = ctx.createLinearGradient(0, H*.2, 0, H);
    grad.addColorStop(0, palette.grass1);
    grad.addColorStop(1, palette.grass2);
    ctx.fillStyle = grad;
    ctx.fillRect(0, H*.22, W, H*.78);

    // Curved garden path.
    ctx.strokeStyle = palette.path;
    ctx.lineWidth = Math.max(60, W*.085);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(W*.08,H*.77);
    ctx.bezierCurveTo(W*.26,H*.52,W*.58,H*.91,W*.92,H*.58);
    ctx.stroke();

    // Soft path center.
    ctx.strokeStyle = 'rgba(255,255,255,.23)';
    ctx.lineWidth = Math.max(10, W*.018);
    ctx.beginPath();
    ctx.moveTo(W*.08,H*.77);
    ctx.bezierCurveTo(W*.26,H*.52,W*.58,H*.91,W*.92,H*.58);
    ctx.stroke();

    // Fence.
    drawFence(H*.25);

    // Flowers.
    if (!flowers.length) {
      for (let i = 0; i < 45; i++) {
        flowers.push({
          x: Math.random()*W,
          y: H*.30 + Math.random()*H*.64,
          s: rand(.45,1.0),
          phase:Math.random()*6.28
        });
      }
    }
    flowers.forEach(f => drawFlower(f.x, f.y, f.s, t + f.phase));
  }

  function drawCloud(x,y,s) {
    ctx.save();
    ctx.translate(x,y);
    ctx.scale(s,s);
    ctx.fillStyle = 'rgba(255,255,255,.78)';
    ctx.beginPath();
    ctx.arc(0, 14, 26, 0, Math.PI*2);
    ctx.arc(30, 0, 34, 0, Math.PI*2);
    ctx.arc(66, 16, 25, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();
  }

  function drawFence(y) {
    ctx.save();
    ctx.globalAlpha = .94;
    ctx.strokeStyle = palette.fenceLine;
    ctx.lineWidth = 5;
    ctx.fillStyle = palette.fence;
    const postW = 15, gap = 54;
    for (let x = 0; x < W + gap; x += gap) {
      roundedRect(x, y - 15, postW, 72, 6);
      ctx.fill();
      ctx.stroke();
    }
    ctx.fillStyle = palette.fence;
    roundedRect(0, y + 8, W, 16, 7);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function drawFlower(x,y,s,t) {
    const sway = Math.sin(t*1.3 + x*.03) * 2.5;
    ctx.save();
    ctx.translate(x+sway,y);
    ctx.scale(s,s);
    ctx.strokeStyle='rgba(52,125,57,.5)';
    ctx.lineWidth=2;
    ctx.beginPath();ctx.moveTo(0,4);ctx.lineTo(0,15);ctx.stroke();
    const colors=['#fff7f0','#ffe173','#ffb1bf','#f7eefc'];
    ctx.fillStyle=colors[Math.floor((x+y)%colors.length)];
    for(let i=0;i<5;i++){
      const a=i*Math.PI*2/5;
      ctx.beginPath();ctx.arc(Math.cos(a)*5,Math.sin(a)*5,4.5,0,Math.PI*2);ctx.fill();
    }
    ctx.fillStyle='#f3a735';ctx.beginPath();ctx.arc(0,0,3.3,0,Math.PI*2);ctx.fill();
    ctx.restore();
  }

  function drawCarrot(c, t) {
    if (c.state === 'respawn') return;
    const pulse = 1 + Math.sin(t*5 + c.wiggle) * .035;
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.scale(pulse,pulse);
    ctx.rotate(-.18);

    // Glow for readability.
    ctx.shadowColor = 'rgba(255,128,35,.35)';
    ctx.shadowBlur = 12;

    ctx.fillStyle = palette.carrot;
    ctx.beginPath();
    ctx.moveTo(-14,-10);
    ctx.quadraticCurveTo(19,-13,8,36);
    ctx.quadraticCurveTo(2,50,-4,36);
    ctx.quadraticCurveTo(-13,8,-14,-10);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(180,75,24,.55)';
    ctx.lineWidth = 2;
    [-2,9,20].forEach(yy=>{
      ctx.beginPath();ctx.moveTo(-5,yy);ctx.lineTo(4,yy-2);ctx.stroke();
    });

    ctx.fillStyle = palette.leaf;
    for (let i=0;i<3;i++){
      ctx.save();
      ctx.rotate((i-1)*.45);
      ctx.beginPath();
      ctx.ellipse(0,-20,7,20,0,0,Math.PI*2);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  function drawOnion(o, t) {
    ctx.save();
    ctx.translate(o.x, o.y + Math.sin(t * 4 + o.phase) * 2);
    ctx.fillStyle = 'rgba(67,65,50,.18)';
    ctx.beginPath(); ctx.ellipse(0, 24, 25, 7, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ad75b7'; ctx.strokeStyle = '#704c83'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(0, 2, 22, 23, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,232,247,.75)'; ctx.lineWidth = 2;
    for (const x of [-8, 0, 8]) {
      ctx.beginPath(); ctx.moveTo(x, -16); ctx.quadraticCurveTo(x + 5, 2, x, 19); ctx.stroke();
    }
    ctx.fillStyle = '#78ba63';
    ctx.beginPath(); ctx.ellipse(-5, -25, 5, 14, -.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(5, -25, 5, 14, .5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawStink() {
    if (performance.now() > stinkUntil) return;
    const x = clamp(mia.x, 85, W - 85), y = Math.max(105, mia.y - 88);
    ctx.save();
    ctx.fillStyle = '#fff9da'; ctx.strokeStyle = '#734579'; ctx.lineWidth = 3;
    roundedRect(x - 77, y - 25, 154, 48, 18); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#56335c'; ctx.font = 'bold 20px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Che puzza! 🤢', x, y); ctx.restore();
  }

  function drawBunny(b, i, t) {
    const bob = Math.sin(b.bob) * 3;
    const coats = ['#fff8f1','#e8d0b6','#f1e6dc','#c9a98f','#e7dbe5'];
    const coat = coats[i % coats.length];
    ctx.save();
    ctx.translate(b.x, b.y + bob);

    // Shadow.
    ctx.fillStyle='rgba(72,82,48,.18)';
    ctx.beginPath();ctx.ellipse(0,31,32,10,0,0,Math.PI*2);ctx.fill();

    // Body.
    // Fluffy tail, body and soft belly.
    ctx.fillStyle = '#fffdfa';
    ctx.beginPath(); ctx.arc(25, 18, 12, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = coat;
    ctx.strokeStyle = '#b98c84';
    ctx.lineWidth = 2.2;
    ctx.beginPath();ctx.ellipse(0,13,27,30,0,0,Math.PI*2);ctx.fill();ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.65)';
    ctx.beginPath();ctx.ellipse(0,19,16,19,0,0,Math.PI*2);ctx.fill();
    for (const sx of [-1,1]) {
      ctx.fillStyle = coat;
      ctx.beginPath();ctx.ellipse(sx*20,35,12,7,sx*.2,0,Math.PI*2);ctx.fill();ctx.stroke();
      ctx.fillStyle = '#e9afb1';
      for (const offset of [-4,0,4]) {
        ctx.beginPath();ctx.arc(sx*20+offset,37,1.5,0,Math.PI*2);ctx.fill();
      }
    }

    // Ears.
    for (const sx of [-1,1]) {
      ctx.save();
      ctx.translate(sx*12,-29);
      ctx.rotate(sx*.12);
      ctx.fillStyle = coat;
      ctx.beginPath();ctx.ellipse(0,0,10,28,0,0,Math.PI*2);ctx.fill();ctx.stroke();
      ctx.fillStyle='#e9a9b1';ctx.beginPath();ctx.ellipse(0,1,5,20,0,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='rgba(255,255,255,.5)';ctx.beginPath();ctx.ellipse(-2,-5,1.5,10,0,0,Math.PI*2);ctx.fill();
      ctx.restore();
    }

    // Head.
    ctx.fillStyle = coat;
    ctx.beginPath();ctx.arc(0,-5,25,0,Math.PI*2);ctx.fill();ctx.stroke();

    // Cheeks, little tuft and expressive brows.
    ctx.fillStyle = 'rgba(255,177,184,.45)';
    for (const sx of [-1,1]) {
      ctx.beginPath();ctx.ellipse(sx*15,2,7,5,0,0,Math.PI*2);ctx.fill();
    }
    ctx.fillStyle = coat;
    ctx.beginPath();ctx.moveTo(-6,-27);ctx.lineTo(-2,-34);ctx.lineTo(2,-27);
    ctx.lineTo(6,-32);ctx.lineTo(9,-25);ctx.fill();
    ctx.strokeStyle='#866d6c';ctx.lineWidth=1.3;
    for (const sx of [-1,1]) {
      ctx.beginPath();ctx.moveTo(sx*5,-17);ctx.quadraticCurveTo(sx*9,-20,sx*12,-17);ctx.stroke();
    }

    // Eyes.
    ctx.fillStyle='#3f3131';
    ctx.beginPath();ctx.arc(-8,-9,3.2,0,Math.PI*2);ctx.arc(8,-9,3.2,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#fff';
    ctx.beginPath();ctx.arc(-7,-10,1.1,0,Math.PI*2);ctx.arc(9,-10,1.1,0,Math.PI*2);ctx.fill();

    // Nose and smile.
    ctx.fillStyle='#e58b95';ctx.beginPath();ctx.arc(0,-1,3.2,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle='#7c5f5f';ctx.lineWidth=1.7;
    ctx.beginPath();ctx.moveTo(0,2);ctx.quadraticCurveTo(-5,7,-9,4);ctx.moveTo(0,2);ctx.quadraticCurveTo(5,7,9,4);ctx.stroke();
    // Tiny muzzle and whiskers.
    ctx.fillStyle='rgba(255,255,255,.72)';
    ctx.beginPath();ctx.ellipse(-5,1,6,4,0,0,Math.PI*2);
    ctx.ellipse(5,1,6,4,0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#e58b95';ctx.beginPath();ctx.arc(0,-1,3,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle='#806569';ctx.lineWidth=1;
    for (const sx of [-1,1]) for (const dy of [-3,1,5]) {
      ctx.beginPath();ctx.moveTo(sx*11,2);ctx.quadraticCurveTo(sx*20,dy,sx*29,dy-1);ctx.stroke();
    }

    // Label.
    ctx.font='800 11px ui-rounded, system-ui';
    ctx.textAlign='center';
    ctx.fillStyle='rgba(73,53,54,.74)';
    ctx.fillText('Lapino',0,52);
    ctx.restore();
  }

  function drawBasket() {
    const x=basket.x,y=basket.y,w=basket.w,h=basket.h;
    // Glow if Mia carries a carrot.
    if (mia.carrying) {
      ctx.save();
      ctx.strokeStyle='rgba(255,232,94,.95)';
      ctx.lineWidth=10;
      ctx.shadowColor='#fff29e';
      ctx.shadowBlur=18;
      ctx.beginPath();ctx.ellipse(x+w/2,y+h/2,w*.65,h*.65,0,0,Math.PI*2);ctx.stroke();
      ctx.restore();
    }

    // Handle.
    ctx.strokeStyle='#9c643b';
    ctx.lineWidth=8;
    ctx.beginPath();
    ctx.arc(x+w/2,y+18,w*.33,Math.PI,Math.PI*2);
    ctx.stroke();

    // Basket body.
    const grad=ctx.createLinearGradient(x,y,x,y+h);
    grad.addColorStop(0,'#d99551');grad.addColorStop(1,'#b96d32');
    ctx.fillStyle=grad;
    ctx.strokeStyle='#8e542d';
    ctx.lineWidth=3;
    ctx.beginPath();
    ctx.moveTo(x+10,y+26);
    ctx.lineTo(x+w-10,y+26);
    ctx.lineTo(x+w-22,y+h-8);
    ctx.lineTo(x+22,y+h-8);
    ctx.closePath();
    ctx.fill();ctx.stroke();

    // Wicker lines.
    ctx.strokeStyle='rgba(255,222,166,.62)';
    ctx.lineWidth=3;
    for(let yy=y+38;yy<y+h-12;yy+=13){
      ctx.beginPath();ctx.moveTo(x+18,yy);ctx.lineTo(x+w-18,yy);ctx.stroke();
    }
    for(let xx=x+28;xx<x+w-18;xx+=18){
      ctx.beginPath();ctx.moveTo(xx,y+28);ctx.lineTo(xx-6,y+h-10);ctx.stroke();
    }

    ctx.fillStyle='#fff7da';
    ctx.font='900 12px ui-rounded, system-ui';
    ctx.textAlign='center';
    ctx.fillText('CESTINO',x+w/2,y+h+15);
  }

  function drawMia(t) {
    const r=mia.r;
    ctx.save();
    ctx.translate(mia.x,mia.y);

    // Player shadow.
    ctx.fillStyle='rgba(57,70,41,.20)';
    ctx.beginPath();ctx.ellipse(0,r*.88,r*.8,r*.25,0,0,Math.PI*2);ctx.fill();

    // Body badge.
    ctx.fillStyle='#ffe4a3';
    ctx.strokeStyle='#fff';
    ctx.lineWidth=4;
    ctx.beginPath();ctx.arc(0,0,r+5,0,Math.PI*2);ctx.fill();ctx.stroke();

    // Crop Mia's manga portrait to a circle.
    ctx.save();
    ctx.beginPath();ctx.arc(0,0,r,0,Math.PI*2);ctx.clip();
    if (miaImg.complete && miaImg.naturalWidth) {
      const sx = miaImg.naturalWidth*.18;
      const sy = miaImg.naturalHeight*.24;
      const sw = miaImg.naturalWidth*.64;
      const sh = miaImg.naturalHeight*.56;
      ctx.drawImage(miaImg,sx,sy,sw,sh,-r,-r,r*2,r*2);
    } else {
      ctx.fillStyle='#f6b5bd';ctx.fillRect(-r,-r,r*2,r*2);
    }
    ctx.restore();

    // Tiny crown of stars.
    ctx.fillStyle='#fff3a3';
    ctx.font='16px system-ui';
    ctx.textAlign='center';
    ctx.fillText('★', -30, -r-8);
    ctx.fillText('✦', 30, -r-12);

    // Name.
    ctx.fillStyle='#4a383a';
    ctx.font='950 13px ui-rounded, system-ui';
    ctx.textAlign='center';
    ctx.fillText('Mia',0,r+22);

    ctx.restore();

    if (mia.carrying) {
      // Direction cue to basket.
      drawArrowToBasket();
    }
  }

  function drawArrowToBasket() {
    const bx=basket.x+basket.w/2, by=basket.y+basket.h/2;
    const dx=bx-mia.x,dy=by-mia.y;
    const ang=Math.atan2(dy,dx);
    ctx.save();
    ctx.translate(mia.x,mia.y);
    ctx.rotate(ang);
    ctx.globalAlpha=.85;
    ctx.fillStyle='#ffef7d';
    ctx.strokeStyle='#a96e31';
    ctx.lineWidth=2;
    ctx.beginPath();
    ctx.moveTo(54,0);
    ctx.lineTo(88,-10);
    ctx.lineTo(88,-18);
    ctx.lineTo(110,0);
    ctx.lineTo(88,18);
    ctx.lineTo(88,10);
    ctx.closePath();
    ctx.fill();ctx.stroke();
    ctx.restore();
  }

  function makeConfetti() {
    const colors=['#ff8a3d','#ffd94d','#66c47a','#72c8ef','#f59bb0','#b79bf3'];
    for(let i=0;i<120;i++){
      confetti.push({
        x:rand(0,W),y:rand(-H*.8,-20),vx:rand(-35,35),vy:rand(90,210),
        rot:rand(0,6.28),vr:rand(-5,5),s:rand(5,11),
        c:colors[i%colors.length]
      });
    }
  }

  function drawConfetti(dt) {
    for(const p of confetti){
      p.x+=p.vx*dt;p.y+=p.vy*dt;p.rot+=p.vr*dt;
      ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.rot);ctx.fillStyle=p.c;
      ctx.fillRect(-p.s/2,-p.s/2,p.s,p.s*.55);ctx.restore();
    }
  }

  function draw(t, dt) {
    ctx.clearRect(0,0,W,H);
    drawBackground(t);
    basket.x = W - basket.w - 24;
    basket.y = H - basket.h - 24;
    drawBasket();
    carrots.forEach(c=>drawCarrot(c,t));
    onions.forEach(o=>drawOnion(o,t));
    bunnies.forEach((b,i)=>drawBunny(b,i,t));
    drawMia(t);
    drawStink();
    drawConfetti(dt);
  }

  function loop(now) {
    const dt=Math.min(.035,(now-last)/1000);
    last=now;
    if (running) update(dt);
    draw(now/1000,dt);
    if (running || confetti.length) requestAnimationFrame(loop);
  }

  function pointerPos(e) {
    const r=canvas.getBoundingClientRect();
    return {x:e.clientX-r.left,y:e.clientY-r.top};
  }

  canvas.addEventListener('pointerdown',e=>{
    e.preventDefault();
    pointerDown=true;
    pointerTarget=pointerPos(e);
    hint.classList.add('hidden');
    try { canvas.setPointerCapture(e.pointerId); } catch(_){}
  });

  canvas.addEventListener('pointermove',e=>{
    if(!pointerDown)return;
    e.preventDefault();
    pointerTarget=pointerPos(e);
  });

  canvas.addEventListener('pointerup',e=>{
    pointerDown=false;
    pointerTarget=pointerPos(e);
  });

  canvas.addEventListener('pointercancel',()=>{pointerDown=false;pointerTarget=null});

  window.addEventListener('keydown',e=>{
    const k=e.key.length===1?e.key.toLowerCase():e.key;
    if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','w','a','s','d'].includes(k)){
      e.preventDefault();keys.add(k);hint.classList.add('hidden');
    }
  },{passive:false});

  window.addEventListener('keyup',e=>{
    const k=e.key.length===1?e.key.toLowerCase():e.key;
    keys.delete(k);
  });

  playBtn.addEventListener('click',()=>{
    beep(620,.09,'triangle',.035);
    start();
  });

  playAgainBtn.addEventListener('click',()=>{
    winScreen.classList.remove('visible');
    start();
  });

  restartBtn.addEventListener('click',()=>{
    beep(420,.08,'sine',.03);
    resetGame();
    running=true;
    last=performance.now();
    requestAnimationFrame(loop);
  });

  soundBtn.addEventListener('click',()=>{
    soundOn=!soundOn;
    soundBtn.textContent=soundOn?'🔊':'🔇';
    if(soundOn)beep(660,.08,'triangle',.035);
  });

  window.addEventListener('resize',()=>{
    resize();
    draw(performance.now()/1000,0);
  });

  resize();
  resetGame();
  draw(performance.now()/1000,0);
})();
