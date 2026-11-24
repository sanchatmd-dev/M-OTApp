import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {isoDate,shiftOf,dutyDate,parsePatient,parseRoster,exportRows,snapshotShiftRates,timesIn,workbookFilename} from '../core.mjs';
import {makeWorkbook} from '../export.mjs';
test('Thai dates and shift boundaries',()=>{assert.equal(isoDate(21,8,69),'2026-08-21');assert.equal(isoDate(29,2,2569),'');assert.equal(isoDate(29,2,2567),'2024-02-29');for(const [time,s]of [['00:00','night'],['07:59','night'],['08:00','morning'],['15:59','morning'],['16:00','afternoon'],['23:59','afternoon']])assert.equal(shiftOf(time),s);assert.equal(shiftOf('24:00'),'');assert.equal(dutyDate('2026-09-01','00:21'),'2026-08-31');assert.equal(dutyDate('2026-09-01','00:21','same'),'2026-09-01');});
test('clinical measurements are not treated as dotted times',()=>{assert.equal(timesIn('BSA : 0.54 BW 12.50').length,0);assert.equal(timesIn('เวลา 16.00')[0].time,'16:00');});
test('image date/time takes priority, retain identifiers and assessment only',()=>{const r=parsePatient({text:'AN : 010123456 HN : 000123456 ชื่อ : ด.ช. ทดสอบ\n21/08/69 00:21\nA: RSV pneumonia\nP: HFNC\n20/08/69 22:17',blocks:[]},{date:'2026-08-22',time:'01:00',source:'EXIF'});assert.equal(r.date,'2026-08-21');assert.equal(r.time,'00:21');assert.equal(r.hn,'000123456');assert.equal(r.an,'010123456');assert.equal(r.diagnosis,'RSV pneumonia');assert.deepEqual(r.dateCandidates,['2026-08-21','2026-08-20']);});
test('missing data stays blank and metadata is explicitly labeled',()=>{const r=parsePatient({text:'No A section\nMedication: antibiotics',blocks:[]},{date:'2026-08-12',time:'23:00',source:'EXIF DateTimeOriginal'});assert.equal(r.diagnosis,'');assert.equal(r.an,'');assert.equal(r.name,'');assert.equal(r.date,'2026-08-12');assert.equal(r.dateSource,'EXIF DateTimeOriginal');});
function fixture(){return {profile:{name:'นพ. ทดสอบ ระบบ',position:'แพทย์ทดสอบ',department:'กุมารเวชกรรม'},nightMode:'previous',roster:{month:8,year:2026,confirmed:true,days:[{date:'2026-08-20',shifts:['afternoon','night']},{date:'2026-08-31',shifts:['afternoon','night']}]},cases:[{date:'2026-08-21',time:'00:21',an:'010123456',hn:'000123456',name:'ผู้ป่วยทดสอบ',diagnosis:'Test diagnosis',ward:'NICU',treatment:'visit',fee:50,reviewed:true,include:true},{date:'2026-08-19',time:'18:00',name:'excluded',include:false,reviewed:false}]};}
test('empty shifts, exclusion, continuous case numbers and cross-midnight',()=>{const rows=exportRows(fixture());assert.equal(rows.length,4);assert.equal(rows[0].empty,true);assert.equal(rows[1].date,'2026-08-20');assert.equal(rows[1].caseNo,1);assert.equal(rows.filter(x=>x.caseNo).length,1);});
test('shift rates survive profile changes and apply to new shifts',()=>{
 const days=[{date:'2026-08-20',shifts:['night']}];
 snapshotShiftRates(days,[],900);
 const edited=[{date:days[0].date,shifts:['night','afternoon']}];
 snapshotShiftRates(edited,days,1200);
 assert.deepEqual(edited[0].rates,{night:900,afternoon:1200});
});

