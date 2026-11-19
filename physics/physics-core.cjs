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

function createContact({bodyA,bodyB,point,normal,penetration=0,toi=null,surfaceVelocity={x:0,y:0},featureId,material={}}={}) {
  const invalid = reason => ({valid:false,reason,contact:null});
  if (!bodyA || !bodyB || bodyA===bodyB ||
      ![bodyA,bodyB].every(body => Number.isFinite(body.invMass) && body.invMass>=0 &&
        (body.mass>0 || body.mass===Infinity))) return invalid('invalid-contact-bodies');
  if (!isFiniteVector(point) || !isFiniteVector(normal) || !isFiniteVector(surfaceVelocity)) {
    return invalid('invalid-contact-vectors');
  }
  const normalLength=Math.hypot(normal.x,normal.y);
  if (!Number.isFinite(normalLength) || normalLength<EPSILON) return invalid('degenerate-contact-normal');
  if (!Number.isFinite(penetration) || penetration<0) return invalid('invalid-contact-penetration');
  if (toi!==null && (!Number.isFinite(toi) || toi<0 || toi>1)) return invalid('invalid-contact-toi');
  if (typeof featureId!=='string' || featureId.length===0) return invalid('invalid-contact-feature-id');
  const restitution=material.restitution ?? 1, friction=material.friction ?? 0;
  if (!Number.isFinite(restitution) || restitution<0 || restitution>1 ||
      !Number.isFinite(friction) || friction<0) return invalid('invalid-contact-material');
  return {
    valid:true,
    contact:{
      bodyA,bodyB,point:{...point},normal:{x:normal.x===0?0:normal.x/normalLength,y:normal.y===0?0:normal.y/normalLength},penetration,toi,
      surfaceVelocity:{...surfaceVelocity},featureId,
      material:{restitution,friction}
    }
  };
}

function createCollider(body,shape,geometry={},material={}) {
  if (!body || !Number.isFinite(body.invMass) || body.invMass<0 ||
      !(body.mass>0 || body.mass===Infinity) || !isFiniteVector(body.position)) {
    throw new TypeError('collider requires a valid body');
  }
  if (!['circle','plane','aabb','segment'].includes(shape)) throw new TypeError('unsupported collider shape');
  const g={...geometry};
  if (shape==='circle') {
    if (!(g.radius>0) || !Number.isFinite(g.radius)) throw new RangeError('circle radius must be finite and positive');
  } else if (shape==='plane') {
    const length=isFiniteVector(g.normal)?Math.hypot(g.normal.x,g.normal.y):NaN;
    if (!Number.isFinite(length) || length<EPSILON || !Number.isFinite(g.offset)) throw new TypeError('plane requires a finite normal and offset');
    g.normal=scale(g.normal,1/length);
    g.offset/=length;
  } else if (shape==='aabb') {
    if (![g.x,g.y,g.halfWidth,g.halfHeight].every(Number.isFinite) || !(g.halfWidth>0) || !(g.halfHeight>0)) {
      throw new TypeError('aabb requires finite center and positive half extents');
    }
  } else if (shape==='segment') {
    if (!isFiniteVector(g.a) || !isFiniteVector(g.b) ||
        Math.hypot(g.b.x-g.a.x,g.b.y-g.a.y)<EPSILON) {
      throw new TypeError('segment requires distinct finite endpoints');
    }
    g.a={...g.a}; g.b={...g.b};
  }
  const restitution=material.restitution ?? 1, friction=material.friction ?? 0;
  if (!Number.isFinite(restitution) || restitution<0 || restitution>1 ||
      !Number.isFinite(friction) || friction<0) throw new RangeError('invalid collider material');
  return {body,shape,geometry:g,material:{restitution,friction}};
}

function closestPointOnSegment(point,a,b) {
  const ab=subtract(b,a);
  const lengthSquared=dot(ab,ab);
  const t=Math.max(0,Math.min(1,dot(subtract(point,a),ab)/lengthSquared));
  return add(a,scale(ab,t));
}

