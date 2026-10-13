export async function requireAdmin(req,fetcher=fetch){
 const token=/^Bearer (\S+)$/.exec(req.headers?.authorization||'')?.[1];
 if(!token)throw Object.assign(new Error('Entre no painel para importar.'),{status:401});
 let claims;try{claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString());}catch{throw Object.assign(new Error('Sessão inválida.'),{status:401});}
 const uid=claims.user_id||claims.sub,project=process.env.FIREBASE_PROJECT_ID||'tvweb-71058';
 if(typeof uid!=='string'||!uid||uid.includes('/')||!Number.isFinite(claims.auth_time)||claims.auth_time*1000+28800000<Date.now())throw Object.assign(new Error('Sessão expirada.'),{status:401});
 // Firebase verifies the token. Decoded claims are used only to locate the protected own admin document.
 const response=await fetcher(`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(project)}/databases/(default)/documents/admins/${encodeURIComponent(uid)}`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(8000)});
 if(!response.ok)throw Object.assign(new Error('Não foi possível autorizar esta sessão.'),{status:403});
 const data=await response.json();if(data.fields?.enabled?.booleanValue!==true)throw Object.assign(new Error('Conta sem acesso ao painel.'),{status:403});
}
export async function boundedText(response,limit=500000){
 if(!response.body)throw new Error('Fonte sem conteúdo.');const reader=response.body.getReader();let size=0;const chunks=[];
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit)throw new Error('Fonte maior que 500 KB.');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
 return Buffer.concat(chunks.map(v=>Buffer.from(v))).toString('utf8');
}
