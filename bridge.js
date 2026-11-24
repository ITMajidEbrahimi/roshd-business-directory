import worker from './worker-api.js';
const assetBase=new URL('.',import.meta.url);
const originalFetch=window.fetch.bind(window);
const notice=document.getElementById('notice');
notice.hidden=false;notice.textContent='در حال بارگذاری بانک اطلاعات کسب‌وکار…';
try {
  await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=new URL('sql-wasm.js',assetBase).href;script.onload=resolve;script.onerror=()=>reject(new Error('بارگذاری موتور جست‌وجو انجام نشد.'));document.head.append(script);});
  const [SQL,response]=await Promise.all([window.initSqlJs({locateFile:file=>new URL(file,assetBase).href}),originalFetch(new URL('presentation.sqlite3',assetBase))]);
  if(!response.ok)throw new Error('دیتابیس بارگذاری نشد.');
  const sqlite=new SQL.Database(new Uint8Array(await response.arrayBuffer()));
  const DB={prepare(sql){let args=[];const statement={bind(...values){args=values;return statement;},async all(){const query=sqlite.prepare(sql);try{query.bind(args);const results=[];while(query.step())results.push(query.getAsObject());return {results};}finally{query.free();}},async first(){const {results}=await statement.all();return results[0]||null;}};return statement;},async batch(statements){const result=[];for(const statement of statements)result.push(await statement.all());return result;}};
  window.fetch=async(input,options={})=>{
    const url=new URL(typeof input==='string'?input:input.url,location.href);
    if(url.origin===location.origin&&url.pathname.startsWith('/api/'))return worker.fetch(new Request(url,options),{DB});
    return originalFetch(input,options);
  };
  notice.hidden=true;
  const script=document.createElement('script');script.src=new URL('app.js',assetBase).href;document.body.append(script);
}catch(error){notice.textContent=error.message;}
