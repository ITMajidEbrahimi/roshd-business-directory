'use strict';
const $=s=>document.querySelector(s),num=n=>Number(n||0).toLocaleString('fa-IR');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=v=>v?new Date(String(v).slice(0,10)+'T00:00:00').toLocaleDateString('fa-IR'):'—';
const titles={dashboard:'نمای کلی کسب‌وکار',archive:'آرشیو مجوزهای کسب‌وکار',search:'جست‌وجوی پیشرفته',leads:'مشتریان و فرصت‌های فروش',activities:'پیگیری‌های مشتریان',products:'کالا و معاملات'};
const statusNames={new:'جدید',contacted:'تماس گرفته‌شده',qualified:'واجد شرایط',won:'موفق',lost:'از دست رفته',draft:'پیش‌نویس',confirmed:'تأییدشده',cancelled:'لغوشده',fetched:'دریافت‌شده',error:'خطای دریافت',pending:'در انتظار'};
let crm=null,archivePage=1,searchPage=1,currentPage='dashboard',archiveParams=new URLSearchParams(),searchParams=new URLSearchParams(),filterOptions={},ready=false,sequence={archive:0,search:0};
function notice(message){$('#notice').hidden=!message;$('#notice').textContent=message||'';}
async function api(path,method='GET'){
  const response=await fetch(path,{method,headers:{'X-Roshd-Client':'presentation'}});let data;
  try{data=await response.json();}catch{throw new Error('پاسخ سرور قابل خواندن نیست.');}
  if(!response.ok)throw new Error(data.error||'درخواست انجام نشد.');return data;
}
async function action(fn,button){if(button)button.disabled=true;try{notice('');await fn();}catch(e){notice(e.message);}finally{if(button)button.disabled=false;}}
function table(head,body){return `<table><thead><tr>${head.map(h=>'<th>'+h+'</th>').join('')}</tr></thead><tbody>${body||`<tr><td colspan="${head.length}"><div class="empty">اطلاعاتی با این شرایط ثبت نشده است.</div></td></tr>`}</tbody></table>`;}
function tag(value){return `<span class="tag ${['error','lost','draft','pending'].includes(value)?'warning':''}">${esc(statusNames[value]||value||'ثبت نشده')}</span>`;}
function source(url,label='مشاهدهٔ منبع'){try{const u=new URL(url);return u.protocol==='https:'||u.protocol==='http:'?`<a href="${esc(u.href)}" target="_blank" rel="noopener noreferrer">${label}</a>`:'';}catch{return '';}}
function filters(...columns){return '<div class="column-filters">'+columns.map(([key,label])=>{
  const selected=archiveParams.get('column_'+key)||'';
  return `<select data-filter="${key}" aria-label="فیلتر ${label}" class="${selected?'chosen':''}"><option value="">${label}: همه</option>${(filterOptions[key]||[]).map(value=>`<option value="${esc(JSON.stringify(value))}" ${selected===JSON.stringify(value)?'selected':''}>${esc(value===null?'ثبت نشده':key==='contact_masked'?value?'پوشانده‌شده':'بدون پوشاندگی':key.endsWith('_at')?date(value):statusNames[value]||value)}</option>`).join('')}</select>`;
}).join('')+'</div>';}
function licenseTable(items,withFilters=false){
  const heads=withFilters?[
    'مجوز / شناسه'+filters(['request_number','شناسه'],['license_title','نوع کسب‌وکار']),
    'دارنده / مرجع'+filters(['applicant_name','نام دارنده'],['organization','مرجع صدور']),
    'موقعیت'+filters(['province','استان'],['township','شهرستان']),
    'صدور / تمدید'+filters(['issued_at','صدور / تمدید'],['original_issued_at','صدور اولیه']),
    'تلفن / نشانی'+filters(['business_phone','تلفن'],['business_address','نشانی'],['postal_code','کدپستی']),
    'وضعیت'+filters(['status_title','وضعیت مجوز'],['detail_state','وضعیت دریافت'],['contact_masked','پوشاندگی']),
    'جزئیات'
  ]:['مجوز / شناسه','دارنده / مرجع','موقعیت','صدور / تمدید','تلفن / نشانی','وضعیت','جزئیات'];
  return table(heads,items.map(r=>`<tr><td><b>${esc(r.license_title)}</b><small dir="ltr">${esc(r.request_number)}</small></td><td>${esc(r.applicant_name)}<small>${esc(r.organization)}</small></td><td>${esc(r.province)}<small>${esc(r.township)}</small></td><td class="date">${date(r.issued_at)}<small>صدور اولیه: ${date(r.original_issued_at)}</small></td><td class="address"><span dir="ltr">${esc(r.business_phone||'تلفن ثبت نشده')}</span><small>${esc(r.business_address||'نشانی ثبت نشده')}</small>${r.contact_masked?'<small>اطلاعات مبدأ پوشانده شده است</small>':''}</td><td>${esc(r.status_title)||'—'}<small>${tag(r.detail_state)}</small></td><td><button class="secondary" data-detail="${r.id}">مشاهده</button></td></tr>`).join(''));
}
function pager(id,page,total,kind){const pages=Math.max(1,Math.ceil(total/30));$(id).innerHTML=`<button class="secondary" data-pager="${kind}" data-target="${page-1}" ${page<=1?'disabled':''}>قبلی</button><span>صفحهٔ ${num(page)} از ${num(pages)}</span><button class="secondary" data-pager="${kind}" data-target="${page+1}" ${page>=pages?'disabled':''}>بعدی</button>`;}
async function loadArchive(kind='archive'){
  const version=++sequence[kind],isArchive=kind==='archive',params=new URLSearchParams(isArchive?archiveParams:searchParams),page=isArchive?archivePage:searchPage;
  params.set('page',page);const data=await api('/api/licenses/archive?'+params);if(version!==sequence[kind])return;
  $('#'+kind+'Table').innerHTML=licenseTable(data.items,isArchive);$('#'+kind+'Count').textContent=num(data.total)+' مجوز';pager('#'+kind+'Pager',page,data.total,kind);
}
async function dashboard(){
  const data=await api('/api/dashboard'),c=data.counts;
  $('#metrics').innerHTML=[['مجوزهای کسب‌وکار',c.LicenseArchive,'archive','ذخیره‌شده در دیتابیس آنلاین'],['مشتریان',c.Leads,'users','فرصت‌های فروش ثبت‌شده'],['استان‌های دارای مجوز',data.provinces.length<8?data.provinces.length:'—','grid','موقعیت کسب‌وکارها'],['پیگیری‌ها',c.Activities,'clock','سوابق منتقل‌شده']].map(([label,count,icon,sub])=>`<div class="metric"><label>${label}</label><svg><use href="#${icon}"/></svg><strong>${typeof count==='number'?num(count):count}</strong><small>${sub}</small></div>`).join('');
  // The ranking is limited for display; calculate the actual province count from the filter catalog.
  const provinceCount=(filterOptions.province||[]).filter(Boolean).length;
  $('#metrics').children[2].querySelector('strong').textContent=num(provinceCount);
  for(const [id,items] of [['provinceChart',data.provinces],['businessChart',data.businesses]]){
    const maximum=Math.max(1,...items.map(r=>r.count));
    $('#'+id).innerHTML=items.map(r=>`<div class="chart-row"><span class="chart-label" title="${esc(r.title)}">${esc(r.title)}</span><div class="bar"><span style="width:${Math.round(r.count/maximum*100)}%"></span></div><span class="chart-number">${num(r.count)}</span></div>`).join('')||'<div class="empty">داده‌ای ثبت نشده است.</div>';
  }
  $('#recent').innerHTML=licenseTable(data.recent);$('#snapshotDate').textContent='آخرین انتقال داده: '+new Date(data.exported_at).toLocaleString('fa-IR');
}
async function loadOptions(){
  const [columns,search]=await Promise.all([api('/api/licenses/archive/options'),api('/api/license-search/options')]);filterOptions=columns;
  for(const p of search.provinces)$('#provinceSelect').add(new Option(p.title,p.id));
  for(const title of search.business_types)if(title)$('#businessSelect').add(new Option(title,title));
}
function renderLeads(){
  const q=$('#leadQuery').value.trim().toLocaleLowerCase(),stage=$('#leadStatus').value;
  const items=crm.leads.filter(l=>(!stage||l.status===stage)&&[l.company,l.contact,l.phone,l.email,l.city].some(v=>String(v||'').toLocaleLowerCase().includes(q)));
  $('#leadCount').textContent=num(items.length)+' مشتری';
  $('#leadsTable').innerHTML=table(['شرکت / مخاطب','حوزه / موقعیت','تماس','مرحله / امتیاز','وب‌سایت / منبع'],items.map(l=>`<tr><td><b>${esc(l.company)}</b><small>${esc(l.contact)}</small></td><td>${esc(l.industry)}<small>${esc(l.city)} · ${esc(l.country_code)}</small></td><td><span dir="ltr">${esc(l.phone)}</span><small dir="ltr">${esc(l.email)}</small></td><td>${tag(l.status)}<small>امتیاز: ${num(l.score)}</small></td><td>${source(l.website,'وب‌سایت')}<small>${source(l.source_url,l.source)||esc(l.source)}</small></td></tr>`).join(''));
}
async function crmPage(){
  crm=await api('/api/data');renderLeads();
  $('#activitiesTable').innerHTML=table(['مشتری','موضوع پیگیری','موعد','وضعیت'],crm.activities.map(a=>`<tr><td>${esc(a.company)}</td><td>${esc(a.body)}</td><td class="date">${date(a.due_date)}</td><td>${a.done?'انجام شده':'در انتظار'}</td></tr>`).join(''));
  $('#productsTable').innerHTML=table(['کالا / شناسه','موجودی','قیمت خرید','قیمت فروش'],crm.products.map(p=>`<tr><td>${esc(p.name)}<small>${esc(p.sku)}</small></td><td>${num(p.stock)} ${esc(p.unit)}</td><td>${num(p.buy_price)} تومان</td><td>${num(p.sell_price)} تومان</td></tr>`).join(''));
  $('#dealsTable').innerHTML=table(['مشتری','کالا','نوع','مقدار / قیمت','وضعیت'],crm.deals.map(d=>`<tr><td>${esc(d.company)}</td><td>${esc(d.product)}</td><td>${d.kind==='buy'?'خرید':'فروش'}</td><td>${num(d.quantity)}<small>${num(d.price)} تومان</small></td><td>${tag(d.state)}</td></tr>`).join(''));
}
async function goto(page){
  if(!titles[page]||!ready)return;
  currentPage=page;$('.nav-item.active')?.classList.remove('active');$(`.nav-item[data-page="${page}"]`)?.classList.add('active');
  document.querySelectorAll('.page').forEach(el=>el.hidden=el.id!=='page-'+page);$('#pageTitle').textContent=titles[page];
  if(page==='dashboard')await dashboard();else if(page==='archive'||page==='search')await loadArchive(page);else await crmPage();
}
async function exportCsv(kind){try{const p=new URLSearchParams(kind==='archive'?archiveParams:searchParams);const response=await fetch('/api/export.csv?'+p);if(!response.ok)throw new Error((await response.json()).error);const url=URL.createObjectURL(await response.blob());const link=document.createElement('a');link.href=url;link.download='roshd-licenses.csv';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){notice(e.message);}}
$('#archiveQuery').onsubmit=e=>{e.preventDefault();archiveParams.set('q',$('#quickSearch').value.trim());archivePage=1;action(()=>loadArchive());};
$('#clearArchive').onclick=()=>{archiveParams=new URLSearchParams();$('#archiveQuery').reset();archivePage=1;action(()=>loadArchive());};
$('#advancedForm').onsubmit=e=>{e.preventDefault();searchParams=new URLSearchParams(new FormData(e.target));searchPage=1;action(()=>loadArchive('search'),e.submitter);};
$('#advancedForm').onreset=()=>{searchParams=new URLSearchParams();searchPage=1;action(()=>loadArchive('search'));};
$('#leadQuery').oninput=$('#leadStatus').onchange=()=>{if(crm)renderLeads();};
$('#exportArchive').onclick=()=>exportCsv('archive');$('#exportSearch').onclick=()=>exportCsv('search');
$('#closeDetail').onclick=()=>$('#detail').close();
$('#detail').addEventListener('click',e=>{if(e.target===$('#detail')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
document.addEventListener('change',e=>{const key=e.target.dataset.filter;if(!key)return;const value=e.target.value;if(value)archiveParams.set('column_'+key,value);else archiveParams.delete('column_'+key);archivePage=1;action(()=>loadArchive());});
document.addEventListener('click',e=>{
  const button=e.target.closest('button');if(!button)return;
  if(button.dataset.page)action(()=>goto(button.dataset.page),button);
  if(button.dataset.pager){const kind=button.dataset.pager;if(kind==='archive')archivePage=Number(button.dataset.target);else searchPage=Number(button.dataset.target);action(()=>loadArchive(kind),button);}
  if(button.dataset.detail)action(async()=>{
    const r=await api('/api/licenses/archive/'+button.dataset.detail);$('#detailTitle').textContent=r.license_title||'جزئیات مجوز';
    const fields=[['شناسهٔ مجوز',r.request_number],['دارندهٔ مجوز',r.applicant_name],['عنوان مجوز',r.license_title],['مرجع صدور',r.organization],['استان',r.province],['شهرستان',r.township],['نشانی کسب‌وکار',r.business_address],['تلفن کاری عمومی',r.business_phone],['کدپستی',r.postal_code],['نوع صدور',r.issue_type],['وضعیت',r.status_title],['صدور اولیه',date(r.original_issued_at)],['صدور / تمدید',date(r.issued_at)],['اعتبار',date(r.expires_at)],['وضعیت دریافت',statusNames[r.detail_state]||r.detail_state],['اطلاعات پوشانده‌شده',r.contact_masked?'بله، مطابق منبع':'خیر']];
    $('#detailContent').innerHTML=table(['فیلد','مقدار'],fields.map(([k,v])=>`<tr><td>${k}</td><td>${esc(v||'ثبت نشده')}</td></tr>`).join(''))+`<p class="muted" style="margin-top:18px">${source(r.source_url,'مشاهدهٔ صفحهٔ مجوز در سایت مبدأ')}</p><details><summary>اطلاعات عمومی تکمیلی</summary><pre dir="ltr">${esc(JSON.stringify(r.public_data,null,2))}</pre></details>`;$('#detail').showModal();
  },button);
});
const system=matchMedia('(prefers-color-scheme: dark)');
function applyTheme(value){document.documentElement.dataset.theme=value==='system'?(system.matches?'dark':'light'):value;}
let selectedTheme='light';try{selectedTheme=localStorage.getItem('roshd.presentation.theme')||'light';}catch{}
$('#theme').value=selectedTheme;applyTheme(selectedTheme);$('#theme').onchange=e=>{selectedTheme=e.target.value;applyTheme(selectedTheme);try{localStorage.setItem('roshd.presentation.theme',selectedTheme);}catch{}};system.addEventListener('change',()=>applyTheme(selectedTheme));
$('#collapse').onclick=()=>{const collapsed=document.body.classList.toggle('collapsed');$('#collapse').setAttribute('aria-expanded',String(!collapsed));$('#collapse').setAttribute('aria-label',collapsed?'بازکردن منو':'جمع‌کردن منو');try{localStorage.setItem('roshd.presentation.collapsed',String(collapsed));}catch{}};
try{if(localStorage.getItem('roshd.presentation.collapsed')==='true')$('#collapse').click();}catch{}
async function start(){
  try{
    let state=await api('/api/status');if(!state.ready){$('#initialization').hidden=false;while(!state.ready){state=await api('/api/initialize','POST');$('#initProgress').value=Math.floor(state.cursor/Math.max(1,state.total)*100);$('#initText').textContent=`${num(state.cursor)} از ${num(state.total)} رکورد منتقل شد.`;}}
    $('#initialization').hidden=true;await loadOptions();ready=true;await goto(currentPage);
  }catch(e){notice(e.message);$('#initialization').hidden=false;$('#initText').textContent='آماده‌سازی کامل نشد. صفحه را تازه کنید تا از آخرین نقطه ادامه داده شود.';}
}
start();
