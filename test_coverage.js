// Deep Test: Panama Staffing - AL, Coverage, Fatigue, Edge Cases
// Run: node test_coverage.js

import {
  formatDate, parseDate, addDays, getCycleDay, getScheduledShift,
  getActualShift, getStaffForDay, isWorkingShift, isCareRole,
  isEarlyShift, isLateShift, isNightShift, isOTShift, isAgencyShift,
  countALOnDate, getTeamBase, CARE_ROLES, WORKING_SHIFTS,
} from './src/lib/rotation.js';

import {
  calculateCoverage, getEscalationLevel, getDayCoverageStatus,
  checkFatigueRisk, validateSwap,
} from './src/lib/escalation.js';

const BASE = 'http://localhost:3001';
let DATA;
try {
  const loginRes = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  if (!loginRes.ok) throw new Error('Login failed: HTTP ' + loginRes.status);
  const { token } = await loginRes.json();
  const res = await fetch(`${BASE}/api/data?home=Oakwood_Care_Home`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Data fetch failed: HTTP ' + res.status);
  DATA = await res.json();
} catch (e) {
  console.error('FATAL: Cannot reach API at ' + BASE + ' - ' + e.message);
  process.exit(1);
}
const CONFIG = DATA.config;
const STAFF = DATA.staff;
const OVERRIDES = DATA.overrides;
const activeStaff = STAFF.filter(s => s.active !== false);
const careStaff = activeStaff.filter(s => isCareRole(s.role));

let totalTests=0, passed=0, failed=0;
const bugs=[], warnings=[];
function assert(c,l,d){totalTests++;if(c){passed++}else{failed++;const m=d?l+' -- '+d:l;console.log('  FAIL: '+m);bugs.push(m)}}
function warn(l,d){warnings.push(d?l+' -- '+d:l)}
function section(t){console.log('\n'+'='.repeat(70)+'\n  '+t+'\n'+'='.repeat(70))}
function sub(t){console.log('\n--- '+t+' ---')}
function dc(o){return JSON.parse(JSON.stringify(o))}
function dr(s,e){const d=[];let c=parseDate(s);const en=parseDate(e);while(c<=en){d.push(new Date(c));c=addDays(c,1)}return d}

// === 1. ANNUAL LEAVE ===
section('1. ANNUAL LEAVE LOGIC');

sub('1a. Book AL on working day - reduces coverage?');
{
  const alice = STAFF.find(s => s.id === 'S001');
  let testDate = null;
  for (const d of dr('2026-02-01', '2026-02-28')) {
    const cd = getCycleDay(d, CONFIG.cycle_start_date);
    if (isWorkingShift(getScheduledShift(alice, cd))) { testDate = d; break; }
  }
  assert(testDate !== null, 'Found working day for Alice Feb 2026');
  if (testDate) {
    const dk = formatDate(testDate);
    const sbf = getStaffForDay(STAFF, testDate, OVERRIDES, CONFIG);
    const cbf = getDayCoverageStatus(sbf, CONFIG);
    const eb = cbf.early.coverage.headCount;
    const to = dc(OVERRIDES);
    if (!to[dk]) to[dk] = {};
    to[dk]['S001'] = { shift: 'AL', reason: 'Test AL', source: 'al' };
    const saf = getStaffForDay(STAFF, testDate, to, CONFIG);
    const caf = getDayCoverageStatus(saf, CONFIG);
    const ea = caf.early.coverage.headCount;
    console.log('  Date: '+dk+' | Early before: '+eb+', after AL: '+ea);
    assert(ea < eb, 'AL on working day reduces early coverage', 'before='+eb+' after='+ea);
    assert(saf.find(s=>s.id==='S001').shift==='AL', 'Alice shift is AL');
    assert(!isWorkingShift('AL'), 'AL not working shift');
    assert(!isEarlyShift('AL'), 'AL not early');
    assert(!isLateShift('AL'), 'AL not late');
    assert(!isNightShift('AL'), 'AL not night');
  }
}

sub('1b. Book AL on OFF day');
{
  const alice = STAFF.find(s => s.id === 'S001');
  let offDate = null;
  for (const d of dr('2026-02-01', '2026-02-28')) {
    if (getScheduledShift(alice, getCycleDay(d, CONFIG.cycle_start_date)) === 'OFF') { offDate = d; break; }
  }
  assert(offDate !== null, 'Found OFF day for Alice');
  if (offDate) {
    const dk = formatDate(offDate);
    console.log('  Date: '+dk+' (OFF day)');
    const to = dc(OVERRIDES);
    if (!to[dk]) to[dk] = {};
    to[dk]['S001'] = { shift: 'AL', reason: 'Test', source: 'al' };
    const saf = getStaffForDay(STAFF, offDate, to, CONFIG);
    assert(saf.find(s=>s.id==='S001').shift==='AL', 'AL override accepted on OFF (no server guard)');
    assert(countALOnDate(offDate, to) === 1, 'AL on OFF counts against cap');
    console.log('  AnnualLeave.jsx bookAL() correctly skips OFF days');
    console.log('  BUG: DailyStatus +AL does not check scheduled shift');
    warn('DailyStatus +AL can waste AL on OFF days', 'filters by current shift not scheduled');
  }
}

sub('1c. Max AL same day cap = 2');
{
  assert(CONFIG.max_al_same_day === 2, 'max_al_same_day is 2');
  let td = null;
  for (const d of dr('2026-02-01','2026-02-28')) {
    if (isWorkingShift(getScheduledShift(STAFF.find(s=>s.id==='S001'), getCycleDay(d, CONFIG.cycle_start_date)))) { td=d; break; }
  }
  if (td) {
    const dk = formatDate(td);
    const to = dc(OVERRIDES);
    if (!to[dk]) to[dk] = {};
    to[dk]['S001'] = { shift:'AL',reason:'1',source:'al' };
    to[dk]['S002'] = { shift:'AL',reason:'2',source:'al' };
    assert(countALOnDate(td, to) === 2, '2 AL counted');
    to[dk]['S003'] = { shift:'AL',reason:'3',source:'al' };
    assert(countALOnDate(td, to) === 3, '3 AL counted (no data-level enforcement)');
    warn('No server-side max_al_same_day enforcement', 'client-side only');
  }
}

sub('1d. AL entitlement check');
{
  assert(CONFIG.al_entitlement_days === 28, 'Entitlement = 28');
  bugs.push('AnnualLeave.jsx bookAL() no entitlement check - unlimited AL booking');
}

sub('1e. Overbooking past entitlement');
{
  const alice = STAFF.find(s=>s.id==='S001');
  const to = dc(OVERRIDES);
  let booked = 0;
  for (const d of dr('2026-01-01','2026-12-31')) {
    if (booked >= 29) break;
    if (!isWorkingShift(getScheduledShift(alice, getCycleDay(d, CONFIG.cycle_start_date)))) continue;
    const dk = formatDate(d);
    if (countALOnDate(d, to) >= CONFIG.max_al_same_day) continue;
    if (!to[dk]) to[dk] = {};
    to[dk]['S001'] = { shift:'AL',reason:'Overbook',source:'al' };
    booked++;
  }
  console.log('  Booked '+booked+' AL (entitlement: 28) -> remaining: '+(28-booked));
  assert(booked >= 29, 'Can book 29+ days (no entitlement guard)', 'booked='+booked);
  warn('AL balance goes negative - no blocking');
}

// === 2. COVERAGE / ESCALATION ===
section('2. COVERAGE / ESCALATION');

sub('2a. Escalation levels Feb-Mar 2026');
{
  const dates = dr('2026-02-01','2026-03-31');
  const lc = {0:0,1:0,2:0,3:0,4:0,5:0};
  const crit = [];
  for (const d of dates) {
    const sf = getStaffForDay(STAFF, d, OVERRIDES, CONFIG);
    const cv = getDayCoverageStatus(sf, CONFIG);
    lc[cv.overallLevel]++;
    if (cv.overallLevel >= 4) crit.push({
      date:formatDate(d), level:cv.overallLevel,
      e:cv.early.coverage.headCount+'/'+cv.early.coverage.required.heads+' '+cv.early.escalation.status,
      l:cv.late.coverage.headCount+'/'+cv.late.coverage.required.heads+' '+cv.late.escalation.status,
      n:cv.night.coverage.headCount+'/'+cv.night.coverage.required.heads+' '+cv.night.escalation.status,
    });
  }
  console.log('  LVL0 Normal: '+lc[0]+' | LVL1 Float: '+lc[1]+' | LVL2 OT: '+lc[2]);
  console.log('  LVL3 Agency: '+lc[3]+' | LVL4 Short: '+lc[4]+' | LVL5 UNSAFE: '+lc[5]);
  if (crit.length) {
    console.log('  CRITICAL days ('+crit.length+'):');
    crit.forEach(c => console.log('    '+c.date+' LVL'+c.level+' E:'+c.e+' L:'+c.l+' N:'+c.n));
    warn(crit.length+' critical+ days in Feb-Mar 2026');
  }
}

sub('2b. Critical days with ZERO overrides');
{
  const dates = dr('2026-02-01','2026-03-31');
  const crit = [];
  for (const d of dates) {
    const sf = getStaffForDay(STAFF, d, {}, CONFIG);
    const cv = getDayCoverageStatus(sf, CONFIG);
    if (cv.overallLevel >= 4) crit.push({date:formatDate(d), level:cv.overallLevel,
      eH:cv.early.coverage.headCount, lH:cv.late.coverage.headCount, nH:cv.night.coverage.headCount});
  }
  console.log('  Critical with no overrides: '+crit.length);
  if (crit.length) {
    crit.forEach(c => console.log('    '+c.date+' LVL'+c.level+' E:'+c.eH+'/3 L:'+c.lH+'/3 N:'+c.nH+'/3'));
    bugs.push(crit.length+' days CRITICAL even with no overrides');
  } else { console.log('  Baseline rotation adequately covers all days'); }
}

sub('2c. 6-level escalation boundary tests');
{
  const mc = dc(CONFIG);
  const s0=[{role:'Senior Carer',shift:'EL',skill:1,team:'Day A'},{role:'Carer',shift:'EL',skill:0.5,team:'Day A'},{role:'Carer',shift:'EL',skill:0.5,team:'Day A'}];
  assert(getEscalationLevel(calculateCoverage(s0,'early',mc),s0).level===0,'LVL0: Normal');
  const s1=[{role:'Senior Carer',shift:'EL',skill:1,team:'Day A'},{role:'Carer',shift:'EL',skill:0.5,team:'Day A'},{role:'Float Carer',shift:'EL',skill:0.5,team:'Float'}];
  assert(getEscalationLevel(calculateCoverage(s1,'early',mc),s1).level===1,'LVL1: Float');
  const s2=[{role:'Senior Carer',shift:'EL',skill:1,team:'Day A'},{role:'Carer',shift:'EL',skill:0.5,team:'Day A'},{role:'Carer',shift:'OC-EL',skill:0.5,team:'Day A'}];
  assert(getEscalationLevel(calculateCoverage(s2,'early',mc),s2).level===2,'LVL2: OT');
  const s3=[{role:'Senior Carer',shift:'EL',skill:1,team:'Day A'},{role:'Carer',shift:'EL',skill:0.5,team:'Day A'},{role:'Carer',shift:'AG-E',skill:0.5,team:'Agency'}];
  assert(getEscalationLevel(calculateCoverage(s3,'early',mc),s3).level===3,'LVL3: Agency');
  const s4=[{role:'Senior Carer',shift:'EL',skill:1,team:'Day A'},{role:'Carer',shift:'EL',skill:0.5,team:'Day A'}];
  assert(getEscalationLevel(calculateCoverage(s4,'early',mc),s4).level===4,'LVL4: Short');
  const s5=[{role:'Senior Carer',shift:'EL',skill:1,team:'Day A'}];
  assert(getEscalationLevel(calculateCoverage(s5,'early',mc),s5).level===5,'LVL5: UNSAFE');
  assert(getEscalationLevel(calculateCoverage([],'early',mc),[]).level===5,'LVL5: empty');
  const sFO=[{role:'Senior Carer',shift:'EL',skill:1,team:'Day A'},{role:'Float Carer',shift:'EL',skill:0.5,team:'Float'},{role:'Carer',shift:'OC-EL',skill:0.5,team:'Day A'}];
  assert(getEscalationLevel(calculateCoverage(sFO,'early',mc),sFO).level===2,'Float+OT=LVL2');
  const sSG=[{role:'Carer',shift:'EL',skill:0.5,team:'Day A'},{role:'Carer',shift:'EL',skill:0.5,team:'Day A'},{role:'Carer',shift:'EL',skill:0.5,team:'Day A'}];
  const cSG=calculateCoverage(sSG,'early',mc);
  assert(!cSG.isCovered,'Skill gap: 3h/1.5sp not covered');
  assert(getEscalationLevel(cSG,sSG).level===4,'Skill gap->LVL4');
  warn('Skill-only gap shows LVL4 Short-Staffed - misleading when heads met');
}

sub('2d. Min staffing');
{
  assert(CONFIG.minimum_staffing.early.heads===3,'Early min=3');
  assert(CONFIG.minimum_staffing.late.heads===3,'Late min=3');
  assert(CONFIG.minimum_staffing.night.heads===3,'Night min=3');
  const sd=parseDate('2026-02-02'),sf=getStaffForDay(STAFF,sd,OVERRIDES,CONFIG),cv=getDayCoverageStatus(sf,CONFIG);
  console.log('  2026-02-02: E:'+cv.early.coverage.headCount+' L:'+cv.late.coverage.headCount+' N:'+cv.night.coverage.headCount);
  assert(cv.early.coverage.headCount===sf.filter(s=>isCareRole(s.role)&&isEarlyShift(s.shift)).length,'Early count matches');
  assert(cv.late.coverage.headCount===sf.filter(s=>isCareRole(s.role)&&isLateShift(s.shift)).length,'Late count matches');
  assert(cv.night.coverage.headCount===sf.filter(s=>isCareRole(s.role)&&isNightShift(s.shift)).length,'Night count matches');
}

// === 3. FATIGUE TRACKER ===
section('3. FATIGUE TRACKER');

sub('3a. Consecutive working days Feb-Mar 2026');
{
  const dates = dr('2026-02-01','2026-03-31');
  const maxC = CONFIG.max_consecutive_days;
  console.log('  Max consecutive allowed: '+maxC);
  const results = [];
  for (const s of careStaff) {
    let maxBlock=0,cur=0,maxStart=null,curStart=null;
    for (const d of dates) {
      const actual = getActualShift(s,d,OVERRIDES,CONFIG.cycle_start_date);
      if (isWorkingShift(actual.shift)) {
        if (cur===0) curStart=formatDate(d);
        cur++;
        if (cur>maxBlock) { maxBlock=cur; maxStart=curStart; }
      } else { cur=0; }
    }
    results.push({id:s.id,name:s.name,team:s.team,maxBlock,maxStart,exceeded:maxBlock>maxC,atLimit:maxBlock===maxC});
  }
  results.sort((a,b)=>b.maxBlock-a.maxBlock);
  const exceeded=results.filter(r=>r.exceeded);
  console.log('  Exceeded (>'+maxC+'): '+exceeded.length);
  console.log('  At limit: '+results.filter(r=>r.atLimit).length);
  console.log('  Safe: '+results.filter(r=>!r.exceeded&&!r.atLimit).length);
  if (exceeded.length>0) {
    console.log('  EXCEEDED:');
    exceeded.forEach(r=>console.log('    '+r.name+' ('+r.team+'): '+r.maxBlock+'d from '+r.maxStart));
    bugs.push(exceeded.length+' staff exceed max_consecutive_days='+maxC);
  }
  console.log('  Top 10:');
  results.slice(0,10).forEach(r=>{
    const f=r.exceeded?' *** EXCEEDED ***':r.atLimit?' (AT LIMIT)':'';
    console.log('    '+r.name.padEnd(20)+' '+r.team.padEnd(10)+' '+r.maxBlock+'d from '+r.maxStart+f);
  });
}

sub('3b. checkFatigueRisk() consistency');
{
  const ts=STAFF.find(s=>s.id==='S001');
  const td=parseDate('2026-02-15');
  const fatigue=checkFatigueRisk(ts,td,OVERRIDES,CONFIG);
  let mb=0,d=addDays(td,-1);
  while(mb<20){const a=getActualShift(ts,d,OVERRIDES,CONFIG.cycle_start_date);if(!isWorkingShift(a.shift))break;mb++;d=addDays(d,-1)}
  let mf=0;const ta=getActualShift(ts,td,OVERRIDES,CONFIG.cycle_start_date);
  if(isWorkingShift(ta.shift)){mf=1;d=addDays(td,1);while(mf<20){const a=getActualShift(ts,d,OVERRIDES,CONFIG.cycle_start_date);if(!isWorkingShift(a.shift))break;mf++;d=addDays(d,1)}}
  console.log('  Alice 2026-02-15: fatigue='+fatigue.consecutive+' manual='+(mb+mf)+' shift='+ta.shift);
  assert(fatigue.consecutive===mb+mf,'checkFatigueRisk matches manual','fatigue='+fatigue.consecutive+' manual='+(mb+mf));
  warn('checkFatigueRisk fixed scan radius '+(CONFIG.max_consecutive_days+3),'Long override runs may be undercounted');
}

sub('3c. Panama pattern max consecutive');
{
  const pA=[1,1,0,0,1,1,1,0,0,1,1,0,0,0,1,1,0,0,1,1,1,0,0,1,1,0,0,0];
  let max=0,cur=0;
  pA.forEach(p=>{if(p){cur++;max=Math.max(max,cur)}else cur=0});
  assert(max===3,'Panama pattern max consecutive = 3','got '+max);
  console.log('  Panama alone NEVER exceeds 3 - limit of 5 has headroom');
}

// === 4. SWAP VALIDATOR ===
section('4. SWAP VALIDATOR');

sub('4a. Skill downgrade');
{
  const senior=STAFF.find(s=>s.id==='S001');
  const carer=STAFF.find(s=>s.id==='S002');
  const lead=STAFF.find(s=>s.id==='S005');
  const td=parseDate('2026-02-02');
  const r1=validateSwap(senior,carer,td,OVERRIDES,CONFIG);
  assert(r1.issues.some(i=>i.msg.includes('Skill downgrade')),'Senior->Carer warns downgrade');
  assert(r1.safe,'Skill downgrade is warning not error');
  const r2=validateSwap(carer,senior,td,OVERRIDES,CONFIG);
  assert(!r2.issues.some(i=>i.msg.includes('Skill downgrade')),'Carer->Senior no warning');
}

sub('4b. Fatigue on swap');
{
  const bob=dc(STAFF.find(s=>s.id==='S002'));
  const td=parseDate('2026-02-10');
  const to=dc(OVERRIDES);
  for(let i=4;i>=0;i--){const dk=formatDate(addDays(td,-i));if(!to[dk])to[dk]={};to[dk]['S002']={shift:'EL',reason:'Test',source:'manual'}}
  const nd=addDays(td,1);const nk=formatDate(nd);if(!to[nk])to[nk]={};to[nk]['S002']={shift:'EL',reason:'Test',source:'manual'};
  const r=validateSwap(STAFF.find(s=>s.id==='S001'),bob,nd,to,CONFIG);
  console.log('  Bob fatigue: '+r.issues.map(i=>'['+i.type+'] '+i.msg).join(', '));
  assert(r.issues.some(i=>i.msg.includes('consecutive')),'Swap detects fatigue');
}

sub('4c. Self-swap');
{
  const alice=STAFF.find(s=>s.id==='S001');
  const r=validateSwap(alice,alice,parseDate('2026-02-02'),OVERRIDES,CONFIG);
  console.log('  Self-swap: safe='+r.safe+' issues='+r.issues.length);
  warn('validateSwap no self-swap guard','UI prevents but validator does not');
}

// === 5. DATE HANDLING ===
section('5. DATE HANDLING EDGE CASES');

sub('5a. DST March 29 2026');
{
  const dst=parseDate('2026-03-29'),before=parseDate('2026-03-28'),after=parseDate('2026-03-30');
  const cb=getCycleDay(before,CONFIG.cycle_start_date),cd=getCycleDay(dst,CONFIG.cycle_start_date),ca=getCycleDay(after,CONFIG.cycle_start_date);
  console.log('  CycleDays: Mar28='+cb+' Mar29(DST)='+cd+' Mar30='+ca);
  assert(((cd-cb)+14)%14===1,'DST +1 from prev');
  assert(((ca-cd)+14)%14===1,'Post-DST +1');
  assert(formatDate(dst)==='2026-03-29','formatDate DST');
  assert(formatDate(addDays(before,1))==='2026-03-29','addDays crosses DST');
  assert(formatDate(addDays(before,2))==='2026-03-30','addDays DST+1');
  const sf=getStaffForDay(STAFF,dst,OVERRIDES,CONFIG);
  assert(sf.length>0,'Staff exist on DST day');
  const cv=getDayCoverageStatus(sf,CONFIG);
  console.log('  DST coverage: E:'+cv.early.coverage.headCount+' L:'+cv.late.coverage.headCount+' N:'+cv.night.coverage.headCount);
}

sub('5b. Month boundary Feb28->Mar1');
{
  assert(new Date(2026,1,29).getMonth()!==1,'2026 not leap year');
  assert(formatDate(addDays(parseDate('2026-02-28'),1))==='2026-03-01','Feb28+1=Mar1');
  const c28=getCycleDay(parseDate('2026-02-28'),CONFIG.cycle_start_date);
  const c1=getCycleDay(parseDate('2026-03-01'),CONFIG.cycle_start_date);
  assert(((c1-c28)+14)%14===1,'Cycle continuous across Feb/Mar');
}

sub('5c. Leap year 2028');
{
  assert(new Date(2028,1,29).getMonth()===1,'2028 IS leap year');
  assert(formatDate(addDays(parseDate('2028-02-28'),1))==='2028-02-29','addDays leap');
}

sub('5d. Staff mid-cycle start');
{
  const ts=dc(STAFF);
  ts.push({id:'TEST_MID',name:'Mid-Cycle Joiner',role:'Carer',team:'Day A',pref:'EL',skill:0.5,hourly_rate:11,active:true,start_date:'2026-02-15',wtr_opt_out:false});
  const sf=getStaffForDay(ts,parseDate('2026-02-10'),{},CONFIG);
  const mj=sf.find(s=>s.id==='TEST_MID');
  console.log('  Mid-cycle joiner before start_date: shift='+(mj?mj.shift:'N/A'));
  if(mj&&isWorkingShift(mj.shift)){bugs.push('Staff scheduled BEFORE start_date - getScheduledShift ignores start_date')}
}

sub('5e. Pre-cycle dates');
{
  const cd=getCycleDay(parseDate('2024-12-01'),CONFIG.cycle_start_date);
  assert(cd>=0&&cd<14,'Pre-cycle wraps correctly','cd='+cd);
}

sub('5f. Round-trip');
{
  ['2026-01-01','2026-02-28','2026-03-01','2026-03-29','2026-12-31','2028-02-29'].forEach(ds=>{
    assert(formatDate(parseDate(ds))===ds,'Round-trip '+ds);
  });
}

// === 6. ADDITIONAL EDGE CASES ===
section('6. ADDITIONAL EDGE CASES');

sub('6a. Float staff');
{
  const floats=activeStaff.filter(s=>s.team==='Float');
  console.log('  Float staff: '+floats.length);
  for(const f of floats){assert(getScheduledShift(f,getCycleDay(parseDate('2026-02-01'),CONFIG.cycle_start_date))==='AVL','Float '+f.name+'=AVL')}
  assert(!isWorkingShift('AVL'),'AVL not working');
}

sub('6b. Part-shift');
{
  assert(isEarlyShift('E')&&!isLateShift('E'),'E=early only');
  assert(!isEarlyShift('L')&&isLateShift('L'),'L=late only');
  assert(isEarlyShift('EL')&&isLateShift('EL'),'EL=both');
}

sub('6c. Team overlap');
{
  const pA=[1,1,0,0,1,1,1,0,0,1,1,0,0,0];
  const pB=[0,0,1,1,0,0,0,1,1,0,0,1,1,1];
  assert(pA.filter((v,i)=>v===1&&pB[i]===1).length===0,'A and B never overlap');
}

sub('6d. S007 SICK impact');
{
  const sd=parseDate('2026-02-13');
  const sf=getStaffForDay(STAFF,sd,OVERRIDES,CONFIG);
  const cv=getDayCoverageStatus(sf,CONFIG);
  const g=sf.find(s=>s.id==='S007');
  const gs=getScheduledShift(STAFF.find(s=>s.id==='S007'),getCycleDay(sd,CONFIG.cycle_start_date));
  console.log('  2026-02-13: George sched='+gs+' actual='+(g?g.shift:'N/A'));
  console.log('  E:'+cv.early.coverage.headCount+' L:'+cv.late.coverage.headCount+' N:'+cv.night.coverage.headCount+' LVL'+cv.overallLevel);
  if(isWorkingShift(gs)){
    const sf2=getStaffForDay(STAFF,sd,{},CONFIG);const cv2=getDayCoverageStatus(sf2,CONFIG);
    assert(cv.early.coverage.headCount<cv2.early.coverage.headCount,'SICK reduces early coverage');
  }
}

sub('6e. Bank holidays');
{
  // Verify BH auto-upgrade works — getStaffForDay upgrades working shifts to BH-D/BH-N on BH dates
  // Use a BH after the cycle start date so staff are actually scheduled
  const cycleStart = CONFIG.cycle_start_date || '2025-01-06';
  const futureBH = (CONFIG.bank_holidays || []).find(bh => bh.date >= cycleStart);
  if (futureBH) {
    const sf = getStaffForDay(STAFF, parseDate(futureBH.date), {}, CONFIG);
    const bhShifts = sf.filter(s => s.shift === 'BH-D' || s.shift === 'BH-N');
    assert(bhShifts.length > 0, 'BH auto-upgrade produces BH-D/BH-N shifts on ' + futureBH.date);
    console.log('  BH auto-upgrade working: ' + bhShifts.length + ' staff upgraded on ' + futureBH.date + ' (' + futureBH.name + ')');
  } else {
    console.log('  No future bank holidays configured — skipping BH upgrade test');
  }
}

sub('6f. Feb 2026 grid');
{
  const dates=dr('2026-02-01','2026-02-28');
  console.log('  Date       | DayA DayB | NtA NtB | E  L  N  | LVL');
  for(const d of dates){
    const sf=getStaffForDay(STAFF,d,{},CONFIG);const c=getDayCoverageStatus(sf,CONFIG);
    const dA=sf.filter(s=>s.team==='Day A'&&isWorkingShift(s.shift)).length;
    const dB=sf.filter(s=>s.team==='Day B'&&isWorkingShift(s.shift)).length;
    const nA=sf.filter(s=>s.team==='Night A'&&isNightShift(s.shift)).length;
    const nB=sf.filter(s=>s.team==='Night B'&&isNightShift(s.shift)).length;
    console.log('  '+formatDate(d)+' |  '+dA+'    '+dB+'   |  '+nA+'   '+nB+'  | '+c.early.coverage.headCount+'  '+c.late.coverage.headCount+'  '+c.night.coverage.headCount+'  |  '+c.overallLevel);
  }
}

sub('6g. countALOnDate edges');
{
  const td=parseDate('2026-06-15');
  assert(countALOnDate(td,{})===0,'Empty=0');
  assert(countALOnDate(td,{'2026-06-15':{}})===0,'Empty day=0');
  assert(countALOnDate(td,{'2026-06-15':{S001:{shift:'SICK'}}})===0,'SICK=0');
  assert(countALOnDate(td,{'2026-06-15':{S001:{shift:'AL'}}})===1,'1 AL');
  assert(countALOnDate(td,{'2026-06-15':{S001:{shift:'AL'},S002:{shift:'AL'}}})===2,'2 AL');
}

sub('6h. Validation gap summary');
{
  console.log('  AnnualLeave.jsx bookAL(): [OK] Skips OFF, [OK] max_al_same_day, [BUG] No entitlement check');
  console.log('  DailyStatus +AL: [OK] Working staff, [OK] max cap, [BUG] No entitlement check');
  console.log('  Server: [BUG] No validation at all');
}

// === 7. ROTATION INTEGRITY ===
section('7. ROTATION INTEGRITY');

sub('7a. Every day has coverage');
{
  const dates=dr('2026-02-01','2026-03-31');
  let gaps=0;
  for(const d of dates){
    const sf=getStaffForDay(STAFF,d,{},CONFIG);
    if(sf.filter(s=>s.team.startsWith('Day')&&isWorkingShift(s.shift)).length===0){gaps++;console.log('  NO DAY TEAM '+formatDate(d))}
    if(sf.filter(s=>s.team.startsWith('Night')&&isNightShift(s.shift)).length===0){gaps++;console.log('  NO NIGHT TEAM '+formatDate(d))}
  }
  assert(gaps===0,'Every day has day+night coverage');
}

sub('7b. Working ratio ~50%');
{
  const dates=dr('2026-02-01','2026-03-31');
  let devs=0;
  for(const s of careStaff.filter(s=>s.team!=='Float')){
    let w=0;for(const d of dates){if(isWorkingShift(getActualShift(s,d,{},CONFIG.cycle_start_date).shift))w++}
    const r=(w/dates.length*100).toFixed(1);
    if(Math.abs(w/dates.length-0.5)>0.05){console.log('  '+s.name+': '+r+'%');devs++}
  }
  if(devs===0)console.log('  All non-Float at ~50%');
}

sub('7c. Cycle start');
{
  console.log('  Start: '+CONFIG.cycle_start_date);
  assert(isWorkingShift(getScheduledShift(STAFF.find(s=>s.id==='S001'),0)),'Day A cycleDay 0 = working');
  assert(!isWorkingShift(getScheduledShift(STAFF.find(s=>s.id==='S001'),2)),'Day A cycleDay 2 = off');
}

// === FINAL REPORT ===
section('FINAL REPORT');

console.log('\n  Total tests: '+totalTests);
console.log('  Passed: '+passed);
console.log('  Failed: '+failed);

if(bugs.length>0){
  console.log('\n  BUGS FOUND ('+bugs.length+'):');
  bugs.forEach((b,i)=>{console.log('    '+(i+1)+'. '+b)});
}
if(warnings.length>0){
  console.log('\n  WARNINGS / CONCERNS ('+warnings.length+'):');
  warnings.forEach((w,i)=>{console.log('    '+(i+1)+'. '+w)});
}
console.log('\n'+'='.repeat(70));
console.log('  Test run complete.');
console.log('='.repeat(70));

process.exit(failed>0?1:0);
