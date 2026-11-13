#!/usr/bin/env python3
"""Opt-in real inference qualification. NO mocks; the caller supplies a running YAG.

Does not emit API keys, prompts, returned text or provider URLs in logs.
Intended for localhost or a user-managed TLS proxy. No paid hosted calls by default.
"""
import argparse
import json
import os
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

TEST_TOOL={'type':'function','function':{
    'name':'yag_fixture_lookup','description':'Look up a deterministic internal test value',
    'parameters':{'type':'object','properties':{
        'key':{'type':'string','description':'Use the literal string fixture'}},
        'required':['key'],'additionalProperties':False}}}
TEST_USER='Call yag_fixture_lookup for the key "fixture". Do not answer without calling it.'

def exercise(base, key, model, protocol, tools, stream, opener=urlopen):
    headers={'Authorization':'Bearer '+key,'Content-Type':'application/json'}
    def post(endpoint,payload):
        request=Request(base+endpoint,data=json.dumps(payload).encode(),
                        headers=headers,method='POST')
        try:
            with opener(request,timeout=90) as response:
                data=response.read(8*1024*1024+1)
                if len(data)>8*1024*1024:raise RuntimeError('Response exceeded 8 MiB')
                return response.headers.get('Content-Type',''),data
        except HTTPError as exc:
            raise RuntimeError('HTTP '+str(exc.code)+' at '+endpoint) from None
        except URLError as exc:
            raise RuntimeError('Connection error at '+endpoint+': '+type(exc.reason).__name__) from None
    def parse(payload):
        typ,raw=post('/v1/'+protocol,payload)
        if payload.get('stream'):
            if 'text/event-stream' not in typ:
                raise RuntimeError(protocol+' did not return SSE')
            lines=[line[6:] for line in raw.decode('utf-8').splitlines() if line.startswith('data: ')]
            if not lines:raise RuntimeError('Empty SSE stream')
            if protocol=='chat/completions':
                if lines[-1]!='[DONE]':raise RuntimeError('Chat stream missing DONE')
            elif protocol=='responses':
                if not any(json.loads(line).get('type')=='response.completed' for line in lines):
                    raise RuntimeError('Responses stream did not complete')
            else:
                if not any(json.loads(line).get('type')=='message_stop' for line in lines):
                    raise RuntimeError('Anthropic stream did not complete')
            return None
        return json.loads(raw)
    if protocol=='chat/completions':
        p={'model':model,'messages':[{'role':'user','content':'Reply with a greeting.'}],
           'stream':stream}
        result=parse(p)
        if not stream:
            assert result['choices'][0]['message']['role']=='assistant'
    elif protocol=='responses':
        p={'model':model,'input':'Reply with a greeting.','store':False,'stream':stream}
        result=parse(p)
        if not stream:
            assert result['object']=='response'
            assert result['status']=='completed'
    else:
        p={'model':model,'max_tokens':128,'messages':[{'role':'user','content':'Reply with a greeting.'}],
           'stream':stream}
        result=parse(p)
        if not stream:
            assert result['type']=='message'
            assert result['role']=='assistant'
    print('[PASS]',protocol,'stream' if stream else 'text',flush=True)
    if not tools:return
    if protocol=='chat/completions':
        p={'model':model,'stream':False,'messages':[{'role':'user','content':TEST_USER}],
           'tools':[TEST_TOOL],'tool_choice':{'type':'function','function':{'name':'yag_fixture_lookup'}}}
        first=parse(p)
        message=first['choices'][0]['message']
        calls=message.get('tool_calls',[])
        if not calls or calls[0]['function']['name']!='yag_fixture_lookup':
            raise RuntimeError('Chat model did not return the required function tool')
        json.loads(calls[0]['function']['arguments'])
        again=p['messages']+[message,{'role':'tool','tool_call_id':calls[0]['id'],
                                     'content':'YAG_FIXTURE_OK'}]
        final=parse({'model':model,'stream':False,'messages':again,'tool_choice':'none'})
        if final['choices'][0]['message']['role']!='assistant':
            raise RuntimeError('Chat tool-result round trip did not complete')
    elif protocol=='responses':
        p={'model':model,'input':TEST_USER,'store':False,'tools':[{
            'type':'function','name':'yag_fixture_lookup',
            'description':TEST_TOOL['function']['description'],
            'parameters':TEST_TOOL['function']['parameters']}],
            'tool_choice':{'type':'function','name':'yag_fixture_lookup'}}
        first=parse(p)
        calls=[item for item in first['output'] if item.get('type')=='function_call']
        if not calls or calls[0]['name']!='yag_fixture_lookup':
            raise RuntimeError('Responses model did not return the required function')
        call=calls[0]
        json.loads(call['arguments'])
        again=[{'role':'user','content':TEST_USER},call,
               {'type':'function_call_output','call_id':call['call_id'],'output':'YAG_FIXTURE_OK'}]
        second=parse({'model':model,'input':again,'store':False})
        if second['status']!='completed':raise RuntimeError('Responses tool replay failed')
    else:
        tool={'name':'yag_fixture_lookup',
              'description':TEST_TOOL['function']['description'],
              'input_schema':TEST_TOOL['function']['parameters']}
        p={'model':model,'max_tokens':192,'stream':False,
           'messages':[{'role':'user','content':TEST_USER}],
           'tools':[tool],'tool_choice':{'type':'tool','name':'yag_fixture_lookup'}}
        first=parse(p)
        calls=[item for item in first['content'] if item.get('type')=='tool_use']
        if not calls or calls[0]['name']!='yag_fixture_lookup':
            raise RuntimeError('Anthropic model did not return the required tool')
        call=calls[0]
        second=parse({'model':model,'max_tokens':192,'stream':False,
            'messages':[p['messages'][0],
                {'role':'assistant','content':first['content']},
                {'role':'user','content':[{'type':'tool_result','tool_use_id':call['id'],
                                           'content':'YAG_FIXTURE_OK'}]}],
            'tools':[tool],'tool_choice':{'type':'none'}})
        if second['type']!='message':raise RuntimeError('Anthropic tool replay failed')
    print('[PASS]',protocol,'tool-replay',flush=True)

