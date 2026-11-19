'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const EPS = 1e-10;
const {colliderBounds,buildBroadPhasePairs,sweepCirclePlane,sweepCircleSegment,sweepCircleAabb,sweepCircleCircle,createBody,applyForce,applyImpulse,integrateBody,createContact,createCollider,detectContacts,createContactTelemetry,kineticEnergy,linearMomentum,solveContact,PhysicsWorld,FixedStepRunner} = require('../physics/physics-core.cjs');
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


test('Contact contract normalizes B-to-A normal and preserves geometric fields', () => {
  const a=body(1), b=body(Infinity);
  const result=createContact({bodyA:a,bodyB:b,point:{x:3,y:4},normal:{x:0,y:5},penetration:.25,toi:.5,surfaceVelocity:{x:2,y:1},featureId:'wall-face',material:{restitution:.4,friction:.2}});
  assert.equal(result.valid,true);
  assert.deepEqual(result.contact.normal,{x:0,y:1});
  assert.deepEqual(result.contact.point,{x:3,y:4});
  assert.equal(result.contact.penetration,.25);
  assert.equal(result.contact.toi,.5);
  assert.deepEqual(result.contact.surfaceVelocity,{x:2,y:1});
  assert.deepEqual(result.contact.material,{restitution:.4,friction:.2});
});
test('Contact contract rejects degenerate normals and invalid vectors', () => {
  const a=body(1), b=body(Infinity);
  assert.equal(createContact({bodyA:a,bodyB:b,point:{x:0,y:0},normal:{x:0,y:0},featureId:'x'}).reason,'degenerate-contact-normal');
  assert.equal(createContact({bodyA:a,bodyB:b,point:{x:NaN,y:0},normal:{x:1,y:0},featureId:'x'}).reason,'invalid-contact-vectors');
});
test('Contact contract rejects negative penetration and out-of-range TOI', () => {
  const a=body(1), b=body(Infinity), base={bodyA:a,bodyB:b,point:{x:0,y:0},normal:{x:1,y:0},featureId:'x'};
  assert.equal(createContact({...base,penetration:-.1}).reason,'invalid-contact-penetration');
  assert.equal(createContact({...base,toi:1.1}).reason,'invalid-contact-toi');
  assert.equal(createContact({...base,toi:NaN}).reason,'invalid-contact-toi');
});
test('Contact contract rejects aliased bodies and invalid material coefficients', () => {
  const a=body(1), b=body(Infinity), base={bodyA:a,bodyB:b,point:{x:0,y:0},normal:{x:1,y:0},featureId:'x'};
  assert.equal(createContact({...base,bodyB:a}).reason,'invalid-contact-bodies');
  assert.equal(createContact({...base,material:{restitution:1.2}}).reason,'invalid-contact-material');
  assert.equal(createContact({...base,material:{friction:-.1}}).reason,'invalid-contact-material');
});


test('Collider factory normalizes plane geometry and preserves supported shapes', () => {
  const b=body(Infinity);
  const circle=createCollider(b,'circle',{radius:3});
  const plane=createCollider(b,'plane',{normal:{x:0,y:4},offset:8});
  const aabb=createCollider(b,'aabb',{x:5,y:6,halfWidth:2,halfHeight:3});
  const segment=createCollider(b,'segment',{a:{x:0,y:1},b:{x:4,y:1}});
  assert.equal(circle.geometry.radius,3);
  assert.deepEqual(plane.geometry,{normal:{x:0,y:1},offset:2});
  assert.deepEqual(aabb.geometry,{x:5,y:6,halfWidth:2,halfHeight:3});
  assert.deepEqual(segment.geometry,{a:{x:0,y:1},b:{x:4,y:1}});
});
test('Collider factory rejects invalid shapes, degenerate geometry and material', () => {
  const b=body(Infinity);
  assert.throws(()=>createCollider(b,'capsule',{}),/unsupported collider shape/);
  assert.throws(()=>createCollider(b,'circle',{radius:0}),/radius/);
  assert.throws(()=>createCollider(b,'plane',{normal:{x:0,y:0},offset:0}),/plane/);
  assert.throws(()=>createCollider(b,'aabb',{x:0,y:0,halfWidth:1,halfHeight:0}),/aabb/);
  assert.throws(()=>createCollider(b,'segment',{a:{x:1,y:1},b:{x:1,y:1}}),/segment/);
  assert.throws(()=>createCollider(b,'circle',{radius:1},{restitution:2}),/material/);
});
test('Collider factory snapshots geometry and material input values', () => {
  const b=body(Infinity), geometry={a:{x:0,y:0},b:{x:2,y:0}}, material={restitution:.5,friction:.2};
  const c=createCollider(b,'segment',geometry,material);
  geometry.a.x=99; material.friction=99;
  assert.deepEqual(c.geometry.a,{x:0,y:0});
  assert.equal(c.material.friction,.2);
});


