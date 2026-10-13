export const studioAllowed=channel=>channel?.studioEnabled===true||(channel?.studioEnabled===undefined&&channel?.newsEnabled===true);
export function channelDisplayMode(channel,settings={}){
 if(!studioAllowed(channel))return 'cinema';
 return settings.channelModes?.[channel.id]==='cinema'?'cinema':'studio';
}
export const isActualLive=video=>video?.snippet?.liveBroadcastContent==='live'&&!video?.liveStreamingDetails?.actualEndTime;
export async function toggleFullscreen(element,doc){
 if(doc.fullscreenElement)await doc.exitFullscreen();
 else if(element?.requestFullscreen)await element.requestFullscreen();
 else throw new Error('Tela cheia indisponível neste navegador.');
}
