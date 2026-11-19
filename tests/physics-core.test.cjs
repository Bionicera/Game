'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const EPS = 1e-10;
const finiteVec = v => Number.isFinite(v.x) && Number.isFinite(v.y);
const dot = (a,b) => a.x*b.x + a.y*b.y;
const add = (a,b) => ({x:a.x+b.x,y:a.y+b.y});
const scale = (a,s) => ({x:a.x*s,y:a.y*s});
const sub = (a,b) => ({x:a.x-b.x,y:a.y-b.y});
const kinetic = b => .5*b.mass*dot(b.v,b.v);
const momentum = b => scale(b.v,b.mass);

function body(mass, v, surface = {x:0,y:0}) {
  return {mass, invMass: mass === Infinity ? 0 : 1/mass, v:{...v}, surface:{...surface}};
}

// normal points B -> A. Contact point velocities are supplied explicitly;
// this translational prototype intentionally has no angular velocity/inertia.
function solveContact(a,b,normal,{restitution=1,friction=0}={}) {
  const len = Math.hypot(normal.x,normal.y);
  if (!finiteVec(normal) || !Number.isFinite(len) || len < EPS) return {valid:false, reason:'degenerate-normal', jn:0, jt:0};
  if (![a.mass,b.mass].every(m => m > 0 || m === Infinity) ||
      ![a.invMass,b.invMass].every(Number.isFinite) ||
      !finiteVec(a.v) || !finiteVec(b.v) || !finiteVec(a.surface) || !finiteVec(b.surface) ||
      !Number.isFinite(restitution) || restitution < 0 || restitution > 1 ||
      !Number.isFinite(friction) || friction < 0) {
    return {valid:false, reason:'invalid-input', jn:0, jt:0};
  }
  const invSum = a.invMass + b.invMass;
  if (!(invSum > 0)) return {valid:false, reason:'zero-inverse-mass', jn:0, jt:0};
  const n = scale(normal,1/len), t = {x:-n.y,y:n.x};
  const va = add(a.v,a.surface), vb = add(b.v,b.surface);
  const u = sub(va,vb), un = dot(u,n);
  if (un >= 0) return {valid:true, applied:false, jn:0, jt:0, un};
  const jn = -(1+restitution)*un/invSum;
  const ut = dot(u,t);
  const jt = Math.max(-friction*jn,Math.min(friction*jn,-ut/invSum));
  const impulse = add(scale(n,jn),scale(t,jt));
  a.v = add(a.v,scale(impulse,a.invMass));
  b.v = sub(b.v,scale(impulse,b.invMass));
  const boundaryWork = a.mass === Infinity || b.mass === Infinity ? NaN :
    (kinetic(a)-0); // replaced below by per-body delta using pre-solve snapshots
  return {valid:true,applied:true,jn,jt,un,ut,impulse,boundaryWork};
}

function resolve(a,b,n,opts={}) {
  const beforeA = kinetic(a), beforeB = kinetic(b);
  const beforePA = momentum(a), beforePB = momentum(b);
  const result = solveContact(a,b,n,opts);
  if (!result.valid || !result.applied) return result;
  result.deltaKA = kinetic(a)-beforeA;
  result.deltaKB = kinetic(b)-beforeB;
  result.deltaK = result.deltaKA+result.deltaKB;
  result.deltaPA = sub(momentum(a),beforePA);
  result.deltaPB = sub(momentum(b),beforePB);
  // For a kinematic B, work delivered to dynamic A is the dynamic body's ΔK.
  result.kinematicBoundaryWork = b.invMass===0 ? result.deltaKA :
    a.invMass===0 ? result.deltaKB : 0;
  return result;
}