test('narrow phase emits circle-plane contact with B-to-A normal and penetration', () => {
  const ball=body(1), wall=body(Infinity);
  ball.position={x:0,y:.5};
  const contacts=detectContacts([createCollider(ball,'circle',{radius:1}),createCollider(wall,'plane',{normal:{x:0,y:1},offset:0})]);
  assert.equal(contacts.valid,true);
  assert.equal(contacts.contacts.length,1);
  assert.deepEqual(contacts.contacts[0].normal,{x:0,y:1});
  assert.deepEqual(contacts.contacts[0].point,{x:0,y:0});
  assert.ok(Math.abs(contacts.contacts[0].penetration-.5)<EPS);
});
test('narrow phase handles circle-AABB exterior and interior contacts', () => {
  const ball=body(1), box=body(Infinity);
  const aabb=createCollider(box,'aabb',{x:0,y:0,halfWidth:1,halfHeight:1});
  ball.position={x:1.4,y:0};
  let result=detectContacts([createCollider(ball,'circle',{radius:.5}),aabb]);
  assert.equal(result.contacts.length,1);
  assert.ok(Math.abs(result.contacts[0].penetration-.1)<EPS);
  ball.position={x:0,y:0};
  result=detectContacts([createCollider(ball,'circle',{radius:.5}),aabb]);
  assert.equal(result.contacts.length,1);
  assert.deepEqual(result.contacts[0].normal,{x:-1,y:0});
  assert.ok(Math.abs(result.contacts[0].penetration-1.5)<EPS);
});
test('narrow phase uses closest point on segment and rejects separated pairs', () => {
  const ball=body(1), wall=body(Infinity);
  ball.position={x:2,y:.25};
  const segment=createCollider(wall,'segment',{a:{x:0,y:0},b:{x:4,y:0}});
  let result=detectContacts([createCollider(ball,'circle',{radius:.5}),segment]);
  assert.equal(result.contacts.length,1);
  assert.deepEqual(result.contacts[0].point,{x:2,y:0});
  assert.deepEqual(result.contacts[0].normal,{x:0,y:1});
  ball.position.y=1;
  result=detectContacts([createCollider(ball,'circle',{radius:.5}),segment]);
  assert.equal(result.contacts.length,0);
});
test('narrow phase circle-circle coincident centers use deterministic normal', () => {
  const a=body(1), b=body(2);
  const result=detectContacts([createCollider(a,'circle',{radius:1}),createCollider(b,'circle',{radius:2})]);
  assert.equal(result.contacts.length,1);
  assert.deepEqual(result.contacts[0].normal,{x:1,y:0});
  assert.equal(result.contacts[0].penetration,3);
});

test('narrow phase reverses B-to-A normal when collider order is reversed', () => {
  const ball=body(1), wall=body(Infinity);
  ball.position={x:0,y:.5};
  const plane=createCollider(wall,'plane',{normal:{x:0,y:1},offset:0});
  const circle=createCollider(ball,'circle',{radius:1});
  const result=detectContacts([plane,circle]);
  assert.equal(result.contacts.length,1);
  assert.equal(result.contacts[0].bodyA,wall);
  assert.equal(result.contacts[0].bodyB,ball);
  assert.deepEqual(result.contacts[0].normal,{x:0,y:-1});
  assert.ok(Math.abs(result.contacts[0].penetration-.5)<EPS);
});

