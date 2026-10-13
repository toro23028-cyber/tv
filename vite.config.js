import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

function offlineShell(){return {name:'trendtv-offline-shell',writeBundle(output,bundle){
  const assets=Object.keys(bundle).filter(name=>name.startsWith('assets/')).map(name=>`/${name}`);
  const newsBaseHash=createHash('sha256').update(readFileSync('public/news-wall-base.png')).digest('hex');
  const version=createHash('sha256').update(JSON.stringify({assets,newsBaseHash})).digest('hex').slice(0,12);
  const precache=['/','/manifest.webmanifest','/icons/icon-192.png','/icons/icon-512.png','/icons/maskable-512.png','/icons/apple-touch-icon.png','/news-wall-base.png',...assets];
  const outDir=output.dir||'dist';
  writeFileSync(`${outDir}/sw.js`,readFileSync('public/sw.js','utf8').replace('__BUILD_ID__',version).replace('__PRECACHE__',JSON.stringify(precache)));
}};}

export default defineConfig({
  plugins:[react(),offlineShell()],
  build:{
    rolldownOptions:{output:{manualChunks(id){
      if(!id.includes('node_modules'))return;
      if(id.includes('/firebase/auth/'))return 'firebase-auth';
      if(id.includes('/firebase/firestore/'))return 'firebase-firestore';
      if(id.includes('/firebase/'))return 'firebase-core';
      if(id.includes('/react/')||id.includes('/react-dom/')||id.includes('/scheduler/'))return 'react-vendor';
    }}}
    ,chunkSizeWarningLimit:550
  }
});
