// HTML template for the RunJS architecture visualization widget.
// Matches the n8n "RunJS template" code node exactly.
// buildRunJsHtml injects the NODES/CONNECTIONS/STEPS JSON and lesson title
// into the template and returns a complete self-contained HTML document.

// Use .replace() callbacks (not template interpolation) so the JSON/title
// strings never accidentally contain $-patterns that confuse String.replace.
export function buildRunJsHtml(sceneData: object, title: string): string {
  const jsonStr = JSON.stringify(sceneData).replace(/</g, '\\u003c');
  const safeTitle = String(title || 'Architecture Visualization')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  return HTML_TEMPLATE
    .replace('__INJECT_JSON_HERE__', () => jsonStr)
    .replace('__TOPIC_TITLE__', () => safeTitle);
}

// ---------------------------------------------------------------------------
// Template — do NOT edit the placeholder strings
// ---------------------------------------------------------------------------

const HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>Dynamic Architecture</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root {
  --bg-primary:#0a0e1a;--bg-secondary:#111827;--bg-card:#1a1f35;--bg-card-hover:#222845;
  --border-subtle:rgba(99,102,241,.18);--border-glow:rgba(99,102,241,.45);
  --text-primary:#f1f5f9;--text-secondary:#94a3b8;--text-muted:#64748b;
  --accent-indigo:#818cf8;--accent-cyan:#22d3ee;--accent-emerald:#34d399;
  --accent-amber:#fbbf24;--accent-rose:#fb7185;--accent-violet:#a78bfa;
  --accent-orange:#fb923c;--accent-sky:#38bdf8;
  --glow-indigo:0 0 24px rgba(99,102,241,.35);--glow-cyan:0 0 24px rgba(34,211,238,.35);
  --glow-emerald:0 0 24px rgba(52,211,153,.35);--glow-amber:0 0 24px rgba(251,191,36,.35);
  --glow-rose:0 0 24px rgba(251,113,133,.35);
  --radius-sm:8px;--radius-md:14px;--radius-lg:20px;
  --font-sans:'Inter',system-ui,-apple-system,sans-serif;
  --font-mono:'JetBrains Mono','Fira Code',monospace;
  --transition-fast:.18s cubic-bezier(.4,0,.2,1);--transition-smooth:.35s cubic-bezier(.4,0,.2,1);
  --node-size:52px;--node-icon-size:28px;
}
[data-theme="light"] {
  --bg-primary:#f0f2f8;--bg-secondary:#ffffff;--bg-card:#ffffff;--bg-card-hover:#f8f9fc;
  --border-subtle:rgba(99,102,241,.15);--border-glow:rgba(99,102,241,.35);
  --text-primary:#1e293b;--text-secondary:#475569;--text-muted:#94a3b8;
  --accent-indigo:#6366f1;--accent-cyan:#0891b2;--accent-emerald:#059669;
  --accent-amber:#d97706;--accent-rose:#e11d48;--accent-violet:#7c3aed;
  --accent-orange:#ea580c;--accent-sky:#0284c7;
  --glow-indigo:0 0 20px rgba(99,102,241,.18);--glow-cyan:0 0 20px rgba(34,211,238,.18);
  --glow-emerald:0 0 20px rgba(52,211,153,.18);--glow-amber:0 0 20px rgba(251,191,36,.18);
  --glow-rose:0 0 20px rgba(251,113,133,.18);
}
@media(max-width:600px){:root{--node-size:40px;--node-icon-size:20px;}}
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box;}
html{scroll-behavior:smooth;}
body{
  font-family:var(--font-sans);background:var(--bg-primary);color:var(--text-primary);
  height:100vh;overflow:hidden;display:flex;justify-content:center;
  -webkit-font-smoothing:antialiased;transition:background .4s ease,color .4s ease;
}
body::before{
  content:'';position:fixed;inset:0;
  background:radial-gradient(ellipse 80% 60% at 50% -10%,rgba(99,102,241,.12) 0%,transparent 60%),
             radial-gradient(ellipse 60% 50% at 80% 100%,rgba(34,211,238,.08) 0%,transparent 50%);
  pointer-events:none;z-index:0;transition:opacity .4s ease;
}
[data-theme="light"] body::before{opacity:.35;}
.scene-wrapper{
  position:relative;z-index:1;width:100%;max-width:900px;margin:0 auto;
  padding:16px;display:flex;flex-direction:column;height:100vh;gap:12px;
}
.header{text-align:center;flex-shrink:0;}
.header h1{
  font-size:clamp(1rem,2.5vw,1.25rem);font-weight:800;letter-spacing:-.02em;
  background:linear-gradient(135deg,var(--accent-indigo),var(--accent-cyan));
  -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;
  margin-bottom:2px;
}
.controls{display:flex;justify-content:center;gap:6px;flex-wrap:wrap;flex-shrink:0;}
.btn{
  font-family:var(--font-sans);font-weight:600;font-size:.72rem;
  padding:5px 11px;border:1px solid var(--border-subtle);border-radius:999px;
  background:var(--bg-card);color:var(--text-primary);
  cursor:pointer;transition:var(--transition-fast);display:flex;align-items:center;gap:4px;
}
.btn:hover{border-color:var(--border-glow);box-shadow:var(--glow-indigo);transform:translateY(-1px);}
.btn.active{background:linear-gradient(135deg,rgba(99,102,241,.25),rgba(34,211,238,.15));border-color:var(--accent-indigo);}
.speed-control{display:flex;align-items:center;gap:5px;font-size:.7rem;color:var(--text-secondary);}
.speed-control input[type="range"]{width:70px;accent-color:var(--accent-indigo);cursor:pointer;}
.diagram-container{
  position:relative;width:100%;flex:1 1 auto;min-height:200px;
  background:var(--bg-secondary);border:1px solid var(--border-subtle);
  border-radius:var(--radius-md);overflow:hidden;box-shadow:0 2px 20px rgba(0,0,0,.4);
}
.diagram-container svg{position:absolute;inset:0;width:100%;height:100%;z-index:1;}
.node{
  position:absolute;display:flex;flex-direction:column;align-items:center;gap:6px;
  transition:var(--transition-smooth);z-index:3;cursor:default;
  transform:translate(-50%,calc(-50% - 16px));
}
.node:hover{transform:translate(-50%,calc(-50% - 16px)) scale(1.06);}
.node:hover .node-box{border-color:var(--border-glow);}
.node-box{
  width:var(--node-size);height:var(--node-size);border-radius:12px;border:1.5px solid var(--border-subtle);
  display:flex;align-items:center;justify-content:center;transition:var(--transition-fast);
  position:relative;overflow:hidden;background:rgba(255,255,255,.05);backdrop-filter:blur(8px);
}
.node-icon{width:var(--node-icon-size);height:var(--node-icon-size);object-fit:contain;position:relative;z-index:1;filter:drop-shadow(0 2px 4px rgba(0,0,0,.1));}
.node-label{font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text-primary);white-space:nowrap;text-align:center;}
.node--client .node-box{border-color:#818cf8;box-shadow:var(--glow-indigo);}
.node--gateway .node-box{border-color:#fb923c;box-shadow:0 0 24px rgba(234,88,12,.25);}
.node--service .node-box{border-color:#a78bfa;box-shadow:0 0 24px rgba(147,51,234,.2);}
.node--cache .node-box{border-color:#fb7185;box-shadow:var(--glow-rose);}
.node--db .node-box{border-color:#fbbf24;box-shadow:var(--glow-amber);}
.node--queue .node-box{border-color:#22d3ee;box-shadow:var(--glow-cyan);}
.node--worker .node-box{border-color:#34d399;box-shadow:var(--glow-emerald);}
.node--storage .node-box{border-color:#a3e635;box-shadow:0 0 24px rgba(163,230,53,.2);}
.node.active .node-box{animation:nodePulse 1.2s ease-in-out infinite;border-width:2.5px;}
@keyframes nodePulse{0%,100%{filter:brightness(1);}50%{filter:brightness(1.35);}}
.tooltip{
  position:fixed;background:var(--bg-card);border:1px solid var(--border-glow);
  border-radius:var(--radius-sm);padding:10px 14px;font-size:.72rem;
  color:var(--text-secondary);line-height:1.5;max-width:220px;
  pointer-events:none;opacity:0;transform:translateY(6px);
  transition:opacity .2s,transform .2s;z-index:9999;
  box-shadow:0 8px 32px rgba(0,0,0,.3);
}
[data-theme="light"] .tooltip{background:#ffffff;box-shadow:0 8px 32px rgba(0,0,0,.12);}
.tooltip.visible{opacity:1;transform:translateY(0);}
.tooltip-title{font-weight:700;color:var(--text-primary);margin-bottom:4px;font-size:.78rem;text-transform:uppercase;letter-spacing:.05em;}
.packet{position:absolute;width:16px;height:6px;border-radius:999px;pointer-events:none;z-index:10;opacity:0;transform-origin:center;}
.packet::after{content:'';position:absolute;inset:-3px;border-radius:inherit;background:inherit;filter:blur(4px);opacity:.8;}
.packet--request{background:var(--accent-cyan);}
.packet--response{background:var(--accent-emerald);}
.packet--cache{background:var(--accent-amber);}
.packet--error{background:var(--accent-rose);}
svg .connection-line{fill:none;stroke-width:2px;stroke-linecap:round;transition:opacity .3s,stroke-width .3s;}
[data-theme="light"] svg .connection-line{opacity:.75;}
[data-theme="dark"] svg .connection-line{opacity:.90;filter:drop-shadow(0 0 2px rgba(255,255,255,.1));}
svg .connection-line.active{opacity:1 !important;stroke-width:3px;filter:drop-shadow(0 0 4px currentColor);}
.narration{
  background:var(--bg-card);border:1px solid var(--border-subtle);
  border-radius:var(--radius-md);padding:16px 20px;
  min-height:100px;height:auto;display:flex;gap:16px;align-items:flex-start;flex-shrink:0;
}
.narration-step{
  flex-shrink:0;width:40px;height:40px;border-radius:8px;
  display:flex;align-items:center;justify-content:center;
  font-family:var(--font-mono);font-weight:800;font-size:1.1rem;
  background:linear-gradient(135deg,rgba(99,102,241,.2),rgba(34,211,238,.1));
  border:1px solid var(--border-subtle);color:var(--accent-cyan);
}
.narration-body{flex:1;}
.narration-title{font-size:1rem;font-weight:800;margin-bottom:6px;color:var(--text-primary);}
.narration-text{font-size:.85rem;line-height:1.6;color:var(--text-secondary);}
.narration-meta{margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;}
.narration-tag{font-size:.65rem;font-family:var(--font-mono);font-weight:600;padding:4px 12px;border-radius:999px;background:rgba(99,102,241,.12);color:var(--accent-indigo);border:1px solid rgba(99,102,241,.2);text-transform:uppercase;}
.progress-bar{height:4px;background:rgba(255,255,255,.06);border-radius:999px;overflow:hidden;flex-shrink:0;}
.progress-bar-fill{height:100%;border-radius:999px;background:linear-gradient(90deg,var(--accent-indigo),var(--accent-cyan));width:0%;transition:width .4s ease;}
.step-dots{display:flex;justify-content:center;gap:6px;flex-wrap:wrap;flex-shrink:0;}
.step-dot{width:8px;height:8px;border-radius:50%;background:rgba(255,255,255,.1);cursor:pointer;transition:var(--transition-fast);border:none;}
.step-dot.done{background:var(--accent-emerald);}
.step-dot.active{background:var(--accent-cyan);transform:scale(1.4);box-shadow:0 0 6px rgba(34,211,238,.5);}
.legend{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;flex-shrink:0;padding-bottom:4px;}
.legend-item{display:flex;align-items:center;gap:5px;font-size:.62rem;color:var(--text-muted);font-weight:600;text-transform:uppercase;}
.legend-dot{width:7px;height:7px;border-radius:50%;}
[data-theme="light"] .diagram-container{box-shadow:0 4px 48px rgba(99,102,241,.1);}
[data-theme="light"] .narration{box-shadow:0 2px 16px rgba(99,102,241,.06);}
[data-theme="light"] .step-dot{background:rgba(0,0,0,.1);}
[data-theme="light"] .progress-bar{background:rgba(0,0,0,.06);}
[data-theme="light"] .node-box{background:rgba(255,255,255,.9);backdrop-filter:blur(8px);box-shadow:0 2px 12px rgba(0,0,0,.08);}
[data-theme="light"] .btn{background:#ffffff;box-shadow:0 1px 4px rgba(0,0,0,.06);}
.theme-toggle{position:fixed;top:12px;right:16px;z-index:100;width:44px;height:24px;border-radius:999px;border:1.5px solid var(--border-subtle);background:var(--bg-card);cursor:pointer;transition:background .35s ease;display:flex;align-items:center;padding:0 3px;}
.theme-toggle-track{position:relative;width:100%;height:100%;}
.theme-toggle-thumb{position:absolute;top:50%;left:0;transform:translateY(-50%);width:16px;height:16px;border-radius:50%;background:linear-gradient(135deg,#312e81,#6366f1);display:flex;align-items:center;justify-content:center;font-size:.6rem;transition:left .3s;}
[data-theme="light"] .theme-toggle-thumb{left:calc(100% - 16px);background:linear-gradient(135deg,#fbbf24,#f59e0b);}
</style>
</head>
<body>
<div class="scene-wrapper">
  <button class="theme-toggle" id="themeToggle" onclick="toggleTheme()">
    <div class="theme-toggle-track"><div class="theme-toggle-thumb" id="toggleThumb">☀️</div></div>
  </button>
  <header class="header"><h1 id="mTitle">__TOPIC_TITLE__</h1></header>
  <div class="controls" id="controls">
    <button class="btn" id="btnPlay" onclick="togglePlay()"><span id="playIcon">▶</span> Play</button>
    <button class="btn" onclick="stepPrev()">⏮ Prev</button>
    <button class="btn" onclick="stepNext()">⏭ Next</button>
    <button class="btn" onclick="resetAnim()">↺ Reset</button>
    <div class="speed-control">
      <label>Speed</label>
      <input type="range" id="speedRange" min="0.5" max="3" step="0.25" value="1" oninput="updateSpeed(this.value)">
      <span id="speedLabel">1×</span>
    </div>
  </div>
  <div class="diagram-container" id="diagram">
    <svg id="svgLayer" xmlns="http://www.w3.org/2000/svg"></svg>
  </div>
  <div class="narration" id="narration">
    <div class="narration-step" id="narrStep">0</div>
    <div class="narration-body">
      <div class="narration-title" id="narrTitle">Ready</div>
      <div class="narration-text" id="narrText">Press <strong>Play</strong> or use <strong>Spacebar / Arrow Keys</strong> to begin.</div>
      <div class="narration-meta" id="narrMeta"></div>
    </div>
  </div>
  <div class="progress-bar"><div class="progress-bar-fill" id="progressFill"></div></div>
  <div class="step-dots" id="stepDots"></div>
  <div class="legend">
    <div class="legend-item"><span class="legend-dot" style="background:var(--accent-cyan)"></span>Event / Request</div>
    <div class="legend-item"><span class="legend-dot" style="background:var(--accent-amber)"></span>Cache / Lookup</div>
    <div class="legend-item"><span class="legend-dot" style="background:var(--accent-emerald)"></span>Data Commit</div>
  </div>
</div>
<div class="tooltip" id="tooltip">
  <div class="tooltip-title" id="tooltipTitle"></div>
  <div id="tooltipBody"></div>
</div>
<script id="sceneData" type="application/json">__INJECT_JSON_HERE__</script>
<script>
(function(){
  var raw=document.getElementById('sceneData').textContent.trim();
  var SCENE_DATA={NODES:[],CONNECTIONS:[],STEPS:[]};
  if(raw&&raw!=='__INJECT_JSON_HERE__'){try{SCENE_DATA=JSON.parse(raw);}catch(e){console.error('JSON parse error:',e);}}
  var NODES=SCENE_DATA.NODES||[];
  var CONNECTIONS=SCENE_DATA.CONNECTIONS||[];
  var STEPS=SCENE_DATA.STEPS||[];
  var diagramEl=document.getElementById('diagram');
  var svgLayer=document.getElementById('svgLayer');
  var narrStep=document.getElementById('narrStep');
  var narrTitle=document.getElementById('narrTitle');
  var narrText=document.getElementById('narrText');
  var narrMeta=document.getElementById('narrMeta');
  var progressFill=document.getElementById('progressFill');
  var stepDotsEl=document.getElementById('stepDots');
  var tooltipEl=document.getElementById('tooltip');
  var tooltipTitle=document.getElementById('tooltipTitle');
  var tooltipBody=document.getElementById('tooltipBody');
  var nodeEls={};
  if(!STEPS||!STEPS.length){narrTitle.textContent='Data Error';narrText.innerHTML='No workflow data generated. Please regenerate.';}
  NODES.forEach(function(n){
    var div=document.createElement('div');
    div.className='node node--'+n.cls;
    div.id='node-'+n.id;
    div.innerHTML='<div class="node-box"><img class="node-icon" src="'+n.icon+'" alt="'+n.label+'" /></div><div class="node-label">'+n.label+'</div>';
    div.style.left=n.xPct+'%';
    div.style.top=n.yPct+'%';
    diagramEl.appendChild(div);
    nodeEls[n.id]=div;
    if(n.tip){
      div.addEventListener('mouseenter',function(){
        tooltipTitle.textContent=n.label;
        tooltipBody.textContent=n.tip;
        tooltipEl.classList.add('visible');
        var rect=div.getBoundingClientRect();
        var leftPos=rect.right+12;
        if(leftPos+240>window.innerWidth)leftPos=rect.left-252;
        tooltipEl.style.left=leftPos+'px';
        tooltipEl.style.top=rect.top+'px';
      });
      div.addEventListener('mouseleave',function(){tooltipEl.classList.remove('visible');});
    }
  });
  STEPS.forEach(function(_,i){
    var d=document.createElement('button');
    d.className='step-dot';
    d.onclick=function(){goToStep(i);};
    stepDotsEl.appendChild(d);
  });
  function getNodeCenter(id){
    var el=nodeEls[id];
    if(!el)return null;
    var box=el.querySelector('.node-box');
    var r=box.getBoundingClientRect();
    var cr=diagramEl.getBoundingClientRect();
    return{x:r.left+r.width/2-cr.left,y:r.top+r.height/2-cr.top};
  }
  window.drawConnections=function(){
    svgLayer.innerHTML='';
    var colors={client:'#818cf8',gateway:'#fb923c',service:'#a78bfa',cache:'#fb7185',db:'#fbbf24',queue:'#22d3ee',worker:'#34d399',storage:'#a3e635'};
    CONNECTIONS.forEach(function(c){
      var a=getNodeCenter(c.from),b=getNodeCenter(c.to);
      if(!a||!b)return;
      var dx=b.x-a.x,dy=b.y-a.y,dist=Math.sqrt(dx*dx+dy*dy);
      if(dist<5)return;
      var fromNode=NODES.find(function(n){return n.id===c.from;});
      var clr=colors[fromNode&&fromNode.cls]||'#818cf8';
      var line=document.createElementNS('http://www.w3.org/2000/svg','line');
      line.setAttribute('x1',a.x);line.setAttribute('y1',a.y);
      line.setAttribute('x2',b.x);line.setAttribute('y2',b.y);
      line.setAttribute('stroke',clr);
      line.classList.add('connection-line');
      line.dataset.from=c.from;line.dataset.to=c.to;
      svgLayer.appendChild(line);
    });
  };
  var resizeObserver=new ResizeObserver(function(){window.drawConnections();});
  resizeObserver.observe(diagramEl);
  window.addEventListener('resize',window.drawConnections);
  setTimeout(window.drawConnections,300);
  var currentStep=-1,playing=false,playTimer=null,speedMultiplier=1;
  var STEP_DURATION_BASE=3200;
  function animatePacket(fromId,toId,type){
    var a=getNodeCenter(fromId),b=getNodeCenter(toId);
    if(!a||!b)return;
    var angle=Math.atan2(b.y-a.y,b.x-a.x);
    var pkt=document.createElement('div');
    pkt.className='packet packet--'+type;
    diagramEl.appendChild(pkt);
    var dur=1200/speedMultiplier;
    var line=svgLayer.querySelector('line[data-from="'+fromId+'"][data-to="'+toId+'"],line[data-from="'+toId+'"][data-to="'+fromId+'"]');
    if(line)line.classList.add('active');
    var start=null;
    function tick(ts){
      if(!start)start=ts;
      var t=Math.min((ts-start)/dur,1);
      t=t<0.5?2*t*t:-1+(4-2*t)*t;
      var x=a.x+(b.x-a.x)*t,y=a.y+(b.y-a.y)*t;
      var stretch=1+(t<0.5?t*2:(1-t)*2);
      pkt.style.left=x+'px';pkt.style.top=y+'px';
      pkt.style.transform='translate(-50%,-50%) rotate('+angle+'rad) scaleX('+stretch+')';
      pkt.style.opacity=t<0.1?t/0.1:t>0.9?(1-t)/0.1:1;
      if(t<1)requestAnimationFrame(tick);
      else{pkt.remove();if(line)line.classList.remove('active');}
    }
    requestAnimationFrame(tick);
  }
  function goToStep(idx){
    if(idx<0||idx>=STEPS.length)return;
    currentStep=idx;
    var step=STEPS[idx];
    narrStep.textContent=idx+1;
    narrTitle.textContent=step.title;
    narrText.innerHTML=step.text;
    narrMeta.innerHTML=(step.tags||[]).map(function(t){return'<span class="narration-tag">'+t+'</span>';}).join('');
    document.querySelectorAll('.node').forEach(function(n){n.classList.remove('active');});
    (step.activeNodes||[]).forEach(function(id){if(nodeEls[id])nodeEls[id].classList.add('active');});
    if(step.packet)animatePacket(step.packet.from,step.packet.to,step.packet.type);
    progressFill.style.width=((idx+1)/STEPS.length*100)+'%';
    document.querySelectorAll('.step-dot').forEach(function(d,i){
      d.classList.remove('active','done');
      if(i<idx)d.classList.add('done');
      else if(i===idx)d.classList.add('active');
    });
  }
  window.goToStep=goToStep;
  document.addEventListener('keydown',function(e){
    if(e.target.tagName==='INPUT')return;
    if(e.key===' '){e.preventDefault();window.togglePlay();}
    if(e.key==='ArrowRight')window.stepNext();
    if(e.key==='ArrowLeft')window.stepPrev();
  });
  window.stepNext=function(){if(currentStep<STEPS.length-1)goToStep(currentStep+1);else window.pause();};
  window.stepPrev=function(){if(currentStep>0)goToStep(currentStep-1);};
  window.resetAnim=function(){
    window.pause();currentStep=-1;
    narrStep.textContent='0';narrTitle.textContent='Ready';
    narrText.innerHTML='Press <strong>Play</strong> or use <strong>Spacebar / Arrow Keys</strong> to begin.';
    narrMeta.innerHTML='';progressFill.style.width='0%';
    document.querySelectorAll('.node').forEach(function(n){n.classList.remove('active');});
    document.querySelectorAll('.step-dot').forEach(function(d){d.classList.remove('active','done');});
  };
  window.play=function(){playing=true;document.getElementById('btnPlay').classList.add('active');document.getElementById('playIcon').textContent='⏸';window.adv();};
  window.pause=function(){playing=false;clearTimeout(playTimer);document.getElementById('btnPlay').classList.remove('active');document.getElementById('playIcon').textContent='▶';};
  window.togglePlay=function(){if(playing)window.pause();else{if(currentStep>=STEPS.length-1)window.resetAnim();window.play();}};
  window.adv=function(){if(!playing)return;window.stepNext();if(currentStep<STEPS.length-1)playTimer=setTimeout(window.adv,STEP_DURATION_BASE/speedMultiplier);else setTimeout(function(){window.pause();},STEP_DURATION_BASE/speedMultiplier);};
  window.updateSpeed=function(v){speedMultiplier=parseFloat(v);document.getElementById('speedLabel').textContent=v+'x';};
  function applyTheme(theme){document.documentElement.setAttribute('data-theme',theme);var thumb=document.getElementById('toggleThumb');if(thumb)thumb.textContent=theme==='light'?'☀️':'🌙';localStorage.setItem('theme',theme);setTimeout(window.drawConnections,50);}
  window.toggleTheme=function(){var c=document.documentElement.getAttribute('data-theme')||'light';applyTheme(c==='light'?'dark':'light');};
  applyTheme(localStorage.getItem('theme')||'light');
})();
</script>
</body>
</html>`;