test('narrow phase returns no contacts for static-static and same-body pairs', () => {
  const wall=body(Infinity), ball=body(1);
  const circle=createCollider(ball,'circle',{radius:1});
  const plane=createCollider(wall,'plane',{normal:{x:0,y:1},offset:0});
  assert.equal(detectContacts([plane,createCollider(body(Infinity),'plane',{normal:{x:0,y:-1},offset:0})]).contacts.length,0);
  assert.equal(detectContacts([circle,createCollider(ball,'circle',{radius:1})]).contacts.length,0);
});


test('PhysicsWorld registers colliders only for owned bodies and cleans them on removal', () => {
  const world=new PhysicsWorld(), ball=body(1), wall=body(Infinity);
  const collider=createCollider(ball,'circle',{radius:1});
  assert.equal(world.addCollider(collider).reason,'invalid-collider');
  world.addBody(ball); world.addBody(wall);
  assert.equal(world.addCollider(collider).valid,true);
  assert.equal(world.addCollider(collider).reason,'collider-already-registered');
  assert.equal(world.removeBody(ball),true);
  assert.equal(world.colliders.length,0);
  assert.equal(world.removeCollider(collider),false);
});
test('PhysicsWorld integrates, resolves and position-corrects circle-plane contact', () => {
  const world=new PhysicsWorld(), ball=body(1,{x:0,y:-2}), wall=body(Infinity);
  ball.position={x:0,y:.5};
  world.addBody(ball); world.addBody(wall);
  world.addCollider(createCollider(ball,'circle',{radius:1},{restitution:1}));
  world.addCollider(createCollider(wall,'plane',{normal:{x:0,y:1},offset:0},{restitution:1}));
  const result=world.step(.1);
  assert.equal(result.valid,true);
  assert.equal(result.contactCount,1);
  assert.ok(ball.velocity.y>0);
  assert.ok(Math.abs(ball.position.y-.852)<EPS);
});
test('PhysicsWorld uses kinematic contact surface velocity in collision impulse', () => {
  const world=new PhysicsWorld(), ball=body(1), paddle=body(Infinity,{x:0,y:0},{x:0,y:3});
  ball.position={x:0,y:.5};
  world.addBody(ball); world.addBody(paddle);
  world.addCollider(createCollider(ball,'circle',{radius:1},{restitution:1}));
  world.addCollider(createCollider(paddle,'plane',{normal:{x:0,y:1},offset:0},{restitution:1}));
  const result=world.step(.01);
  assert.equal(result.valid,true);
  assert.ok(ball.velocity.y>0);
  assert.ok(Math.abs(ball.velocity.y-6)<EPS);
});
test('PhysicsWorld rolls back integrated state when narrow phase rejects invalid geometry', () => {
  const world=new PhysicsWorld(), ball=body(1,{x:1,y:0}), wall=body(Infinity);
  ball.position={x:0,y:.5};
  world.addBody(ball); world.addBody(wall);
  world.addCollider(createCollider(ball,'circle',{radius:1}));
  const plane=createCollider(wall,'plane',{normal:{x:0,y:1},offset:0});
  plane.geometry.normal={x:0,y:0};
  world.addCollider(plane);
  const before={position:{...ball.position},velocity:{...ball.velocity},stepCount:world.stepCount};
  const result=world.step(.1);
  assert.equal(result.valid,false);
  assert.deepEqual(ball.position,before.position);
  assert.deepEqual(ball.velocity,before.velocity);
  assert.equal(world.stepCount,before.stepCount);
});


