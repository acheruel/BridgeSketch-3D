// 0.6.9: distance along a draped polyline, shared by road markings and vehicles.
export function roadPath(points, width, ground) {
  const lengths=[0];
  for(let i=1;i<points.length;i++) lengths.push(lengths.at(-1)+Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1]));
  const length=lengths.at(-1);
  return { width, halfLength:length/2, sample(s,u=0) {
    const d=Math.max(0,Math.min(length,s+length/2));
    let i=1;while(i<lengths.length-1&&lengths[i]<d)i++;
    const a=points[i-1],b=points[i],seg=lengths[i]-lengths[i-1]||1,t=(d-lengths[i-1])/seg,
      tx=(b[0]-a[0])/seg,tz=(b[1]-a[1])/seg,x=a[0]+(b[0]-a[0])*t-tz*u,z=a[1]+(b[1]-a[1])*t+tx*u;
    return {x,z,tx,tz,y:ground(x,z)+0.1};
  }};
}
