'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync(require('node:path').join(__dirname, '..', 'Portrait Breakout.html'), 'utf8');

function extractFunction(name) {
  const marker = new RegExp('function\\s+' + name + '\\s*\\(');
  const match = marker.exec(html);
  assert.ok(match, 'missing production function: ' + name);
  const open = html.indexOf('{', match.index);
  let depth = 0, quote = null, lineComment = false, blockComment = false, escape = false;
  for (let i = open; i < html.length; i++) {
    const c = html[i], n = html[i + 1];
    if (lineComment) { if (c === '\n') lineComment = false; continue; }
    if (blockComment) { if (c === '*' && n === '/') { blockComment = false; i++; } continue; }
    if (quote) {
      if (escape) { escape = false; continue; }
      if (c === '\\') { escape = true; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '/' && n === '/') { lineComment = true; i++; continue; }
    if (c === '/' && n === '*') { blockComment = true; i++; continue; }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    if (c === '}' && --depth === 0) return html.slice(match.index, i + 1);
  }
  throw new Error('unclosed function: ' + name);
}

const productionFunctions = [
  'ringTipTaper', 'ringTipTaperSlope', 'ringInnerRadius', 'ringInnerRadiusSlope',
  'ringAimMode', 'ringAimNormal', 'updateRingSensor', 'updateRingState', 'beginRingSling', 'updateRingSling', 'tryReleaseRingSling', 'recordRingEvaluation', 'startRingCombo', 'advanceRingCombo', 'planRingSkill', 'updateRingPlanner', 'ringAimReflect', 'ringContact', 'paddleReflect', 'bouncePaddle'
].map(extractFunction).join('\n');

function harness() {
  const context = {
    Math, Number, Object, Infinity,
    clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)),
    shape: 'ring', state:'playing', W:800, H:844, time:0, autoPilot:false, aimPlan:null, levelType:()=>1,
    ringSling:{phase:'idle',focus:null,anchorX:0,targetX:0,dashDir:1,exitSide:-1,cyclesTarget:1,halfSwings:0,amplitude:0,dashStartX:0,dashDistance:0,dashProgress:0,releaseTimer:0,cooldown:0,phaseTime:0,lastCycles:0,lastAngle:0,abortReason:''},
    paddle: { x: 100, y: 500, w: 200, h: 20, vx: 0 },
    ball: { r: 8 },
    hitFx: null,
    ringMoodEvent: () => {}, ringMoodRandom: () => .5, beep: () => {}, particles: [],
    curse: {drunkT:0,friction:0}, PADDLE_MAX_V:900, FRICTION:.02, FRICTION_CAP:.3,
    baseSpeed: () => 300,
    ringSensor: {
      valid: false, speed: 0, speedRatio: 0, speedClass: 'stopped', acceleration: 0,
      speedTrend: 'stable', previousSpeed: null, previousObject: null, updatedAt: 0
    },
    ringPlanner:{skill:'recover',targetX:null,reason:'',confidence:0,focus:null,phase:'idle',updatedAt:0},
    ringCombo:{name:'idle',steps:[],index:0,focus:null,startedAt:0,reason:''},
    ringEvaluator:{requested:0,accepted:0,completed:0,cancelled:0,innerContacts:0,outerContacts:0,slows:0,boosts:0,guides:0,slingReleases:0,lastSpeed:0,lastSkill:'recover',events:[]},
    ringState: {
      valid: false, mode: 'attack', priority: 'normal', intent: 'boost',
      reason: '', confidence: 0, hold: 0, updatedAt: 0, focus: null
    }
  };
  const setup = `
    const RING_R=()=>paddle.w*.47;
    const RING_WALL=()=>Math.max(5,Math.min(paddle.h*.72,RING_R()*.22));
    const RING_GAP_HALF=()=>Math.asin(clamp(Math.max(1,ball.r*3)/RING_R(),0,.92));
    const ringAimOffset=rel=>clamp(rel,-.92,.92)*RING_R();
    function reflectScreenX(x,r){
      const lo=2+r,span=Math.max(1,(800-2-r)-lo);
      let m=(x-lo)%(2*span);if(m<0)m+=2*span;
      return lo+(m<=span?m:2*span-m);
    }
  `;
  vm.createContext(context);
  vm.runInContext(setup + productionFunctions + `
    globalThis.api={
      updateRingSensor,updateRingState,beginRingSling,updateRingSling,tryReleaseRingSling,recordRingEvaluation,startRingCombo,advanceRingCombo,planRingSkill,updateRingPlanner,ringAimReflect,ringAimMode,ringAimNormal,ringTipTaper,ringInnerRadius,ringInnerRadiusSlope,ringContact,
      get sensor(){return ringSensor},get state(){return ringState},get paddle(){return paddle},get ball(){return ball},
      get sling(){return ringSling},get planner(){return ringPlanner},get combo(){return ringCombo},get evaluator(){return ringEvaluator},set auto(v){autoPilot=v},set worldWidth(v){W=v},get worldWidth(){return W},set worldHeight(v){H=v},set aim(v){aimPlan=v},
      set shape(v){shape=v},get shape(){return shape}
    };
  `, context);
  return context.api;
}