test('Contact collection deterministically sorts and deduplicates equivalent collider pairs', () => {
  const ball=body(1), wall=body(Infinity);
  ball.position={x:0,y:.5};
  const circleA=createCollider(ball,'circle',{radius:1});
  const circleB=createCollider(ball,'circle',{radius:1});
  const planeA=createCollider(wall,'plane',{normal:{x:0,y:1},offset:0});
  const planeB=createCollider(wall,'plane',{normal:{x:0,y:2},offset:0});
  const result=detectContacts([circleA,circleB,planeA,planeB]);
  assert.equal(result.valid,true);
  assert.equal(result.contacts.length,1);
  assert.equal(result.contacts[0].featureId,'circle-plane');
  assert.deepEqual(result.contacts[0].normal,{x:0,y:1});
});
test('Contact collection produces repeatable order for a fixed collider registration order', () => {
  const ball=body(1), wallA=body(Infinity), wallB=body(Infinity);
  ball.position={x:.5,y:.5};
  const colliders=[
    createCollider(ball,'circle',{radius:1}),
    createCollider(wallA,'plane',{normal:{x:1,y:0},offset:0}),
    createCollider(wallB,'plane',{normal:{x:0,y:1},offset:0})
  ];
  const first=detectContacts(colliders), second=detectContacts(colliders);
  assert.deepEqual(first.contacts.map(c=>[c.featureId,c.point.x,c.point.y]),second.contacts.map(c=>[c.featureId,c.point.x,c.point.y]));
});


