/* ============================================================
   widgets.js — интерактивные анимации «внутрянки».
   Каждый виджет: Widgets[name](container) -> cleanup()
   ============================================================ */
(function () {
  const P = { amber:'#ffa023', amber2:'#ff7a00', cyan:'#2dd4e6', green:'#34d399',
              red:'#ff5a6a', text:'#e9eef6', mut:'#74819a', surf:'#141b29',
              line:'#283449', violet:'#a78bfa', road:'#0c111c' };

  function shell(container, title, tag, stageH = 300) {
    container.innerHTML =
      `<div class="widget__head"><span class="widget__title">${title}</span>
        <span class="widget__tag">${tag}</span></div>
       <div class="widget__stage"><svg viewBox="0 0 640 ${stageH}" width="640" style="width:100%"></svg></div>
       <div class="widget__controls"></div>`;
    return {
      svg: container.querySelector('svg'),
      controls: container.querySelector('.widget__controls'),
    };
  }
  const NS = 'http://www.w3.org/2000/svg';
  function S(tag, attrs, html) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (html != null) e.innerHTML = html;
    return e;
  }
  function slider(controls, label, min, max, val, step, onInput) {
    const wrap = document.createElement('div'); wrap.className = 'ctrl';
    const out = document.createElement('b');
    wrap.innerHTML = `<label>${label} <b></b></label>`;
    const inp = document.createElement('input');
    inp.type = 'range'; inp.min = min; inp.max = max; inp.value = val; inp.step = step || 1;
    wrap.appendChild(inp);
    const b = wrap.querySelector('label b');
    const upd = () => { b.textContent = onInput(parseFloat(inp.value)); };
    inp.addEventListener('input', upd); controls.appendChild(wrap); upd();
    return inp;
  }
  function button(controls, text, cls) {
    const b = document.createElement('button');
    b.className = 'btn btn--sm ' + (cls || '');
    b.textContent = text; controls.appendChild(b); return b;
  }
  function readout(controls) {
    const d = document.createElement('div'); d.className = 'readout';
    d.style.cssText = 'min-width:100%;display:flex;gap:16px;flex-wrap:wrap';
    controls.appendChild(d); return d;
  }
  const spokes = (cx, cy, r, n, color) => {
    let s = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${P.surf}" stroke="${color}" stroke-width="3"/>`;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      s += `<line x1="${cx}" y1="${cy}" x2="${cx + Math.cos(a) * r}" y2="${cy + Math.sin(a) * r}" stroke="${color}" stroke-width="2.5" opacity=".8"/>`;
    }
    s += `<circle cx="${cx}" cy="${cy}" r="6" fill="${color}"/>`;
    return s;
  };

  const Widgets = {};

  /* ---------------------------------------------------------- СЦЕПЛЕНИЕ */
  Widgets.clutch = function (container) {
    const { svg, controls } = shell(container, '⚙️ Сцепление: управление рассогласованием скоростей', 'Lada Granta', 300);
    // static scene
    svg.appendChild(S('rect', { x: 0, y: 0, width: 640, height: 300, fill: 'none' }));
    svg.appendChild(S('text', { x: 150, y: 36, fill: P.mut, 'font-size': 13, 'text-anchor': 'middle', 'font-family': 'JetBrains Mono' }, 'ДВИГАТЕЛЬ'));
    svg.appendChild(S('text', { x: 500, y: 36, fill: P.mut, 'font-size': 13, 'text-anchor': 'middle', 'font-family': 'JetBrains Mono' }, 'КОЛЁСА'));
    // shafts
    svg.appendChild(S('rect', { x: 0, y: 142, width: 90, height: 16, fill: P.line, rx: 4 }));
    const shaftR = S('rect', { x: 500, y: 142, width: 140, height: 16, fill: P.line, rx: 4 }); svg.appendChild(shaftR);
    const gEngine = S('g'); const gClutch = S('g'); svg.appendChild(gEngine); svg.appendChild(gClutch);
    const heat = S('g'); svg.appendChild(heat);
    const status = S('text', { x: 320, y: 280, fill: P.text, 'font-size': 18, 'text-anchor': 'middle', 'font-weight': 700 }, ''); svg.appendChild(status);
    const slipArc = S('text', { x: 320, y: 110, fill: P.red, 'font-size': 12, 'text-anchor': 'middle', 'font-family': 'JetBrains Mono', opacity: 0 }, '↯ ПРОСКАЛЬЗЫВАНИЕ'); svg.appendChild(slipArc);

    const out = readout(controls);
    let pedal = 0, gas = 0; // pedal: 0=выжато, 100=отпущено
    const pedalI = slider(controls, 'Педаль сцепления', 0, 100, 0, 1,
      v => { pedal = v; return v < 5 ? 'выжата' : v > 95 ? 'отпущена' : v + '%'; });
    const gasI = slider(controls, 'Газ', 0, 100, 0, 1, v => { gas = v; return v + '%'; });
    const dropBtn = button(controls, '⛔ Бросить резко (без газа)', '');
    const startBtn = button(controls, '▶ Тронуться плавно', 'btn--primary');

    // physics state (omega in rad/s-ish abstract)
    let eng = 84, whl = 0, heatV = 0, stalled = false, aE = 0, aC = 0;
    const IDLE = 84, STALL = 42;
    let raf, anim = null; // anim: {target pedal/gas script}

    dropBtn.onclick = () => { gasI.value = 0; gasI.dispatchEvent(new Event('input')); pedalI.value = 100; pedalI.dispatchEvent(new Event('input')); };
    startBtn.onclick = () => {
      stalled = false; eng = IDLE; whl = 0; heatV = 0;
      anim = { t: 0 }; // scripted smooth start
    };

    let last = performance.now();
    function frame(now) {
      let dt = Math.min((now - last) / 1000, 0.05); last = now; dt *= 1.6;
      if (anim) { // scripted smooth launch: add gas, then ease pedal up
        anim.t += dt;
        const g = Math.min(anim.t * 55, 45);
        const p = anim.t < 0.7 ? 0 : Math.min((anim.t - 0.7) * 38, 100);
        gasI.value = g; gasI.dispatchEvent(new Event('input'));
        pedalI.value = p; pedalI.dispatchEvent(new Event('input'));
        if (anim.t > 4) anim = null;
      }
      const contact = Math.max(0, Math.min(1, (pedal - 38) / (94 - 38))); // bite zone 38..94
      if (!stalled) {
        const targetEng = IDLE + gas * 4.6;
        const slip = eng - whl;
        const load = contact * slip;                        // нагрузка сцепления тянет мотор к скорости колёс
        const gasTorque = gas * 1.4;                        // газ открывает дроссель = тяга
        const idleGov = Math.max(0, IDLE - eng) * 0.35;     // слабый регулятор ХХ: держит холостые лишь без нагрузки
        eng += (gasTorque + idleGov - load * 1.6 - Math.max(0, eng - targetEng) * 0.5) * dt * 1.2;
        whl += (load * 0.9 - whl * 0.55) * dt * 0.6;         // тяжёлая машина — колёса разгоняются медленно
        if (eng < 0) eng = 0;
        if (contact > 0.18 && eng < STALL) stalled = true;  // тяги не хватило — двигатель заглох
      } else {
        eng -= (eng * 3 + 24) * dt; if (eng < 0) eng = 0;   // мотор быстро затихает
        whl -= whl * 1.5 * dt; if (whl < 0) whl = 0;
      }
      const slipNow = Math.max(0, eng - whl) * contact;
      heatV += slipNow * dt * 0.012; heatV -= heatV * 0.4 * dt; heatV = Math.max(0, Math.min(heatV, 1));

      aE += eng * dt; aC += whl * dt;
      const clutchCx = 400 - (pedal / 100) * 66;          // 400(apart)..334(touch)
      gEngine.innerHTML = spokes(200, 150, 64, 8, P.amber);
      gEngine.setAttribute('transform', `rotate(${aE * 6} 200 150)`);
      gClutch.innerHTML = spokes(clutchCx, 150, 56, 6, P.cyan);
      gClutch.setAttribute('transform', `rotate(${aC * 6} ${clutchCx} 150)`);
      shaftR.setAttribute('x', clutchCx + 50);
      shaftR.setAttribute('width', 640 - (clutchCx + 50));
      // heat glow at interface
      const ix = (264 + clutchCx - 56) / 2 + 6;
      heat.innerHTML = heatV > 0.04 && contact > 0.05
        ? `<circle cx="${ix}" cy="150" r="${10 + heatV * 30}" fill="${P.red}" opacity="${heatV * 0.5}"/>`
        : '';
      slipArc.setAttribute('opacity', (contact > 0.05 && slipNow > 4) ? 0.9 : 0);

      let st, col = P.text;
      if (stalled) { st = '🟥 ЗАГЛОХ! Обороты упали ниже холостых. Жми «Тронуться плавно»'; col = P.red; }
      else if (contact < 0.04) { st = 'Разъединено — мотор крутится сам по себе'; col = P.mut; }
      else if (slipNow > 6) { st = '🟡 Проскальзывание — диски трутся, гасят разницу'; col = P.amber; }
      else { st = '🟢 Сцеплено — мотор и колёса как одно целое'; col = P.green; }
      status.textContent = st; status.setAttribute('fill', col);

      out.innerHTML = `<span>Обороты: <b style="color:${P.amber}">${Math.round(eng / 84 * 800)}</b> об/мин</span>
        <span>Скорость колёс: <b style="color:${P.cyan}">${Math.round(whl / 84 * 60)}</b></span>
        <span>Нагрев диска: <b style="color:${heatV > .6 ? P.red : P.text}">${Math.round(heatV * 100)}%</b></span>`;
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  };

  /* ---------------------------------------------------------- КОРОБКА ПЕРЕДАЧ */
  Widgets.gearbox = function (container) {
    const { svg, controls } = shell(container, '⚙️ Коробка передач: подбор передаточного числа', 'Lada Granta · 5-МКПП', 300);
    const ratios = [0, 3.636, 1.95, 1.357, 0.941, 0.784]; // Lada Granta (ВАЗ) 5-МКПП, передачи 1..5
    const gDrive = S('g'), gDriven = S('g'); svg.appendChild(gDriven); svg.appendChild(gDrive);
    const lbl = S('text', { x: 320, y: 280, fill: P.text, 'font-size': 16, 'text-anchor': 'middle', 'font-weight': 700 }, ''); svg.appendChild(lbl);
    svg.appendChild(S('text', { x: 180, y: 40, fill: P.mut, 'font-size': 12, 'text-anchor': 'middle', 'font-family': 'JetBrains Mono' }, 'ДВИГАТЕЛЬ'));
    svg.appendChild(S('text', { x: 470, y: 40, fill: P.mut, 'font-size': 12, 'text-anchor': 'middle', 'font-family': 'JetBrains Mono' }, 'КОЛЁСА'));
    const out = readout(controls);
    let gear = 1, speed = 10;
    const gearI = slider(controls, 'Передача', 1, 5, 1, 1, v => { gear = v; return v + '-я'; });
    const speedI = slider(controls, 'Скорость', 0, 120, 10, 1, v => { speed = v; return v + ' км/ч'; });
    function gearTeeth(cx, cy, r, color, ang) {
      let s = `<g transform="rotate(${ang} ${cx} ${cy})">`;
      const n = Math.max(8, Math.round(r / 4));
      for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r; s += `<rect x="${x - 3}" y="${y - 3}" width="6" height="6" fill="${color}" transform="rotate(${a * 180 / Math.PI} ${x} ${y})"/>`; }
      s += `<circle cx="${cx}" cy="${cy}" r="${r - 6}" fill="${P.surf}" stroke="${color}" stroke-width="3"/><circle cx="${cx}" cy="${cy}" r="6" fill="${color}"/></g>`;
      return s;
    }
    let a = 0, last = performance.now(), raf;
    function frame(now) {
      const dt = Math.min((now - last) / 1000, 0.05); last = now;
      const ratio = ratios[gear];
      let rpm = Math.round(speed * ratio * 31);   // обороты ~ скорость × передаточное число (без фальшивого пола)
      const wheelR = 70, driveR = Math.max(22, wheelR / ratio);
      a += dt * (speed + 4) * 1.5;
      gDrive.innerHTML = gearTeeth(180, 150, driveR, P.amber, a * ratio);
      gDriven.innerHTML = gearTeeth(180 + driveR + wheelR + 2, 150, wheelR, P.cyan, -a);
      let msg, col;
      if (speed === 0) {
        rpm = 800;  // холостой ход, сцепление выжато
        if (gear === 1) { msg = '🟢 Стоим. Трогаемся с 1-й — она даёт максимум силы'; col = P.green; }
        else { msg = '🟡 Стоим. Трогаться надо с 1-й, а не с ' + gear + '-й — заглохнешь'; col = P.amber; }
      } else if (rpm < 800) {
        msg = '🔴 Обороты ниже холостых — мотор задыхается и заглохнет, переключись ВНИЗ'; col = P.red;
      } else if (rpm > 5500) {
        msg = '🔴 Перекрут — пора переключаться ВВЕРХ'; col = P.red;
      } else if (rpm > 4300) {
        msg = '🟡 Обороты высоковаты — можно повысить передачу'; col = P.amber;
      } else if (rpm < 1300) {
        msg = '🟡 Низковато — мотор вяло «тянет», для разгона лучше передачу ниже'; col = P.amber;
      } else {
        msg = '🟢 Передача подобрана хорошо'; col = P.green;
      }
      lbl.textContent = msg; lbl.setAttribute('fill', col);
      out.innerHTML = `<span>Обороты двигателя: <b style="color:${col}">${rpm}</b> об/мин</span>
        <span>Передаточное число: <b style="color:${P.cyan}">${ratio.toFixed(1)}:1</b></span>
        <span>1 оборот колеса = <b>${ratio.toFixed(1)}</b> оборота мотора</span>`;
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  };

  /* ---------------------------------------------------------- 4-ТАКТНЫЙ ДВИГАТЕЛЬ */
  Widgets.engine4 = function (container) {
    const { svg, controls } = shell(container, '🔥 Четырёхтактный двигатель: впуск-сжатие-рабочий ход-выпуск', 'ВАЗ 1.6 · 8 кл · 90 л.с.', 320);
    const strokes = [
      { name: '1. Впуск', desc: 'Поршень идёт вниз, впускной клапан открыт — цилиндр засасывает смесь воздуха и бензина.', color: P.cyan },
      { name: '2. Сжатие', desc: 'Оба клапана закрыты, поршень идёт вверх и сжимает смесь — давление и температура растут.', color: P.amber },
      { name: '3. Рабочий ход', desc: 'Свеча даёт искру, смесь взрывается и толкает поршень вниз — вот эта работа и крутит колёса.', color: P.red },
      { name: '4. Выпуск', desc: 'Выпускной клапан открыт, поршень идёт вверх и выталкивает отработавшие газы.', color: P.mut },
    ];
    const cyl = S('g'); svg.appendChild(cyl);
    const nameT = S('text', { x: 360, y: 80, fill: P.text, 'font-size': 20, 'font-weight': 800 }, ''); svg.appendChild(nameT);
    const descT = S('foreignObject', { x: 320, y: 95, width: 300, height: 180 }); svg.appendChild(descT);
    const out = readout(controls);
    let speed = 50, playing = true, ang = 0;
    const speedI = slider(controls, 'Скорость', 5, 100, 50, 1, v => { speed = v; return v + '%'; });
    const playBtn = button(controls, '⏸ Пауза', 'btn--primary');
    playBtn.onclick = () => { playing = !playing; playBtn.textContent = playing ? '⏸ Пауза' : '▶ Пуск'; };
    let last = performance.now(), raf;
    function frame(now) {
      const dt = Math.min((now - last) / 1000, 0.05); last = now;
      if (playing) ang += dt * speed * 0.04;
      const cycle = ang % (Math.PI * 4);           // 2 crank revs = 1 cycle = 4*PI? use 4 strokes over 4*PI
      const strokeIdx = Math.floor(cycle / Math.PI) % 4;
      const st = strokes[strokeIdx];
      // piston: top at compression top; y from crank
      const pistonY = 150 + Math.cos(cycle / 2) * 60; // 90..210 roughly mapping
      const intakeOpen = strokeIdx === 0, exhaustOpen = strokeIdx === 3;
      const cx = 150;
      let mix = strokeIdx === 0 ? P.cyan : strokeIdx === 1 ? P.amber : strokeIdx === 2 ? P.red : '#33405a';
      cyl.innerHTML =
        `<rect x="${cx - 50}" y="70" width="100" height="170" rx="8" fill="${P.surf}" stroke="${P.line}" stroke-width="3"/>
         <rect x="${cx - 44}" y="${pistonY}" width="88" height="${238 - pistonY}" fill="${mix}" opacity=".18"/>
         <!-- valves -->
         <line x1="${cx - 26}" y1="${intakeOpen ? 82 : 70}" x2="${cx - 26}" y2="55" stroke="${P.cyan}" stroke-width="6" stroke-linecap="round"/>
         <text x="${cx - 26}" y="48" fill="${P.cyan}" font-size="10" text-anchor="middle">впуск</text>
         <line x1="${cx + 26}" y1="${exhaustOpen ? 82 : 70}" x2="${cx + 26}" y2="55" stroke="${P.mut}" stroke-width="6" stroke-linecap="round"/>
         <text x="${cx + 26}" y="48" fill="${P.mut}" font-size="10" text-anchor="middle">выпуск</text>
         <!-- spark -->
         ${strokeIdx === 2 && (cycle % Math.PI) < 0.4 ? `<circle cx="${cx}" cy="78" r="9" fill="${P.amber}"/><circle cx="${cx}" cy="78" r="16" fill="none" stroke="${P.amber}" stroke-width="2" opacity=".6"/>` : `<circle cx="${cx}" cy="78" r="4" fill="${P.line}"/>`}
         <!-- piston -->
         <rect x="${cx - 44}" y="${pistonY}" width="88" height="34" rx="4" fill="${P.amber}" stroke="#1a1100" stroke-width="2"/>
         <!-- rod + crank -->
         <line x1="${cx}" y1="${pistonY + 30}" x2="${cx + Math.sin(cycle / 2) * 34}" y2="290" stroke="${P.text}" stroke-width="5"/>
         <circle cx="${cx}" cy="290" r="34" fill="none" stroke="${P.line}" stroke-width="4"/>
         <circle cx="${cx + Math.sin(cycle / 2) * 34}" cy="${290 - Math.cos(cycle / 2) * 34}" r="7" fill="${P.cyan}"/>
         <circle cx="${cx}" cy="290" r="6" fill="${P.text}"/>`;
      nameT.textContent = st.name; nameT.setAttribute('fill', st.color);
      descT.innerHTML = `<div xmlns="http://www.w3.org/1999/xhtml" style="color:${P.text};font:14px Manrope;line-height:1.5">${st.desc}</div>`;
      out.innerHTML = `<span style="color:${P.mut}">Только <b style="color:${P.red}">3-й такт</b> даёт энергию — остальные три «живут» за счёт инерции маховика и других цилиндров.</span>`;
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  };

  /* ---------------------------------------------------------- ТОРМОЗА / ABS */
  Widgets.brakes = function (container) {
    const { svg, controls } = shell(container, '🛑 Торможение и ABS: почему заблокированное колесо не рулит', 'Lada Granta', 300);
    svg.appendChild(S('rect', { x: 0, y: 210, width: 640, height: 90, fill: P.road }));
    for (let i = 0; i < 16; i++) svg.appendChild(S('rect', { x: i * 44, y: 250, width: 24, height: 5, fill: P.line }));
    const carNo = S('g'), carAbs = S('g'), tip = S('text', { x: 320, y: 30, fill: P.text, 'font-size': 14, 'text-anchor': 'middle', 'font-weight': 700 }, ''); svg.appendChild(carNo); svg.appendChild(carAbs); svg.appendChild(tip);
    const out = readout(controls);
    let brake = 60, running = false;
    const brakeI = slider(controls, 'Сила торможения', 10, 100, 60, 1, v => { brake = v; return v + '%'; });
    const goBtn = button(controls, '🚗 Затормозить с поворотом руля', 'btn--primary');
    let noX, absX, noW, absW, noWheelLock, t, raf;
    function reset() { noX = 70; absX = 70; noW = 0; absW = 0; t = 0; running = true; }
    goBtn.onclick = reset;
    let last = performance.now();
    function carSVG(x, y, color, wheelAng, steer, skid) {
      return `<g transform="translate(${x},${y})">
        ${skid ? `<line x1="-60" y1="34" x2="6" y2="34" stroke="${P.red}" stroke-width="4" opacity=".7"/>` : ''}
        <rect x="0" y="0" width="78" height="34" rx="9" fill="${color}"/>
        <rect x="14" y="-15" width="42" height="20" rx="7" fill="${color}" opacity=".85"/>
        <g transform="translate(60,34) rotate(${steer})"><circle r="11" fill="#10131c" stroke="${P.text}" stroke-width="2"/><line x1="0" y1="0" x2="${Math.cos(wheelAng) * 8}" y2="${Math.sin(wheelAng) * 8}" stroke="${P.amber}" stroke-width="2.5"/></g>
        <g transform="translate(16,34)"><circle r="11" fill="#10131c" stroke="${P.text}" stroke-width="2"/><line x1="0" y1="0" x2="${Math.cos(wheelAng) * 8}" y2="${Math.sin(wheelAng) * 8}" stroke="${P.amber}" stroke-width="2.5"/></g></g>`;
    }
    function frame(now) {
      const dt = Math.min((now - last) / 1000, 0.05); last = now;
      if (running) {
        t += dt;
        const decel = brake * 1.3;
        // no ABS: wheels lock -> slides straight, longer distance, no steering
        const lockSlide = brake > 55 ? 1 : 0;
        noW = lockSlide ? noW : noW + (180) * dt; // locked wheel stops spinning
        noX += Math.max(0, 150 - t * decel * (lockSlide ? 0.7 : 1.0)) * dt;
        // ABS: wheel keeps rolling (pulsing), shorter distance, can steer
        absW += (200 - brake) * dt + 60 * dt;
        absX += Math.max(0, 150 - t * decel * 1.15) * dt;
        if (t > 4) running = false;
      }
      const lock = brake > 55;
      carNo.innerHTML = carSVG(noX, 176, P.red, noW, lock && running ? 0 : 0, lock && running);
      carAbs.innerHTML = carSVG(absX, 120, P.green, absW, running ? -18 : 0, false);
      svg.querySelector('.lblNo')?.remove();
      tip.textContent = lock ? 'Сильно жмёшь: без ABS колёса заблокированы' : 'ABS дозирует тормоз — колесо не блокируется';
      out.innerHTML = `<span><b style="color:${P.red}">Без ABS:</b> колесо заблокировано → скользит юзом, руль не слушается (едет прямо), тормозной путь длиннее.</span>
        <span><b style="color:${P.green}">С ABS:</b> тормоз «пульсирует», колесо катится на грани → сохраняется сцепление и управляемость, можно объехать.</span>`;
      raf = requestAnimationFrame(frame);
    }
    reset(); running = false; noX = 70; absX = 70;
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  };

  /* ---------------------------------------------------------- РЕГУЛИРОВЩИК */
  Widgets.regulator = function (container) {
    const { svg, controls } = shell(container, '👮 Регулировщик: жесты и что они значат', 'интерактив', 300);
    const fig = S('g'); svg.appendChild(fig);
    const info = S('foreignObject', { x: 300, y: 40, width: 320, height: 230 }); svg.appendChild(info);
    const states = {
      sides: { title: 'Руки вытянуты в стороны или опущены', arms: 'sides',
        rules: [['Со стороны груди и спины', 'СТОП — движение запрещено', P.red],
                ['Со стороны левого/правого бока', 'Прямо и направо (трамвай — прямо)', P.green]],
        mnemo: '«Грудь и спина — стена». Бок открыт — едешь прямо и направо.' },
      front: { title: 'Правая рука вытянута вперёд', arms: 'front',
        rules: [['Со стороны груди', 'Только направо', P.amber],
                ['Со стороны левого бока', 'В любом направлении', P.green],
                ['Со стороны правого бока и сзади', 'СТОП', P.red]],
        mnemo: '«Палка смотрит в рот — делай правый поворот» (если регулировщик к тебе грудью).' },
      up: { title: 'Рука поднята вверх', arms: 'up',
        rules: [['Для всех направлений', 'СТОП — приготовиться (как жёлтый сигнал)', P.red]],
        mnemo: 'Рука вверх = «внимание», движение запрещено всем.' },
    };
    let cur = 'sides';
    function drawFig(kind, armPhase) {
      const cx = 150, cy = 150;
      let arms = '';
      if (kind === 'sides') arms = `<line x1="${cx}" y1="120" x2="${cx - 55}" y2="120" stroke="${P.amber}" stroke-width="7" stroke-linecap="round"/><line x1="${cx}" y1="120" x2="${cx + 55}" y2="120" stroke="${P.amber}" stroke-width="7" stroke-linecap="round"/>`;
      else if (kind === 'front') arms = `<line x1="${cx}" y1="120" x2="${cx + 58}" y2="115" stroke="${P.amber}" stroke-width="7" stroke-linecap="round"/><line x1="${cx}" y1="120" x2="${cx - 20}" y2="150" stroke="${P.amber}" stroke-width="7" stroke-linecap="round"/>`;
      else arms = `<line x1="${cx}" y1="120" x2="${cx + 14}" y2="${70 - armPhase * 8}" stroke="${P.amber}" stroke-width="7" stroke-linecap="round"/><line x1="${cx}" y1="120" x2="${cx - 20}" y2="150" stroke="${P.amber}" stroke-width="7" stroke-linecap="round"/>`;
      return `<circle cx="${cx}" cy="92" r="18" fill="${P.surf}" stroke="${P.text}" stroke-width="3"/>
        <rect x="${cx - 18}" y="108" width="36" height="58" rx="10" fill="${P.cyan}" opacity=".9"/>
        ${arms}
        <line x1="${cx - 9}" y1="166" x2="${cx - 9}" y2="215" stroke="${P.text}" stroke-width="7" stroke-linecap="round"/>
        <line x1="${cx + 9}" y1="166" x2="${cx + 9}" y2="215" stroke="${P.text}" stroke-width="7" stroke-linecap="round"/>
        <text x="${cx}" y="250" fill="${P.mut}" font-size="12" text-anchor="middle">ты смотришь на него спереди</text>`;
    }
    function render() {
      const s = states[cur];
      let rows = s.rules.map(r => `<div style="display:flex;gap:8px;margin:6px 0;align-items:flex-start">
        <span style="color:${P.mut};font-size:13px;flex:1">${r[0]}</span>
        <span style="color:${r[2]};font-weight:700;font-size:13px;flex:1">${r[1]}</span></div>`).join('');
      info.innerHTML = `<div xmlns="http://www.w3.org/1999/xhtml" style="font-family:Manrope">
        <div style="font-weight:800;font-size:15px;color:${P.text};margin-bottom:8px">${s.title}</div>
        ${rows}
        <div style="margin-top:12px;padding:10px;background:${P.surf};border-radius:8px;border-left:3px solid ${P.amber};font-size:13px;color:${P.amber}">🎯 ${s.mnemo}</div></div>`;
    }
    let phase = 0, raf, last = performance.now();
    function frame(now) { const dt = (now - last) / 1000; last = now; phase = (Math.sin(now / 400) + 1) / 2; fig.innerHTML = drawFig(states[cur].arms, phase); raf = requestAnimationFrame(frame); }
    [['sides', 'Руки в стороны'], ['front', 'Рука вперёд'], ['up', 'Рука вверх']].forEach(([k, t]) => {
      const b = button(controls, t, k === cur ? 'btn--primary' : '');
      b.onclick = () => { cur = k; [...controls.querySelectorAll('.btn')].forEach(x => x.classList.remove('btn--primary')); b.classList.add('btn--primary'); render(); };
    });
    render(); raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  };

  /* ---------------------------------------------------------- ПЕРЕКРЁСТОК: ПОМЕХА СПРАВА */
  Widgets.intersection = function (container) {
    const { svg, controls } = shell(container, '🚦 Равнозначный перекрёсток: правило «помеха справа»', 'интерактив', 320);
    // roads
    svg.appendChild(S('rect', { x: 0, y: 0, width: 640, height: 320, fill: P.road }));
    svg.appendChild(S('rect', { x: 250, y: 0, width: 140, height: 320, fill: '#161c2a' }));
    svg.appendChild(S('rect', { x: 0, y: 110, width: 640, height: 100, fill: '#161c2a' }));
    [60, 180].forEach(() => { }); // markings
    for (let y = 10; y < 320; y += 40) if (y < 110 || y > 210) svg.appendChild(S('rect', { x: 317, y: y, width: 6, height: 20, fill: P.amber, opacity: .5 }));
    for (let x = 10; x < 640; x += 40) if (x < 250 || x > 390) svg.appendChild(S('rect', { x: x, y: 158, width: 20, height: 6, fill: P.amber, opacity: .5 }));
    const cars = S('g'); svg.appendChild(cars);
    const tip = S('foreignObject', { x: 410, y: 12, width: 220, height: 120 }); svg.appendChild(tip);
    const out = readout(controls);
    // you: from bottom going straight (blue). other: choose side.
    let from = 'right', running = false, t = 0, raf;
    function carRect(x, y, w, h, color, rot) { return `<g transform="translate(${x},${y}) rotate(${rot || 0})"><rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="7" fill="${color}"/><rect x="${-w / 2 + 4}" y="${-h / 2 + (h > w ? 5 : 0)}" width="${h > w ? w - 8 : 14}" height="${h > w ? 12 : h - 8}" rx="4" fill="#000" opacity=".25"/></g>`; }
    function yields() { // does YOUR car yield? you go straight from bottom (upwards)
      // помеха справа: yield to car coming from your right. Your right (going up) = the east side (from right of screen? you're going up, your right hand points to +x = right side of screen). Car "from right" approaches from +x moving left -> it is on your right -> you YIELD.
      if (from === 'right') return true;     // car from your right -> yield
      if (from === 'left') return false;     // car from your left -> you go (it yields to you)
      if (from === 'oncoming') return false; // both straight, no conflict (simplify)
      return false;
    }
    const goBtn = button(controls, '▶ Поехали', 'btn--primary');
    goBtn.onclick = () => { t = 0; running = true; };
    [['right', 'Встречный — справа'], ['left', 'Встречный — слева'], ['oncoming', 'Встречный — навстречу']].forEach(([k, label]) => {
      const b = button(controls, label, k === from ? 'btn--primary' : '');
      b.onclick = () => { from = k; running = false; t = 0; [...controls.querySelectorAll('.btn')].forEach(x => { if (x !== goBtn) x.classList.remove('btn--primary'); }); b.classList.add('btn--primary'); draw(); };
    });
    let last = performance.now();
    function positions() {
      // returns {you:{x,y}, other:{x,y,rot}}
      const youYield = yields();
      let youY = 300, ox = 320, oy = 160, orot = 0;
      const speed = 70;
      if (from === 'right') { ox = 600; orot = 90; }
      else if (from === 'left') { ox = 40; orot = 90; }
      else { oy = 20; orot = 0; }
      if (running) {
        if (youYield) {
          // other goes first through center, then you
          if (from === 'right') ox = 600 - Math.min(t * speed, 320);
          else if (from === 'left') ox = 40 + Math.min(t * speed, 320);
          else oy = 20 + Math.min(t * speed, 320);
          youY = t > 2.4 ? 300 - Math.max(0, (t - 2.4) * speed) : 300;
        } else {
          youY = 300 - Math.min(t * speed, 320);
          // other waits then goes
          const wait = from === 'oncoming' ? 0 : 2.4;
          if (from === 'right') ox = 600 - Math.max(0, (t - wait) * speed);
          else if (from === 'left') ox = 40 + Math.max(0, (t - wait) * speed);
          else oy = 20 + Math.min(t * speed, 320);
        }
      }
      return { youY, ox, oy, orot, youYield };
    }
    function draw() {
      const p = positions();
      let other;
      if (from === 'oncoming') other = carRect(p.ox, p.oy, 30, 52, P.red, 180);
      else other = carRect(p.ox, p.oy, 52, 30, P.red, 0);
      cars.innerHTML = carRect(320, p.youY, 30, 52, P.cyan, 0) + other;
      const youYield = yields();
      const msg = from === 'oncoming'
        ? 'Встречный прямо — траектории не пересекаются, едете оба.'
        : youYield
          ? '⚠️ Машина справа от тебя → ты обязан уступить. Сначала она.'
          : '✅ Машина слева → помеха справа у неё. Первым едешь ты.';
      tip.innerHTML = `<div xmlns="http://www.w3.org/1999/xhtml" style="font:13px Manrope;color:${P.text};background:rgba(10,14,22,.85);padding:10px;border-radius:8px;border-left:3px solid ${youYield ? P.red : P.green}">
        <b>Ты</b> (синий) едешь прямо снизу.<br>${msg}</div>`;
      out.innerHTML = `<span style="color:${P.mut}">Принцип: на равнозначном перекрёстке (нет знаков, все «равны») уступаешь тому, кто <b style="color:${P.amber}">приближается справа</b> — потому что его ты хуже видишь и сложнее объехать.</span>`;
    }
    function frame(now) { const dt = (now - last) / 1000; last = now; if (running) { t += dt; if (t > 6) running = false; } draw(); raf = requestAnimationFrame(frame); }
    draw(); raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  };

  /* ---------------------------------------------------------- ГАБАРИТЫ / ПАРКОВКА */
  Widgets.dimensions = function (container) {
    const { svg, controls } = shell(container, '📐 Габариты Гранты и чувство места при парковке', 'Lada Granta', 300);
    const SC = 78;                       // px на метр
    const carL = 4.27, carW = 1.70;      // Lada Granta
    const g = S('g'); svg.appendChild(g);
    const out = readout(controls);
    let space = 5.5;
    slider(controls, 'Длина места для параллельной парковки', 4.4, 7.5, 5.5, 0.1, v => { space = v; draw(); return v.toFixed(1) + ' м'; });
    function draw() {
      const cx = 320, curbY = 70, carLpx = carL * SC, carWpx = carW * SC;
      const carTop = curbY + 18, carBot = carTop + carWpx;
      const slotPx = space * SC, slotL = cx - slotPx / 2, slotR = cx + slotPx / 2;
      const marginEach = (space - carL) / 2;
      let col, msg;
      if (space < carL + 0.4) { col = P.red; msg = '🔴 Не влезает — места меньше машины с минимальным запасом'; }
      else if (space < carL + 1.0) { col = P.amber; msg = '🟡 Впритык — придётся «вкатываться» в несколько приёмов'; }
      else { col = P.green; msg = '🟢 Влезает свободно — есть запас спереди и сзади'; }
      const parked = (x1, x2) => `<rect x="${x1}" y="${carTop}" width="${x2 - x1}" height="${carWpx}" rx="10" fill="#2a3346" stroke="${P.line}" stroke-width="2"/>`;
      g.innerHTML =
        `<rect x="0" y="0" width="640" height="${curbY}" fill="#10131c"/>
         <line x1="0" y1="${curbY}" x2="640" y2="${curbY}" stroke="${P.amber}" stroke-width="3" stroke-dasharray="2 0"/>
         <text x="12" y="${curbY - 8}" fill="${P.mut}" font-size="12">бордюр</text>
         ${parked(slotL - 150, slotL - 6)} ${parked(slotR + 6, slotR + 150)}
         <!-- slot bracket -->
         <line x1="${slotL}" y1="${curbY + 6}" x2="${slotR}" y2="${curbY + 6}" stroke="${col}" stroke-width="2"/>
         <text x="${cx}" y="${curbY + 2}" fill="${col}" font-size="12" text-anchor="middle" font-family="JetBrains Mono">место ${space.toFixed(1)} м</text>
         <!-- Granta -->
         <g transform="translate(${cx - carLpx / 2},${carTop})">
           <rect x="0" y="0" width="${carLpx}" height="${carWpx}" rx="13" fill="${P.amber}" opacity=".92"/>
           <rect x="${carLpx * 0.18}" y="6" width="${carLpx * 0.5}" height="${carWpx - 12}" rx="8" fill="#1a1100" opacity=".25"/>
           <rect x="-7" y="${carWpx / 2 - 9}" width="6" height="18" fill="${P.cyan}"/><rect x="${carLpx + 1}" y="${carWpx / 2 - 9}" width="6" height="18" fill="${P.cyan}"/>
         </g>
         <!-- dimension labels -->
         <text x="${cx}" y="${carBot + 26}" fill="${P.text}" font-size="13" text-anchor="middle" font-family="JetBrains Mono">длина ${carL} м</text>
         <text x="${cx - carLpx / 2 - 16}" y="${carTop + carWpx / 2}" fill="${P.text}" font-size="13" text-anchor="middle" font-family="JetBrains Mono" transform="rotate(-90 ${cx - carLpx / 2 - 16} ${carTop + carWpx / 2})">ширина ${carW} м</text>
         <text x="320" y="${carBot + 56}" fill="${col}" font-size="15" text-anchor="middle" font-weight="700">${msg}</text>`;
      out.innerHTML = `<span style="color:${P.mut}">Гранта <b style="color:${P.amber}">${carL}×${carW} м</b>. Для параллельной парковки удобно от <b style="color:${P.green}">~${(carL + 1.1).toFixed(1)} м</b> (запас ~0.5 м спереди и сзади). Запас сейчас: <b style="color:${col}">${marginEach > 0 ? marginEach.toFixed(2) : 0} м</b> с каждой стороны.</span>`;
    }
    draw();
    return () => {};
  };

  window.Widgets = Widgets;
})();
