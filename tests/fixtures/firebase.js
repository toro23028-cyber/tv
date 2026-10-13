export const db={},auth={};
export const state={writes:0,batches:[],transactions:[]};
export function doc(...parts){return{path:parts.slice(1).join('/')}}
export function collection(...parts){return{path:parts.slice(1).join('/')}}
export function writeBatch(){const ops=[];state.batches.push(ops);return{set:(...a)=>ops.push(['set',...a]),update:(...a)=>ops.push(['update',...a]),delete:(...a)=>ops.push(['delete',...a]),commit:async()=>{state.writes++;}}}
export async function runTransaction(_,cb){state.transactions.push(1);return cb({get:async()=>({exists:()=>false,data:()=>undefined}),set(){},delete(){}})}
export function onSnapshot(){return()=>{}}
export async function updateDoc(){}
export async function deleteDoc(){}
export async function getDoc(){return{exists:()=>false}}
export async function setDoc(){}
