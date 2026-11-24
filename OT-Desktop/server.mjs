import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import crypto from 'node:crypto';
import {spawn,execFile} from 'node:child_process';
import sharp from 'sharp';
import exifr from 'exifr';
import {createWorker,PSM} from 'tesseract.js';
import {parsePatient,parseRoster,linesFrom,isoDate,validDate,workbookFilename,workbookFormat} from './core.mjs';
import {makeWorkbook} from './export.mjs';
const ROOT=path.dirname(fileURLToPath(import.meta.url)),DATA=path.join(ROOT,'data'),PORT=17869;
await fs.mkdir(path.join(DATA,'images'),{recursive:true});
const stateFile=path.join(DATA,'workspace.json');
const initial={profile:{name:'',position:'',department:'',rosterName:'',aliases:''},roster:{month:0,year:2026,days:[],confirmed:false},nightMode:'previous',cases:[],images:[]};
let state;try{state=JSON.parse(await fs.readFile(stateFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;state=initial;}
let revision=0,progress={busy:false,stage:'',percent:0},worker,working=false;
async function getWorker(){if(!worker)worker=await createWorker('tha+eng',1,{langPath:path.join(ROOT,'models'),gzip:false,cacheMethod:'none',logger:m=>{if(m.status==='recognizing text')progress.percent=Math.round(m.progress*100);}});return worker;}
function json(res,data,status=200){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
async function body(req){const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>40*1024*1024)throw Error('รูปใหญ่เกิน 28 MB');chunks.push(c);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
function metadataDate(value){if(value instanceof Date&&!isNaN(value)){return bangkok(value);}if(typeof value==='string'){const m=value.match(/(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2})/);if(m)return {date:`${m[1]}-${m[2]}-${m[3]}`,time:`${m[4]}:${m[5]}`};}return {};}
function bangkok(d){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(d);const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));return {date:`${p.year}-${p.month}-${p.day}`,time:`${p.hour}:${p.minute}`};}
async function metadata(bytes,lastModified){try{const exif=await exifr.parse(bytes,{reviveValues:false});for(const k of ['DateTimeOriginal','CreateDate','ModifyDate']){const result=metadataDate(exif?.[k]);if(result.date)return {...result,source:'EXIF '+k};}}catch{}if(Number.isFinite(lastModified)&&lastModified>0)return {...bangkok(new Date(lastModified)),source:'วันแก้ไขไฟล์ (อาจไม่ใช่วันถ่าย)'};return {};}
async function rosterGrid(bytes,width,height){const {data,info}=await sharp(bytes).grayscale().raw().toBuffer({resolveWithObject:true});const start=Math.round(width*.095),end=Math.round(width*.695),ys=[];for(let y=Math.round(height*.07);y<height;y++){let dark=0;for(let x=start;x<end;x++)if(data[y*info.width+x]<185)dark++;if(dark/(end-start)>.72)ys.push(y);}const bands=[];for(const y of ys){if(!bands.length||y-bands.at(-1).at(-1)>2)bands.push([y]);else bands.at(-1).push(y);}const edges=bands.map(b=>b.reduce((a,v)=>a+v,0)/b.length);return edges;}
function readOpenThai(image){
 return new Promise((resolve,reject)=>{
  const python=path.join(ROOT,'runtime','openthai','Scripts','python.exe');
  const child=execFile(python,[path.join(ROOT,'openthai.py')],{windowsHide:true,timeout:120000,maxBuffer:16*1024*1024},(error,stdout)=>{
   if(error)return reject(new Error('OpenThai อ่านภาพไม่สำเร็จ กรุณาตรวจการติดตั้งหรือเลือก Tesseract'));
   try{resolve(JSON.parse(stdout));}catch{reject(new Error('อ่านผลจาก OpenThai ไม่สำเร็จ'));}
  });
  child.stdin.on('error',()=>{}); // Process failures are reported by execFile.
  child.stdin.end(image);
 });
}
async function readImage(input){if(working)throw Error('กำลังอ่านภาพก่อนหน้า กรุณารอสักครู่');working=true;progress={busy:true,stage:'เตรียมภาพ',percent:0};try{
 let bytes=Buffer.from(input.base64||'','base64');if(!bytes.length||bytes.length>28*1024*1024)throw Error('ขนาดรูปไม่ถูกต้อง');const meta=await metadata(bytes,input.lastModified);const id=crypto.randomUUID();const original=await sharp(bytes,{limitInputPixels:50000000}).rotate().jpeg({quality:95}).toBuffer();await fs.writeFile(path.join(DATA,'images',id+'.jpg'),original);
 let prep=sharp(original).resize({width:input.kind==='roster'?2000:2200,withoutEnlargement:true}).grayscale().normalise().sharpen({sigma:1});const processed=await prep.png().toBuffer();const dims=await sharp(processed).metadata();const engine=input.engine==='openthai'?'openthai':'tesseract';
 let data;
 if(engine==='openthai'){
  progress.stage='อ่านข้อความด้วย OpenThai';
  data=await readOpenThai(processed);
 }else{
  const w=await getWorker();
  progress.stage='อ่านข้อความด้วย Tesseract';
  await w.setParameters({tessedit_pageseg_mode:PSM.SPARSE_TEXT,preserve_interword_spaces:'1',tessedit_char_whitelist:''});
  ({data}=await w.recognize(processed,{}, {text:true,blocks:true}));
 }
 const actualKind=input.kind==='roster'||/ตารางเวร/.test(data.text.replace(/\s/g,''))?'roster':'patient';let result;if(actualKind==='roster'){
  const edges=await rosterGrid(processed,dims.width,dims.height);const gaps=edges.slice(1).map((e,i)=>e-edges[i]);const median=[...gaps].sort((a,b)=>a-b)[Math.floor(gaps.length/2)];const cells=[];for(let i=1;i<edges.length;i++)if(edges[i]-edges[i-1]>median*.65&&edges[i]-edges[i-1]<median*1.35)cells.push([edges[i-1],edges[i]]);
  // Only synthesize row anchors when a complete regular 28–31-day grid is visible.
  if(cells.length>=28&&cells.length<=31){data.blocks=data.blocks??[];const old=linesFrom(data).filter(l=>/^\d{1,2}$/.test(l.text)&&l.x0<dims.width*.12);const consistent=old.filter(l=>{const i=cells.findIndex(([a,b])=>l.y0>a&&l.y1<b);return i>=0&&+l.text===i+1;}).length;if(consistent>=3){data.blocks=data.blocks.map(b=>({...b,paragraphs:b.paragraphs.map(p=>({...p,lines:p.lines.filter(l=>!(l.bbox.x0<dims.width*.12&&/^\d{1,2}$/.test(l.text.trim())))}))}));data.blocks.push({paragraphs:[{lines:cells.map(([a,b],i)=>({text:String(i+1),confidence:60,bbox:{x0:dims.width*.05,x1:dims.width*.08,y0:(a+b)/2-5,y1:(a+b)/2+5}}))}]});}}
  result=parseRoster(data,input.profile||state.profile,dims.width);
 }else result=parsePatient(data,meta);
 return {id,name:String(input.name||'รูปภาพ').slice(0,200),kind:actualKind,engine,result,metadata:meta,createdAt:new Date().toISOString(),reviewed:false};
 }finally{working=false;progress={busy:false,stage:'',percent:0};}}
