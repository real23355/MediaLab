// A key access unit may not repeat the VPS/SPS/PPS carried at the file start.
// Supplying those NALs initializes a fresh decoder without altering frame statistics.
export function keyFrameData(source:Uint8Array,frame:Uint8Array,codec:string){
  const avc=codec.startsWith("avc"),wanted=avc?[7,8]:[32,33,34],found=new Map<number,Uint8Array>();
  let start=-1,payload=0;
  for(let i=0;i+3<source.length;i++){
    if(source[i]!==0||source[i+1]!==0)continue;
    const size=source[i+2]===1?3:source[i+2]===0&&source[i+3]===1?4:0;if(!size)continue;
    if(start>=0){const type=avc?source[payload]&31:(source[payload]>>1)&63;if(wanted.includes(type))found.set(type,source.subarray(start,i));}
    start=i;payload=i+size;i+=size-1;
  }
  if(start>=0){const type=avc?source[payload]&31:(source[payload]>>1)&63;if(wanted.includes(type))found.set(type,source.subarray(start));}
  const prefix=[...found.values()],length=prefix.reduce((n,p)=>n+p.length,0),result=new Uint8Array(length+frame.length);let offset=0;
  for(const p of prefix){result.set(p,offset);offset+=p.length;}result.set(frame,offset);return result;
}
