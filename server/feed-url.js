import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
export function publicIPv4(address){
 if(isIP(address)!==4)return false;
 const [a,b]=address.split('.').map(Number);
 return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&[0,168].includes(b)||a===100&&b>=64&&b<=127||a===198&&[18,19].includes(b));
}
export async function validateFeedURL(value,resolver=lookup){
 const url=new URL(value);
 if(url.protocol!=='https:'||url.port||url.username||url.password||isIP(url.hostname)||!url.hostname.includes('.')||url.hostname.endsWith('.local')||url.hostname.endsWith('.internal'))throw new Error('Use uma URL HTTPS de feed público.');
 const addresses=await resolver(url.hostname,{all:true,family:4});
 if(!addresses.length||addresses.some(p=>!publicIPv4(p.address)))throw new Error('A fonte precisa estar em um endereço público.');
 return url;
}
export async function fetchFeedURL(value,{fetcher=fetch,resolver=lookup,verifyInitial=true}={}){
 let url=verifyInitial?await validateFeedURL(value,resolver):new URL(value);
 for(let i=0;i<=3;i++){
  const response=await fetcher(url,{redirect:'manual',signal:AbortSignal.timeout(12000),headers:{Accept:'application/rss+xml,application/atom+xml,application/json,text/xml','User-Agent':'TrendTV-Editorial/2.0'}});
  if([301,302,303,307,308].includes(response.status)){
   const location=response.headers.get('location');if(!location)throw new Error('Feed redirecionou sem endereço de destino.');
   await response.body?.cancel();url=await validateFeedURL(new URL(location,url).href,resolver);continue;
  }
  if(!response.ok)throw new Error(`A fonte respondeu HTTP ${response.status}. Confira o link do feed.`);
  return response;
 }
 throw new Error('O feed excedeu três redirecionamentos. Use seu endereço final.');
}
