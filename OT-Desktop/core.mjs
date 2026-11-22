export const months=['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
export const shiftNames={morning:'เวรเช้า',afternoon:'เวรบ่าย',night:'เวรดึก'};
export const shiftTimes={morning:'08.00–15.59',afternoon:'16.00–23.59',night:'00.00–07.59'};
export const digits=s=>String(s??'').replace(/[๐-๙]/g,c=>'๐๑๒๓๔๕๖๗๘๙'.indexOf(c));
export const clean=s=>digits(s).replace(/\s+/g,' ').trim();
const pad=n=>String(n).padStart(2,'0');
export function isoDate(day,month,year){let y=+year;if(y<100)y+=2500;if(y>2400)y-=543;let m=+month,d=+day;const t=new Date(Date.UTC(y,m-1,d));return y>=1900&&y<=2200&&t.getUTCFullYear()===y&&t.getUTCMonth()===m-1&&t.getUTCDate()===d?`${y}-${pad(m)}-${pad(d)}`:'';}
export function validDate(s){return /^\d{4}-\d{2}-\d{2}$/.test(s)&&isoDate(s.slice(8),s.slice(5,7),s.slice(0,4))===s;}
export function validTime(s){return /^([01]\d|2[0-3]):[0-5]\d$/.test(s);}
export function shiftOf(time){if(!validTime(time))return '';const h=+time.slice(0,2);return h<8?'night':h<16?'morning':'afternoon';}
export function dayBefore(date){const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-1);return d.toISOString().slice(0,10);}
export function dutyDate(date,time,nightMode='previous'){return validDate(date)&&shiftOf(time)==='night'&&nightMode==='previous'?dayBefore(date):date;}
export function datesIn(text){return [...digits(text).matchAll(/(?<!\d)(\d{1,2})\s*[\/\-]\s*(\d{1,2})\s*[\/\-]\s*(\d{2,4})(?!\d)/g)].map(m=>({date:isoDate(m[1],m[2],m[3]),offset:m.index,raw:m[0]})).filter(x=>x.date);}
export function timesIn(text){return [...digits(text).matchAll(/(?<!\d)([01]?\d|2[0-3])\s*:\s*([0-5]\d)(?!\d)|(?:เวลา\s*)([01]?\d|2[0-3])\.([0-5]\d)(?!\d)/g)].map(m=>({time:`${pad(m[1]??m[3])}:${m[2]??m[4]}`,offset:m.index,raw:m[0]}));}
export function linesFrom(data){return (data.blocks??[]).flatMap(b=>(b.paragraphs??[]).flatMap(p=>p.lines??[])).map(l=>({text:clean(l.text),...l.bbox,confidence:l.confidence}));}
export function normalizeName(s){return clean(s).replace(/^(นพ\.?|พญ\.?|นายแพทย์|แพทย์หญิง)/,'').replace(/[^\u0E00-\u0E7Fa-zA-Z]/g,'');}
export function nameMatches(text,profile){const t=normalizeName(text),aliases=[profile.rosterName,...String(profile.aliases??'').split(',')].map(normalizeName).filter(s=>s.length>=3);return aliases.some(n=>t.includes(n));}
export function parseRoster(data,profile,width){const text=digits(data.text),m=months.findIndex(m=>text.replace(/\s/g,'').includes(m));const ym=text.match(/25\d{2}|20\d{2}/);const year=ym?(+ym[0]>2400?+ym[0]-543:+ym[0]):null;const month=m>=0?m+1:null;const lines=linesFrom(data);const days=[];const warnings=[];
 if(!month||!year)warnings.push('อ่านเดือน/ปีไม่ครบ กรุณากำหนดเดือนและปี');
 const anchors=lines.filter(l=>/^\d{1,2}$/.test(l.text)&&+l.text>=1&&+l.text<=31&&l.x0<width*.12).sort((a,b)=>a.y0-b.y0);
 for(let i=0;i<anchors.length;i++){const a=anchors[i],cy=(a.y0+a.y1)/2,prev=anchors[i-1],next=anchors[i+1],gap=next?(next.y0+next.y1)/2-cy:prev?cy-(prev.y0+prev.y1)/2:40;const row=lines.filter(l=>Math.abs((l.y0+l.y1)/2-cy)<gap*.46&&l.x0>width*.08&&l.x0<width*.71);let shifts=[];
  for(const [s,lo,hi] of [['morning',.08,.285],['afternoon',.285,.48],['night',.48,.715]]){const cell=row.filter(l=>l.x0>=width*lo&&l.x0<width*hi).map(l=>l.text).join(' ');if(nameMatches(cell,profile))shifts.push(s);}
  if(shifts.length&&month&&year&&isoDate(+a.text,month,year))days.push({date:isoDate(+a.text,month,year),shifts,holiday:shifts.includes('morning'),reviewed:false});
 }
 if(!days.length)warnings.push('ยังจับคู่ชื่อในตารางไม่ได้ ลองแก้ชื่อที่ใช้ในตารางเวร หรือเลือกวันที่บนปฏิทิน');
 warnings.push('ตรวจวันที่และเวรจากภาพก่อนยืนยัน โดยเฉพาะตารางที่จัดคอลัมน์ต่างจากตัวอย่าง');
 return {month,year,days,warnings,raw:text};
}
export function parsePatient(data,metadata={}){const raw=digits(data.text),lines=linesFrom(data);const text=raw.replace(/[：]/g,':');const allDates=datesIn(text);const ts=timesIn(text);
 const date=allDates[0]?.date||metadata.date||'';let time='';if(allDates.length){const tail=text.slice(allDates[0].offset+allDates[0].raw.length,allDates[0].offset+allDates[0].raw.length+100);time=timesIn(tail)[0]?.time??'';}
 if(!time)time=ts[0]?.time||metadata.time||'';
 const getID=(tag)=>{const match=text.match(new RegExp('\\b'+tag+'\\s*[:;]?\\s*([0-9][0-9 \\t]{5,18})','i'));return match?match[1].replace(/\s/g,''):'';};
 const nameCandidates=[...text.matchAll(/(?:ชื่อ|ซื่อ)\s*[:;!]?\s*([^\n]+)/g)].map(m=>m[1].split(/อายุ|อาย\s*[:;]|แผนก|CID|BW|AN\s*:|HN\s*:/i)[0].trim()).filter(s=>/[ก-๙]{2}/.test(s));let name=nameCandidates.find(s=>/^ด[.\s]?[ชญซ]/.test(s))||nameCandidates[0]||'';
 const age=(text.match(/อายุ\s*[:;]?\s*([^\n]+)/)?.[1]??'').split(/แผนก|CID|BW|เพศ|AN\s*:|HN\s*:/i)[0].trim();
 let ward=(text.match(/(?:ward|หอผู้ป่วย|ตึก)\s*[:;]?\s*([^\n]+)/i)?.[1]??'').split(/เตียง|bed/i)[0].trim();
 if(!ward){ward=(text.match(/(?:เปี่ยมสุข|เปียมสุข)\s*\d+|\b(?:SPICU|PICU|NICU|NS|IMC)\b|นว\.?\s*\d+/i)?.[0]??'');}
 let diagnosis='';const am=[...text.matchAll(/(?:^|\n)\s*A\s*[:：]\s*([^\n]+(?:\n(?!\s*[SOPA]\s*:|\s*\d{1,2}\/|\s*\[)[^\n]+)?)/gi)];if(am.length)diagnosis=clean(am[0][1]);
 if(!diagnosis){const a=lines.find(l=>/^A\s*:?$/.test(l.text));if(a){const p=lines.find(l=>/^P\s*:?$/.test(l.text)&&l.y0>a.y0);diagnosis=lines.filter(l=>l.x0>a.x1&&l.x0<a.x0+500&&l.y0>=a.y0-45&&l.y0<(p?.y0??a.y0+160)-12).map(l=>l.text).join(' ');}}
 const warnings=['ตรวจ AN, HN และชื่อภาษาไทยเทียบกับรูป'];if(!allDates.length)warnings.push(metadata.date?'วันที่จาก '+metadata.source:'ไม่พบวันที่');if(!ts.length)warnings.push(metadata.time?'เวลาจาก '+metadata.source:'ไม่พบเวลา');if(new Set(allDates.map(x=>x.date)).size>1||new Set(ts.map(x=>x.time)).size>1)warnings.push('ภาพมีหลายวัน/เวลา เลือกรายการที่ต้องการ');if(!diagnosis)warnings.push('ไม่พบข้อความ A: เว้นวินิจฉัยไว้');
 return {date,time,an:getID('AN'),hn:getID('HN'),name,age,ward,diagnosis,dateSource:allDates.length?'ข้อความในภาพ':metadata.source||'ไม่พบ',timeSource:ts.length?'ข้อความในภาพ':metadata.source||'ไม่พบ',dateCandidates:[...new Set(allDates.map(x=>x.date))],timeCandidates:[...new Set(ts.map(x=>x.time))],warnings,raw};
}
export function effectiveDuty(row,nightMode){return row.dutyOverride||dutyDate(row.date,row.time,nightMode);}
export function rowIssues(row,state){let a=[];if(!validDate(row.date))a.push('วันที่ไม่ถูกต้อง');if(!validTime(row.time))a.push('เวลาไม่ครบ');if(!row.name&&!row.an&&!row.hn)a.push('ไม่มีชื่อหรือเลขผู้ป่วย');const dd=effectiveDuty(row,state.nightMode),shift=row.shiftOverride||shiftOf(row.time);if(!state.roster.days.some(d=>d.date===dd&&d.shifts.includes(shift)))a.push('นอกตารางเวร');if(!row.reviewed)a.push('รอตรวจทาน');return a;}
export function exportRows(state){const list=[];const grouped=new Map();const included=state.cases.filter(c=>c.include!==false);for(const row of included){const d=effectiveDuty(row,state.nightMode),shift=row.shiftOverride||shiftOf(row.time);const key=d+'|'+shift;if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(row);}
 for(const d of state.roster.days){for(const s of d.shifts){const key=d.date+'|'+s;if(!grouped.has(key))grouped.set(key,[]);}}
 const rank={morning:0,afternoon:1,night:2};let n=0;for(const [key,rows] of [...grouped].sort(([a],[b])=>{const [ad,as]=a.split('|'),[bd,bs]=b.split('|');return ad.localeCompare(bd)||(rank[as]-rank[bs]);})){const [date,shift]=key.split('|');if(!rows.length)list.push({date,shift,caseNo:null,empty:true});else for(const r of rows.sort((a,b)=>a.time.localeCompare(b.time)))list.push({...r,date,shift,caseNo:++n,empty:false});}return list;
}
