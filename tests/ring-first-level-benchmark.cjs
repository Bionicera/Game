'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const source=fs.readFileSync(path.join(__dirname,'..','Portrait Breakout.html'),'utf8');
const marker='  setTimeout(enterGame, 2000);';
assert.ok(source.includes(marker),'production startup marker must exist');
const bridge="\n  const __bench={events:[],won:false,restarted:false};\n  const __ringContact=ringContact;\n  ringContact=function(o,px,py,main,sx,ex){\n    const before={x:o.x,y:o.y,vx:o.vx,vy:o.vy};\n    const hit=__ringContact(o,px,py,main,sx,ex);\n    if(main&&hit&&__bench.events.length<20000)__bench.events.push({type:'ring-contact',t:time,before,after:{x:o.x,y:o.y,vx:o.vx,vy:o.vy}});\n    return hit;\n  };\n  const __nextLevel=nextLevel;\n  nextLevel=function(){__bench.won=true;__bench.events.push({type:'level-clear',t:time,score,lives});return __nextLevel();};\n  const __resetGame=resetGame;\n  resetGame=function(){__bench.restarted=true;__bench.events.push({type:'game-over',t:time,score,lives,bricksRemaining:bricks.filter(b=>b.alive).length});return __resetGame();};\n  const __loseLife=loseLife;\n  loseLife=function(){const before=lives;__loseLife();__bench.events.push({type:'life-lost',t:time,before,after:lives});};\n  window.__ringBenchmark={\n    start(position){\n      shape='ring';shapeLocked=false;autoPilot=true;newLevel(false);\n      const x=position==='left'?2:position==='right'?W-paddle.w-2:(W-paddle.w)/2;\n      paddle.x=x;paddle.targetX=x;paddle.vx=0;autoServeT=.5;state='serving';\n      __bench.events.length=0;__bench.won=false;__bench.restarted=false;\n      return {W,H,paddle:{x:paddle.x,y:paddle.y,w:paddle.w},ball:{...ball},bricks:bricks.filter(b=>b.alive).length,lives,level};\n    },\n    run(seconds){\n      const dt=1/60,limit=Math.ceil(seconds/dt),trajectory=[];\n      let frames=0;\n      for(;frames<limit;frames++){\n        update(dt);\n        if(frames%12===0&&trajectory.length<600)trajectory.push({t:time,x:ball.x,y:ball.y,vx:ball.vx,vy:ball.vy,lives,score,bricks:bricks.filter(b=>b.alive).length,state,level});\n        if(__bench.won||__bench.restarted)break;\n      }\n      return {won:__bench.won,restarted:__bench.restarted,simulatedSeconds:frames*dt,frames,level,score,lives,bricksRemaining:bricks.filter(b=>b.alive).length,state,events:__bench.events.slice(),trajectory};\n    }\n  };\n";
(async()=>{
  const seeds=(process.env.RING_BENCH_SEEDS||'101,202').split(',').map(Number).filter(Number.isFinite);
  const positions=['center','left','right'];
  const maxSeconds=Math.max(30,Number(process.env.RING_BENCH_MAX_SECONDS)||90);
  const html=source.replace(marker,bridge+'\n'+marker);
  const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  const results=[];
  try{
    for(const seed of seeds)for(const position of positions){
      const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1});
      await page.addInitScript(({seed})=>{
        let s=seed>>>0;
        Math.random=()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};
        window.requestAnimationFrame=()=>0;
      },{seed});
      const errors=[];
      page.on('pageerror',e=>errors.push(e.message));
      await page.setContent(html,{waitUntil:'load'});
      const initial=await page.evaluate(p=>window.__ringBenchmark.start(p),position);
      const result=await page.evaluate(t=>window.__ringBenchmark.run(t),maxSeconds);
      assert.equal(errors.length,0,'uncaught browser errors: '+errors.join('; '));
      results.push({seed,position,initial,...result});
      await page.close();
    }
  }finally{await browser.close();}
  const wins=results.filter(r=>r.won).length;
  const summary={benchmark:'production-first-level-ring-auto',physics:'production update/stepBall/ringContact/damageBrick/checkClear',
    trials:results.length,wins,winRate:results.length?wins/results.length:0,
    restarts:results.filter(r=>r.restarted).length,timedOut:results.filter(r=>!r.won&&!r.restarted).length,
    byPosition:Object.fromEntries(positions.map(p=>{const a=results.filter(r=>r.position===p),w=a.filter(r=>r.won).length;return[p,{trials:a.length,wins:w,winRate:a.length?w/a.length:0}]})),
    details:results.map(r=>({seed:r.seed,position:r.position,initial:r.initial,won:r.won,restarted:r.restarted,simulatedSeconds:r.simulatedSeconds,score:r.score,lives:r.lives,bricksRemaining:r.bricksRemaining,ringContacts:r.events.filter(e=>e.type==='ring-contact').length,lifeLosses:r.events.filter(e=>e.type==='life-lost').length,gameOver:r.events.find(e=>e.type==='game-over')||null,firstContacts:r.events.filter(e=>e.type==='ring-contact').slice(0,12),lastTrajectory:r.trajectory.slice(-8)}))};
  console.log('RING_FIRST_LEVEL_BENCHMARK '+JSON.stringify(summary));
  assert.ok(results.length>0,'benchmark must execute at least one scenario');
})().catch(e=>{console.error(e);process.exitCode=1;});
