import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
function offlineShell(){return {name:'trendtv-offline-shell',closeBundle(){
  const assets=readdirSync('dist/assets').map(name=>`/assets/${name}`);
  const version=createHash('sha256').update(JSON.stringify(assets)).digest('hex').slice(0,12);
  const precache=['/','/manifest.webmanifest','/icons/icon-192.png','/icons/icon-512.png','/icons/maskable-512.png','/icons/apple-touch-icon.png',...assets];
  writeFileSync('dist/sw.js',readFileSync('public/sw.js','utf8').replace('__BUILD_ID__',version).replace('__PRECACHE__',JSON.stringify(precache)));
}};}
export default defineConfig({plugins:[react(),offlineShell()]});