test('main production script parses as JavaScript', () => {
  const start = html.indexOf('<script>'), end = html.lastIndexOf('</script>');
  assert.ok(start>=0 && end>start, 'expected the game script block');
  new vm.Script(html.slice(start+8,end));
});

test('ring ball still spawns and launches from the inner cavity floor', () => {
  assert.ok(html.includes('ball.y=cy+ringInnerRadius(Math.PI/2)-ball.r-2;'));
  assert.ok(html.includes('ball.y=cy+ringInnerRadius(Math.PI/2)-ball.r-1;'));
  assert.ok(html.includes('顶部缺口'));
});

test('speed classes cover crawl, slow, cruise, fast and extreme', () => {
  const h = harness(), o = {x:200,y:400,vx:0,vy:0,r:8};
  const cases = [[.2,'crawl'],[.5,'slow'],[1,'cruise'],[1.3,'fast'],[1.8,'extreme']];
  for (const [ratio, expected] of cases) {
    o.vx = 300 * ratio; o.vy = 0;
    assert.equal(h.updateRingSensor(0, o).speedClass, expected);
  }
});

test('sensor estimates acceleration and resets history on focus change', () => {
  const h = harness(), a = {x:200,y:400,vx:100,vy:0,r:8}, b = {x:200,y:400,vx:500,vy:0,r:8};
  h.updateRingSensor(.1, a);
  const rising = h.updateRingSensor(.1, Object.assign(a,{vx:180}));
  assert.ok(rising.acceleration > 0);
  const switched = h.updateRingSensor(.1, b);
  assert.equal(switched.acceleration, 0);
});

test('gap sensor distinguishes a centered pass, an offset pass and downward travel', () => {
  const h = harness(), o = {x:200,y:420,vx:0,vy:-120,r:8};
  const centered = h.updateRingSensor(0, o);
  assert.equal(centered.gapPassable, true);
  o.x = 260;
  const offset = h.updateRingSensor(0, o);
  assert.equal(offset.gapPassable, false);
  o.vy = 120;
  const downward = h.updateRingSensor(0, o);
  assert.equal(downward.gapEta, null);
});

test('sensor output remains finite for center and extreme coordinates', () => {
  const h = harness(), o = {x:200,y:426,vx:1e6,vy:-1e6,r:8};
  const s = h.updateRingSensor(0, o);
  for (const key of ['speed','speedRatio','radialDistance','radialVelocity','innerClearance','outerClearance','kineticIndex'])
    assert.ok(Number.isFinite(s[key]), key + ' must be finite');
});

test('ring state maps extreme/high speed to capture and low speed to boost', () => {
  const h = harness(), focus = {};
  const sensor = {valid:true,speedRatio:1.8,speedClass:'extreme',speedTrend:'stable',acceleration:0,gapEta:null,gapPassable:false,nextWall:null,etaInner:null,etaOuter:null};
  assert.equal(h.updateRingState(sensor,0,focus).mode, 'capture');
  assert.equal(h.state.intent, 'unload');
  sensor.speedRatio=.5; sensor.speedClass='slow';
  assert.equal(h.updateRingState(sensor,.3,focus).mode, 'attack');
  assert.equal(h.state.intent, 'boost');
});

