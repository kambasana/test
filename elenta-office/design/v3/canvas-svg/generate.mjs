import { writeFileSync } from 'node:fs';
const OUT='/tmp/claude-0/-home-user-test/66222c3b-c2a5-5d5a-8b24-2ae41e52a95b/scratchpad/devzip/elenta-office-assets-v2/canvas-art';
const BLOB={'military-lead':'81f8e6a40f13f8ed6d2db72494675802','military-software':'27a38804abdbeef066f35f4889253911','military-testing':'be5d50c25402ac0483d10713417bf70d','military-documentation':'21491a1f48e476c96d403a0b39cc029c','military-analysis':'367f0335bbd30d7756d9b78f2753436b','military-compliance':'12d914d385e5d3a08928ca99b1cfefa9','business-finance':'5e54410e3d8d45adfb1bbabb63f5c1aa','business-documents':'749a52e2b3a4bc70f597a4c547f97203','bookshelf':'543630e92bd762df472c286268918ad6'};
const uri=s=>'/_blob/'+BLOB[s];
const COL={mil:'#657337',biz:'#6554E8',cmd:'#334155',lib:'#188C86'};
const FILL={mil:'#F1F2E5',biz:'#EEEDF9',cmd:'#EDF0F4',lib:'#E9F4F1'};
const ST={working:'#14B8A6',waiting:'#F59E0B',refused:'#EF4444',idle:'#9CA3AF'};
const COS=0.866,SIN=0.5,S=24;
const P=(x,y)=>[(x-y)*COS*S,(x+y)*SIN*S];
const f=n=>(+n).toFixed(1);
let out,minx,miny,maxx,maxy;
const bd=(x,y)=>{minx=Math.min(minx,x);miny=Math.min(miny,y);maxx=Math.max(maxx,x);maxy=Math.max(maxy,y);};
const esc=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;');
function room(x,y,w,h,k){const pts=[[x,y],[x+w,y],[x+w,y+h],[x,y+h]].map(a=>P(...a));pts.forEach(p=>bd(p[0],p[1]));
  out.push(`<polygon points="${pts.map(p=>f(p[0])+','+f(p[1])).join(' ')}" fill="${FILL[k]}" stroke="${COL[k]}" stroke-width="2.4" stroke-opacity="0.85"/>`);}
function worker(x,y,sprite,status,marker){const p=P(x,y);bd(p[0]-57,p[1]-105);bd(p[0]+57,p[1]+15);
  out.push(`<ellipse cx="${f(p[0]-18)}" cy="${f(p[1]+3)}" rx="23" ry="11" fill="none" stroke="${ST[status]}" stroke-width="3"/>`);
  out.push(`<image x="${f(p[0]-57)}" y="${f(p[1]-105)}" width="114" height="112" xlink:href="${uri(sprite)}"/>`);
  if(marker==='waiting')out.push(`<g transform="translate(${f(p[0]-6)},${f(p[1]-128)})"><rect x="-10" y="-10" width="20" height="20" rx="5" fill="#FFFBEB" stroke="${ST.waiting}" stroke-width="2"/><text x="0" y="5" font-size="13" font-weight="700" fill="${ST.waiting}" text-anchor="middle" font-family="sans-serif">?</text></g>`);
  if(marker==='refused')out.push(`<g transform="translate(${f(p[0]-6)},${f(p[1]-128)})"><circle r="10" fill="#FEE2E2" stroke="${ST.refused}" stroke-width="2"/><rect x="-5" y="-1.6" width="10" height="3.2" rx="1.6" fill="${ST.refused}"/></g>`);}
function chip(x,y,name,sub,col,mono){const p=P(x,y);const w=Math.max(name.length*(mono?6.4:7.0)+(col?20:12),44)+14,h=sub?30:22,bx=p[0]-8,by=p[1]-h-14;bd(bx,by);bd(bx+w,by+h);
  out.push(`<g transform="translate(${f(bx)},${f(by)})"><rect width="${f(w)}" height="${h}" rx="7" fill="#FFFFFF" stroke="#E4E8ED" stroke-width="1"/>`+
    (col?`<rect x="9" y="${sub?9:7}" width="9" height="9" rx="2" fill="${col}"/>`:'')+
    `<text x="${col?23:10}" y="${sub?15:14.5}" font-size="${mono?10.5:11.5}" font-weight="600" fill="#1E2530" font-family="${mono?'ui-monospace,Menlo,monospace':'IBM Plex Sans,Segoe UI,sans-serif'}">${esc(name)}</text>`+
    (sub?`<text x="${col?23:10}" y="25" font-size="10.5" fill="#5B6673" font-family="IBM Plex Sans,Segoe UI,sans-serif">${esc(sub)}</text>`:'')+`</g>`);}
