import {auth} from './firebase';
import {parseNewsImport,normalizeNewsItem,NEWS_WORD_LIMIT} from './news';
export async function adminRequest(path,{signal}={}){
 const user=auth.currentUser;if(!user)throw new Error('Entre no painel para importar.');
 const token=await user.getIdToken();const response=await fetch(path,{headers:{Authorization:`Bearer ${token}`},signal});
 let data;try{data=await response.json()}catch{throw new Error('A função de importação não está disponível. Publique o código atualizado na Vercel.');}
 if(!response.ok)throw new Error(data.error||'Não foi possível importar.');return data;
}
export async function importEditorialSource(id,{signal}={}){
 const data=await adminRequest(`/api/editorial-feed?source=${encodeURIComponent(id)}`,{signal});
 return parseNewsImport(data.text,data.kind==='mixed'?'news':data.kind).map(p=>normalizeNewsItem({...p,kind:data.kind==='mixed'?p.kind:data.kind,source:p.source||data.name,title:data.kind==='news'?p.title.split(/\s+/).slice(0,NEWS_WORD_LIMIT).join(' '):p.title,approved:false}));
}
