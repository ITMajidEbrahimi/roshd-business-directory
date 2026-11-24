const ASSETS={};
const SNAPSHOT={"snapshot": "d259563a9ce51a1e204e8f8835d73b5d1ccd74b8683e011b27ac2ac9a272f3b6", "exported_at": "2026-11-24T10:36:02.327542+00:00", "tables": {"MojavezProvinces": {"rows": []}, "Leads": {"rows": []}, "Products": {"rows": []}, "Deals": {"rows": []}, "Activities": {"rows": []}, "LicenseArchive": {"rows": []}}};
const TABLES=['MojavezProvinces','Leads','Products','Deals','Activities','LicenseArchive'];
const TEXT_COLUMNS=['request_number','applicant_name','license_title','organization','province','township','business_address','postal_code','business_phone','status_title','detail_state'];
const FILTER_COLUMNS=[...TEXT_COLUMNS,'issued_at','original_issued_at','contact_masked'];
const snapshotRows=TABLES.flatMap(table=>SNAPSHOT.tables[table].rows.map(row=>({table,row})));
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const normalized=column=>`replace(replace(replace(replace(coalesce(${column},''),'ي','ی'),'ك','ک'),'‌',''),' ','')`;
const norm=value=>String(value||'').replaceAll('ي','ی').replaceAll('ك','ک').replace(/[ ‌]/g,'');
const like=value=>'%'+norm(value).replace(/[~%_]/g,c=>'~'+c)+'%';
const expression=key=>key==='contact_masked'?key:key.endsWith('_at')?`substr(${key},1,10)`:`nullif(trim(${key}),'')`;
const parsePublic=row=>{if(row?.public_data){try{row.public_data=JSON.parse(row.public_data);}catch{row.public_data={};}}return row;};
const readAll=async(db,sql,params=[])=> (await db.prepare(sql).bind(...params).all()).results;
const summary=async db=>{
  const batch=await db.batch(TABLES.map(name=>db.prepare(`SELECT count(*) AS total FROM "${name}"`)));
  return Object.fromEntries(TABLES.map((name,index)=>[name,batch[index].results[0].total]));
};
async function seedStatus(db){
  const state=await db.prepare('SELECT cursor FROM PresentationSeed WHERE snapshot=?').bind(SNAPSHOT.snapshot).first();
  const cursor=state?.cursor||0;
  return {ready:cursor>=snapshotRows.length,cursor,total:snapshotRows.length,exported_at:SNAPSHOT.exported_at,snapshot:SNAPSHOT.snapshot};
}
async function seed(db){
  const current=await seedStatus(db);if(current.ready)return current;
  const next=Math.min(current.cursor+40,snapshotRows.length);
  const statements=snapshotRows.slice(current.cursor,next).map(({table,row})=>{
    const columns=SNAPSHOT.tables[table].columns;
    return db.prepare(`INSERT OR IGNORE INTO "${table}" (${columns.map(c=>'"'+c+'"').join(',')}) VALUES (${columns.map(()=>'?').join(',')})`).bind(...columns.map(c=>typeof row[c]==='boolean'?Number(row[c]):row[c]??null));
  });
  statements.push(db.prepare('INSERT INTO PresentationSeed(snapshot,cursor) VALUES (?,?) ON CONFLICT(snapshot) DO UPDATE SET cursor=max(cursor,excluded.cursor)').bind(SNAPSHOT.snapshot,next));
  await db.batch(statements);
  return seedStatus(db);
}
function archiveWhere(params){
  const clauses=[],values=[];
  const q=params.get('q')?.trim();
  if(q){if(q.length>200)fail('متن جست‌وجو حداکثر ۲۰۰ کاراکتر باشد.');clauses.push('('+['applicant_name','license_title','business_address','request_number','township'].map(c=>`${normalized(c)} LIKE ? ESCAPE '~'`).join(' OR ')+')');values.push(...Array(5).fill(like(q)));}
  for(const [key,value] of params){
    if(!key.startsWith('column_')||value==='')continue;
    const column=key.slice(7);if(!FILTER_COLUMNS.includes(column))fail('ستون فیلتر معتبر نیست.');
    let parsed;try{parsed=JSON.parse(value);}catch{fail('مقدار فیلتر معتبر نیست.');}
    if(parsed===null){clauses.push(expression(column)+' IS NULL');continue;}
    if(column==='contact_masked'? ![0,1].includes(parsed):typeof parsed!=='string'||parsed.length>2500)fail('مقدار فیلتر معتبر نیست.');
    clauses.push(expression(column)+'=?');values.push(parsed);
  }
  for(const [key,column] of [['first_name','applicant_name'],['last_name','applicant_name'],['address','business_address'],['business_type','license_title']]){
    const value=params.get(key)?.trim();if(!value)continue;
    if(value.length>600)fail('متن جست‌وجو بیش از حد مجاز است.');
    if(key==='business_type'){clauses.push(`(${normalized(column)} LIKE ? ESCAPE '~' OR ${normalized("json_extract(public_data,'$.isic_title')")} LIKE ? ESCAPE '~')`);values.push(like(value),like(value));}
    else{clauses.push(`${normalized(column)} LIKE ? ESCAPE '~'`);values.push(like(value));}
  }
  const province=params.get('province_id');if(province){if(!/^\d+$/.test(province))fail('کد استان نامعتبر است.');clauses.push(`${normalized('province')}=(SELECT ${normalized('title')} FROM MojavezProvinces WHERE id=?)`);values.push(Number(province));}
  const dateColumn=params.get('date_kind')==='original'?'original_issued_at':'issued_at';
  const from=params.get('issued_from')||params.get('issue_from'),to=params.get('issued_to')||params.get('issue_to');
  for(const [value,operator] of [[from,'>='],[to,'<=']])if(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number.isNaN(Date.parse(value+'T00:00:00Z'))||new Date(value).toISOString().slice(0,10)!==value)fail('تاریخ معتبر میلادی وارد کنید.');clauses.push(`substr(${dateColumn},1,10)${operator}?`);values.push(value);}
  if(from&&to&&from>to)fail('تاریخ شروع بعد از تاریخ پایان است.');
  return {sql:clauses.length?' WHERE '+clauses.join(' AND '):'',values};
}
async function archive(db,params,download=false){
  const page=Number(params.get('page')||1);if(!Number.isSafeInteger(page)||page<1||page>10000000)fail('شماره صفحه معتبر نیست.');
  const {sql,values}=archiveWhere(params);
  const total=(await db.prepare('SELECT count(*) total FROM LicenseArchive'+sql).bind(...values).first()).total;
  if(download&&total>10000)fail('برای خروجی حداکثر ۱۰ هزار ردیف، فیلتر دقیق‌تری انتخاب کنید.');
  const rows=await readAll(db,'SELECT * FROM LicenseArchive'+sql+' ORDER BY issued_at DESC,id DESC LIMIT ? OFFSET ?',[...values,download?10000:30,download?0:(page-1)*30]);
  return {items:rows.map(parsePublic),page,total,page_size:30};
}
async function options(db){
  const batch=await db.batch(FILTER_COLUMNS.map(key=>db.prepare(`SELECT DISTINCT ${expression(key)} AS value FROM LicenseArchive ORDER BY value`)));
  return Object.fromEntries(FILTER_COLUMNS.map((key,i)=>[key,batch[i].results.map(r=>r.value)]));
}
async function api(request,env,path,url){
  if(!env.DB)fail('دیتابیس آنلاین هنوز به برنامه متصل نشده است.',503);
  const db=env.DB;
  if(path==='/api/initialize'&&request.method==='POST')return json(await seed(db));
  if(request.method!=='GET')fail('این نسخه برای نمایش اطلاعات است.',405);
  if(path==='/api/status')return json(await seedStatus(db));
  const status=await seedStatus(db);if(!status.ready)return json({...status,error:'انتقال داده‌ها در حال تکمیل است.'},503);
  if(path==='/api/dashboard'){
    const [counts,provinces,businesses,recent]=await Promise.all([
      summary(db),readAll(db,"SELECT coalesce(nullif(province,''),'ثبت نشده') title,count(*) count FROM LicenseArchive GROUP BY province ORDER BY count DESC LIMIT 8"),
      readAll(db,"SELECT coalesce(nullif(license_title,''),'ثبت نشده') title,count(*) count FROM LicenseArchive GROUP BY license_title ORDER BY count DESC LIMIT 6"),
      readAll(db,'SELECT * FROM LicenseArchive ORDER BY issued_at DESC,id DESC LIMIT 6')
    ]);
    return json({counts,provinces,businesses,recent:recent.map(parsePublic),exported_at:SNAPSHOT.exported_at});
  }
  if(path==='/api/licenses/archive/options')return json(await options(db));
  if(path==='/api/license-search/options')return json({provinces:await readAll(db,'SELECT id,title FROM MojavezProvinces ORDER BY sort_order'),business_types:(await readAll(db,"SELECT DISTINCT license_title title FROM LicenseArchive WHERE license_title<>'' UNION SELECT DISTINCT json_extract(public_data,'$.isic_title') title FROM LicenseArchive WHERE json_extract(public_data,'$.isic_title') IS NOT NULL ORDER BY title")).map(r=>r.title)});
  if(['/api/licenses/archive','/api/license-search'].includes(path))return json(await archive(db,url.searchParams));
  const detail=path.match(/^\/api\/licenses\/archive\/(\d+)$/);
  if(detail){const row=await db.prepare('SELECT * FROM LicenseArchive WHERE id=?').bind(Number(detail[1])).first();if(!row)fail('مجوز پیدا نشد.',404);return json(parsePublic(row));}
  if(path==='/api/export.csv'){
    const {items}=await archive(db,url.searchParams,true);
    const fields=['request_number','applicant_name','license_title','province','township','business_address','business_phone','issued_at','original_issued_at','status_title'];
    const cell=value=>'"'+String(value??'').replace(/^[\s]*[=+@-]/,s=>"'"+s).replaceAll('"','""')+'"';
    const csv='\uFEFF'+[fields.map(cell).join(','),...items.map(row=>fields.map(k=>cell(row[k])).join(','))].join('\r\n');
    return new Response(csv,{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="roshd-licenses.csv"','Cache-Control':'no-store'}});
  }
  if(path==='/api/data')return json({leads:await readAll(db,'SELECT * FROM Leads ORDER BY id DESC'),products:await readAll(db,'SELECT * FROM Products ORDER BY id DESC'),deals:await readAll(db,'SELECT d.*,l.company,p.name product FROM Deals d LEFT JOIN Leads l ON l.id=d.lead_id LEFT JOIN Products p ON p.id=d.product_id ORDER BY d.id DESC'),activities:await readAll(db,'SELECT a.*,l.company FROM Activities a LEFT JOIN Leads l ON l.id=a.lead_id ORDER BY a.done,a.due_date'),hunter_configured:false});
  fail('مسیر پیدا نشد.',404);
}
export default {async fetch(request,env){
  const url=new URL(request.url),path=url.pathname;
  try{
    if(path.startsWith('/api/')){
      if(request.method!=='GET'){
        const origin=request.headers.get('Origin');if(origin&&origin!==url.origin)fail('مبدأ درخواست معتبر نیست.',403);
        if(request.headers.get('Sec-Fetch-Site')==='cross-site')fail('مبدأ درخواست معتبر نیست.',403);
        if(request.headers.get('X-Roshd-Client')!=='presentation')fail('درخواست معتبر نیست.',403);
      }
      return await api(request,env,path,url);
    }
    if(!['GET','HEAD'].includes(request.method))return json({error:'روش درخواست معتبر نیست.'},405);
    const asset=ASSETS[path];if(!asset)return new Response('یافت نشد',{status:404});
    const body=asset.binary?Uint8Array.from(atob(asset.body),c=>c.charCodeAt(0)):asset.body;
    return new Response(request.method==='HEAD'?null:body,{headers:{'Content-Type':asset.type,'Cache-Control':path==='/'?'no-cache':'public, max-age=3600','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'self' https://chatgpt.com https://*.chatgpt.com"}});
  }catch(error){console.error('Request failed',path,error.status||500);return json({error:error.status?error.message:'خطای اتصال به دیتابیس آنلاین. لطفاً دوباره تلاش کنید.'},error.status||500);}
}};
