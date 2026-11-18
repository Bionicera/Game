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
        sling:{...ringSling},ball:{...ball}};
    },
    chooseRing(){
      shapeLocked=false;shape='ring';updateShapeMenu();snapBall();
      autoPilot=true;state='playing';ringState.intent='aim';ringPlanner.skill='attack';beep=()=>{};
    },
    innerCapture(){
      const R=RING_R(),cy=paddle.y+paddle.h-R,a=0;
      const rr=ringInnerRadius(a),nx=-1,ny=0;
      const qx=paddle.w/2+rr,qy=cy;
      const o={x:paddle.x+qx+nx*(ball.r-.5),y:qy+ny*(ball.r-.5),
        vx:-nx*220,vy:-ny*220,r:ball.r};
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
      return {hit,phase:ringSling.phase,vx:o.vx,vy:o.vy,speed:Math.hypot(o.vx,o.vy)};
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
    const canvas=await page.evaluate(() => ({
      width:document.querySelector('#game').width,
      height:document.querySelector('#game').height,
      context:!!document.querySelector('#game').getContext('2d')
    }));
    assert.ok(canvas.width>0&&canvas.height>0&&canvas.context,'Canvas should initialize in Chromium');
    assert.deepEqual(pageErrors,[],'browser should have no uncaught page errors');
    process.stdout.write('Browser smoke passed: Canvas startup, inner capture, paddle-driven oscillation, short dash, focus-locked real gap-tip sling release.\\n');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode=1; });
