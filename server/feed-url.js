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
