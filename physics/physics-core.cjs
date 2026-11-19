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




function createCollider(body, shape, geometry={}, material={}) {
  if (!body || !Number.isFinite(body.invMass) || !isFiniteVector(body.position)) throw new TypeError('collider requires a valid body');
  if (!['circle','plane','aabb','segment'].includes(shape)) throw new TypeError('unsupported collider shape');
  const g={...geometry};
  if (shape==='circle' && (!(g.radius>0) || !Number.isFinite(g.radius))) throw new RangeError('circle radius must be positive');
  if (shape==='plane') {
    const length=isFiniteVector(g.normal)?Math.hypot(g.normal.x,g.normal.y):NaN;
    if (!Number.isFinite(length) || length<EPSILON || !Number.isFinite(g.offset)) throw new TypeError('plane requires finite normal and offset');
    g.normal=scale(g.normal,1/length); g.offset/=length;
  }
  if (shape==='aabb' && (!(g.halfWidth>0) || !(g.halfHeight>0) || !Number.isFinite(g.x) || !Number.isFinite(g.y) || !Number.isFinite(g.halfWidth) || !Number.isFinite(g.halfHeight))) throw new TypeError('aabb requires finite center and positive half extents');
  if (shape==='segment' && (!isFiniteVector(g.a) || !isFiniteVector(g.b) || Math.hypot(g.b.x-g.a.x,g.b.y-g.a.y)<EPSILON)) throw new TypeError('segment requires distinct finite endpoints');
  const restitution=material.restitution ?? 1, friction=material.friction ?? 0;
  if (!Number.isFinite(restitution) || restitution<0 || restitution>1 || !Number.isFinite(friction) || friction<0) throw new RangeError('invalid collider material');
  return {body,shape,geometry:g,material:{restitution,friction}};
}
function closestPointOnSegment(point,a,b) {
  const ab=subtract(b,a), t=Math.max(0,Math.min(1,dot(subtract(point,a),ab)/dot(ab,ab)));
  return add(a,scale(ab,t));
}
function circleContact(circleCollider, otherCollider) {
  const center=circleCollider.body.position, radius=circleCollider.geometry.radius, other=otherCollider.geometry, otherBody=otherCollider.body;
  let normal,point,penetration,featureId;
  if (otherCollider.shape==='circle') {
    const delta=subtract(center,otherBody.position), distance=Math.hypot(delta.x,delta.y);
    penetration=radius+other.radius-distance; if (!(penetration>0)) return null;
    normal=distance>EPSILON?scale(delta,1/distance):{x:1,y:0}; point=subtract(center,scale(normal,radius)); featureId='circle-circle';
  } else if (otherCollider.shape==='plane') {
    const distance=dot(center,other.normal)-other.offset; penetration=radius-distance; if (!(penetration>0)) return null;
    normal=other.normal; point=subtract(center,scale(normal,distance)); featureId='circle-plane';
  } else if (otherCollider.shape==='aabb') {
    const closest={x:Math.max(other.x-other.halfWidth,Math.min(other.x+other.halfWidth,center.x)),y:Math.max(other.y-other.halfHeight,Math.min(other.y+other.halfHeight,center.y))};
    const delta=subtract(center,closest), distance=Math.hypot(delta.x,delta.y);
    if (distance>EPSILON) { penetration=radius-distance; if (!(penetration>0)) return null; normal=scale(delta,1/distance); point=closest; featureId='circle-aabb-face'; }
    else {
      const faces=[
        {d:center.x-(other.x-other.halfWidth),n:{x:-1,y:0},p:{x:other.x-other.halfWidth,y:center.y},id:'left'},
        {d:other.x+other.halfWidth-center.x,n:{x:1,y:0},p:{x:other.x+other.halfWidth,y:center.y},id:'right'},
        {d:center.y-(other.y-other.halfHeight),n:{x:0,y:-1},p:{x:center.x,y:other.y-other.halfHeight},id:'top'},
        {d:other.y+other.halfHeight-center.y,n:{x:0,y:1},p:{x:center.x,y:other.y+other.halfHeight},id:'bottom'}
      ].sort((a,b)=>a.d-b.d);
      normal=faces[0].n; point=faces[0].p; penetration=radius+faces[0].d; featureId='circle-aabb-'+faces[0].id;
    }
  } else if (otherCollider.shape==='segment') {
    point=closestPointOnSegment(center,other.a,other.b);
    const delta=subtract(center,point), distance=Math.hypot(delta.x,delta.y); penetration=radius-distance; if (!(penetration>0)) return null;
    if (distance>EPSILON) normal=scale(delta,1/distance);
    else {const edge=subtract(other.b,other.a),length=Math.hypot(edge.x,edge.y);normal={x:-edge.y/length,y:edge.x/length};}
    featureId='circle-segment';
  } else return null;
  return {bodyA:circleCollider.body,bodyB:otherBody,point,normal,penetration,toi:null,surfaceVelocity:{...otherBody.surfaceVelocity},featureId,
    material:{restitution:Math.min(circleCollider.material.restitution,otherCollider.material.restitution),friction:Math.sqrt(circleCollider.material.friction*otherCollider.material.friction)}};
}
function detectContacts(colliders) {
  if (!Array.isArray(colliders)) return {valid:false,reason:'invalid-collider-list',contacts:[]};
  const contacts=[];
  for(let i=0;i<colliders.length;i++) {
    const a=colliders[i]; if(!a||!a.body||!['circle','plane','aabb','segment'].includes(a.shape)) return {valid:false,reason:'invalid-collider',contacts:[]};
    for(let j=i+1;j<colliders.length;j++) {
      const b=colliders[j]; if(!b||!b.body||a.body===b.body||(a.body.invMass===0&&b.body.invMass===0)) continue;
      let c=null;
      if(a.shape==='circle') c=circleContact(a,b);
      else if(b.shape==='circle') {const r=circleContact(b,a);if(r)c={...r,bodyA:r.bodyB,bodyB:r.bodyA,normal:scale(r.normal,-1),surfaceVelocity:{...a.body.surfaceVelocity}};}
      if(c) contacts.push({...c,colliderA:c.bodyA===a.body?a:b,colliderB:c.bodyB===b.body?b:a});
    }
  }
  return {valid:true,contacts};
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
    this.colliders = [];
    this.colliderSet = new Set();
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

  addCollider(collider) {
    if (!collider || !this.bodySet.has(collider.body) || !['circle','plane','aabb','segment'].includes(collider.shape)) return {valid:false,reason:'invalid-collider'};
    if (this.colliderSet.has(collider)) return {valid:false,reason:'collider-already-registered'};
    this.colliderSet.add(collider); this.colliders.push(collider); return {valid:true,collider};
  }
  removeCollider(collider) {
    if (!this.colliderSet.has(collider)) return false;
    this.colliderSet.delete(collider); this.colliders.splice(this.colliders.indexOf(collider),1); return true;
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

  step(dt,{positionCorrection=.8,positionSlop=.01}={}) {
    if (!(dt>0)||!Number.isFinite(dt)||!Number.isFinite(positionCorrection)||positionCorrection<0||positionCorrection>1||!Number.isFinite(positionSlop)||positionSlop<0) return {valid:false,reason:'invalid-world-step-options'};
    const snapshots=this.bodies.map(body=>({body,position:{...body.position},velocity:{...body.velocity},force:{...body.force}}));
    const rollback=()=>{for(const s of snapshots){s.body.position=s.position;s.body.velocity=s.velocity;s.body.force=s.force;}};
    for(const body of this.bodies) {
      if(body.invMass===0) continue;
      for(const generator of this.forceGenerators) {
        let force; try{force=generator(body,dt,this);}catch(_){rollback();return {valid:false,reason:'force-generator-threw'};}
        if(force==null) continue;
        if(!applyForce(body,force)){rollback();return {valid:false,reason:'invalid-generated-force'};}
      }
    }
    for(const body of this.bodies) {
      if(body.invMass===0) continue;
      const candidate={...body,position:{...body.position},velocity:{...body.velocity},force:{...body.force}};
      const result=integrateBody(candidate,dt);
      if(!result.valid){rollback();return {valid:false,reason:result.reason};}
      body.position=candidate.position;body.velocity=candidate.velocity;body.force=candidate.force;
    }
    const detected=detectContacts(this.colliders);
    if(!detected.valid){rollback();return detected;}
    for(const contact of detected.contacts) {
      const solved=solveContact(contact.bodyA,contact.bodyB,contact.normal,contact.material);
      if(!solved.valid){rollback();return {valid:false,reason:'contact-solver-failed',featureId:contact.featureId};}
      const invSum=contact.bodyA.invMass+contact.bodyB.invMass;
      const correction=Math.max(contact.penetration-positionSlop,0)*positionCorrection/invSum;
      if(correction>0) {
        contact.bodyA.position=add(contact.bodyA.position,scale(contact.normal,correction*contact.bodyA.invMass));
        contact.bodyB.position=subtract(contact.bodyB.position,scale(contact.normal,correction*contact.bodyB.invMass));
      }
      contact.normalImpulse=solved.normalImpulse||0;contact.tangentImpulse=solved.tangentImpulse||0;
    }
    this.stepCount++;
    return {valid:true,stepCount:this.stepCount,bodyCount:this.bodies.length,contactCount:detected.contacts.length,contacts:detected.contacts};
  }}

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

module.exports = {createBody,applyForce,applyImpulse,integrateBody,createContactTelemetry,kineticEnergy,linearMomentum,solveContact,createCollider,detectContacts,PhysicsWorld,FixedStepRunner};