test('Excel round trip keeps identifiers, case fields and per-shift totals',async()=>{
 const state=fixture();
 snapshotShiftRates(state.roster.days,[],900);
 Object.assign(state.cases[0],{treatment:'CPAP',fee:400,note:'test'});
 state.cases.push({...state.cases[0],time:'02:00',fee:650});
 state.cases.push({...state.cases[0],date:'2026-08-31',time:'18:00',fee:100});
 const book=await makeWorkbook(state);
 const ExcelJS=(await import('exceljs')).default;
 const reread=new ExcelJS.Workbook();
 await reread.xlsx.load(await book.xlsx.writeBuffer());
 const sheet=reread.worksheets[0], cell=address=>sheet.getCell(address);
 assert.equal(cell('A2').value,'ประจำเดือนสิงหาคม ปี 2569');
 assert.equal(cell('A6').value.getUTCFullYear(),2026);
 assert.equal(cell('E6').value,'000123456');
 assert.deepEqual(['J6','K6','L6'].map(a=>cell(a).value),['CPAP',400,'test']);
 assert.deepEqual(['M5','N5','O5','N6'].map(a=>cell(a).value),[null,900,null,null]);
 assert.equal(cell('M7').formula,'SUM(K6:K7)');
 assert.equal(cell('M7').result,1050);
 assert.equal(cell('O7').result,150);
 assert.equal(cell('O8').formula,'MAX(0,M8-N8)');
 assert.equal(cell('O8').result,0);
 assert.deepEqual(['M10','N10','O10','M11'].map(a=>cell(a).result),[1150,3600,150,3750]);
 assert.equal(cell('L11').value,'Total');
 assert.equal(cell('M11').formula,'N10+O10');
 assert.equal(cell('N11').master.address,'M11');
 assert.equal(cell('O11').master.address,'M11');
 assert.equal(cell('L12').value,'(Total = ค่าเวร + workload)');
 assert.deepEqual(['A5','N5','M6','N6','O6','L11','M11','O11'].map(a=>cell(a).fill.fgColor.argb),
  ['FFF0F5F8','FFFFFFFF','FFF0F5F8','FFF0F5F8','FFF0F5F8','FF81D41A','FFFFFF00','FFFFFF00']);
 assert.equal(cell('M7').fill?.pattern??'none','none');
});
test('Excel filenames include the doctor name and retain the saved-file timestamp',()=>{
 const state=fixture();
 assert.equal(workbookFilename(state),'OT_2569_08_นพ. ทดสอบ ระบบ.xlsx');
 state.profile.rosterName=' สัญชาติ ';
 assert.equal(workbookFilename(state),'OT_2569_08_สัญชาติ.xlsx');
 assert.equal(workbookFilename(state,'20261124123456000'),'OT_2569_08_20261124123456000_สัญชาติ.xlsx');
 state.profile.rosterName='ชื่อ/ทดสอบ';
 assert.equal(workbookFilename(state),'OT_2569_08_ชื่อ_ทดสอบ.xlsx');
});
test('export rejects unreviewed or off-roster cases',async()=>{let s=fixture();s.cases[0].reviewed=false;await assert.rejects(()=>makeWorkbook(s),/ยังไม่ตรวจทาน/);s=fixture();s.cases[0].date='2026-08-23';await assert.rejects(()=>makeWorkbook(s),/นอกตารางเวร/);});
test('actual uploaded roster matches all seven days and sixteen shifts',async t=>{const fixture=await fs.readFile('data/integration-roster.json','utf8').catch(error=>{if(error.code!=='ENOENT')throw error;});if(fixture===undefined)return t.skip('Local roster fixture unavailable');const actual=JSON.parse(fixture).result;assert.deepEqual(actual.days.map(d=>+d.date.slice(8)),[3,7,9,12,18,20,31]);assert.equal(actual.days.reduce((n,d)=>n+d.shifts.length,0),16);assert.equal(actual.year,2026);assert.equal(actual.month,8);});

