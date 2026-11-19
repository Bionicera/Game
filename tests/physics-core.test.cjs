'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const EPS = 1e-10;
const {createBody,applyForce,applyImpulse,integrateBody,createContactTelemetry,kineticEnergy,linearMomentum,solveContact,PhysicsWorld,FixedStepRunner} = require('../physics/physics-core.cjs');
const add = (a,b) => ({x:a.x+b.x,y:a.y+b.y});
const sub = (a,b) => ({x:a.x-b.x,y:a.y-b.y});
const body = createBody;
const kinetic = kineticEnergy;
const momentum = linearMomentum;

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
  result.kinematicBoundaryWork = result.kinematicWork;
  return result;
}

test('static wall: elastic reflection reverses only normal velocity', () => {
  const a=body(1,{x:3,y:4}), wall=body(Infinity,{x:0,y:0});
  const r=resolve(a,wall,{x:-1,y:0},{restitution:1});
  assert.equal(r.applied,true);
  assert.ok(Math.abs(a.velocity.x+3)<EPS);
  assert.ok(Math.abs(a.velocity.y-4)<EPS);
  assert.ok(Math.abs(kinetic(a)-12.5)<EPS);
});
test('static wall: zero restitution removes normal speed without adding energy', () => {
  const a=body(2,{x:5,y:7}), wall=body(Infinity,{x:0,y:0});
  resolve(a,wall,{x:-1,y:0},{restitution:0});
  assert.ok(Math.abs(a.velocity.x)<EPS);
  assert.ok(Math.abs(a.velocity.y-7)<EPS);
  assert.ok(Math.abs(kinetic(a)-49)<EPS);
});
test('moving kinematic paddle surface velocity changes the outgoing velocity', () => {
  const ball=body(1,{x:0,y:0}), paddle=body(Infinity,{x:0,y:0},{x:-6,y:0});
  const r=resolve(ball,paddle,{x:-1,y:0},{restitution:1});
  assert.ok(Math.abs(ball.velocity.x+12)<EPS);
  assert.ok(Math.abs(r.kinematicBoundaryWork-72)<EPS);
});
test('two dynamic bodies conserve total momentum and obey restitution', () => {
  const a=body(2,{x:3,y:0}), b=body(1,{x:-1,y:0});
  const p0=add(momentum(a),momentum(b));
  resolve(a,b,{x:-1,y:0},{restitution:1});
  const p1=add(momentum(a),momentum(b));
  assert.ok(Math.abs(p1.x-p0.x)<EPS && Math.abs(p1.y-p0.y)<EPS);
  assert.ok(Math.abs(a.velocity.x-(1/3))<EPS);
  assert.ok(Math.abs(b.velocity.x-(13/3))<EPS);
});
test('separating contact receives no second impulse', () => {
  const a=body(1,{x:-2,y:0}), wall=body(Infinity,{x:0,y:0});
  const r=resolve(a,wall,{x:-1,y:0});
  assert.equal(r.applied,false);
  assert.equal(r.normalImpulse,0);
  assert.equal(a.velocity.x,-2);
});
test('friction impulse is bounded by Coulomb limit', () => {
  const a=body(1,{x:4,y:20}), wall=body(Infinity,{x:0,y:0});
  const r=resolve(a,wall,{x:-1,y:0},{restitution:0,friction:.25});
  assert.ok(Math.abs(r.tangentImpulse)<=.25*r.normalImpulse+EPS);
  assert.ok(Math.abs(r.tangentImpulse-.25*r.normalImpulse)<EPS);
});
test('static frictionless collision energy change matches impulse work', () => {
  const a=body(3,{x:8,y:5}), wall=body(Infinity,{x:0,y:0});
  const before=kinetic(a);
  const r=resolve(a,wall,{x:-1,y:0},{restitution:.5});
  assert.ok(Math.abs((kinetic(a)-before)-r.deltaKA)<EPS);
  assert.ok(r.deltaKA<0);
});
test('kinematic boundary work and restitution loss are accounted separately', () => {
  const a=body(2,{x:-4,y:3}), paddle=body(Infinity,{x:0,y:0},{x:2,y:0});
  const before=kinetic(a);
  const r=resolve(a,paddle,{x:1,y:0},{restitution:.6});
  const expectedDissipation=.5*(1/(a.invMass+paddle.invMass))*(1-.6*.6)*36;
  assert.ok(Math.abs(r.kinematicBoundaryWork-38.4)<EPS);
  assert.ok(Math.abs((kinetic(a)-before)-(r.kinematicBoundaryWork-expectedDissipation))<EPS);
});
test('degenerate normals and non-finite inputs fail closed without NaN', () => {
  const a=body(1,{x:1,y:2}), wall=body(Infinity,{x:0,y:0});
  const zero=resolve(a,wall,{x:0,y:0});
  assert.equal(zero.valid,false);
  assert.deepEqual(a.velocity,{x:1,y:2});
  const bad=body(1,{x:0,y:0}); bad.velocity.x=NaN;
  const invalid=resolve(bad,wall,{x:-1,y:0});
  assert.equal(invalid.valid,false);
  assert.ok(!Number.isNaN(a.velocity.x) && !Number.isNaN(a.velocity.y));
});
test('normal orientation is scale-invariant and normalized internally', () => {
  const a=body(1,{x:4,y:0}), wall=body(Infinity,{x:0,y:0});
  resolve(a,wall,{x:-10,y:0},{restitution:1});
  assert.equal(a.velocity.x,-4);
});