test('ring state responds to acceleration trend, deceleration and gap guidance', () => {
  const h = harness(), focus = {};
  const sensor = {valid:true,speedRatio:1,speedClass:'cruise',speedTrend:'accelerating',acceleration:80,gapEta:null,gapPassable:false,nextWall:null,etaInner:null,etaOuter:null};
  assert.equal(h.updateRingState(sensor,0,focus).mode,'capture');
  sensor.speedTrend='decelerating';
  assert.equal(h.updateRingState(sensor,.3,focus).mode,'attack');
  sensor.gapEta=.1;sensor.gapPassable=true;
  h.updateRingState(sensor,0,focus);
  assert.equal(h.state.intent,'guide-through');
});

test('critical speed risk overrides the short strategy hold', () => {
  const h = harness(), focus = {};
  const sensor = {valid:true,speedRatio:.6,speedClass:'slow',speedTrend:'stable',acceleration:0,gapEta:null,gapPassable:false,nextWall:null,etaInner:null,etaOuter:null};
  h.updateRingState(sensor,0,focus);
  sensor.speedRatio=1.9;sensor.speedClass='extreme';
  assert.equal(h.updateRingState(sensor,.01,focus).mode,'capture');
});

test('wall contact windows raise priority', () => {
  const h = harness(), focus = {};
  const sensor = {valid:true,speedRatio:1,speedClass:'cruise',speedTrend:'stable',acceleration:0,gapEta:null,gapPassable:false,nextWall:'inner',etaInner:.08,etaOuter:null};
  assert.equal(h.updateRingState(sensor,0,focus).priority,'high');
});


test('sensor normalizes negative lower-half angles onto the continuous inner contour', () => {
  const h = harness(), cx=200, cy=426, radius=42;
  const left = {x:cx+radius*Math.cos(-2.5),y:cy+radius*Math.sin(-2.5),vx:0,vy:0,r:8};
  const actual = h.updateRingSensor(0,left).innerClearance;
  const expected = h.ringInnerRadius(-2.5+Math.PI*2)-8-radius;
  assert.ok(Math.abs(actual-expected)<1e-8, 'negative atan2 angle must map to the continuous contour interval');
});

test('inner contour and taper remain finite and smooth at gap tips', () => {
  const h = harness();
  for (let i=0;i<=720;i++) {
    const a=-Math.PI + i*Math.PI/360;
    assert.ok(Number.isFinite(h.ringTipTaper(a)));
    assert.ok(Number.isFinite(h.ringInnerRadius(a)));
    assert.ok(Number.isFinite(h.ringInnerRadiusSlope(a)));
    assert.ok(h.ringTipTaper(a)>=0 && h.ringTipTaper(a)<=1);
  }
});


test('hysteresis keeps mode and intent coherent while high-risk wall windows can override it', () => {
  const h = harness(), focus = {};
  const sensor = {valid:true,speedRatio:1.8,speedClass:'extreme',speedTrend:'stable',acceleration:0,gapEta:null,gapPassable:false,nextWall:null,etaInner:null,etaOuter:null};
  h.updateRingState(sensor,0,focus);
  sensor.speedRatio=.5;sensor.speedClass='slow';
  const held = h.updateRingState(sensor,.01,focus);
  assert.equal(held.mode,'capture');
  assert.equal(held.intent,'unload');
  sensor.nextWall='outer';sensor.etaOuter=.05;
  const urgent = h.updateRingState(sensor,.01,focus);
  assert.equal(urgent.mode,'attack');
  assert.equal(urgent.priority,'high');
});

test('sensor and state production functions do not write ball physics', () => {
  const sensor = extractFunction('updateRingSensor');
  const state = extractFunction('updateRingState');
  const forbidden = /(?:ball|focus|o)\.(?:x|y|vx|vy)\s*=/;
  assert.equal(forbidden.test(sensor), false);
  assert.equal(forbidden.test(state), false);
});