const server=http.createServer(async(req,res)=>{try{
 if(!['127.0.0.1:'+PORT,'localhost:'+PORT].includes(req.headers.host)){return json(res,{error:'Forbidden host'},403);}
 if(req.headers.origin&&!['http://127.0.0.1:'+PORT,'http://localhost:'+PORT].includes(req.headers.origin))return json(res,{error:'Forbidden origin'},403);
 const url=new URL(req.url,'http://127.0.0.1:'+PORT);const route=url.pathname;
 if(route==='/api/state'&&req.method==='GET')return json(res,{state,revision});
 if(route==='/api/state'&&req.method==='POST'){const input=await body(req);if(input.revision!==revision)return json(res,{error:'ข้อมูลถูกเปลี่ยนในอีกหน้าต่าง กรุณาเปิดใหม่'},409);if(!input.state?.profile||!Array.isArray(input.state?.cases)||!Array.isArray(input.state?.roster?.days))throw Error('ข้อมูลไม่ครบ');await fs.writeFile(stateFile+'.tmp',JSON.stringify(input.state,null,2));await fs.rename(stateFile+'.tmp',stateFile);state=input.state;revision++;return json(res,{revision});}
 if(route==='/api/progress')return json(res,progress);
 if(route==='/api/read'&&req.method==='POST')return json(res,await readImage(await body(req)));
 if(route==='/api/reparse'&&req.method==='POST'){const input=await body(req);if(!/^[\w-]+$/.test(input.id))throw Error('ไม่พบรูป');const bytes=await fs.readFile(path.join(DATA,'images',input.id+'.jpg'));return json(res,await readImage({base64:bytes.toString('base64'),kind:input.kind,engine:input.engine,profile:input.profile,name:input.name}));}
 if(route==='/api/export'&&req.method==='POST'){
  const {state:exportState}=await body(req);
  const book=await makeWorkbook(exportState);
  const buffer=Buffer.from(await book.xlsx.writeBuffer());
  const exportDir=path.join(ROOT,'exports');
  await fs.mkdir(exportDir,{recursive:true});
  const timestamp=new Date().toISOString().replace(/[-:.TZ]/g,'');
  const filename=workbookFilename(exportState,timestamp);
  await fs.writeFile(path.join(exportDir,filename),buffer);
  const download=encodeURIComponent(workbookFilename(exportState)).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
  res.writeHead(200,{
   'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
   'Content-Disposition':"attachment; filename*=UTF-8''"+download,
   'X-OT-Export-Format':workbookFormat,
   'X-OT-Saved':encodeURIComponent(filename),
   'Cache-Control':'no-store'
  });
  return res.end(buffer);
 }
 if(route==='/api/open-exports'&&req.method==='POST'){await fs.mkdir(path.join(ROOT,'exports'),{recursive:true});const child=spawn('explorer.exe',[path.join(ROOT,'exports')],{detached:true,stdio:'ignore',windowsHide:false});child.unref();return json(res,{ok:true});}
 if(route==='/api/backup'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'application/json','Content-Disposition':'attachment; filename="OT-backup.json"'});return res.end(JSON.stringify({version:1,state},null,2));}
 if(route.startsWith('/images/')){const id=route.slice(8);if(!/^[a-f0-9-]+\.jpg$/.test(id))throw Error('ไม่พบรูป');res.writeHead(200,{'Content-Type':'image/jpeg','Cache-Control':'private, max-age=3600'});return res.end(await fs.readFile(path.join(DATA,'images',id)));}
 const file=route==='/'?'index.html':route.slice(1);if(!['index.html','app.js','style.css','favicon.svg','core.mjs'].includes(file)){res.writeHead(404);return res.end('Not found');}const content=await fs.readFile(file==='core.mjs'?path.join(ROOT,file):path.join(ROOT,'public',file));res.writeHead(200,{'Content-Type':/\.m?js$/.test(file)?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':file.endsWith('.svg')?'image/svg+xml':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});res.end(content);
 }catch(e){json(res,{error:e.message||'เกิดข้อผิดพลาด กรุณาลองใหม่'},400);}});
server.listen(PORT,'127.0.0.1',()=>console.log('OT Assistant: http://127.0.0.1:'+PORT));
server.on('error',e=>{if(e.code==='EADDRINUSE')process.exit(0);else throw e;});