test('PhysicsWorld resolves simultaneous corner contacts with iterative solver', () => {
  const world=new PhysicsWorld(), ball=body(1,{x:-2,y:-2}), left=body(Infinity), floor=body(Infinity);
  ball.position={x:.5,y:.5};
  world.addBody(ball); world.addBody(left); world.addBody(floor);
  world.addCollider(createCollider(ball,'circle',{radius:1},{restitution:1}));
  world.addCollider(createCollider(left,'plane',{normal:{x:1,y:0},offset:0},{restitution:1}));
  world.addCollider(createCollider(floor,'plane',{normal:{x:0,y:1},offset:0},{restitution:1}));
  const result=world.step(.01,{solverIterations:4});
  assert.equal(result.valid,true);
  assert.equal(result.contactCount,2);
  assert.ok(ball.velocity.x>0);
  assert.ok(ball.velocity.y>0);
  assert.ok(result.contacts.every(contact=>contact.normalImpulse>0));
});
test('PhysicsWorld rejects invalid solver iteration counts without advancing', () => {
  const world=new PhysicsWorld(), ball=body(1,{x:1,y:0});
  world.addBody(ball);
  assert.equal(world.step(.1,{solverIterations:0}).valid,false);
  assert.equal(world.step(.1,{solverIterations:33}).valid,false);
  assert.deepEqual(ball.position,{x:0,y:0});
  assert.equal(world.stepCount,0);
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


test('sweepCirclePlane reports normalized time and exact impact geometry', () => {
  const result=sweepCirclePlane({
    position:{x:3,y:10},velocity:{x:0,y:-200},radius:1,
    normal:{x:0,y:2},offset:0,dt:.1
  });
  assert.equal(result.valid,true);
  assert.ok(Math.abs(result.hit.seconds-.045)<EPS);
  assert.ok(Math.abs(result.hit.toi-.45)<EPS);
  assert.deepEqual(result.hit.center,{x:3,y:1});
  assert.deepEqual(result.hit.point,{x:3,y:0});
  assert.deepEqual(result.hit.normal,{x:0,y:1});
});
test('sweepCirclePlane ignores separating, non-crossing and initially overlapping paths', () => {
  const base={position:{x:0,y:3},radius:1,normal:{x:0,y:1},offset:0,dt:.1};
  assert.equal(sweepCirclePlane({...base,velocity:{x:0,y:2}}).hit,null);
  assert.equal(sweepCirclePlane({...base,velocity:{x:0,y:-5}}).hit,null);
  assert.equal(sweepCirclePlane({...base,position:{x:0,y:.5},velocity:{x:0,y:-10}}).hit,null);
  assert.equal(sweepCirclePlane({...base,velocity:{x:0,y:-30}}).hit.toi,.6666666666666666);
});
test('PhysicsWorld CCD prevents a fast circle tunneling through a static plane', () => {
  for (const dt of [.05,.1,.2]) {
    const world=new PhysicsWorld(), ball=body(1,{x:0,y:-200}), wall=body(Infinity);
    ball.position={x:2,y:10};
    world.addBody(ball); world.addBody(wall);
    world.addCollider(createCollider(ball,'circle',{radius:1},{restitution:1}));
    world.addCollider(createCollider(wall,'plane',{normal:{x:0,y:1},offset:0},{restitution:1}));
    const result=world.step(dt);
    assert.equal(result.valid,true);
    assert.equal(result.ccdEventCount,1);
    assert.ok(ball.position.y>=1-EPS);
    assert.ok(ball.velocity.y>0);
    assert.ok(Math.abs(ball.position.y-(1+200*(dt-.045)))<1e-7);
  }
});
test('PhysicsWorld CCD respects restitution and reports swept contact metadata', () => {
  const world=new PhysicsWorld(), ball=body(2,{x:0,y:-100}), wall=body(Infinity);
  ball.position={x:0,y:6};
  world.addBody(ball); world.addBody(wall);
  world.addCollider(createCollider(ball,'circle',{radius:1},{restitution:.5}));
  world.addCollider(createCollider(wall,'plane',{normal:{x:0,y:1},offset:0},{restitution:.5}));
  const result=world.step(.1);
  assert.equal(result.valid,true);
  assert.equal(result.ccdEventCount,1);
  assert.equal(result.contactCount,1);
  assert.equal(result.contacts[0].toi,.5);
  assert.ok(Math.abs(ball.velocity.y-50)<EPS);
  assert.ok(Math.abs(ball.position.y-3.5)<EPS);
});
test('PhysicsWorld rolls back the whole step when CCD exceeds its event safety limit', () => {
  const world=new PhysicsWorld(), ball=body(1,{x:0,y:1000}), lower=body(Infinity), upper=body(Infinity);
  ball.position={x:0,y:1};
  world.addBody(ball); world.addBody(lower); world.addBody(upper);
  world.addCollider(createCollider(ball,'circle',{radius:.1}));
  world.addCollider(createCollider(lower,'plane',{normal:{x:0,y:1},offset:0}));
  world.addCollider(createCollider(upper,'plane',{normal:{x:0,y:-1},offset:-2}));
  const before={position:{...ball.position},velocity:{...ball.velocity},force:{...ball.force}};
  const result=world.step(.1);
  assert.equal(result.valid,false);
  assert.equal(result.reason,'ccd-event-limit');
  assert.deepEqual(ball.position,before.position);
  assert.deepEqual(ball.velocity,before.velocity);
  assert.deepEqual(ball.force,before.force);
  assert.equal(world.stepCount,0);
});


test('sweepCircleSegment detects side-face TOI and rejects paths outside the finite span', () => {
  const hit=sweepCircleSegment({position:{x:2,y:10},velocity:{x:0,y:-200},radius:1,a:{x:0,y:0},b:{x:4,y:0},dt:.1});
  assert.equal(hit.valid,true);
  assert.ok(Math.abs(hit.hit.seconds-.045)<EPS);
  assert.deepEqual(hit.hit.normal,{x:0,y:1});
  assert.deepEqual(hit.hit.point,{x:2,y:0});
  const miss=sweepCircleSegment({position:{x:8,y:10},velocity:{x:0,y:-200},radius:1,a:{x:0,y:0},b:{x:4,y:0},dt:.1});
  assert.equal(miss.hit,null);
});
test('sweepCircleSegment detects rounded endpoint impacts with radial normals', () => {
  const hit=sweepCircleSegment({position:{x:-.5,y:5},velocity:{x:0,y:-100},radius:1,a:{x:0,y:0},b:{x:4,y:0},dt:.1});
  assert.equal(hit.valid,true);
  assert.ok(hit.hit.seconds>0 && hit.hit.seconds<.05);
  assert.equal(hit.hit.featureId,'circle-segment-end-a');
  assert.ok(Math.abs(Math.hypot(hit.hit.normal.x,hit.hit.normal.y)-1)<EPS);
  assert.ok(Math.abs(Math.hypot(hit.hit.center.x,hit.hit.center.y)-1)<EPS);
});
test('PhysicsWorld CCD prevents fast circle tunneling through a finite static segment', () => {
  const world=new PhysicsWorld(), ball=body(1,{x:0,y:-200}), wall=body(Infinity);
  ball.position={x:2,y:10};
  world.addBody(ball); world.addBody(wall);
  world.addCollider(createCollider(ball,'circle',{radius:1},{restitution:1}));
  world.addCollider(createCollider(wall,'segment',{a:{x:0,y:0},b:{x:4,y:0}},{restitution:1}));
  const result=world.step(.05);
  assert.equal(result.valid,true);
  assert.equal(result.ccdEventCount,1);
  assert.ok(ball.position.y>=1-EPS);
  assert.ok(ball.velocity.y>0);
  assert.ok(Math.abs(ball.position.y-2)<1e-7);
});
test('PhysicsWorld CCD resolves a segment endpoint as a rounded cap', () => {
  const world=new PhysicsWorld(), ball=body(1,{x:0,y:-100}), wall=body(Infinity);
  ball.position={x:-.5,y:5};
  world.addBody(ball); world.addBody(wall);
  world.addCollider(createCollider(ball,'circle',{radius:1},{restitution:1}));
  world.addCollider(createCollider(wall,'segment',{a:{x:0,y:0},b:{x:4,y:0}},{restitution:1}));
  const result=world.step(.1);
  assert.equal(result.valid,true);
  assert.equal(result.ccdEventCount,1);
  assert.equal(result.contacts[0].featureId,'circle-segment-end-a');
  assert.ok(ball.velocity.x<0);
  assert.ok(ball.position.x<-.5);
});


test('sweepCircleAabb detects face TOI and rejects outside-face projections', () => {
  const hit=sweepCircleAabb({position:{x:0,y:-10},velocity:{x:0,y:200},radius:1,x:0,y:0,halfWidth:1,halfHeight:1,dt:.1});
  assert.equal(hit.valid,true);
  assert.ok(Math.abs(hit.hit.seconds-.04)<EPS);
  assert.deepEqual(hit.hit.normal,{x:0,y:-1});
  assert.deepEqual(hit.hit.point,{x:0,y:-1});
  const miss=sweepCircleAabb({position:{x:5,y:-10},velocity:{x:0,y:200},radius:1,x:0,y:0,halfWidth:1,halfHeight:1,dt:.1});
  assert.equal(miss.hit,null);
});
test('sweepCircleAabb detects rounded corner impacts', () => {
  const hit=sweepCircleAabb({position:{x:-5,y:-5},velocity:{x:100,y:100},radius:1,x:0,y:0,halfWidth:1,halfHeight:1,dt:.05});
  assert.equal(hit.valid,true);
  assert.equal(hit.hit.featureId,'circle-aabb-top-left');
  assert.ok(Math.abs(Math.hypot(hit.hit.normal.x,hit.hit.normal.y)-1)<EPS);
  assert.ok(Math.abs(Math.hypot(hit.hit.center.x+1,hit.hit.center.y+1)-1)<EPS);
});
test('PhysicsWorld CCD prevents fast circle tunneling through a static AABB face', () => {
  const world=new PhysicsWorld(), ball=body(1,{x:0,y:200}), box=body(Infinity);
  ball.position={x:0,y:-10};
  world.addBody(ball); world.addBody(box);
  world.addCollider(createCollider(ball,'circle',{radius:1},{restitution:1}));
  world.addCollider(createCollider(box,'aabb',{x:0,y:0,halfWidth:1,halfHeight:1},{restitution:1}));
  const result=world.step(.1);
  assert.equal(result.valid,true);
  assert.equal(result.ccdEventCount,1);
  assert.equal(result.contacts[0].featureId,'circle-aabb-top');
  assert.ok(ball.position.y< -2);
  assert.ok(ball.velocity.y<0);
});
test('PhysicsWorld CCD resolves rounded AABB corner impacts', () => {
  const world=new PhysicsWorld(), ball=body(1,{x:100,y:100}), box=body(Infinity);
  ball.position={x:-5,y:-5};
  world.addBody(ball); world.addBody(box);
  world.addCollider(createCollider(ball,'circle',{radius:1},{restitution:1}));
  world.addCollider(createCollider(box,'aabb',{x:0,y:0,halfWidth:1,halfHeight:1},{restitution:1}));
  const result=world.step(.05);
  assert.equal(result.valid,true);
  assert.equal(result.ccdEventCount,1);
  assert.equal(result.contacts[0].featureId,'circle-aabb-top-left');
  assert.ok(ball.velocity.x<0 && ball.velocity.y<0);
});


test('sweepCircleCircle computes earliest relative-motion TOI', () => {
  const result=sweepCircleCircle({
    positionA:{x:-10,y:0},velocityA:{x:200,y:0},radiusA:1,
    positionB:{x:10,y:0},velocityB:{x:-200,y:0},radiusB:1,dt:.1
  });
  assert.equal(result.valid,true);
  assert.ok(Math.abs(result.hit.seconds-.045)<EPS);
  assert.deepEqual(result.hit.centerA,{x:-1,y:0});
  assert.deepEqual(result.hit.centerB,{x:1,y:0});
  assert.deepEqual(result.hit.normal,{x:-1,y:0});
  assert.deepEqual(result.hit.point,{x:0,y:0});
});
test('sweepCircleCircle ignores separating and non-intersecting trajectories', () => {
  const base={positionA:{x:-5,y:0},radiusA:1,positionB:{x:5,y:0},velocityB:{x:0,y:0},radiusB:1,dt:.1};
  assert.equal(sweepCircleCircle({...base,velocityA:{x:-10,y:0}}).hit,null);
  assert.equal(sweepCircleCircle({...base,velocityA:{x:10,y:10}}).hit,null);
});
test('PhysicsWorld CCD resolves fast dynamic circle-circle impacts without tunneling', () => {
  const world=new PhysicsWorld(), a=body(1,{x:200,y:0}), b=body(1,{x:-200,y:0});
  a.position={x:-10,y:0}; b.position={x:10,y:0};
  world.addBody(a); world.addBody(b);
  world.addCollider(createCollider(a,'circle',{radius:1},{restitution:1}));
  world.addCollider(createCollider(b,'circle',{radius:1},{restitution:1}));
  const result=world.step(.1);
  assert.equal(result.valid,true);
  assert.equal(result.ccdEventCount,1);
  assert.equal(result.contacts[0].featureId,'circle-circle');
  assert.ok(a.velocity.x<0 && b.velocity.x>0);
  assert.ok(a.position.x< -1 && b.position.x>1);
  assert.ok(Math.abs(a.position.x+12)<1e-7);
  assert.ok(Math.abs(b.position.x-12)<1e-7);
});
test('PhysicsWorld CCD finds a static circle even when it is registered first', () => {
  const world=new PhysicsWorld(), fixed=body(Infinity), ball=body(1,{x:200,y:0});
  ball.position={x:-10,y:0};
  world.addBody(fixed); world.addBody(ball);
  world.addCollider(createCollider(fixed,'circle',{radius:1},{restitution:1}));
  world.addCollider(createCollider(ball,'circle',{radius:1},{restitution:1}));
  const result=world.step(.1);
  assert.equal(result.valid,true);
  assert.equal(result.ccdEventCount,1);
  assert.ok(ball.velocity.x<0);
  assert.ok(Math.abs(ball.position.x+14)<1e-7);
});


test('colliderBounds produces finite bounds and infinite planes', () => {
  const ball=body(1), planeBody=body(Infinity);
  ball.position={x:3,y:4};
  assert.deepEqual(colliderBounds(createCollider(ball,'circle',{radius:2})),{minX:1,maxX:5,minY:2,maxY:6});
  assert.deepEqual(colliderBounds(createCollider(planeBody,'plane',{normal:{x:0,y:1},offset:0})),
    {minX:-Infinity,maxX:Infinity,minY:-Infinity,maxY:Infinity});
});
test('sweep-and-prune broad phase filters separated finite colliders and keeps plane pairs', () => {
  const worldBodies=[body(1),body(1),body(Infinity),body(Infinity)];
  worldBodies[0].position={x:0,y:0};
  worldBodies[1].position={x:20,y:20};
  const colliders=[
    createCollider(worldBodies[0],'circle',{radius:1}),
    createCollider(worldBodies[1],'circle',{radius:1}),
    createCollider(worldBodies[2],'plane',{normal:{x:0,y:1},offset:0}),
    createCollider(worldBodies[3],'segment',{a:{x:50,y:50},b:{x:60,y:50}})
  ];
  const result=buildBroadPhasePairs(colliders);
  assert.equal(result.valid,true);
  assert.deepEqual(result.pairs,[[0,2],[1,2]]);
});
test('broad phase returns stable collider-index pair order and skips static-static pairs', () => {
  const a=body(Infinity), b=body(Infinity), c=body(1);
  const colliders=[
    createCollider(a,'aabb',{x:0,y:0,halfWidth:2,halfHeight:2}),
    createCollider(b,'segment',{a:{x:-1,y:0},b:{x:1,y:0}}),
    createCollider(c,'circle',{radius:1})
  ];
  const first=buildBroadPhasePairs(colliders), second=buildBroadPhasePairs(colliders);
  assert.deepEqual(first.pairs,[[0,2],[1,2]]);
  assert.deepEqual(first.pairs,second.pairs);
});
test('broad phase fails closed when collider geometry is corrupted', () => {
  const ball=body(1), wall=body(Infinity);
  const circle=createCollider(ball,'circle',{radius:1});
  const plane=createCollider(wall,'plane',{normal:{x:0,y:1},offset:0});
  plane.geometry.normal={x:0,y:0};
  const result=buildBroadPhasePairs([circle,plane]);
  assert.equal(result.valid,false);
  assert.equal(result.reason,'invalid-collider');
});


test('swept broad phase includes fast circles whose paths cross finite colliders', () => {
  const ball=body(1,{x:200,y:0}), wall=body(Infinity);
  ball.position={x:-10,y:0};
  const colliders=[
    createCollider(ball,'circle',{radius:1}),
    createCollider(wall,'segment',{a:{x:0,y:-2},b:{x:0,y:2}})
  ];
  assert.deepEqual(buildBroadPhasePairs(colliders).pairs,[]);
  assert.deepEqual(buildBroadPhasePairs(colliders,{sweepDt:.1}).pairs,[[0,1]]);
});
test('swept broad phase covers both moving circles and rejects invalid sweep dt', () => {
  const a=body(1,{x:100,y:0}), b=body(1,{x:-100,y:0});
  a.position={x:-10,y:0}; b.position={x:10,y:0};
  const colliders=[createCollider(a,'circle',{radius:1}),createCollider(b,'circle',{radius:1})];
  assert.deepEqual(buildBroadPhasePairs(colliders).pairs,[]);
  assert.deepEqual(buildBroadPhasePairs(colliders,{sweepDt:.1}).pairs,[[0,1]]);
  assert.equal(buildBroadPhasePairs(colliders,{sweepDt:-1}).valid,false);
});


test('PhysicsWorld CCD resolves simultaneous orthogonal plane impacts at one TOI', () => {
  const world=new PhysicsWorld(), ball=body(1,{x:-200,y:-200}), vertical=body(Infinity), horizontal=body(Infinity);
  ball.position={x:10,y:10};
  world.addBody(ball); world.addBody(vertical); world.addBody(horizontal);
  world.addCollider(createCollider(ball,'circle',{radius:1},{restitution:1}));
  world.addCollider(createCollider(vertical,'plane',{normal:{x:1,y:0},offset:0},{restitution:1}));
  world.addCollider(createCollider(horizontal,'plane',{normal:{x:0,y:1},offset:0},{restitution:1}));
  const result=world.step(.1);
  assert.equal(result.valid,true);
  assert.equal(result.ccdEventCount,2);
  assert.ok(ball.velocity.x>0 && ball.velocity.y>0);
  assert.ok(Math.abs(ball.position.x-12)<1e-7);
  assert.ok(Math.abs(ball.position.y-12)<1e-7);
});
