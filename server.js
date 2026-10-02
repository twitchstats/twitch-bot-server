// Бот leimtwitch для многих каналов. Без зависимостей, нужен Node 18+.
// Запуск: CLIENT_ID=... CLIENT_SECRET=... BASE_URL=https://твой-домен ADMIN_KEY=придумай node server.js
const http=require('http'),tls=require('tls'),fs=require('fs'),crypto=require('crypto');
const {CLIENT_ID,CLIENT_SECRET,BASE_URL,ADMIN_KEY}=process.env,BOT=(process.env.BOT_LOGIN||'leimtwitch').toLowerCase(),PORT=process.env.PORT||3000,DB=process.env.DB_FILE||'data.json';
if(!CLIENT_ID||!CLIENT_SECRET||!BASE_URL||!ADMIN_KEY){console.error('Нужны переменные CLIENT_ID, CLIENT_SECRET, BASE_URL, ADMIN_KEY');process.exit(1)}
let D={bot:null,ch:{}};try{D=JSON.parse(fs.readFileSync(DB,'utf8'))}catch(e){}
const save=()=>fs.writeFileSync(DB,JSON.stringify(D)),states=new Map(),RU=BASE_URL.replace(/\/$/,'')+'/callback';
const tok=async b=>{const r=await fetch('https://id.twitch.tv/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(Object.assign({client_id:CLIENT_ID,client_secret:CLIENT_SECRET},b))});const j=await r.json();if(!j.access_token)throw new Error(JSON.stringify(j));return {access:j.access_token,refresh:j.refresh_token,exp:Date.now()+j.expires_in*1000}};
const fresh=async o=>{if(o.exp-6e4<Date.now()){Object.assign(o,await tok({grant_type:'refresh_token',refresh_token:o.refresh}));save()}return o.access};
const hx=async(o,path,init)=>fetch('https://api.twitch.tv/helix/'+path,Object.assign({headers:{Authorization:'Bearer '+await fresh(o),'Client-Id':CLIENT_ID,'Content-Type':'application/json'}},init));
/* --- вход --- */
const auth=(scope,st)=>'https://id.twitch.tv/oauth2/authorize?'+new URLSearchParams({client_id:CLIENT_ID,redirect_uri:RU,response_type:'code',scope,state:st,force_verify:'true'});
const page=t=>'<meta charset=utf-8><body style="font:20px sans-serif;background:#0b0818;color:#fff;text-align:center;padding:80px">'+t;
http.createServer(async(q,s)=>{const u=new URL(q.url,BASE_URL);try{
 if(u.pathname==='/join'){const st=crypto.randomUUID();states.set(st,'ch');return s.writeHead(302,{Location:auth('channel:manage:broadcast',st)}).end()}
 if(u.pathname==='/bot-login'){if(u.searchParams.get('key')!==ADMIN_KEY)return s.writeHead(403).end('no');const st=crypto.randomUUID();states.set(st,'bot');return s.writeHead(302,{Location:auth('chat:read chat:edit',st)}).end()}
 if(u.pathname==='/callback'){const kind=states.get(u.searchParams.get('state'));states.delete(u.searchParams.get('state'));if(!kind||!u.searchParams.get('code'))return s.writeHead(400).end(page('Вход отменён или устарел'));
  const t=await tok({grant_type:'authorization_code',code:u.searchParams.get('code'),redirect_uri:RU}),me=(await (await fetch('https://api.twitch.tv/helix/users',{headers:{Authorization:'Bearer '+t.access,'Client-Id':CLIENT_ID}})).json()).data[0],login=me.login.toLowerCase();
  if(kind==='bot'){if(login!==BOT)return s.writeHead(403).end(page('Нужен аккаунт '+BOT));D.bot=t;save();irc();return s.end(page('Бот '+BOT+' подключён ✅'))}
  D.ch[login]=Object.assign(t,{id:me.id});save();join(login);return s.end(page('Бот '+BOT+' подключён к каналу '+login+' ✅<br><small>Отключить: twitch.tv/settings/connections</small>'))}
 if(u.pathname==='/status')return s.end(JSON.stringify({bot:!!D.bot,channels:Object.keys(D.ch).length}));
 s.writeHead(404).end('not found')}catch(e){console.error(e);s.writeHead(500).end('error')}}).listen(PORT,()=>console.log('http://localhost:'+PORT));
/* --- чат --- */
let sock=null,ok=false,out=[];const send=(ch,t)=>out.push('PRIVMSG #'+ch+' :'+t.slice(0,440));
setInterval(()=>{const m=out.shift();if(m&&ok)sock.write(m+'\r\n')},1400);
const join=l=>ok&&sock.write('JOIN #'+l+'\r\n');
async function irc(){if(!D.bot)return;try{sock&&sock.destroy()}catch(e){}ok=false;const a=await fresh(D.bot);
 sock=tls.connect(6697,'irc.chat.twitch.tv',()=>{sock.write('CAP REQ :twitch.tv/tags twitch.tv/commands\r\nPASS oauth:'+a+'\r\nNICK '+BOT+'\r\n');ok=true;Object.keys(D.ch).forEach(join)});let buf='';
 sock.on('data',d=>{buf+=d;const L=buf.split('\r\n');buf=L.pop();L.forEach(onLine)});
 sock.on('close',()=>{ok=false;setTimeout(irc,5000)});sock.on('error',()=>{})}
async function onLine(l){if(l.startsWith('PING'))return sock.write('PONG :tmi.twitch.tv\r\n');
 const m=l.match(/^@(\S+) :(\w+)!\S+ PRIVMSG #(\w+) :(.*)$/);if(!m)return;const tg={};m[1].split(';').forEach(p=>{const i=p.indexOf('=');tg[p.slice(0,i)]=p.slice(i+1)});
 const ch=m[3],c=D.ch[ch];if(!c||!m[4].startsWith('!'))return;const [w,...a]=m[4].slice(1).trim().split(/\s+/),mod=tg.mod==='1'||/broadcaster/.test(tg.badges||'');
 try{if(w==='команды'||w==='commands')return send(ch,'Команды: !игра !название');
  if(w==='игра'||w==='game'||w==='название'||w==='title'){const game=w==='игра'||w==='game',q=a.join(' ');
   if(!q){const j=await (await hx(c,'channels?broadcaster_id='+c.id)).json();return send(ch,(game?'🎮 Сейчас: ':'📝 Название: ')+(j.data[0][game?'game_name':'title']||'—'))}
   if(!mod)return;let body;if(game){const d=(await (await hx(c,'search/categories?first=10&query='+encodeURIComponent(q))).json()).data||[],g=d.find(z=>z.name.toLowerCase()===q.toLowerCase())||d[0];if(!g)return send(ch,'Категория «'+q+'» не найдена');body={game_id:g.id}}else body={title:q.slice(0,140)};
   const r=await hx(c,'channels?broadcaster_id='+c.id,{method:'PATCH',body:JSON.stringify(body)});send(ch,r.status===204?'✅ Готово':'Не получилось ('+r.status+')')}}catch(e){console.error(e)}}
irc();
