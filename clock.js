// Um único relógio de transmissão, independente do fuso do espectador.
export const TIME_ZONE = import.meta.env?.VITE_BROADCAST_TIMEZONE || 'America/Sao_Paulo';
const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE, year:'numeric', month:'2-digit', day:'2-digit',
  hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23'
});
export function broadcastParts(date = new Date()) {
  return Object.fromEntries(formatter.formatToParts(date).map(p => [p.type, p.value]));
}
export function getToday(date = new Date()) {
  const p = broadcastParts(date); return `${p.year}-${p.month}-${p.day}`;
}
export function getNow(date = new Date()) {
  const p = broadcastParts(date); return Number(p.hour)*3600+Number(p.minute)*60+Number(p.second);
}
export function fmtHM(seconds) {
  const s = Math.max(0, Number(seconds)||0);
  return `${String(Math.floor(s/3600)).padStart(2,'0')}:${String(Math.floor(s%3600/60)).padStart(2,'0')}`;
}
export function broadcastTime(date = new Date()) { return fmtHM(getNow(date)); }
export function broadcastDate(date = new Date(), options = {}) {
  return date.toLocaleDateString('pt-BR', {timeZone:TIME_ZONE, ...options});
}
const BASE = Date.UTC(2026,0,1);
export function dateSecondsToAbsolute(date, seconds = 0) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date||'')) return NaN;
  return (Date.parse(`${date}T00:00:00Z`)-BASE)/1000+Number(seconds);
}
export function absoluteToDateSeconds(absolute) {
  const day = Math.floor(absolute/86400);
  return {date:new Date(BASE+day*86400000).toISOString().slice(0,10), seconds:absolute-day*86400};
}
export function addBroadcastDays(date,days=1) {
  return absoluteToDateSeconds(dateSecondsToAbsolute(date)+Number(days)*86400).date;
}
export function getBroadcastWeekday(date) {
  const days=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  const absolute=dateSecondsToAbsolute(date);
  return Number.isFinite(absolute)?days[new Date(BASE+absolute*1000).getUTCDay()]:'';
}
export function getAbsoluteNow(date = new Date()) { return dateSecondsToAbsolute(getToday(date),getNow(date)); }