test('noisy Thai name labels require an identifier and a name in the patient header',()=>{
 for(const label of ['ชือ','ชีอ','ขือ','ขึอ']){
  const raw='แพทย์ : นพ. ตัวอย่าง ทดสอบ HN : 01234567 AN : 12345678 '+label+' : ด.ญ.ตัวอย่าง ทดสอบ อาย : 6 ปี';
  assert.equal(parsePatient({text:raw}).name,'ด.ญ.ตัวอย่าง ทดสอบ');
 }
 for(const raw of [
  'แพทย์ ชือ : ตัวอย่าง ทดสอบ อายุ : 40',
  'AN : 12345678 ชือ : ด.ช... อายุ : 6',
  'AN : 12345678 ชือ : ต.... ทดสอบ อายุ : 6',
 ]){
  assert.equal(parsePatient({text:raw}).name,'');
 }
});


test('patient header preserves a partial pediatric name exactly as printed',()=>{
 for(const name of ['ด.ช.... ตัวอย่าง','ด.ญ... ทดสอบ','ด.ญ. ทดสอบ']){
  const raw='HN : 01234567 AN : 12345678 ชือ : '+name+' อาย : 0 ปี';
  assert.equal(parsePatient({text:raw}).name,name);
 }
});

test('age uses the largest nonzero unit after the patient age label',()=>{
 for(const [source,expected] of [
  ['อายุ 1 ปี 2 เดือน 3 วัน','1 ปี'],['อายุ: 0 ปี 2 เดือน 3 วัน','2 เดือน'],
  ['อาย : ๐ ปี ๐ เดือน ๓ วัน','3 วัน'],['อายุ 0 ปี 0 เดือน 0 วัน','0 วัน'],
  ['อายุ\n11เดือน','11 เดือน'],['อาย: Unknown5 วัน CID: 987654','5 วัน'],
  ['อายุน้อยกว่า 16 ปี',''],['ให้ยา 3 วัน',''],['อายุ: ไม่ทราบ เตียง 3',''],
 ]) assert.equal(parsePatient({text:source}).age,expected);
});

test('ward is bounded by its label and the next field',()=>{
 for(const [source,expected] of [
  ['แผนก: กุมารเวชกรรม - อาคาร 4 - กุมารเวชกรรม 1 เตียง: A001','กุมารเวชกรรม - อาคาร 4 - กุมารเวชกรรม 1'],
  ['ตึก: พระบารมี 3 -SPICU อายุ 14 ปี','SPICU'],
  ['แผนก\nNICU\nHN: 01234567','NICU'],['Ward: PICU Bed 5','PICU'],
  ['อยู่ ward ไม่มีไข้',''],['แผนก: เตียง: AA009',''],
 ]) assert.equal(parsePatient({text:source}).ward,expected);
});

test('NICU-IMC ward follows the bed code printed immediately after the bed label',()=>{
 for(const [source,expected] of [
  ['แผนก: เปี่ยมสุข 3 - NICU-IMC เตียง: NSด008','NS-ปส.3'],
  ['ตึก: NICU - IMC\nเตียง: NIด004','NICU'],
  ['แผนก: NICU-IMC เดียง : NS011','NS-ปส.3'],
  ['ตึก: สามัญ เตียง: NI002','สามัญ'],
  ['Ward: NICU-IMC เตียง: A013\nย้ายไป NS','NICU-IMC'],
  ['แผนก: NICU-IMC\nบันทึกย้ายผู้ป่วย\nเตียง: NI001','NICU-IMC'],
 ])assert.equal(parsePatient({text:source}).ward,expected);
});


test('short ward names apply only to matching department or building values',()=>{
 for(const [text,expected] of [
  ['แผนก: กุมารเวชกรรม - เปี่ยมสุข 4 - กุมารเวชกรรม 1 เตียง: A01','เปี่ยมสุข 4'],
  ['แผนก: เปียมสข๔','เปี่ยมสุข 4'],
  ['ตึก: พระบารมี 3 - spicu','SPICU'],
  ['แผนก: เปี่ยมสุข 40','เปี่ยมสุข 40'],
  ['แผนก: อาคาร 2 เตียง: P2\nเคยอยู่ SPICU','อาคาร 2'],
 ])assert.equal(parsePatient({text}).ward,expected);
});
