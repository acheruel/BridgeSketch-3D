// 0.6.9: edit a draft packet only. Canceling the dialog never edits the displayed site.
import { serializePacket, gridBounds } from './terrain-packet.mjs';

export const zoneNames = { water: 'Lake / pond', river: 'River', forest: 'Forest', grass: 'Grass', road: 'Road' };
export function validZonePoints(points, road = false) {
  if (points.length < (road ? 2 : 3) || points.some(p => p.some(v => !Number.isFinite(v)))) return false;
  if (road) return points.slice(1).some((p, i) => Math.hypot(p[0] - points[i][0], p[1] - points[i][1]) > 0.1);
  let area = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) area += points[j][0] * points[i][1] - points[i][0] * points[j][1];
  if (Math.abs(area) < 1) return false;
  // Reject crossing edges rather than rendering ambiguous water/forest masks.
  const cross = (a,b,c) => (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  for (let i = 0; i < points.length; i++) for (let j = i + 2; j < points.length; j++) {
    if (i === 0 && j === points.length - 1) continue;
    const a=points[i], b=points[(i+1)%points.length], c=points[j], d=points[(j+1)%points.length];
    if (cross(a,b,c)*cross(a,b,d)<0 && cross(c,d,a)*cross(c,d,b)<0) return false;
  }
  return true;
}

