import ExcelJS from 'exceljs';
import {missingReviewFields,paymentProblem,months,shiftNames,shiftTimes,exportRows,effectiveDuty,shiftOf} from './core.mjs';
const solidFill = argb => ({type:'pattern',pattern:'solid',fgColor:{argb}});
const mutedFill = solidFill('FFF0F5F8');
const whiteFill = solidFill('FFFFFFFF');
export async function makeWorkbook(state){
 if(!state.profile.name||!state.profile.position||!state.profile.department)throw Error('กรอกข้อมูลแพทย์ให้ครบ');
 if(!state.roster.month||!state.roster.year||!state.roster.confirmed)throw Error('ตรวจและยืนยันตารางเวรก่อนส่งออก');
 for(const c of state.cases.filter(c=>c.include!==false)){if(!c.reviewed||missingReviewFields(c).length)throw Error('มีรายการยังไม่ตรวจทาน หรือข้อมูลที่บังคับกรอกไม่ครบ');const d=effectiveDuty(c,state.nightMode);if(+d.slice(0,4)!==state.roster.year||+d.slice(5,7)!==state.roster.month)throw Error('มีรายการอยู่นอกเดือนที่เลือก');if(!state.roster.days.some(r=>r.date===d&&r.shifts.includes(c.shiftOverride||shiftOf(c.time))))throw Error('มีรายการนอกตารางเวร กรุณาแก้วัน/เวร หรือเอาเครื่องหมายรวมออก');}
 const problem=paymentProblem(state);if(problem)throw Error(problem);
 const book=new ExcelJS.Workbook();book.creator='OT Assistant (offline)';const sheet=book.addWorksheet('ค่าตอบแทน',{views:[{state:'frozen',ySplit:4,xSplit:3}]});
 const headers=['วันที่','Case ที่','เวลา/เวร','AN','HN','ชื่อ-สกุล','อายุ','Ward','วินิจฉัย','การรักษา','ค่าตอบแทน','หมายเหตุ','DF','ค่าเวร','workload'];
 const widths=[14,10,24,17,17,34,22,19,48,22,15,22,14,14,15];sheet.columns=widths.map(width=>({width}));
 [ 'ค่าตอบแทนตามปริมาณในสายงาน',`ประจำเดือน${months[state.roster.month-1]} ปี ${state.roster.year+543}`,`ชื่อ - สกุล ${state.profile.name} ตำแหน่ง ${state.profile.position} กลุ่มงาน ${state.profile.department}`].forEach((v,i)=>{sheet.mergeCells(i+1,1,i+1,15);const c=sheet.getCell(i+1,1);c.value=v;c.font={name:'Tahoma',size:i===0?16:12,bold:i===0};c.alignment={horizontal:'center',vertical:'middle',wrapText:true};sheet.getRow(i+1).height=i===2?35:27;});
 sheet.addRow(headers);sheet.getRow(4).height=28;sheet.getRow(4).eachCell(c=>{c.font={name:'Tahoma',bold:true,size:11,color:{argb:'FFFFFFFF'}};c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF176D78'}};c.alignment={vertical:'middle',horizontal:'center'};});
 const rows=exportRows(state);
 const totals={M:0,N:0,O:0};
 let first=5, df=0;
 for(const [index,r] of rows.entries()){
  const date=new Date(r.date+'T00:00:00Z');
  const row=sheet.addRow([date,r.caseNo,`${shiftNames[r.shift]}${r.time?' '+r.time:' '+shiftTimes[r.shift]}`,r.an||null,r.hn||null,r.name||null,r.age||null,r.ward||null,r.diagnosis||null,r.treatment||null,r.fee??null,r.note||null]);
  const next=rows[index+1];
  const continues=next?.date===r.date && next.shift===r.shift;
  row.height=Math.max(32,Math.min(150,Math.ceil((r.diagnosis?.length||0)/40)*17));
  for(let col=1;col<=headers.length;col++){
   const cell=row.getCell(col);
   cell.font={name:'Tahoma',size:11};
   cell.alignment={vertical:'top',wrapText:true};
   cell.border={bottom:{style:'hair',color:{argb:'FFD3DEE7'}}};
   if(r.empty)cell.fill=col===14?whiteFill:mutedFill;
   else if(continues && col>=13)cell.fill=mutedFill;
   if(col===4||col===5)cell.numFmt='@';
  }
  row.getCell(1).numFmt='[$-th-TH]dd/mm/yyyy';
  df += r.fee ?? 0;
  if(continues)continue;
  const end=row.number;
  const rate=state.roster.days.find(day=>day.date===r.date).rates[r.shift];
  row.getCell(14).value=rate;
  totals.N+=rate;
  if(!r.empty){
   const workload=Math.max(0,df-rate);
   row.getCell(13).value={formula:'SUM(K'+first+':K'+end+')',result:df};
   row.getCell(15).value={formula:'MAX(0,M'+end+'-N'+end+')',result:workload};
   totals.M+=df;
   totals.O+=workload;
  }
  first=end+1;
  df=0;
 }
 sheet.autoFilter={from:'A4',to:`O${Math.max(4,sheet.rowCount)}`};
 const last=sheet.rowCount;
 const summary=sheet.addRow([]);
 for(const [column,result] of Object.entries(totals)){
  summary.getCell(column).value={formula:last>=5?'SUM('+column+'5:'+column+last+')':'0',result};
 }
 const total=sheet.addRow([]);
 total.getCell('L').value='Total';
 total.getCell('L').fill=solidFill('FF81D41A');
 sheet.mergeCells(total.number,13,total.number,15);
 const totalAmount=total.getCell('M');
 totalAmount.value={formula:'N'+summary.number+'+O'+summary.number,result:totals.N+totals.O};
 totalAmount.fill=solidFill('FFFFFF00');
 totalAmount.alignment={horizontal:'center'};
 summary.font=total.font={name:'Tahoma',bold:true,size:11};
 sheet.addRow([]).getCell('L').value='(Total = ค่าเวร + workload)';
 book.calcProperties.fullCalcOnLoad=true;
 sheet.pageSetup={paperSize:9,orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0,printTitlesRow:'1:4',margins:{left:.25,right:.25,top:.4,bottom:.4,header:.15,footer:.15}};sheet.headerFooter.oddFooter='&Cหน้า &P / &N';return book;
}
