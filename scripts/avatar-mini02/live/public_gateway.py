"""Password-gated HTTPS tunnel ingress; the GPU services stay on loopback."""
import asyncio, contextlib, hmac, json, logging
from pathlib import Path
from urllib.parse import parse_qs
import httpx, websockets
from fastapi import FastAPI, Request, WebSocket
from fastapi.responses import HTMLResponse, RedirectResponse, StreamingResponse, PlainTextResponse, Response
from paid_access import PaidAccess
ROOT=Path('/data/zrc/dyt/avatar-mini02')
config=json.loads((ROOT/'public-access.json').read_text())
app=FastAPI()
COOKIE='avatar_access'
PAID_COOKIE='avatar_paid_access'
paid_config_path=ROOT/'paid-access.json'
paid_config=json.loads(paid_config_path.read_text()) if paid_config_path.exists() else {}
paid=PaidAccess(paid_config.get('secret'))
def authorized(cookies):return hmac.compare_digest(cookies.get(COOKIE,''),config['session']) or paid.remaining(cookies.get(PAID_COOKIE,''))>0
def vidu_paid(cookies):return paid.audience(cookies.get(PAID_COOKIE,''))=='vidu-s2'
def origin_ok(origin):
    try: return origin==(ROOT/'public-origin.txt').read_text().strip()
    except FileNotFoundError:return False
LOGIN='''<!doctype html><html lang="zh"><meta name="viewport" content="width=device-width,initial-scale=1"><title>数字人 · 好友体验</title><style>body{background:#160f12;color:#f6eeee;font:17px system-ui;max-width:400px;margin:12vh auto;padding:24px}input,button{box-sizing:border-box;width:100%;padding:14px;margin:12px 0;border-radius:10px;border:1px solid #694750;font:inherit}button{background:#e9afb8}p{line-height:1.7;color:#c3a8b2}</style><h1>和小玥聊聊</h1><p>好友测试入口。建议戴耳机；目前一次仅支持一人对话。</p><form method="post" action="/login"><label for="password">访问口令</label><input id="password" name="password" type="password" required autocomplete="current-password"><button>进入体验</button></form></html>'''
@app.get('/login')
async def login():return HTMLResponse(LOGIN,headers={'Cache-Control':'no-store'})
@app.post('/paid/session')
async def paid_session(request:Request):
    # Vercel forwards only this short HTTP request, never the realtime WebSocket.
    if request.headers.get('origin') not in paid_config.get('origins',[]):return PlainTextResponse('Invalid origin',403)
    bearer=request.headers.get('authorization','')
    if not bearer.startswith('Bearer ') or len(bearer)>8192:return PlainTextResponse('Unauthorized',401)
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            upstream=await client.post('http://127.0.0.1:3001/api/avatar/session',headers={'Authorization':bearer})
        return Response(upstream.content,status_code=upstream.status_code,media_type='application/json',headers={'Cache-Control':'no-store'})
    except httpx.HTTPError:return PlainTextResponse('Business service unavailable',503)
@app.post('/launch')
async def launch(request:Request):
    if request.headers.get('origin') not in paid_config.get('origins',[]):return PlainTextResponse('Invalid origin',403)
    body=b''
    async for chunk in request.stream():
        body+=chunk
        if len(body)>8192:return PlainTextResponse('Invalid request',413)
    try:
        ticket=parse_qs(body.decode()).get('ticket',[''])[0]
        token=paid.consume(ticket)
    except (ValueError,UnicodeError):return PlainTextResponse('入口已过期，请返回付费站重新进入。',401)
    # GET after POST starts a first-party session, avoiding third-party cookie requirements.
    response=RedirectResponse('/',303)
    response.set_cookie(PAID_COOKIE,token,httponly=True,secure=True,samesite='lax',max_age=600)
    response.headers['Cache-Control']='no-store'
    return response
@app.post('/login')
async def authenticate(request:Request):
    if not origin_ok(request.headers.get('origin')):return PlainTextResponse('Invalid origin',403)
    length=int(request.headers.get('content-length','0'))
    if length>2048:return PlainTextResponse('Invalid request',413)
    form=parse_qs((await request.body()).decode())
    if not hmac.compare_digest(form.get('password',[''])[0],config['password']):
        await asyncio.sleep(1)
        return HTMLResponse(LOGIN.replace('<form','<p>口令不正确，请重试。</p><form'),status_code=401)
    response=RedirectResponse('/',303)
    response.set_cookie(COOKIE,config['session'],httponly=True,secure=True,samesite='strict',max_age=86400)
    return response