test('ring-specific controller is gated away from other paddle shapes', () => {
  const h = harness();
  h.shape='rect';
  const s = h.updateRingSensor(.016,{x:200,y:400,vx:0,vy:100,r:8});
  assert.equal(s.valid,false);
  assert.equal(h.updateRingState(s,.016,{}).valid,false);
});


test('inner wall soft contact dissipates speed while retaining a valid response', () => {
  const h = harness(), p=h.paddle, R=p.w*.47, cy=p.y+p.h-R, ri=h.ringInnerRadius(0);
  const o={x:p.x+p.w/2+ri-8+.5,y:cy,vx:300,vy:50,r:8};
  const before=Math.hypot(o.vx,o.vy);
  assert.equal(h.ringContact(o,o.x-2,o.y,true,p.x,p.x),true);
  assert.ok(Math.hypot(o.vx,o.vy)<before*.6,'inner wall should strongly dissipate normal energy');
  assert.ok(Number.isFinite(o.x)&&Number.isFinite(o.y)&&Number.isFinite(o.vx)&&Number.isFinite(o.vy));
});

test('outer wall reflects and applies the bounded 1.045 speed gain', () => {
  const h = harness(), p=h.paddle, R=p.w*.47, cy=p.y+p.h-R;
  const o={x:p.x+p.w/2+R+8-.5,y:cy,vx:-300,vy:50,r:8};
  const before=Math.hypot(o.vx,o.vy);
  assert.equal(h.ringContact(o,o.x+2,o.y,true,p.x,p.x),true);
  assert.ok(o.vx>0,'outer wall should reflect horizontal motion');
  const gain=Math.hypot(o.vx,o.vy)/before;
  assert.ok(gain>1.03&&gain<=1.0451,'outer wall should add bounded energy after contact friction');
});

test('open top gap remains a pass-through and is not treated as a collision wall', () => {
  const h = harness(), p=h.paddle, R=p.w*.47, cy=p.y+p.h-R;
  const o={x:p.x+p.w/2,y:cy-R-1,vx:0,vy:-220,r:8};
  assert.equal(h.ringContact(o,o.x,o.y+2,true,p.x,p.x),false);
});

test('production physics retains soft inner wall and accelerated outer wall', () => {
  const ringContact = extractFunction('ringContact');
  assert.match(ringContact,/softNormal=-vn\*\.28/);
  assert.match(ringContact,/softTangent=vt\*\.94/);
  assert.ok(ringContact.includes('speedCap=baseSpeed()*1.72'));
  assert.ok(ringContact.includes('Math.min(1.045,speedCap/afterReflect)'));
});


test('sling skill is gated to Auto ring play and selects more cycles for low-speed balls', () => {
  const h=harness(), slow={x:200,y:420,vx:60,vy:0,r:8};
  assert.equal(h.beginRingSling(slow),false);
  h.auto=true;
  assert.equal(h.beginRingSling(slow),true);
  assert.equal(h.sling.phase,'oscillate');
  assert.equal(h.sling.cyclesTarget,4);
  const fastHarness=harness();fastHarness.auto=true;
  assert.equal(fastHarness.beginRingSling({x:200,y:420,vx:540,vy:0,r:8}),true);
  assert.equal(fastHarness.sling.cyclesTarget,1);
});

test('sling performs alternating oscillations, then a one-way short dash and release window', () => {
  const h=harness();h.auto=true;
  const o={x:200,y:420,vx:60,vy:0,r:8};
  assert.equal(h.beginRingSling(o),true);
  const cycles=h.sling.cyclesTarget;
  for(let i=0;i<cycles*2;i++){
    h.paddle.x=h.sling.targetX;
    h.updateRingSling(.016,o);
    if(i<cycles*2-1) assert.equal(h.sling.phase,'oscillate');
  }
  assert.equal(h.sling.phase,'dash');
  assert.ok(h.sling.dashDistance>0);
  h.paddle.x=h.sling.targetX;
  h.updateRingSling(.016,o);
  assert.equal(h.sling.phase,'release');
});

