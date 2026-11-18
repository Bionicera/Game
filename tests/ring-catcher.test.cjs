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
  'ringAimMode', 'updateRingSensor', 'updateRingState', 'ringContact', 'paddleReflect', 'bouncePaddle'
].map(extractFunction).join('\n');

function harness() {
  const context = {
    Math, Number, Object, Infinity,
    clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)),
    shape: 'ring',
    paddle: { x: 100, y: 500, w: 200, h: 20, vx: 0 },
    ball: { r: 8 },
    hitFx: null,
    ringMoodEvent: () => {}, ringMoodRandom: () => .5, beep: () => {}, particles: [], autoPilot: false,
    curse: {drunkT:0,friction:0}, PADDLE_MAX_V:900, FRICTION:.02, FRICTION_CAP:.3,
    baseSpeed: () => 300,
    ringSensor: {
      valid: false, speed: 0, speedRatio: 0, speedClass: 'stopped', acceleration: 0,
      speedTrend: 'stable', previousSpeed: null, previousObject: null, updatedAt: 0
    },
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
      updateRingSensor,updateRingState,ringAimMode,ringTipTaper,ringInnerRadius,ringInnerRadiusSlope,ringContact,
      get sensor(){return ringSensor},get state(){return ringState},get paddle(){return paddle},get ball(){return ball},
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
  assert.ok(Math.abs(Math.hypot(o.vx,o.vy)/before-1.045)<1e-6);
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
  assert.match(ringContact,/o\.vx\*=1\.045;o\.vy\*=1\.045/);
});