test('force integration uses semi-implicit Euler and clears accumulated force', () => {
  const b=body(2,{x:1,y:0}); b.position={x:0,y:0};
  assert.equal(applyForce(b,{x:4,y:0}),true);
  const r=integrateBody(b,.5);
  assert.equal(r.valid,true);
  assert.ok(Math.abs(b.velocity.x-2)<EPS);
  assert.ok(Math.abs(b.position.x-1)<EPS);
  assert.deepEqual(b.force,{x:0,y:0});
});
test('static and kinematic bodies reject force and impulse mutation', () => {
  const wall=body(Infinity,{x:0,y:0});
  assert.equal(applyForce(wall,{x:10,y:0}),false);
  assert.equal(applyImpulse(wall,{x:10,y:0}),false);
  assert.deepEqual(wall.velocity,{x:0,y:0});
});
test('impulse changes dynamic momentum by exactly the applied impulse', () => {
  const b=body(4,{x:1,y:2}), before=momentum(b);
  assert.equal(applyImpulse(b,{x:8,y:-4}),true);
  const after=momentum(b);
  assert.ok(Math.abs(after.x-before.x-8)<EPS);
  assert.ok(Math.abs(after.y-before.y+4)<EPS);
});
test('contact telemetry records energy delta and impulse result', () => {
  const ball=body(1,{x:2,y:0}), wall=body(Infinity,{x:0,y:0});
  const before=kinetic(ball)+kinetic(wall);
  const result=solveContact(ball,wall,{x:-1,y:0},{restitution:0});
  const log=createContactTelemetry(ball,wall,{point:{x:5,y:3}},result,before);
  assert.equal(log.valid,true);
  assert.equal(log.normalImpulse,2);
  assert.equal(log.kineticEnergyBefore,2);
  assert.equal(log.kineticEnergyAfter,0);
  assert.equal(log.kineticEnergyDelta,-2);
  assert.deepEqual(log.point,{x:5,y:3});
});
test('invalid dt or non-finite accumulated force fails without corrupting body', () => {
  const b=body(1,{x:1,y:2}); b.position={x:3,y:4};
  assert.equal(integrateBody(b,-1).valid,false);
  b.force.x=Infinity;
  assert.equal(integrateBody(b,.1).valid,false);
  assert.deepEqual(b.position,{x:3,y:4});
});

test('overflowing force and impulse requests are rejected atomically', () => {
  const b=body(1,{x:Number.MAX_VALUE,y:0});
  assert.equal(applyImpulse(b,{x:Number.MAX_VALUE,y:0}),false);
  assert.deepEqual(b.velocity,{x:Number.MAX_VALUE,y:0});
  assert.equal(applyForce(b,{x:Number.MAX_VALUE,y:0}),true);
  assert.equal(applyForce(b,{x:Number.MAX_VALUE,y:0}),false);
  assert.deepEqual(b.force,{x:Number.MAX_VALUE,y:0});
});


test('PhysicsWorld owns an ordered body registry and rejects duplicate identity', () => {
  const world=new PhysicsWorld(), a=body(1), b=body(2);
  assert.equal(world.addBody(a).valid,true);
  assert.equal(world.addBody(b).valid,true);
  assert.equal(world.addBody(a).reason,'body-already-registered');
  assert.equal(world.bodies[0],a);
  assert.equal(world.removeBody(a),true);
  assert.equal(world.removeBody(a),false);
  assert.deepEqual(world.bodies,[b]);
});