test('static wall: elastic reflection reverses only normal velocity', () => {
  const a=body(1,{x:3,y:4}), wall=body(Infinity,{x:0,y:0});
  const r=resolve(a,wall,{x:-1,y:0},{restitution:1});
  assert.equal(r.applied,true);
  assert.ok(Math.abs(a.v.x+3)<EPS);
  assert.ok(Math.abs(a.v.y-4)<EPS);
  assert.ok(Math.abs(kinetic(a)-12.5)<EPS);
});
test('static wall: zero restitution removes normal speed without adding energy', () => {
  const a=body(2,{x:5,y:7}), wall=body(Infinity,{x:0,y:0});
  resolve(a,wall,{x:-1,y:0},{restitution:0});
  assert.ok(Math.abs(a.v.x)<EPS);
  assert.ok(Math.abs(a.v.y-7)<EPS);
  assert.ok(Math.abs(kinetic(a)-49)<EPS);
});
test('moving kinematic paddle surface velocity changes the outgoing velocity', () => {
  const ball=body(1,{x:0,y:0}), paddle=body(Infinity,{x:0,y:0},{x:-6,y:0});
  const r=resolve(ball,paddle,{x:-1,y:0},{restitution:1});
  assert.ok(Math.abs(ball.v.x+12)<EPS);
  assert.ok(Math.abs(r.kinematicBoundaryWork-72)<EPS);
});
test('two dynamic bodies conserve total momentum and obey restitution', () => {
  const a=body(2,{x:3,y:0}), b=body(1,{x:-1,y:0});
  const p0=add(momentum(a),momentum(b));
  resolve(a,b,{x:-1,y:0},{restitution:1});
  const p1=add(momentum(a),momentum(b));
  assert.ok(Math.abs(p1.x-p0.x)<EPS && Math.abs(p1.y-p0.y)<EPS);
  assert.ok(Math.abs(a.v.x-(1/3))<EPS);
  assert.ok(Math.abs(b.v.x-(13/3))<EPS);
});
test('separating contact receives no second impulse', () => {
  const a=body(1,{x:2,y:0}), wall=body(Infinity,{x:0,y:0});
  const r=resolve(a,wall,{x:-1,y:0});
  assert.equal(r.applied,false);
  assert.equal(r.jn,0);
  assert.equal(a.v.x,2);
});
test('friction impulse is bounded by Coulomb limit', () => {
  const a=body(1,{x:4,y:20}), wall=body(Infinity,{x:0,y:0});
  const r=resolve(a,wall,{x:-1,y:0},{restitution:0,friction:.25});
  assert.ok(Math.abs(r.jt)<=.25*r.jn+EPS);
  assert.ok(Math.abs(r.jt-.25*r.jn)<EPS);
});
test('static frictionless collision energy change matches impulse work', () => {
  const a=body(3,{x:8,y:5}), wall=body(Infinity,{x:0,y:0});
  const before=kinetic(a);
  const r=resolve(a,wall,{x:-1,y:0},{restitution:.5});
  assert.ok(Math.abs((kinetic(a)-before)-r.deltaKA)<EPS);
  assert.ok(r.deltaKA<0);
});
test('kinematic boundary work equals dynamic-body kinetic-energy change', () => {
  const a=body(2,{x:-4,y:3}), paddle=body(Infinity,{x:0,y:0},{x:2,y:0});
  const before=kinetic(a);
  const r=resolve(a,paddle,{x:1,y:0},{restitution:.6});
  assert.ok(Math.abs((kinetic(a)-before)-r.kinematicBoundaryWork)<EPS);
  assert.ok(Math.abs(r.kinematicBoundaryWork-r.deltaKA)<EPS);
});
test('degenerate normals and non-finite inputs fail closed without NaN', () => {
  const a=body(1,{x:1,y:2}), wall=body(Infinity,{x:0,y:0});
  const zero=resolve(a,wall,{x:0,y:0});
  assert.equal(zero.valid,false);
  assert.deepEqual(a.v,{x:1,y:2});
  const bad=body(1,{x:NaN,y:0});
  const invalid=resolve(bad,wall,{x:-1,y:0});
  assert.equal(invalid.valid,false);
  assert.ok(!Number.isNaN(a.v.x) && !Number.isNaN(a.v.y));
});
test('normal orientation is scale-invariant and normalized internally', () => {
  const a=body(1,{x:4,y:0}), wall=body(Infinity,{x:0,y:0});
  resolve(a,wall,{x:-10,y:0},{restitution:1});
  assert.equal(a.v.x,-4);
});