function circleContact(circleCollider,otherCollider) {
  const center=circleCollider.body.position;
  const radius=circleCollider.geometry.radius;
  const other=otherCollider.geometry;
  const otherBody=otherCollider.body;
  let normal,point,penetration,featureId;
  if (otherCollider.shape==='circle') {
    const delta=subtract(center,otherBody.position);
    const distance=Math.hypot(delta.x,delta.y);
    penetration=radius+other.radius-distance;
    if (!(penetration>0)) return null;
    normal=distance>EPSILON?scale(delta,1/distance):{x:1,y:0};
    point=subtract(center,scale(normal,radius));
    featureId='circle-circle';
  } else if (otherCollider.shape==='plane') {
    const distance=dot(center,other.normal)-other.offset;
    penetration=radius-distance;
    if (!(penetration>0)) return null;
    normal=other.normal;
    point=subtract(center,scale(normal,distance));
    featureId='circle-plane';
  } else if (otherCollider.shape==='aabb') {
    const closest={
      x:Math.max(other.x-other.halfWidth,Math.min(other.x+other.halfWidth,center.x)),
      y:Math.max(other.y-other.halfHeight,Math.min(other.y+other.halfHeight,center.y))
    };
    const delta=subtract(center,closest);
    const distance=Math.hypot(delta.x,delta.y);
    if (distance>EPSILON) {
      penetration=radius-distance;
      if (!(penetration>0)) return null;
      normal=scale(delta,1/distance);
      point=closest;
      featureId='circle-aabb-face';
    } else {
      const faces=[
        {distance:center.x-(other.x-other.halfWidth),normal:{x:-1,y:0},point:{x:other.x-other.halfWidth,y:center.y},id:'left'},
        {distance:other.x+other.halfWidth-center.x,normal:{x:1,y:0},point:{x:other.x+other.halfWidth,y:center.y},id:'right'},
        {distance:center.y-(other.y-other.halfHeight),normal:{x:0,y:-1},point:{x:center.x,y:other.y-other.halfHeight},id:'top'},
        {distance:other.y+other.halfHeight-center.y,normal:{x:0,y:1},point:{x:center.x,y:other.y+other.halfHeight},id:'bottom'}
      ];
      faces.sort((a,b)=>a.distance-b.distance);
      normal=faces[0].normal;
      point=faces[0].point;
      penetration=radius+faces[0].distance;
      featureId='circle-aabb-'+faces[0].id;
    }
  } else if (otherCollider.shape==='segment') {
    point=closestPointOnSegment(center,other.a,other.b);
    const delta=subtract(center,point);
    const distance=Math.hypot(delta.x,delta.y);
    penetration=radius-distance;
    if (!(penetration>0)) return null;
    if (distance>EPSILON) normal=scale(delta,1/distance);
    else {
      const edge=subtract(other.b,other.a);
      const length=Math.hypot(edge.x,edge.y);
      normal={x:-edge.y/length,y:edge.x/length};
    }
    featureId='circle-segment';
  } else return null;

  const contact=createContact({
    bodyA:circleCollider.body,bodyB:otherBody,point,normal,penetration,toi:null,
    surfaceVelocity:otherBody.surfaceVelocity || {x:0,y:0},featureId,
    material:{
      restitution:Math.min(circleCollider.material.restitution,otherCollider.material.restitution),
      friction:Math.sqrt(circleCollider.material.friction*otherCollider.material.friction)
    }
  });
  if (!contact.valid) return {valid:false,reason:contact.reason};
  return contact.contact;
}

