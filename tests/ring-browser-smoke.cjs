'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  const sourcePath = path.join(__dirname, '..', 'Portrait Breakout.html');
  let html = fs.readFileSync(sourcePath, 'utf8');
  const marker = '  setTimeout(enterGame, 2000);';
  assert.ok(html.includes(marker), 'game startup marker must exist');
  const hook = `
  // Test-only bridge: read/drive the real IIFE state without shipping debug APIs.
  let testSlingBall=null;
  window.__ringTest = {
    snapshot(){
      return {shape,autoPilot,state,canvasWidth:canvas.width,canvasHeight:canvas.height,
        sling:{...ringSling},combo:{...ringCombo},planner:{...ringPlanner},sensor:{...ringSensor},
        evaluator:{...ringEvaluator,events:ringEvaluator.events.slice()},ball:{...ball},time,lives,paddle:{...paddle}};
    },
    startLiveAuto(){
      shapeLocked=false;shape='ring';updateShapeMenu();autoPilot=true;state='playing';lives=20;
      const R=RING_R(),cy=paddle.y+paddle.h-R;
      ball.x=paddle.x+paddle.w/2;ball.y=cy+ringInnerRadius(Math.PI/2)-ball.r-2;
      ball.vx=140;ball.vy=-260;ringState.intent='aim';beep=()=>{};syncUI();
    },
    plannerMatrix(){
      const focus={x:paddle.x+paddle.w/2,y:paddle.y-100,vx:0,vy:120,r:ball.r};
      const base={valid:true,speedRatio:.5,speedClass:'slow',speedTrend:'stable',gapEta:null,
        gapPassable:false,gapPredictedX:null,etaInner:null,radialZone:'outside'};
      const boost=planRingSkill(base,{intent:'boost'},focus).skill;
      const capture=planRingSkill({...base,speedRatio:1.4,speedClass:'fast',etaInner:.2},{intent:'control'},focus).skill;
      const gap=planRingSkill({...base,gapEta:.1,gapPassable:true,gapPredictedX:focus.x+20},{intent:'guide-through'},focus).skill;
      const guide=planRingSkill({...base,speedRatio:1,speedClass:'cruise',radialZone:'inside'},{intent:'aim'},focus).skill;
      const danger={...focus,y:paddle.y+paddle.h-30,vy:200};
      const safe=planRingSkill(base,{intent:'boost'},danger).skill;
      const trajectory=predictRingTrajectory({x:paddle.x+paddle.w/2,y:paddle.y+paddle.h-RING_R()+10,vx:0,vy:-300,r:ball.r},1.2);
      return {boost,capture,gap,guide,safe,trajectory:trajectory.events.some(e=>e.type==='gap')};
    },
    chooseRing(){
      shapeLocked=false;shape='ring';updateShapeMenu();snapBall();
      autoPilot=true;state='playing';ringState.intent='aim';ringPlanner.skill='attack';beep=()=>{};
      window.requestAnimationFrame=()=>0;
    },
    innerCapture(){
      const R=RING_R(),cy=paddle.y+paddle.h-R,a=0;
      const rr=ringInnerRadius(a),nx=-1,ny=0;
      const qx=paddle.w/2+rr,qy=cy;
      const o=ball;
      o.x=paddle.x+qx+nx*(o.r-.5);o.y=qy+ny*(o.r-.5);
      o.vx=-nx*220;o.vy=-ny*220;
      updateRingSensor(.016,o);updateRingState(ringSensor,.016,o);
      // Reproduce the production bug: a valid capture while the transient intent is boost.
      ringState.intent='boost';ringPlanner.skill='capture';
      testSlingBall=o;
      const hit=ringContact(o,o.x,o.y,true,paddle.x,paddle.x);
      return {hit,phase:ringSling.phase,ball:{...o},cycles:ringSling.cyclesTarget};
    },
    driveSlingSequence(){
      const o=testSlingBall;
      if(!o||ringSling.focus!==o)return {phase:ringSling.phase,error:'focus not locked'};
      let frames=0;
      while(frames<900&&(ringSling.phase==='oscillate'||ringSling.phase==='dash')){
        const prev=paddle.x;
        const v=paddleCommandVelocity(ringSling.targetX,paddle.x);
        paddle.x=clamp(paddle.x+v*.016,2,W-paddle.w-2);
        paddle.vx=(paddle.x-prev)/.016;
        updateRingSling(.016,o);
        frames++;
      }
      return {phase:ringSling.phase,halfSwings:ringSling.halfSwings,
        cycles:ringSling.cyclesTarget,dashDistance:ringSling.dashDistance,frames};
    },
    releaseAtOppositeTip(){
      const R=RING_R(),cy=paddle.y+paddle.h-R,gap=RING_GAP_HALF();
      const a=-Math.PI/2+gap,rr=ringInnerRadius(a);
      const nx=-Math.cos(a),ny=-Math.sin(a);
      const qx=paddle.w/2+rr*Math.cos(a),qy=cy+rr*Math.sin(a);
      ringSling.phase='release';ringSling.phaseTime=0;ringSling.exitSide=1;
      ringSling.dashDistance=42;ringSling.cyclesTarget=2;ringSling.focus=testSlingBall;
      const o=testSlingBall;
      o.x=paddle.x+qx+nx*(ball.r-.5);o.y=qy+ny*(ball.r-.5);
      o.vx=-nx*220;o.vy=-ny*220;
      const hit=ringContact(o,o.x,o.y,true,paddle.x,paddle.x);
      return {hit,phase:ringSling.phase,vx:o.vx,vy:o.vy,speed:Math.hypot(o.vx,o.vy),
        comboStep:ringCombo.steps[ringCombo.index],slingReleases:ringEvaluator.slingReleases};
    }
  };
`;
  html = html.replace(marker, hook + marker);
  const browser = await chromium.launch({headless:true,args:['--no-sandbox']});
  try {
    const page = await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1});
    const pageErrors=[];
    page.on('pageerror', e => pageErrors.push(e.message));
    await page.setContent(html,{waitUntil:'load'});
    await page.waitForFunction(() => document.querySelector('#cover')?.classList.contains('dismissed'),null,{timeout:5000});
    await page.evaluate(() => window.__ringTest.chooseRing());
    await page.waitForTimeout(40); // drain the already queued animation frame after disabling the loop
    const skills=await page.evaluate(() => window.__ringTest.plannerMatrix());
    assert.deepEqual(skills,{boost:'boost',capture:'capture',gap:'gap-guide',guide:'guide',safe:'safe-catch',trajectory:true},
      'browser planner should arbitrate the complete base skill set');
    const capture=await page.evaluate(() => window.__ringTest.innerCapture());
    assert.equal(capture.hit,true,'production inner-wall collision should register');
    assert.equal(capture.phase,'oscillate','inner capture should enter the sling oscillation phase');
    const sequence=await page.evaluate(() => window.__ringTest.driveSlingSequence());
    assert.equal(sequence.phase,'release','real paddle command integration should finish oscillations and short dash');
    assert.equal(sequence.halfSwings,sequence.cycles*2,'every oscillation half-swing should be completed');
    assert.ok(sequence.dashDistance>=10,'short dash must have a real reachable travel distance');
    const release=await page.evaluate(() => window.__ringTest.releaseAtOppositeTip());
    assert.equal(release.hit,true,'production collision should register the gap-tip contact');
    assert.equal(release.phase,'cooldown','successful sling should enter cooldown');
    assert.ok(release.vx>0&&release.vy<0,'sling should exit upward through the selected gap tip');
    assert.ok(release.speed>0&&Number.isFinite(release.speed),'sling velocity should remain finite');
    assert.equal(release.comboStep,'attack','sling combo should advance to attack after a confirmed release');
    assert.equal(release.slingReleases,1,'evaluator should count the real release once');
    const canvas=await page.evaluate(() => ({
      width:document.querySelector('#game').width,
      height:document.querySelector('#game').height,
      context:!!document.querySelector('#game').getContext('2d')
    }));
    assert.ok(canvas.width>0&&canvas.height>0&&canvas.context,'Canvas should initialize in Chromium');
    assert.deepEqual(pageErrors,[],'browser should have no uncaught page errors');
    const livePage=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1});
    const liveErrors=[];
    livePage.on('pageerror',e=>liveErrors.push(e.message));
    livePage.on('console',m=>{if(m.type()==='error')liveErrors.push('console: '+m.text());});
    await livePage.setContent(html,{waitUntil:'load'});
    await livePage.waitForFunction(()=>document.querySelector('#cover')?.classList.contains('dismissed'),null,{timeout:5000});
    await livePage.evaluate(()=>window.__ringTest.startLiveAuto());
    await livePage.waitForTimeout(30000);
    const live=await livePage.evaluate(()=>window.__ringTest.snapshot());
    for(const key of ['x','y','vx','vy'])assert.ok(Number.isFinite(live.ball[key]),'live Auto ball '+key+' must stay finite');
    assert.equal(live.shape,'ring');
    assert.equal(live.autoPilot,true);
    assert.equal(live.sensor.valid,true,'live RingSensor should stay active during browser play');
    assert.ok(live.evaluator.events.length<=48,'live evaluator history must remain bounded');
    assert.ok(live.time>=28,'real-time Auto scenario should advance for at least 28 seconds');
    assert.ok(live.lives>=10,'stress run must not silently restart due to ordinary life depletion');
    assert.ok(['idle','cooldown','oscillate','dash','release'].includes(live.sling.phase),'sling must remain in a recognized bounded phase');
    assert.ok(live.sling.phaseTime===undefined||live.sling.phaseTime<=3.21,'no sling phase may exceed its timeout');
    await livePage.locator('#btnPause').click();
    assert.equal(await livePage.evaluate(()=>window.__ringTest.snapshot().state),'paused','pause must remain responsive after long Auto');
    await livePage.locator('#btnPause').click();
    assert.ok(['playing','serving'].includes(await livePage.evaluate(()=>window.__ringTest.snapshot().state)),'resume must restore a live game state');
    await livePage.locator('#btnReset').click();
    assert.equal(await livePage.evaluate(()=>window.__ringTest.snapshot().state),'serving','restart must return to the serving state');
    assert.deepEqual(liveErrors,[],'long browser Auto play should have no console or uncaught page errors');
    process.stdout.write('Browser smoke passed: Canvas startup, planner matrix, full sling sequence, and 30s live Ring Auto stress with pause/resume/restart.\\n');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode=1; });