test('PhysicsWorld advances multiple bodies deterministically in one world step', () => {
  const makeWorld=()=>{
    const world=new PhysicsWorld(), a=body(1,{x:1,y:0}), b=body(2,{x:0,y:2});
    world.addBody(a); world.addBody(b);
    world.addForceGenerator((item)=>({x:2*item.mass,y:0}));
    return {world,a,b};
  };
  const x=makeWorld(), y=makeWorld();
  assert.equal(x.world.step(.5).valid,true);
  assert.equal(y.world.step(.5).valid,true);
  assert.deepEqual(x.a.position,y.a.position);
  assert.deepEqual(x.b.velocity,y.b.velocity);
  assert.deepEqual(x.a.position,{x:1,y:0});
  assert.deepEqual(x.b.position,{x:.5,y:1});
});

test('FixedStepRunner accumulates fractional frames and runs only fixed steps', () => {
  const world=new PhysicsWorld(), b=body(1,{x:1,y:0}); world.addBody(b);
  const runner=new FixedStepRunner(world,{fixedDt:.1,maxSubSteps:4});
  assert.equal(runner.advance(.04).steps,0);
  assert.equal(runner.advance(.07).steps,1);
  assert.ok(Math.abs(b.position.x-.1)<EPS);
  assert.ok(Math.abs(runner.accumulator-.01)<EPS);
});

test('catch-up cap retains and reports backlog instead of dropping simulation time', () => {
  const world=new PhysicsWorld(), runner=new FixedStepRunner(world,{fixedDt:.1,maxSubSteps:2});
  const result=runner.advance(.55);
  assert.equal(result.steps,2);
  assert.ok(Math.abs(result.backlogSeconds-.35)<EPS);
  const next=runner.advance(0);
  assert.equal(next.steps,2);
  assert.ok(Math.abs(next.backlogSeconds-.15)<EPS);
});

test('paused runner does not accumulate time; reset explicitly clears backlog', () => {
  const world=new PhysicsWorld(), runner=new FixedStepRunner(world,{fixedDt:.1});
  runner.advance(.05);
  runner.setPaused(true);
  assert.equal(runner.advance(10).backlogSeconds,.05);
  runner.setPaused(false);
  assert.equal(runner.reset().accumulator,0);
});

test('force generators are unique, ordered, and invalid output rolls back force state', () => {
  const world=new PhysicsWorld(), b=body(1); world.addBody(b);
  const gravity=()=>({x:0,y:10});
  assert.equal(world.addForceGenerator(gravity).valid,true);
  assert.equal(world.addForceGenerator(gravity).reason,'force-generator-already-registered');
  assert.equal(world.addForceGenerator(()=>({x:Infinity,y:0})).valid,true);
  const result=world.step(.1);
  assert.equal(result.valid,false);
  assert.deepEqual(b.force,{x:0,y:0});
  assert.deepEqual(b.position,{x:0,y:0});
  assert.equal(world.stepCount,0);
});

test('failed world step is atomic across bodies and does not leak references in status', () => {
  const world=new PhysicsWorld(), a=body(1), b=body(1);
  world.addBody(a); world.addBody(b); b.position.x=Number.MAX_VALUE; b.velocity.x=Number.MAX_VALUE;
  const result=world.step(2);
  assert.equal(result.valid,false);
  assert.deepEqual(a.position,{x:0,y:0});
  assert.deepEqual(a.velocity,{x:0,y:0});
  assert.equal(Object.hasOwn(result,'body'),false);
});

test('kinematic bodies remain unchanged while dynamic bodies advance', () => {
  const world=new PhysicsWorld(), ball=body(1,{x:2,y:0}), paddle=body(Infinity,{x:3,y:4},{x:5,y:6});
  world.addBody(ball); world.addBody(paddle);
  assert.equal(world.step(.5).valid,true);
  assert.deepEqual(paddle.position,{x:0,y:0});
  assert.deepEqual(paddle.velocity,{x:3,y:4});
  assert.deepEqual(paddle.surfaceVelocity,{x:5,y:6});
  assert.deepEqual(ball.position,{x:1,y:0});
});

test('invalid frame and world time steps fail closed without advancing state', () => {
  const world=new PhysicsWorld(), b=body(1,{x:1,y:0}); world.addBody(b);
  const runner=new FixedStepRunner(world,{fixedDt:.1});
  assert.equal(runner.advance(Infinity).valid,false);
  assert.equal(world.step(NaN).valid,false);
  assert.deepEqual(b.position,{x:0,y:0});
});