export function createZoneEditor({ $, packet, redraw, toCanvas, ratio }) {
  let selected = -1, vertex = 0, drawing = null, moving = false, beforeMove = null, history = [];
  const list = $('dem-zone-list'), type = $('dem-zone-type'), width = $('dem-zone-width'), level = $('dem-zone-level');
  const zone = () => packet()?.zones[selected];
  const points = () => zone()?.line ?? zone()?.polygon ?? [];
  const remember = () => { history.push(structuredClone(packet().zones)); if (history.length > 30) history.shift(); };
  const message = s => $('dem-zone-help').textContent = s;
  const bounded = p => {
    const b = gridBounds(packet());
    return [Math.max(b.x0, Math.min(b.x1,p[0])), Math.max(b.y0,Math.min(b.y1,p[1]))];
  };
  function refresh() {
    const p = packet(); if (!p) return;
    list.replaceChildren(new Option('None · move the bridge', '-1'), ...p.zones.map((z,i) => new Option(`${i+1} · ${zoneNames[z.type]} · ${z.source}`, String(i))));
    list.value = String(selected);
    const z = zone();
    if (z) { type.value=z.type; width.value=z.width ?? 7; level.value=z.level ?? ''; }
    width.disabled = (z?.type ?? type.value) !== 'road';
    level.disabled = !['water','river'].includes(z?.type ?? type.value);
    $('dem-zone-delete').disabled = !z || !!drawing;
    $('dem-zone-finish').disabled = !drawing;
    $('dem-zone-cancel').disabled = !drawing;
    $('dem-zone-undo').disabled = !history.length || !!drawing;
    const pts=points(); vertex=Math.max(0,Math.min(vertex,pts.length-1));
    $('dem-vertex').replaceChildren(...pts.map((_,i)=>new Option(String(i+1),String(i))));
    $('dem-vertex').value=String(vertex);
    $('dem-vertex-x').value=pts[vertex]?.[0]?.toFixed(2) ?? '';
    $('dem-vertex-y').value=pts[vertex]?.[1]?.toFixed(2) ?? '';
    for (const id of ['dem-vertex','dem-vertex-x','dem-vertex-y','dem-vertex-add','dem-vertex-delete']) $(id).disabled=!z || !!drawing;
    redraw();
  }
  list.onchange=()=>{selected=Number(list.value);vertex=0;refresh();};
  type.onchange=()=>{
    const z=zone();
    if(z){
      if ((z.type==='road') !== (type.value==='road')) {message('A road is a line: draw a new zone to change the geometry.');type.value=z.type;return;}
      remember(); z.type=type.value;z.source='user'; if(!['water','river'].includes(z.type))delete z.level;
    }
    refresh();
  };
  width.onchange=()=>{const z=zone(),v=Number(width.value);if(z?.type!=='road')return;if(!Number.isFinite(v)||v<3||v>40){message('Road width: 3 to 40 m.');return;}remember();z.width=v;z.source='user';refresh();};
  level.onchange=()=>{const z=zone();if(!z||!['river','water'].includes(z.type))return;const v=Number(level.value);if(!Number.isFinite(v))return;remember();if(level.value.trim()==='')delete z.level;else z.level=v;z.source='user';refresh();};
  $('dem-zone-new').onclick=()=>{if(!packet())return;drawing={type:type.value,points:[],width:Number(width.value)||7};selected=-1;message('Click to add vertices. Finish keeps the drawing; Cancel drops it.');refresh();};
  $('dem-zone-finish').onclick=()=>{
    if(!drawing)return;
    if(!validZonePoints(drawing.points,drawing.type==='road')){message('Invalid drawing: at least 3 vertices without crossing edges (2 for a road).');return;}
    remember();const z={type:drawing.type,source:'user'};
    if(z.type==='road'){z.line=drawing.points;z.width=Math.max(3,Math.min(40,drawing.width));}else z.polygon=drawing.points;
    packet().zones.push(z);selected=packet().zones.length-1;drawing=null;vertex=0;message('Zone added. Apply to update the scene.');refresh();
  };
  $('dem-zone-cancel').onclick=()=>{drawing=null;refresh();message('Drawing cancelled.');};
  $('dem-zone-delete').onclick=()=>{if(!zone())return;remember();packet().zones.splice(selected,1);selected=-1;refresh();};
  $('dem-zone-undo').onclick=()=>{if(!history.length)return;packet().zones=history.pop();selected=-1;refresh();};
  $('dem-vertex').onchange=()=>{vertex=Number($('dem-vertex').value);refresh();};
  function editVertex() {
    if(!zone())return;const x=Number($('dem-vertex-x').value),y=Number($('dem-vertex-y').value);
    if(!Number.isFinite(x)||!Number.isFinite(y))return;
    const pts=structuredClone(points());pts[vertex]=bounded([x,y]);
    if(!validZonePoints(pts,zone().type==='road')){message('This edit crosses the edges or collapses the area.');return;}
    remember();zone()[zone().type==='road'?'line':'polygon']=pts;zone().source='user';refresh();
  }
  $('dem-vertex-x').onchange=editVertex;$('dem-vertex-y').onchange=editVertex;
  $('dem-vertex-add').onclick=()=>{if(!zone())return;remember();const pts=points(),a=pts[vertex],b=pts[(vertex+1)%pts.length];pts.splice(vertex+1,0,[(a[0]+b[0])/2,(a[1]+b[1])/2]);vertex++;zone().source='user';refresh();};
  $('dem-vertex-delete').onclick=()=>{if(!zone())return;const pts=points().filter((_,i)=>i!==vertex);if(!validZonePoints(pts,zone().type==='road')){message('This vertex is needed for a valid zone.');return;}remember();zone()[zone().type==='road'?'line':'polygon']=pts;zone().source='user';refresh();};
  $('dem-save-terrain').onclick=()=>{
    if(!packet()||drawing){message('Finish the drawing before saving.');return;}
    const blob=new Blob([serializePacket(packet())],{type:'application/json'}),a=document.createElement('a');
    a.href=URL.createObjectURL(blob);a.download='site-corrige.bs3dterrain';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),4000);
  };
  return {
    reset(){selected=-1;vertex=0;drawing=null;moving=false;history=[];refresh();},
    unfinished:()=>!!drawing,
    down(x,y,p){
      if(drawing){drawing.points.push(bounded(p));redraw();return true;}
      const i=points().findIndex(q=>{const [qx,qy]=toCanvas(...q);return Math.hypot(qx-x,qy-y)<12*ratio();});
      if(i<0)return false;vertex=i;beforeMove=structuredClone(packet().zones);moving=true;refresh();return true;
    },
    move(p){if(!moving)return false;points()[vertex]=bounded(p);redraw();return true;},
    up(){if(!moving)return;moving=false;if(!validZonePoints(points(),zone().type==='road')){packet().zones=beforeMove;message('Move cancelled: invalid geometry.');}else{history.push(beforeMove);if(history.length>30)history.shift();zone().source='user';}beforeMove=null;refresh();},
    draw(g){
      const pts=drawing?.points ?? points();if(!pts.length)return;
      g.save();g.strokeStyle='#fff';g.lineWidth=2*ratio();g.setLineDash([5*ratio(),3*ratio()]);g.beginPath();
      pts.forEach((p,i)=>{const q=toCanvas(...p);i?g.lineTo(...q):g.moveTo(...q);});
      if(!drawing&&zone()?.polygon)g.closePath();g.stroke();g.setLineDash([]);
      pts.forEach((p,i)=>{const q=toCanvas(...p);g.beginPath();g.arc(...q,5*ratio(),0,Math.PI*2);g.fillStyle=i===vertex?'#E69F00':'#fff';g.fill();g.strokeStyle='#102d41';g.stroke();g.fillStyle='#102d41';g.font=`${11*ratio()}px sans-serif`;g.fillText(String(i+1),q[0]+7*ratio(),q[1]-5*ratio());});g.restore();
    }
  };
}