function render(scene){out=[];minx=miny=1e9;maxx=maxy=-1e9;scene();
  const pad=36,x=minx-pad,y=miny-pad,w=(maxx-minx)+pad*2,h=(maxy-miny)+pad*2;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${f(x)} ${f(y)} ${f(w)} ${f(h)}" preserveAspectRatio="xMidYMid meet" style="position:absolute;inset:0;width:100%;height:100%" font-family="IBM Plex Sans, Segoe UI, system-ui, sans-serif"><rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" fill="#EEF0F3"/>${out.join('')}</svg>`;}
const office=render(()=>{
  room(0,0,6,5,'biz'); room(6.8,0,5,5,'lib'); room(0,5.6,5,5.4,'cmd'); room(6.3,5.6,8.6,6.6,'mil');
  {const p=P(8.6,1.6);out.push(`<image xlink:href="/_blob/543630e92bd762df472c286268918ad6" x="${f(p[0]-70)}" y="${f(p[1]-120)}" width="150" height="150"/>`);bd(p[0]-70,p[1]-120);}
  [['business-finance','working',1,0.8],['business-finance','working',3.2,0.8],['business-documents','idle',4.6,2.4],['business-documents','idle',1.2,2.8],['business-finance','working',3.2,3.4]].forEach(a=>worker(a[2],a[3],a[0],a[1]));
  worker(1.2,6.8,'business-finance','working'); worker(3.4,8.4,'business-documents','idle');
  [['military-lead','working',7.6,6.6],['military-software','working',9.6,6.6],['military-documentation','working',11.6,6.8],['military-analysis','working',8.2,9.0],['military-compliance','refused',10.2,9.4],['military-testing','idle',12.0,9.2]].forEach(a=>worker(a[2],a[3],a[0],a[1],a[1]==='refused'?'refused':null));
  chip(0.3,0.2,'BUSINESS','5 people',COL.biz); chip(7.0,0.2,'LIBRARY','10 notes · lessons',COL.lib);
  chip(0.3,5.75,'COMMAND','2 people',COL.cmd); chip(6.6,5.75,'MILITARY','10 people · 4 sub-teams',COL.mil);
});
writeFileSync(OUT+'/office.inline.svg',office);
const mil=render(()=>{
  room(0,0,11,8,'mil');
  [{l:'LEAD',n:1,x:4.6,y:6.0,ppl:[['military-lead','working']]},
   {l:'SOFTWARE',n:3,x:1.2,y:1.0,ppl:[['military-software','working'],['military-software','working'],['military-testing','idle']]},
   {l:'DOCUMENTATION',n:2,x:7.4,y:1.0,ppl:[['military-documentation','working'],['military-documentation','waiting']]},
   {l:'ANALYSIS',n:2,x:1.2,y:4.0,ppl:[['military-analysis','working'],['military-analysis','idle']]},
   {l:'COMPLIANCE',n:2,x:6.6,y:4.0,ppl:[['military-compliance','refused'],['military-compliance','working']]}].forEach(cl=>{
     cl.ppl.forEach((pp,i)=>{const px=cl.x+(i%3)*1.55,py=cl.y+Math.floor(i/3)*1.8;worker(px,py,pp[0],pp[1],pp[1]==='waiting'?'waiting':pp[1]==='refused'?'refused':null);});
     chip(cl.x+0.15,cl.y+0.15,cl.l+(cl.n>1?'  '+cl.n:''),'',cl.l==='LEAD'?null:COL.mil,true);});
});
writeFileSync(OUT+'/military.inline.svg',mil);
console.log('office',office.length,'military',mil.length,'blobrefs',(office.match(/_blob/g)||[]).length);
