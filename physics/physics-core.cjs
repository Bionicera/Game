'use strict';

const EPSILON = 1e-10;

function isFiniteVector(v) {
  return !!v && Number.isFinite(v.x) && Number.isFinite(v.y);
}
function dot(a,b) { return a.x*b.x + a.y*b.y; }
function add(a,b) { return {x:a.x+b.x,y:a.y+b.y}; }
function scale(a,s) { return {x:a.x*s,y:a.y*s}; }
function subtract(a,b) { return {x:a.x-b.x,y:a.y-b.y}; }

function createBody(mass, velocity={x:0,y:0}, surfaceVelocity={x:0,y:0}) {
  if (!(mass > 0) && mass !== Infinity) throw new RangeError('mass must be positive or Infinity');
  if (!isFiniteVector(velocity) || !isFiniteVector(surfaceVelocity)) {
    throw new TypeError('body velocities must be finite vectors');
  }
  return {
    mass,
    invMass: mass === Infinity ? 0 : 1/mass,
    velocity: {...velocity},
    surfaceVelocity: {...surfaceVelocity},
    force: {x:0,y:0},
    position: {x:0,y:0}
  };
}

function applyForce(body, force) {
  if (!body || body.invMass === 0 || !isFiniteVector(force)) return false;
  const nextForce = add(body.force,force);
  if (!isFiniteVector(nextForce)) return false;
  body.force = nextForce;
  return true;
}

function applyImpulse(body, impulse) {
  if (!body || body.invMass === 0 || !isFiniteVector(impulse)) return false;
  const nextVelocity = add(body.velocity,scale(impulse,body.invMass));
  if (!isFiniteVector(nextVelocity)) return false;
  body.velocity = nextVelocity;
  return true;
}

// Semi-implicit Euler: update velocity from accumulated force, then position.
// Forces are cleared after each successful step.
function integrateBody(body, dt) {
  if (!body || body.invMass === 0 || !(dt >= 0) || !Number.isFinite(dt) ||
      !isFiniteVector(body.position) || !isFiniteVector(body.velocity) || !isFiniteVector(body.force)) {
    return {valid:false,reason:'invalid-integration-input'};
  }
  const acceleration = scale(body.force,body.invMass);
  const nextVelocity = add(body.velocity,scale(acceleration,dt));
  const nextPosition = add(body.position,scale(nextVelocity,dt));
  if (!isFiniteVector(nextVelocity) || !isFiniteVector(nextPosition)) {
    return {valid:false,reason:'non-finite-integration-result'};
  }
  body.velocity = nextVelocity;
  body.position = nextPosition;
  body.force = {x:0,y:0};
  return {valid:true,acceleration};
}

function createContactTelemetry(bodyA,bodyB,contact,result,energyBefore) {
  if (!result || !result.valid) return {valid:false,reason:result?.reason || 'invalid-solver-result'};
  const energyAfter = kineticEnergy(bodyA)+kineticEnergy(bodyB);
  const momentumAfter = add(linearMomentum(bodyA),linearMomentum(bodyB));
  return {
    valid:true,
    bodyA:bodyA.id ?? null, bodyB:bodyB.id ?? null,
    point:contact?.point ? {...contact.point} : null,
    normal:result.normal ? {...result.normal} : null,
    relativeVelocity:result.relativeVelocity ? {...result.relativeVelocity} : null,
    normalImpulse:result.normalImpulse ?? 0,
    tangentImpulse:result.tangentImpulse ?? 0,
    kineticEnergyBefore:energyBefore,
    kineticEnergyAfter:energyAfter,
    kineticEnergyDelta:energyAfter-energyBefore,
    kinematicWork:result.kinematicWork ?? 0,
    momentumAfter
  };
}

function kineticEnergy(body) {
  return body.invMass === 0 ? 0 : .5*body.mass*dot(body.velocity,body.velocity);
}
function linearMomentum(body) {
  return body.invMass === 0 ? {x:0,y:0} : scale(body.velocity,body.mass);
}

/**
 * Translational, single-contact impulse solver prototype.
 * Contact normal points from B to A. surfaceVelocity is the velocity
 * of the body's material point at the contact location.
 */
function solveContact(bodyA, bodyB, normal, material={}) {
  const restitution = material.restitution ?? 1;
  const friction = material.friction ?? 0;
  const length = isFiniteVector(normal) ? Math.hypot(normal.x,normal.y) : NaN;
  const invalid = reason => ({valid:false, applied:false, reason, normalImpulse:0, tangentImpulse:0});
  if (!Number.isFinite(length) || length < EPSILON) return invalid('degenerate-normal');
  if (![bodyA,bodyB].every(b => b && b.mass > 0 || b && b.mass === Infinity) ||
      ![bodyA.invMass,bodyB.invMass].every(Number.isFinite) ||
      ![bodyA.velocity,bodyB.velocity,bodyA.surfaceVelocity,bodyB.surfaceVelocity].every(isFiniteVector) ||
      !Number.isFinite(restitution) || restitution < 0 || restitution > 1 ||
      !Number.isFinite(friction) || friction < 0) return invalid('invalid-input');

  const inverseMassSum = bodyA.invMass + bodyB.invMass;
  if (!(inverseMassSum > 0) || !Number.isFinite(inverseMassSum)) return invalid('zero-inverse-mass');

  const n = scale(normal,1/length);
  const tangent = {x:-n.y,y:n.x};
  const contactVelocityA = add(bodyA.velocity,bodyA.surfaceVelocity);
  const contactVelocityB = add(bodyB.velocity,bodyB.surfaceVelocity);
  const relativeVelocity = subtract(contactVelocityA,contactVelocityB);
  const normalSpeed = dot(relativeVelocity,n);
  if (normalSpeed >= 0) {
    return {valid:true,applied:false,reason:'separating',normal:n,normalSpeed,normalImpulse:0,tangentImpulse:0};
  }

  const normalImpulse = -(1+restitution)*normalSpeed/inverseMassSum;
  const tangentSpeed = dot(relativeVelocity,tangent);
  const tangentImpulse = Math.max(-friction*normalImpulse,
    Math.min(friction*normalImpulse,-tangentSpeed/inverseMassSum));
  const impulse = add(scale(n,normalImpulse),scale(tangent,tangentImpulse));

  bodyA.velocity = add(bodyA.velocity,scale(impulse,bodyA.invMass));
  bodyB.velocity = subtract(bodyB.velocity,scale(impulse,bodyB.invMass));

  const kinematicWork = bodyB.invMass===0 ? dot(impulse,bodyB.surfaceVelocity) :
    bodyA.invMass===0 ? -dot(impulse,bodyA.surfaceVelocity) : 0;

  return {
    valid:true,applied:true,normal:n,tangent,relativeVelocity,normalSpeed,tangentSpeed,
    normalImpulse,tangentImpulse,impulse,kinematicWork
  };
}

module.exports = {createBody,applyForce,applyImpulse,integrateBody,createContactTelemetry,kineticEnergy,linearMomentum,solveContact};
