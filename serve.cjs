const http=require('node:http'); const fs=require('node:fs'); const path=require('node:path');
const root=__dirname; const port=Number(process.argv[2]||process.env.PORT||4173);
const types={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png'};
http.createServer((req,res)=>{ let relative; try { relative=decodeURIComponent(new URL(req.url,'http://localhost').pathname); } catch { res.writeHead(400).end(); return; }
if(relative==='/')relative='/index.html'; const file=path.resolve(root,'.'+relative);
if(!file.startsWith(root+path.sep) || relative.split('/').some(p=>p.startsWith('.')) || !types[path.extname(file)]) {res.writeHead(404).end();return;}
fs.readFile(file,(error,data)=>{if(error){res.writeHead(404).end();return;} res.writeHead(200,{'Content-Type':types[path.extname(file)],'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});res.end(data);});
}).listen(port,'127.0.0.1',()=>console.log('Aplicación disponible en http://localhost:'+port));