test('sling releases only at the opposite real gap tip; short-dash length controls exit angle', () => {
  const h=harness();h.auto=true;
  const o={x:200,y:420,vx:100,vy:0,r:8};
  h.beginRingSling(o);
  h.sling.phase='release';h.sling.exitSide=1;h.sling.dashDistance=35;h.sling.cyclesTarget=2;
  const R=94,cx=100,cy=426,gap=Math.asin(24/94),tip=-Math.PI/2+gap;
  const wrong={kind:'inner',q:{x:cx+R*Math.cos(tip+.8),y:cy+R*Math.sin(tip+.8)}};
  assert.equal(h.tryReleaseRingSling(o,wrong,true),false);
  const tipContact={kind:'inner',q:{x:cx+R*Math.cos(tip),y:cy+R*Math.sin(tip)}};
  assert.equal(h.tryReleaseRingSling(o,tipContact,true),true);
  assert.equal(h.sling.phase,'cooldown');
  assert.ok(o.vy<0&&o.vx>0,'release should launch upward through the selected right-side opening');
  const shortAngle=h.sling.lastAngle;
  const h2=harness();h2.auto=true;
  const o2={x:200,y:420,vx:100,vy:0,r:8};
  h2.beginRingSling(o2);
  h2.sling.phase='release';h2.sling.exitSide=1;h2.sling.dashDistance=65;h2.sling.cyclesTarget=2;
  assert.equal(h2.tryReleaseRingSling(o2,tipContact,true),true);
  assert.ok(h2.sling.lastAngle>shortAngle,'longer dash should produce a wider release angle');
  assert.ok(Math.hypot(o2.vx,o2.vy)>Math.hypot(o.vx,o.vy)*.99);
});

test('sling aborts cleanly when Auto is disabled or the focus ball changes', () => {
  const h=harness();h.auto=true;
  const a={x:200,y:420,vx:100,vy:0,r:8},b={x:210,y:420,vx:100,vy:0,r:8};
  h.beginRingSling(a);
  h.updateRingSling(.016,b);
  assert.equal(h.sling.phase,'idle');
  h.beginRingSling(a);
  h.auto=false;
  h.updateRingSling(.016,a);
  assert.equal(h.sling.phase,'idle');
});


test('sling oscillation count changes release speed while equal dash distance keeps angle fixed', () => {
  const make=(cycles)=>{
    const h=harness();h.auto=true;
    const o={x:200,y:420,vx:100,vy:0,r:8};
    h.beginRingSling(o);
    h.sling.phase='release';h.sling.exitSide=1;h.sling.dashDistance=42;h.sling.cyclesTarget=cycles;
    const R=94,cx=100,cy=426,gap=Math.asin(24/94),tip=-Math.PI/2+gap;
    const contact={kind:'inner',q:{x:cx+R*Math.cos(tip),y:cy+R*Math.sin(tip)}};
    assert.equal(h.tryReleaseRingSling(o,contact,true),true);
    return {speed:Math.hypot(o.vx,o.vy),angle:h.sling.lastAngle};
  };
  const one=make(1),many=make(4);
  assert.ok(many.speed>one.speed,'more complete oscillations should create a faster sling');
  assert.ok(Math.abs(many.angle-one.angle)<1e-12,'equal short-dash lengths must produce equal release angles');
});


test('production ringContact starts sling on inner capture and releases at the real opposite tip', () => {
  const h=harness();h.auto=true;h.state.intent='aim';h.planner.skill='attack';
  const p=h.paddle,R=p.w*.47,cy=p.y+p.h-R,gap=Math.asin(24/R),tip=-Math.PI/2+gap;
  const nx=-Math.cos(tip),ny=-Math.sin(tip);
  const qx=p.w/2+R*Math.cos(tip),qy=cy+R*Math.sin(tip);
  const captured={x:p.x+qx+nx*7.5,y:qy+ny*7.5,vx:-nx*220,vy:-ny*220,r:8};
  assert.equal(h.ringContact(captured,captured.x,captured.y,true,p.x,p.x),true);
  assert.equal(h.sling.phase,'oscillate','real inner-wall contact should begin the skill for the Auto main ball');

  h.sling.phase='release';h.sling.exitSide=1;h.sling.dashDistance=42;h.sling.cyclesTarget=2;
  const releaseBall=captured;
  releaseBall.x=p.x+qx+nx*7.5;releaseBall.y=qy+ny*7.5;
  releaseBall.vx=-nx*220;releaseBall.vy=-ny*220;
  assert.equal(h.ringContact(releaseBall,releaseBall.x,releaseBall.y,true,p.x,p.x),true);
  assert.ok(releaseBall.vx>0&&releaseBall.vy<0,'the actual production collision should fling through the right-side gap tip');
  assert.equal(h.sling.phase,'cooldown');
});


