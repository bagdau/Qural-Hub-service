const fs=require('fs');
const path=require('path');
const {chromium}=require('playwright');
(async()=>{
 const root=path.resolve(__dirname,'../../..');
 const env=fs.readFileSync(root+'/.env','utf8');
 const password=env.match(/^DEMO_USER_PASSWORD=(.*)$/m)[1].trim().replace(/^["']|["']$/g,'');
 const b=await chromium.launch({headless:true,channel:'msedge'});
 const ctx=await b.newContext({viewport:{width:1920,height:660},locale:'ru-RU',reducedMotion:'reduce'});
 const r=await ctx.request.post('http://localhost:8100/api/v1/auth/login',{data:{email:'dispatcher@demo.alageum.test',password}});
 if(!r.ok())throw new Error('HTTP '+r.status());
 const page=await ctx.newPage();
 await page.goto('http://localhost:8100/board');
 await page.waitForTimeout(1600);
 await page.screenshot({path:root+'/docs/presentation/assets/board-wide.png'});
 await ctx.close();await b.close();
 console.log('Wide screenshot captured');
})();
