import {auth} from './firebase';
import {parseNewsImport,normalizeNewsItem,NEWS_WORD_LIMIT} from './news';
export async function adminRequest(path,{signal,method='GET',body}={}){
 const user=auth.currentUser;if(!user)throw new Error('Entre no painel para importar.');
 const token=await user.getIdToken();const response=await fetch(path,{method,headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal});
 let data;try{data=await response.json()}catch{throw new Error('A função de importação não está disponível. Publique o código atualizado na Vercel.');}
 if(!response.ok)throw new Error(data.error||'Não foi possível importar.');return data;
}
export async function importEditorialSource(id,{signal}={}){
 const data=await adminRequest(`/api/editorial-feed?source=${encodeURIComponent(id)}`,{signal});
 return parseNewsImport(data.text,data.kind==='mixed'?'news':data.kind).map(p=>normalizeNewsItem({...p,kind:data.kind==='mixed'?p.kind:data.kind,source:p.source||data.name,title:data.kind==='news'?p.title.split(/\s+/).slice(0,NEWS_WORD_LIMIT).join(' '):p.title,approved:false}));
}

export async function importFeedURL(source){
 const data=await adminRequest('/api/editorial-feed',{method:'POST',body:source});
 return parseNewsImport(data.text,source.kind).map(p=>normalizeNewsItem({...p,kind:source.kind,source:p.source||data.name,title:source.kind==='news'?p.title.split(/\s+/).slice(0,NEWS_WORD_LIMIT).join(' '):p.title,approved:false}));
}
export async function importTweetURL(url){
 const data=await adminRequest(`/api/tweet-preview?url=${encodeURIComponent(url)}`);
 const doc=new DOMParser().parseFromString(data.html,'text/html'),paragraph=doc.querySelector('blockquote p');
 if(!paragraph?.textContent?.trim())throw new Error('Este post não forneceu texto público. Use um feed ou escreva o texto.');
 return normalizeNewsItem({kind:'tweet',title:paragraph.textContent,source:data.author,url:data.url,category:'Redes sociais',approved:false});
}
