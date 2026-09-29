// Restricted containers may hide /proc. getrusage peak RSS remains measurable.
export function resourceSnapshot(){
  let rss,rssKind='current';
  try{rss=process.memoryUsage().rss;}catch{rss=process.resourceUsage().maxRSS*1024;rssKind='peak';}
  return {cpu:process.cpuUsage(),rss,rssKind,peakRss:process.resourceUsage().maxRSS*1024};
}
