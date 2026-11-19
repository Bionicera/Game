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



/**
 * Deterministic body registry and force/integration owner.
 * This prototype deliberately has no collision detection or contact pipeline.
 */
class PhysicsWorld {
  constructor() {
    this.bodies = [];
    this.bodySet = new Set();
    this.forceGenerators = [];
    this.forceGeneratorSet = new Set();
    this.stepCount = 0;
  }

  addBody(body) {
    if (!body || !Number.isFinite(body.invMass) || !isFiniteVector(body.position) ||
        !isFiniteVector(body.velocity) || !isFiniteVector(body.force)) {
      return {valid:false,reason:'invalid-body'};
    }
    if (this.bodySet.has(body)) return {valid:false,reason:'body-already-registered'};
    this.bodySet.add(body);
    this.bodies.push(body);
    return {valid:true,body};
  }

  removeBody(body) {
    if (!this.bodySet.has(body)) return false;
    this.bodySet.delete(body);
    this.bodies.splice(this.bodies.indexOf(body),1);
    return true;
  }

  addForceGenerator(generator) {
    if (typeof generator !== 'function') return {valid:false,reason:'invalid-force-generator'};
    if (this.forceGeneratorSet.has(generator)) return {valid:false,reason:'force-generator-already-registered'};
    this.forceGeneratorSet.add(generator);
    this.forceGenerators.push(generator);
    return {valid:true};
  }

  removeForceGenerator(generator) {
    if (!this.forceGeneratorSet.has(generator)) return false;
    this.forceGeneratorSet.delete(generator);
    this.forceGenerators.splice(this.forceGenerators.indexOf(generator),1);
    return true;
  }

  step(dt) {
    if (!(dt > 0) || !Number.isFinite(dt)) return {valid:false,reason:'invalid-world-dt'};
    const forceSnapshots = this.bodies.map(body => ({body,force:{...body.force}}));
    for (const body of this.bodies) {
      if (body.invMass === 0) continue;
      for (const generator of this.forceGenerators) {
        let force;
        try { force = generator(body,dt,this); }
        catch (_) {
          for (const snapshot of forceSnapshots) snapshot.body.force = snapshot.force;
          return {valid:false,reason:'force-generator-threw'};
        }
        if (force == null) continue;
        if (!applyForce(body,force)) {
          for (const snapshot of forceSnapshots) snapshot.body.force = snapshot.force;
          return {valid:false,reason:'invalid-generated-force'};
        }
      }
    }

    // Preflight every body on copies so a bad body cannot partially advance the world.
    const results = [];
    for (const body of this.bodies) {
      if (body.invMass === 0) { results.push(null); continue; }
      const candidate = {...body,position:{...body.position},velocity:{...body.velocity},force:{...body.force}};
      const result = integrateBody(candidate,dt);
      if (!result.valid) {
        for (const snapshot of forceSnapshots) snapshot.body.force = snapshot.force;
        return {valid:false,reason:result.reason};
      }
      results.push({position:candidate.position,velocity:candidate.velocity,force:candidate.force});
    }
    for (let i=0;i<this.bodies.length;i++) {
      if (!results[i]) continue;
      Object.assign(this.bodies[i],results[i]);
    }
    this.stepCount++;
    return {valid:true,stepCount:this.stepCount,bodyCount:this.bodies.length};
  }
}

/**
 * Fixed-step accumulator. Excess whole steps remain in backlog; they are never
 * silently discarded. The caller can inspect backlogSeconds and choose when to
 * catch up. A paused runner does not accumulate wall-clock frame time.
 */
class FixedStepRunner {
  constructor(world,{fixedDt=1/120,maxSubSteps=4}={}) {
    if (!world || typeof world.step !== 'function') throw new TypeError('world must provide step(dt)');
    if (!(fixedDt > 0) || !Number.isFinite(fixedDt)) throw new RangeError('fixedDt must be finite and positive');
    if (!Number.isInteger(maxSubSteps) || maxSubSteps < 1) throw new RangeError('maxSubSteps must be a positive integer');
    this.world = world;
    this.fixedDt = fixedDt;
    this.maxSubSteps = maxSubSteps;
    this.accumulator = 0;
    this.paused = false;
  }

  advance(frameDt) {
    if (!Number.isFinite(frameDt) || frameDt < 0) return {valid:false,reason:'invalid-frame-dt'};
    if (this.paused) return {valid:true,steps:0,backlogSeconds:this.accumulator,paused:true};
    const nextAccumulator = this.accumulator + frameDt;
    if (!Number.isFinite(nextAccumulator)) return {valid:false,reason:'accumulator-overflow'};
    this.accumulator = nextAccumulator;
    let steps = 0;
    while (this.accumulator + EPSILON >= this.fixedDt && steps < this.maxSubSteps) {
      const result = this.world.step(this.fixedDt);
      if (!result.valid) return {...result,steps,backlogSeconds:this.accumulator};
      this.accumulator = Math.max(0,this.accumulator-this.fixedDt);
      steps++;
    }
    return {valid:true,steps,backlogSeconds:this.accumulator,backlogSteps:Math.floor((this.accumulator+EPSILON)/this.fixedDt)};
  }

  setPaused(paused) {
    this.paused = !!paused;
    return this.paused;
  }

  reset({clearBacklog=true}={}) {
    if (clearBacklog) this.accumulator = 0;
    return {accumulator:this.accumulator,paused:this.paused};
  }
}

module.exports = {createBody,applyForce,applyImpulse,integrateBody,createContactTelemetry,kineticEnergy,linearMomentum,solveContact,PhysicsWorld,FixedStepRunner};