function detectContacts(colliders) {
  if (!Array.isArray(colliders)) return {valid:false,reason:'invalid-collider-list',contacts:[]};
  const contacts=[];
  for(let i=0;i<colliders.length;i++) {
    const a=colliders[i];
    if(!a || !a.body || !['circle','plane','aabb','segment'].includes(a.shape)) {
      return {valid:false,reason:'invalid-collider',contacts:[]};
    }
    for(let j=i+1;j<colliders.length;j++) {
      const b=colliders[j];
      if(!b || !b.body || !['circle','plane','aabb','segment'].includes(b.shape)) {
        return {valid:false,reason:'invalid-collider',contacts:[]};
      }
      if(a.body===b.body || (a.body.invMass===0 && b.body.invMass===0)) continue;
      let contact=null;
      if(a.shape==='circle') {
        contact=circleContact(a,b);
      } else if(b.shape==='circle') {
        const reversed=circleContact(b,a);
        if(reversed) {
          const result=createContact({
            bodyA:reversed.bodyB,bodyB:reversed.bodyA,point:reversed.point,
            normal:scale(reversed.normal,-1),penetration:reversed.penetration,toi:reversed.toi,
            surfaceVelocity:reversed.bodyB.surfaceVelocity || {x:0,y:0},
            featureId:reversed.featureId,material:reversed.material
          });
          if(!result.valid) return {valid:false,reason:result.reason,contacts:[]};
          contact=result.contact;
        }
      }
      if(contact && contact.valid===false) return {valid:false,reason:contact.reason,contacts:[]};
      if(contact) contacts.push(contact);
    }
  }
  const bodyOrder=new Map();
  for (const collider of colliders) {
    if (!bodyOrder.has(collider.body)) bodyOrder.set(collider.body,bodyOrder.size);
  }
  const compare=(a,b)=>{
    return (bodyOrder.get(a.bodyA)-bodyOrder.get(b.bodyA)) ||
      (bodyOrder.get(a.bodyB)-bodyOrder.get(b.bodyB)) ||
      a.featureId.localeCompare(b.featureId) ||
      (a.point.x-b.point.x) || (a.point.y-b.point.y) ||
      (a.normal.x-b.normal.x) || (a.normal.y-b.normal.y);
  };
  contacts.sort(compare);
  const unique=[];
  for (const contact of contacts) {
    const duplicate=unique.some(existing=>
      existing.bodyA===contact.bodyA && existing.bodyB===contact.bodyB &&
      existing.featureId===contact.featureId &&
      Math.abs(existing.point.x-contact.point.x)<=EPSILON &&
      Math.abs(existing.point.y-contact.point.y)<=EPSILON &&
      Math.abs(existing.normal.x-contact.normal.x)<=EPSILON &&
      Math.abs(existing.normal.y-contact.normal.y)<=EPSILON
    );
    if (!duplicate) unique.push(contact);
  }
  return {valid:true,contacts:unique};
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
    this.bodies=[];
    this.bodySet=new Set();
    this.colliders=[];
    this.colliderSet=new Set();
    this.forceGenerators=[];
    this.forceGeneratorSet=new Set();
    this.stepCount=0;
  }

  addBody(body) {
    if (!body || !Number.isFinite(body.invMass) || body.invMass<0 ||
        !(body.mass>0 || body.mass===Infinity) || !isFiniteVector(body.position) ||
        !isFiniteVector(body.velocity) || !isFiniteVector(body.force) ||
        !isFiniteVector(body.surfaceVelocity)) return {valid:false,reason:'invalid-body'};
    if (this.bodySet.has(body)) return {valid:false,reason:'body-already-registered'};
    this.bodySet.add(body);
    this.bodies.push(body);
    return {valid:true,body};
  }

  addCollider(collider) {
    if (!collider || !this.bodySet.has(collider.body) ||
        !['circle','plane','aabb','segment'].includes(collider.shape)) {
      return {valid:false,reason:'invalid-collider'};
    }
    if (this.colliderSet.has(collider)) return {valid:false,reason:'collider-already-registered'};
    this.colliderSet.add(collider);
    this.colliders.push(collider);
    return {valid:true,collider};
  }

  removeCollider(collider) {
    if (!this.colliderSet.has(collider)) return false;
    this.colliderSet.delete(collider);
    this.colliders.splice(this.colliders.indexOf(collider),1);
    return true;
  }

  removeBody(body) {
    if (!this.bodySet.has(body)) return false;
    for (const collider of this.colliders.filter(item=>item.body===body)) this.removeCollider(collider);
    this.bodySet.delete(body);
    this.bodies.splice(this.bodies.indexOf(body),1);
    return true;
  }

  addForceGenerator(generator) {
    if (typeof generator!=='function') return {valid:false,reason:'invalid-force-generator'};
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

  step(dt,{positionCorrection=.8,positionSlop=.01,solverIterations=1}={}) {
    if (!(dt>0) || !Number.isFinite(dt) ||
        !Number.isFinite(positionCorrection) || positionCorrection<0 || positionCorrection>1 ||
        !Number.isFinite(positionSlop) || positionSlop<0 ||
        !Number.isInteger(solverIterations) || solverIterations<1 || solverIterations>32) {
      return {valid:false,reason:'invalid-world-step-options'};
    }
    const snapshots=this.bodies.map(body=>({
      body,position:{...body.position},velocity:{...body.velocity},force:{...body.force}
    }));
    const rollback=()=>{
      for (const snapshot of snapshots) {
        snapshot.body.position=snapshot.position;
        snapshot.body.velocity=snapshot.velocity;
        snapshot.body.force=snapshot.force;
      }
    };

    for (const body of this.bodies) {
      if (body.invMass===0) continue;
      for (const generator of this.forceGenerators) {
        let force;
        try { force=generator(body,dt,this); }
        catch (_) { rollback(); return {valid:false,reason:'force-generator-threw'}; }
        if (force==null) continue;
        if (!applyForce(body,force)) { rollback(); return {valid:false,reason:'invalid-generated-force'}; }
      }
    }

    for (const body of this.bodies) {
      if (body.invMass===0) continue;
      const candidate={...body,position:{...body.position},velocity:{...body.velocity},force:{...body.force}};
      const result=integrateBody(candidate,dt);
      if (!result.valid) { rollback(); return {valid:false,reason:result.reason}; }
      body.position=candidate.position;
      body.velocity=candidate.velocity;
      body.force=candidate.force;
    }

    const detected=detectContacts(this.colliders);
    if (!detected.valid) { rollback(); return detected; }
    for (const contact of detected.contacts) {
      contact.normalImpulse=0;
      contact.tangentImpulse=0;
    }
    for (let iteration=0;iteration<solverIterations;iteration++) {
      for (const contact of detected.contacts) {
        const solved=solveContact(contact.bodyA,contact.bodyB,contact.normal,contact.material);
        if (!solved.valid) { rollback(); return {valid:false,reason:'contact-solver-failed',featureId:contact.featureId}; }
        contact.normalImpulse+=solved.normalImpulse||0;
        contact.tangentImpulse+=solved.tangentImpulse||0;
      }
    }
    for (const contact of detected.contacts) {
      const inverseMassSum=contact.bodyA.invMass+contact.bodyB.invMass;
      const correction=Math.max(contact.penetration-positionSlop,0)*positionCorrection/inverseMassSum;
      if (!Number.isFinite(correction)) { rollback(); return {valid:false,reason:'invalid-position-correction'}; }
      if (correction>0) {
        contact.bodyA.position=add(contact.bodyA.position,scale(contact.normal,correction*contact.bodyA.invMass));
        contact.bodyB.position=subtract(contact.bodyB.position,scale(contact.normal,correction*contact.bodyB.invMass));
        if (!isFiniteVector(contact.bodyA.position) || !isFiniteVector(contact.bodyB.position)) {
          rollback();
          return {valid:false,reason:'non-finite-position-correction'};
        }
      }
    }
    this.stepCount++;
    return {
      valid:true,stepCount:this.stepCount,bodyCount:this.bodies.length,
      colliderCount:this.colliders.length,contactCount:detected.contacts.length,contacts:detected.contacts
    };
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

module.exports = {createBody,applyForce,applyImpulse,integrateBody,createContact,createCollider,detectContacts,createContactTelemetry,kineticEnergy,linearMomentum,solveContact,PhysicsWorld,FixedStepRunner};