@app.websocket('/session')
async def session(ws:WebSocket):
    if not authorized(ws.cookies) or vidu_paid(ws.cookies) or not origin_ok(ws.headers.get('origin')):
        await ws.close(1008);return
    await ws.accept()
    tasks=[]
    try:
        async with websockets.connect('ws://127.0.0.1:8027/session',origin='http://localhost:8027',max_size=4*1024*1024,ping_interval=20,ping_timeout=120) as upstream:
            async def incoming():
                while True: await upstream.send(await ws.receive_text())
            async def outgoing():
                async for msg in upstream: await ws.send_text(msg)
            tasks=[asyncio.create_task(incoming()),asyncio.create_task(outgoing())]
            deadline=paid.remaining(ws.cookies.get(PAID_COOKIE,''))
            if not hmac.compare_digest(ws.cookies.get(COOKIE,''),config['session']):
                tasks.append(asyncio.create_task(asyncio.sleep(deadline)))
            done,pending=await asyncio.wait(tasks,return_when=asyncio.FIRST_COMPLETED)
            for t in done:t.result()
    except Exception as exc:
        logging.getLogger('avatar.public').warning('WebSocket relay closed: %s',exc)
        with contextlib.suppress(Exception):await ws.send_json({'type':'error','message':'实时连接中断，请重新开始。'+str(exc)[:180]})
    finally:
        for t in tasks:t.cancel()
        await asyncio.gather(*tasks,return_exceptions=True)
        with contextlib.suppress(Exception):await ws.close()
async def proxy_vidu(path:str,request:Request):
    if '..' in path or path.startswith('/') or '\\' in path:return PlainTextResponse('Not found',404)
    if request.method == 'POST':
        if not path.startswith('api/') or not origin_ok(request.headers.get('origin')):
            return PlainTextResponse('Forbidden',403)
        content=b''
        async for chunk in request.stream():
            content+=chunk
            if len(content)>20*1024*1024:return PlainTextResponse('Request too large',413)
    else: content=None
    client=httpx.AsyncClient(timeout=httpx.Timeout(None if path=='api/events' else 60,connect=10))
    try:
        headers={'Accept':request.headers.get('accept','*/*')}
        if content is not None:
            headers['Content-Type']=request.headers.get('content-type','application/json')
            headers['X-Studio-Token']=request.headers.get('x-studio-token','')
            # The upstream is loopback-only and checks its own same-origin header.
            headers['Origin']='http://127.0.0.1:8787'
        req=client.build_request(request.method,'http://127.0.0.1:8787/'+path,
                                 params=request.query_params,headers=headers,content=content)
        upstream=await client.send(req,stream=True)
    except Exception:
        await client.aclose();return PlainTextResponse('Vidu S2 service unavailable',503)
    async def body():
        try:
            async for chunk in upstream.aiter_raw():yield chunk
        finally:await upstream.aclose();await client.aclose()
    headers={k:v for k,v in upstream.headers.items() if k in ('content-type','content-length','content-encoding')}
    headers.update({'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin'})
    return StreamingResponse(body(),status_code=upstream.status_code,headers=headers)

@app.api_route('/xumeng-api/{path:path}',methods=['GET','POST','DELETE'])
async def xumeng_bridge(path:str,request:Request):
    # Only the Cloudflare gateway signs these requests. The Node bridge checks
    # the signature, fresh timestamp/nonce, account, role and lease ownership.
    import re
    if not re.fullmatch(r'(status|leases|leases/[a-f0-9-]{36}(/(status|start|stop|heartbeat|execute|danmaku|interrupt|references|generate|task|recording))?)',path):
        return Response('{"error":"接口不存在。"}',404,media_type='application/json')
    names=('x-xumeng-live-user','x-xumeng-live-role','x-xumeng-live-timestamp','x-xumeng-live-nonce','x-xumeng-live-signature')
    if request.query_params or any(not request.headers.get(name) or len(request.headers[name])>256 for name in names):
        return Response('{"error":"桥接认证无效。"}',401,media_type='application/json')
    body=b''
    async for chunk in request.stream():
        body+=chunk
        if len(body)>20*1024*1024:return Response('{"error":"请求过大。"}',413,media_type='application/json')
    headers={name:request.headers[name] for name in names}
    headers['Content-Type']='application/json'
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(65,connect=10)) as client:
            upstream=await client.request(request.method,'http://127.0.0.1:8787/xumeng-api/'+path,headers=headers,content=body,follow_redirects=False)
        return Response(upstream.content,status_code=upstream.status_code,media_type='application/json',headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'})
    except httpx.HTTPError:
        return Response('{"error":"实时影像服务暂不可用。"}',503,media_type='application/json',headers={'Cache-Control':'no-store'})

@app.api_route('/{path:path}',methods=['GET','POST'])
async def proxy(path:str,request:Request):
    if not authorized(request.cookies):return RedirectResponse('/login',303)
    if vidu_paid(request.cookies):return await proxy_vidu(path,request)
    if request.method != 'GET':return PlainTextResponse('Method not allowed',405)
    if '..' in path or path.startswith('/') or '\\' in path:return PlainTextResponse('Not found',404)
    client=httpx.AsyncClient(timeout=httpx.Timeout(60,connect=10))
    try:
        req=client.build_request('GET','http://127.0.0.1:8027/'+path,params=request.query_params,headers={k:v for k,v in request.headers.items() if k in ('range','if-range','accept')})
        upstream=await client.send(req,stream=True)
    except Exception:
        await client.aclose();return PlainTextResponse('服务暂不可用，请稍后重试',503)
    async def content():
        try:
            async for chunk in upstream.aiter_raw():yield chunk
        finally:await upstream.aclose();await client.aclose()
    headers={k:v for k,v in upstream.headers.items() if k in ('content-type','content-length','content-range','accept-ranges','content-encoding')}
    headers.update({'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin'})
    return StreamingResponse(content(),status_code=upstream.status_code,headers=headers)