test('RingPlanner prioritizes survival, then gap guidance, capture, boost, and steering', () => {
  const h=harness(),focus={x:400,y:300,vx:0,vy:500,r:8};
  h.auto=true;
  const base={valid:true,speedRatio:.6,speedClass:'slow',speedTrend:'stable',gapEta:null,gapPassable:false,
    gapPredictedX:null,etaInner:null,radialZone:'outside'};
  let p=h.planRingSkill(base,{intent:'boost'},focus);
  assert.equal(p.skill,'boost');
  const fast={...base,speedRatio:1.4,speedClass:'fast',speedTrend:'stable',etaInner:.2};
  assert.equal(h.planRingSkill(fast,{intent:'control'},focus).skill,'capture');
  const gap={...base,gapEta:.1,gapPassable:true,gapPredictedX:430};
  assert.equal(h.planRingSkill(gap,{intent:'guide-through'},focus).skill,'gap-guide');
  const danger={...base};
  const falling={x:400,y:520,vx:0,vy:300,r:8};
  assert.equal(h.planRingSkill(danger,{intent:'boost'},falling).skill,'safe-catch');
});

test('RingPlanner guide and gap targets move the ring toward the ball path', () => {
  const h=harness(),focus={x:520,y:400,vx:0,vy:100,r:8};
  const sensor={valid:true,speedRatio:1,speedClass:'cruise',speedTrend:'stable',gapEta:null,
    gapPassable:false,gapPredictedX:null,etaInner:null,radialZone:'inside'};
  const plan=h.planRingSkill(sensor,{intent:'aim'},focus);
  assert.equal(plan.skill,'guide');
  assert.ok(plan.targetX<focus.x,'paddle target is left edge coordinate centered beneath the ball');
  const gap=h.planRingSkill({...sensor,gapEta:.12,gapPassable:true,gapPredictedX:600},{intent:'guide-through'},focus);
  assert.equal(gap.skill,'gap-guide');
  assert.ok(gap.targetX>plan.targetX);
});

test('RingEvaluator keeps bounded event history and records real wall energy outcomes', () => {
  const h=harness();
  for(let i=0;i<60;i++)h.recordRingEvaluation('guide',{skill:'guide'});
  assert.equal(h.evaluator.events.length,48);
  h.recordRingEvaluation('inner',{skill:'capture',before:400,after:200});
  h.recordRingEvaluation('outer',{skill:'boost',before:200,after:220});
  h.recordRingEvaluation('sling',{skill:'sling',before:220,after:350});
  assert.equal(h.evaluator.slows,1);
  assert.equal(h.evaluator.boosts,1);
  assert.equal(h.evaluator.slingReleases,1);
});

test('RingPlanner changes are evaluated once per transition and reset on mode loss', () => {
  const h=harness(),focus={x:400,y:300,vx:0,vy:0,r:8};
  h.auto=true;
  h.updateRingSensor(0,focus);
  h.updateRingState(h.sensor,0,focus);
  h.updateRingPlanner(.016,focus);
  const requests=h.evaluator.requested;
  h.updateRingPlanner(.016,focus);
  assert.equal(h.evaluator.requested,requests,'same skill should not create repeated requests');
  h.shape='rect';
  h.updateRingPlanner(.016,focus);
  assert.equal(h.planner.skill,'recover');
});