def exercise_optional_endpoint(base, key, model, endpoint, payload, opener=urlopen):
    """Opt-in live compatibility check; never print model output or credentials."""
    headers={'Authorization':'Bearer '+key,'Content-Type':'application/json'}
    request=Request(base+'/v1/'+endpoint,
                    data=json.dumps(dict(payload,model=model)).encode(),
                    headers=headers,method='POST')
    try:
        with opener(request,timeout=90) as response:
            raw=response.read(8*1024*1024+1)
            if len(raw)>8*1024*1024:
                raise RuntimeError('Response exceeded 8 MiB')
            result=json.loads(raw)
    except HTTPError as exc:
        raise RuntimeError('HTTP '+str(exc.code)+' at '+endpoint) from None
    except URLError as exc:
        raise RuntimeError('Connection error at '+endpoint+': '+
                           type(exc.reason).__name__) from None
    if endpoint=='embeddings':
        data=result.get('data')
        if result.get('object')!='list' or not isinstance(data,list) or not data:
            raise RuntimeError('Embedding result missing data list')
        vector=data[0].get('embedding')
        if not isinstance(vector,list) or not vector or not all(
            isinstance(value,(int,float)) and not isinstance(value,bool)
            for value in vector):
            raise RuntimeError('Embedding result missing numeric vector')
    elif endpoint=='completions':
        if result.get('object')!='text_completion' or not result.get('choices'):
            raise RuntimeError('Completion result missing choices')
        if not isinstance(result['choices'][0].get('text'),str):
            raise RuntimeError('Completion result missing text')
    else:
        raise ValueError('Unsupported optional protocol')
    print('[PASS]',endpoint,'text' if endpoint=='completions' else 'vector',
          flush=True)

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url',default='http://127.0.0.1:8080')
    parser.add_argument('--model',required=True)
    parser.add_argument('--protocol',choices=['all','chat','responses','anthropic'],default='all')
    parser.add_argument('--tools',action='store_true',
                        help='Require model-driven function calls and subsequent tool-result replay')
    parser.add_argument('--stream',action='store_true',help='Also require SSE completion')
    parser.add_argument('--embedding-model',default='',
        help='Optionally validate /v1/embeddings using a real embedding-capable model')
    parser.add_argument('--completions',action='store_true',
        help='Optionally validate /v1/completions with the selected text model')
    args=parser.parse_args()
    key=os.environ.get('YAG_API_KEY','')
    if len(key)<16:parser.error('YAG_API_KEY must be set in the environment')
    url=urlparse(args.base_url)
    if url.scheme not in ('http','https') or not url.netloc or url.username or url.password \
       or url.query or url.fragment or url.path not in ('','/'):
        parser.error('Provide a clean gateway origin (no credentials, query or path)')
    if url.scheme=='http' and url.hostname not in ('localhost','127.0.0.1','::1'):
        parser.error('Remote gateways must use HTTPS')
    protocols={'chat':'chat/completions','responses':'responses','anthropic':'messages'}
    chosen=list(protocols.values()) if args.protocol=='all' else [protocols[args.protocol]]
    failed=0
    for protocol in chosen:
        try:
            exercise(args.base_url.rstrip('/'),key,args.model,protocol,args.tools,False)
            if args.stream:
                exercise(args.base_url.rstrip('/'),key,args.model,protocol,False,True)
        except (ValueError,KeyError,TypeError,AssertionError,RuntimeError) as exc:
            print('[FAIL]',protocol,type(exc).__name__,str(exc)[:200],file=sys.stderr,flush=True)
            failed+=1
    for endpoint,model,payload in [
        ('embeddings',args.embedding_model,{'input':['YAG local embedding fixture']}),
        ('completions',args.model if args.completions else '',
         {'prompt':'Reply with a greeting.','stream':False}),
    ]:
        if not model:continue
        try:
            exercise_optional_endpoint(args.base_url.rstrip('/'),key,model,
                                       endpoint,payload)
        except (ValueError,KeyError,TypeError,AssertionError,RuntimeError) as exc:
            print('[FAIL]',endpoint,type(exc).__name__,str(exc)[:200],
                  file=sys.stderr,flush=True)
            failed+=1
    if failed:print('Real-model qualification FAILED for',failed,'protocol(s)',file=sys.stderr)
    else:print('Real-model qualification PASSED for selected checks')
    return bool(failed)

if __name__=='__main__':sys.exit(main())
