/* Functions' V8 isolate has no Web APIs. This bounded compatibility layer is
 * bundled only for that host; no networking/storage or external dependency.
 * UUID entropy MUST come from an OS CSPRNG supplied by the caller, never Math.random.
 */
const runtimeAlphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function portableBase64(bytes){let out='';for(let i=0;i<bytes.length;i+=3){const a=bytes[i],b=bytes[i+1]??0,c=bytes[i+2]??0;out+=runtimeAlphabet[a>>>2]+runtimeAlphabet[((a&3)<<4)|(b>>>4)]+(i+1<bytes.length?runtimeAlphabet[((b&15)<<2)|(c>>>6)]:'=')+(i+2<bytes.length?runtimeAlphabet[c&63]:'=');}return out;}
export function portableUnbase64(value){if(typeof value!=='string'||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))throw Error('invalid_base64');const result=new Uint8Array(value.length/4*3-(value.endsWith('==')?2:value.endsWith('=')?1:0));let p=0;for(let i=0;i<value.length;i+=4){const a=runtimeAlphabet.indexOf(value[i]),b=runtimeAlphabet.indexOf(value[i+1]),c=runtimeAlphabet.indexOf(value[i+2]),d=runtimeAlphabet.indexOf(value[i+3]);if(p<result.length)result[p++]=(a<<2)|(b>>>4);if(p<result.length)result[p++]=((b&15)<<4)|(c>>>2);if(p<result.length)result[p++]=((c&3)<<6)|d;}return result;}
export function portableEncode(value){const out=[];for(const char of String(value)){let c=char.codePointAt(0);if(c>=0xd800&&c<=0xdfff)c=0xfffd;if(c<128)out.push(c);else if(c<2048)out.push(0xc0|(c>>6),0x80|(c&63));else if(c<65536)out.push(0xe0|(c>>12),0x80|((c>>6)&63),0x80|(c&63));else out.push(0xf0|(c>>18),0x80|((c>>12)&63),0x80|((c>>6)&63),0x80|(c&63));}return new Uint8Array(out);}
export function portableDecode(bytes){let out='';for(let i=0;i<bytes.length;){const a=bytes[i++];let count,c,min;if(a<0x80){count=0;c=a;min=0;}else if(a>=0xc2&&a<=0xdf){count=1;c=a&31;min=0x80;}else if(a>=0xe0&&a<=0xef){count=2;c=a&15;min=0x800;}else if(a>=0xf0&&a<=0xf4){count=3;c=a&7;min=0x10000;}else throw Error('invalid_utf8');if(i+count>bytes.length)throw Error('invalid_utf8');for(let n=0;n<count;n++){const b=bytes[i++];if((b&0xc0)!==0x80)throw Error('invalid_utf8');c=(c<<6)|(b&63);}if(c<min||c>0x10ffff||(c>=0xd800&&c<=0xdfff))throw Error('invalid_utf8');if(!(out===''&&i===3&&c===0xfeff))out+=String.fromCodePoint(c);}return out;}
const runtimeK=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
export function portableSHA256(input){
  const bytes=input instanceof Uint8Array?input:new Uint8Array(input);if(bytes.length>256*1024*1024)throw Error('hash_input_limit');
  const size=Math.ceil((bytes.length+9)/64)*64,data=new Uint8Array(size);data.set(bytes);data[bytes.length]=128;
  const bitLength=bytes.length*8,view=new DataView(data.buffer);view.setUint32(size-8,Math.floor(bitLength/4294967296));view.setUint32(size-4,bitLength>>>0);
  const h=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19],w=new Uint32Array(64),ror=(x,n)=>(x>>>n)|(x<<(32-n));
  for(let offset=0;offset<size;offset+=64){
    for(let i=0;i<16;i++)w[i]=view.getUint32(offset+i*4);
    for(let i=16;i<64;i++){const a=w[i-15],b=w[i-2],s0=ror(a,7)^ror(a,18)^(a>>>3),s1=ror(b,17)^ror(b,19)^(b>>>10);w[i]=(w[i-16]+s0+w[i-7]+s1)>>>0;}
    let [a,b,c,d,e,f,g,j]=h;
    for(let i=0;i<64;i++){const s1=ror(e,6)^ror(e,11)^ror(e,25),ch=(e&f)^(~e&g),t1=(j+s1+ch+runtimeK[i]+w[i])>>>0,s0=ror(a,2)^ror(a,13)^ror(a,22),maj=(a&b)^(a&c)^(b&c),t2=(s0+maj)>>>0;j=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;}
    for(const [i,x]of [a,b,c,d,e,f,g,j].entries())h[i]=(h[i]+x)>>>0;
  }
  const result=new Uint8Array(32),output=new DataView(result.buffer);for(let i=0;i<8;i++)output.setUint32(i*4,h[i]);return result;
}
export function createPortableRuntime(entropyBase64){
  const seed=portableUnbase64(entropyBase64);if(seed.length<32)throw Error('os_entropy_required');let counter=0;
  return {
    TextEncoder:class{encode(value){return portableEncode(value??'');}},
    TextDecoder:class{constructor(label='utf-8',options={}){if(label!=='utf-8'||options.fatal===false)throw Error('unsupported_decoder');}decode(bytes){return portableDecode(bytes);}},
    atob:value=>[...portableUnbase64(value)].map(x=>String.fromCharCode(x)).join(''),
    btoa:value=>{const bytes=Uint8Array.from(value,x=>{const n=x.charCodeAt(0);if(n>255)throw Error('invalid_binary_string');return n;});return portableBase64(bytes);},
    crypto:{subtle:{digest:async(algorithm,input)=>{if(algorithm!=='SHA-256')throw Error('unsupported_digest');return portableSHA256(input).buffer;}},randomUUID:()=>{
      if(++counter>1000000)throw Error('uuid_stream_limit');
      const bytes=new Uint8Array(seed.length+8);bytes.set(seed);new DataView(bytes.buffer).setUint32(seed.length+4,counter);
      const id=portableSHA256(bytes).slice(0,16);id[6]=(id[6]&15)|64;id[8]=(id[8]&63)|128;const hex=[...id].map(x=>x.toString(16).padStart(2,'0')).join('');return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
    }}
  };
}