test('sling has bounded phase timeouts and aborts instead of hanging', () => {
  const h=harness();h.auto=true;
  const o={x:200,y:420,vx:60,vy:0,r:8};
  h.beginRingSling(o);
  h.updateRingSling(3.3,o);
  assert.equal(h.sling.phase,'cooldown');
  assert.equal(h.sling.abortReason,'阶段超时');
  assert.equal(h.evaluator.cancelled,1);
});

test('sling uses a reachable oscillation center near either screen edge', () => {
  const h=harness();h.auto=true;
  h.paddle.x=2;
  assert.equal(h.beginRingSling({x:110,y:420,vx:100,vy:0,r:8}),true);
  assert.ok(h.sling.targetX>=2&&h.sling.targetX<=h.worldWidth-202);
  assert.ok(h.sling.amplitude>=9);
});

test('outer-wall boost is capped at 1.72 times base speed', () => {
  const h=harness(),p=h.paddle,R=p.w*.47,cy=p.y+p.h-R;
  const cap=300*1.72;
  const o={x:p.x+p.w/2+R+8-.5,y:cy,vx:-cap*1.1,vy:0,r:8};
  assert.equal(h.ringContact(o,o.x+2,o.y,true,p.x,p.x),true);
  assert.ok(Math.hypot(o.vx,o.vy)<=cap+1e-6,'outer-wall energy must stay under the skill cap');
});

test('skill planner does not write ball position or velocity', () => {
  const source=extractFunction('planRingSkill')+extractFunction('updateRingPlanner');
  assert.doesNotMatch(source,/(?:focus|ball|o)\.(?:x|y|vx|vy)\s*=/);
});

test('ring skill evaluator only retains the latest 48 records', () => {
  const h=harness();
  for(let i=0;i<100;i++)h.recordRingEvaluation('request',{skill:'guide'});
  assert.equal(h.evaluator.events.length,48);
  assert.equal(h.evaluator.requested,100);
});


test('sling release rejects a different ball after focus lock', () => {
  const h=harness();h.auto=true;
  const focus={x:200,y:420,vx:100,vy:0,r:8},other={x:200,y:420,vx:100,vy:0,r:8};
  h.beginRingSling(focus);
  h.sling.phase='release';h.sling.exitSide=1;h.sling.dashDistance=42;
  const R=94,cx=100,cy=426,gap=Math.asin(24/94),tip=-Math.PI/2+gap;
  const contact={kind:'inner',q:{x:cx+R*Math.cos(tip),y:cy+R*Math.sin(tip)}};
  assert.equal(h.tryReleaseRingSling(other,contact,true),false);
  assert.equal(h.tryReleaseRingSling(focus,contact,true),true);
});


test('RingCombo advances only after confirmed capture, slow, guide and gap events', () => {
  const h=harness(),focus={};
  h.startRingCombo('unload',focus);
  assert.deepEqual(Array.from(h.combo.steps),['capture','slow','guide','gap-guide','attack']);
  assert.equal(h.advanceRingCombo('capture','inner wall hit'),true);
  assert.equal(h.combo.steps[h.combo.index],'slow');
  assert.equal(h.advanceRingCombo('guide'),false,'cannot skip an unconfirmed slow phase');
  assert.equal(h.advanceRingCombo('slow','speed reduced'),true);
  assert.equal(h.advanceRingCombo('guide','steering aligned'),true);
  assert.equal(h.advanceRingCombo('gap-guide','ball passed opening'),true);
  assert.equal(h.combo.steps[h.combo.index],'attack');
});

test('RingCombo selects charge and sling recipes with the expected skill order', () => {
  const h=harness(),focus={};
  h.startRingCombo('charge',focus);
  assert.deepEqual(Array.from(h.combo.steps),['boost','attack']);
  h.startRingCombo('sling',focus);
  assert.deepEqual(Array.from(h.combo.steps),['capture','oscillate','dash','sling-release','attack']);
  assert.equal(h.advanceRingCombo('capture'),true);
  assert.equal(h.advanceRingCombo('oscillate'),true);
  assert.equal(h.advanceRingCombo('dash'),true);
  assert.equal(h.advanceRingCombo('sling-release'),true);
  assert.equal(h.combo.steps[h.combo.index],'attack');
});


