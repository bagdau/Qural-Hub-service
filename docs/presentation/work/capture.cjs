const fs = require('fs');
const path = require('path');
const { chromium } = require('C:/Users/BAGDAULET-KOPTILEU/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(__dirname, '../../..');
const out = path.resolve(__dirname, '../assets');
const env = fs.readFileSync(path.join(root,'.env'),'utf8');
const password = env.match(/^DEMO_USER_PASSWORD=(.*)$/m)?.[1].trim().replace(/^["']|["']$/g,'');
const base = 'http://localhost:8100';
const manifest = {};
async function shot(page,name,url) {
  if(url) await page.goto(base+url);
  await page.waitForTimeout(1400);
  await page.screenshot({path:path.join(out,name+'.png'),fullPage:false});
  manifest[name]={url:page.url(),title:await page.title()};
  console.log(name, (await page.locator('h1').allTextContents()).join(' | '));
}
(async()=>{
 const browser = await chromium.launch({headless:true,channel:'msedge'});
 const anon = await browser.newContext({viewport:{width:1440,height:980},locale:'ru-RU',reducedMotion:'reduce'});
 if(!process.argv[2]) await shot(await anon.newPage(),'login','/login');
 for(const [role,email] of [['admin','admin'],['dispatcher','dispatcher'],['engineer','engineer1'],['client','client.metal'],['manager','manager']]){
  if(process.argv[2] && role==='admin')continue;
  const context=await browser.newContext({viewport:{width:1440,height:980},locale:'ru-RU',reducedMotion:'reduce'});
  const resp=await context.request.post(base+'/api/v1/auth/login',{data:{email:email+'@demo.alageum.test',password}});
  if(!resp.ok()) throw Error('Login '+role+' HTTP '+resp.status());
  const page=await context.newPage();
  const tickets=await (await context.request.get(base+'/api/v1/tickets?page_size=100')).json();
  const equipment=await (await context.request.get(base+'/api/v1/equipment?page_size=100')).json();
  if(role==='admin'){
    fs.writeFileSync(path.join(__dirname,'data.json'),JSON.stringify({tickets,equipment},null,2));
    for(const [name,url] of [['dashboard','/'],['equipment','/equipment'],['maintenance','/maintenance'],['users','/admin/users'],['organizations','/admin/organizations'],['parts','/admin/spare-parts'],['templates','/admin/checklists'],['sla','/admin/sla'],['audit','/admin/audit'],['notifications','/notifications'],['map','/map'],['scanner','/scan']]) await shot(page,name,url);
    const eq=equipment.items[0];
    await shot(page,'passport','/equipment/'+eq.id);
    await page.getByRole('tab',{name:'История',exact:true}).click();await shot(page,'equipment-history');
    await shot(page,'qr','/equipment/'+eq.id+'/qr');
    await shot(page,'generator','/generator?ids='+equipment.items.slice(0,3).map(x=>x.id).join(','));
  }
  if(role==='dispatcher'){
    await shot(page,'board','/board');
    for(const [name,label] of [['board-list','Список'],['calendar','Календарь'],['timeline','Шкала SLA']]){
      await page.getByRole('tab',{name:label,exact:true}).click(); await shot(page,name);
    }
    const t=tickets.items.find(x=>x.status==='new')||tickets.items[0];
    await shot(page,'ticket','/tickets/'+t.id);
    await page.getByRole('button',{name:'Назначить инженера',exact:true}).click();await shot(page,'assign');
    await shot(page,'create','/tickets/new');
    await shot(page,'drawer','/board?t='+t.id);
    await page.getByRole('tab',{name:'Журнал и чат',exact:true}).click();await shot(page,'journal');
  }
  if(role==='engineer'){
    await shot(page,'tasks','/my-tasks');
    const t=tickets.items.find(x=>x.status==='in_progress');
    if(t){
      await shot(page,'report','/tickets/'+t.id+'/report');
      await shot(page,'checklist','/board?t='+t.id);
      await page.getByRole('tab',{name:'Чек-листы',exact:true}).click();await shot(page,'checklist');
      await page.getByRole('tab',{name:'Запчасти и материалы',exact:true}).click();await shot(page,'used-parts');
    }
    await page.setViewportSize({width:390,height:844});await shot(page,'mobile-tasks','/my-tasks');
  }
  if(role==='client'){
    await shot(page,'client-home','/');
    const t=tickets.items.find(x=>x.status==='awaiting_confirmation');
    if(t){await shot(page,'confirmation','/tickets/'+t.id);if(t.current_act)await shot(page,'act','/acts/'+t.current_act.id);}
    await page.setViewportSize({width:390,height:844});await shot(page,'mobile-client','/board');
  }
  if(role==='manager'){
    await page.setViewportSize({width:834,height:1112});await shot(page,'tablet-dashboard','/');
  }
  await context.close();
 }
 fs.writeFileSync(path.join(__dirname,'screenshots.json'),JSON.stringify(manifest,null,2));
 await browser.close();
})().catch(e=>{console.error(e.message);process.exit(1)});