test('ringAimReflect applies a hard speed ceiling to attack-mode predictions', () => {
  const h=harness();
  const out=h.ringAimReflect(9000,-9000,.9,0,8);
  assert.equal(out.mode,'attack');
  assert.ok(Math.hypot(out.vx,out.vy)<=300*1.72+1e-6);
});

test('RingPlanner keeps a higher-priority unload combo when the instantaneous skill shifts to guide', () => {
  const h=harness(),focus={x:400,y:300,vx:0,vy:0,r:8};
  h.auto=true;
  h.updateRingSensor(0,focus);
  h.sensor.speedRatio=1.4;h.sensor.speedClass='fast';h.sensor.speedTrend='stable';
  h.updateRingState(h.sensor,0,focus);
  h.updateRingPlanner(.016,focus);
  assert.equal(h.combo.name,'unload');
  h.sensor.speedRatio=.9;h.sensor.speedClass='cruise';h.sensor.radialZone='inside';
  h.updateRingState(h.sensor,.3,focus);
  h.updateRingPlanner(.016,focus);
  assert.equal(h.combo.name,'unload','control intent must not interrupt a higher-priority unload recipe');
});


test('RingPlanner emits bounded action requests with expiry and explicit acceptance', () => {
  const h=harness(),focus={x:400,y:300,vx:0,vy:0,r:8};
  h.auto=true;
  h.updateRingSensor(0,focus);
  h.updateRingState(h.sensor,0,focus);
  const plan=h.updateRingPlanner(.016,focus);
  assert.equal(plan.accepted,true);
  assert.equal(plan.action.type,'hard-wall-boost');
  assert.ok(Number.isFinite(plan.expiresAt)&&plan.expiresAt>0);
  assert.ok(Number.isFinite(plan.action.targetX));
});

test('RingEvaluator counters saturate and cannot grow without bound', () => {
  const h=harness();
  h.evaluator.requested=1000000;
  h.recordRingEvaluation('request',{skill:'stress'});
  assert.equal(h.evaluator.requested,1000000);
});


test('emergency safe-catch plan overrides an active sling sequence', () => {
  const h=harness();h.auto=true;
  const focus={x:400,y:520,vx:0,vy:300,r:8};
  h.beginRingSling(focus);
  h.sling.phase='oscillate';
  const sensor={valid:true,speedRatio:1,speedClass:'cruise',speedTrend:'stable',gapEta:null,
    gapPassable:false,gapPredictedX:null,etaInner:null,radialZone:'inside'};
  const plan=h.planRingSkill(sensor,{intent:'aim'},focus);
  assert.equal(plan.skill,'safe-catch');
  h.planner.skill='safe-catch';
  h.updateRingSling(.016,focus);
  assert.equal(h.sling.phase,'cooldown');
});

test('sling cannot release while emergency catch priority is active', () => {
  const h=harness();h.auto=true;
  const focus={x:200,y:420,vx:100,vy:0,r:8};
  h.beginRingSling(focus);
  h.sling.phase='release';h.sling.exitSide=1;h.sling.dashDistance=42;
  h.planner.skill='safe-catch';
  const R=94,cx=100,cy=426,gap=Math.asin(24/94),tip=-Math.PI/2+gap;
  const contact={kind:'inner',q:{x:cx+R*Math.cos(tip),y:cy+R*Math.sin(tip)}};
  assert.equal(h.tryReleaseRingSling(focus,contact,true),false);
});


test('ring Auto pipeline locks sensor, state, planner and sling to the same focus ball', () => {
  assert.match(html,/const ringFocus=autoPilot\?selectAutoFocusBall\(\):ball/);
  assert.match(html,/updateRingSensor\(dt,ringFocus\)/);
  assert.match(html,/updateRingSling\(dt,ringFocus\)/);
  assert.match(html,/updateRingPlanner\(dt,ringFocus\)/);
});

test('ring skills and sling do not override special-level Auto routing', () => {
  assert.match(extractFunction('beginRingSling'),/levelType\(\)!==1/);
  assert.match(extractFunction('updateRingSling'),/levelType\(\)!==1/);
  assert.match(extractFunction('autoTargetX'),/levelType\(\)===1/);
});
