#!/usr/bin/env python3
"""Responses protocol integration against the same deterministic mock backend."""
import json
import http.client
import socket
import time
import unittest
import integration as base
request, KEY = base.request, base.KEY

class Responses(unittest.TestCase):
    setUpClass = classmethod(base.Integration.setUpClass.__func__)
    tearDownClass = classmethod(base.Integration.tearDownClass.__func__)
    def post(self, payload): return request(self.port,'POST','/v1/responses',payload)
    def test_response_string_and_parameters(self):
        payload={'model':'response-echo','input':'Hello','instructions':'be concise','temperature':0.5,'top_p':0.8,'max_output_tokens':42,'parallel_tool_calls':False,'store':False,'metadata':{'case':'test'},'text':{'format':{'type':'text'}},'reasoning':{'effort':'low'}}
        status,_,data=self.post(payload);self.assertEqual(status,200,data);obj=json.loads(data)
        self.assertEqual(obj['object'],'response');self.assertEqual(obj['status'],'completed');self.assertEqual(obj['metadata'],{'case':'test'});self.assertEqual(obj['usage'],{'input_tokens':10,'output_tokens':3,'total_tokens':13})
        translated=json.loads(obj['output'][0]['content'][0]['text']);self.assertEqual(translated['messages'],[{'role':'system','content':'be concise'},{'role':'user','content':'Hello'}]);self.assertEqual(translated['max_tokens'],42);self.assertEqual(translated['reasoning_effort'],'low');self.assertFalse(translated['parallel_tool_calls'])
    def test_response_tool_request_roundtrip(self):
        payload={'model':'response-echo','input':[{'role':'user','content':[{'type':'input_text','text':'read'}]},{'type':'function_call','id':'fc_1','call_id':'call_A','name':'read','arguments':'{"path":"a"}'},{'type':'function_call','call_id':'call_B','name':'write','arguments':'{}'},{'type':'function_call_output','call_id':'call_A','output':'contents'},{'type':'function_call_output','call_id':'call_B','output':'ok'}], 'tools':[{'type':'function','name':'read','parameters':{'type':'object'},'strict':True}], 'tool_choice':{'type':'function','name':'read'}}
        status,_,data=self.post(payload);self.assertEqual(status,200,data);chat=json.loads(json.loads(data)['output'][0]['content'][0]['text']);msgs=chat['messages']
        self.assertEqual([c['id'] for c in msgs[1]['tool_calls']],['call_A','call_B']);self.assertEqual(msgs[2]['tool_call_id'],'call_A');self.assertEqual(msgs[3]['tool_call_id'],'call_B');self.assertEqual(msgs[2]['content'],'contents');self.assertEqual(chat['tools'][0]['function']['strict'],True);self.assertEqual(chat['tool_choice']['function']['name'],'read')
    def test_response_json_format(self):
        status,_,data=self.post({'model':'response-echo','input':'x','prompt_cache_key':'cache','text':{'verbosity':'low','format':{'type':'json_schema','name':'result','schema':{'type':'object'},'strict':True}}});self.assertEqual(status,200,data)
        chat=json.loads(json.loads(data)['output'][0]['content'][0]['text']);self.assertEqual(chat['verbosity'],'low');self.assertEqual(chat['prompt_cache_key'],'cache');self.assertEqual(chat['response_format'],{'type':'json_schema','json_schema':{'name':'result','schema':{'type':'object'},'strict':True}})
    def test_responses_routes_to_configured_model(self):
        status,_,data=self.post({'model':'routed-model','input':'hello'})
        self.assertEqual(status,200,data)
        response=json.loads(data)
        self.assertEqual(response['output'][0]['content'][0]['text'],'routed response')
    def test_namespaced_function_tools_and_replay(self):
        tool={'type':'namespace','name':'workspace','description':'File operations',
              'tools':[{'type':'function','name':'read_file','parameters':{'type':'object'},
                        'description':'Read a file'}]}
        payload={'model':'response-echo',
                 'input':[{'role':'user','content':'Read a file'},
                          {'type':'function_call','call_id':'call_1','name':'read_file',
                           'namespace':'workspace','arguments':'{"path":"notes.txt"}'},
                          {'type':'function_call_output','call_id':'call_1','output':'hello'}],
                 'tools':[tool],
                 'tool_choice':{'type':'function','namespace':'workspace','name':'read_file'}}
        status,_,body=self.post(payload)
        self.assertEqual(status,200,body)
        chat=json.loads(json.loads(body)['output'][0]['content'][0]['text'])
        self.assertEqual(chat['tools'][0]['function']['name'],'workspace__read_file')
        self.assertEqual(chat['tool_choice']['function']['name'],'workspace__read_file')
        self.assertEqual(chat['messages'][1]['tool_calls'][0]['function']['name'],'workspace__read_file')
        self.assertEqual(chat['messages'][2]['content'],'hello')

    def test_namespaced_function_calls_decode_in_response(self):
        tool={'type':'namespace','name':'workspace',
              'tools':[{'type':'function','name':'read_file','parameters':{'type':'object'}}]}
        status,_,body=self.post({'model':'response-namespaced-tools','input':'open README',
                                  'tools':[tool]})
        self.assertEqual(status,200,body)
        answer=json.loads(body)
        self.assertEqual(answer['output'][0]['type'],'function_call')
        self.assertEqual(answer['output'][0]['namespace'],'workspace')
        self.assertEqual(answer['output'][0]['name'],'read_file')
        self.assertEqual(answer['output'][0]['call_id'],'call_namespaced')

    def test_response_multiple_tool_outputs(self):
        status,_,data=self.post({'model':'response-tools','input':'go'});self.assertEqual(status,200,data);r=json.loads(data)
        self.assertEqual([i['type'] for i in r['output']],['message','function_call','function_call']);self.assertEqual([i['call_id'] for i in r['output'][1:]],['call_A','call_B']);self.assertEqual(r['output'][1]['arguments'],'{"path":"a"}');self.assertIsNone(r['usage'])
    def events(self,model):
        status,headers,data=self.post({'model':model,'input':'hi','stream':True});self.assertEqual(status,200,data);self.assertIn('text/event-stream',headers['Content-Type']);events=[]
        for block in data.decode().strip().split('\n\n'):
            lines=block.split('\n');self.assertTrue(lines[0].startswith('event: '));v=json.loads(lines[1][6:]);self.assertEqual(lines[0][7:],v['type']);events.append(v)
        self.assertEqual([e['sequence_number'] for e in events],list(range(len(events))))
        return events
    def test_response_stream_text(self):
        events=self.events('response-stream');self.assertEqual([e['type'] for e in events],['response.created','response.in_progress','response.output_item.added','response.content_part.added','response.output_text.delta','response.output_text.delta','response.output_text.done','response.content_part.done','response.output_item.done','response.completed']);self.assertEqual(events[-1]['response']['output'][0]['content'][0]['text'],'Hello world');self.assertEqual(events[0]['response']['id'],events[-1]['response']['id']);self.assertEqual(events[4]['item_id'],events[-1]['response']['output'][0]['id'])
    def test_response_stream_tool_calls(self):
        events=self.events('response-stream-tools');r=events[-1]['response'];self.assertEqual([x['call_id'] for x in r['output']],['call_A','call_B']);self.assertEqual([x['arguments'] for x in r['output']],['{"p":1}','{}']);self.assertEqual(sum(e['type']=='response.function_call_arguments.done' for e in events),2)
        for i in range(2):
            added=next(j for j,e in enumerate(events) if e['type']=='response.output_item.added' and e['output_index']==i);delta=next(j for j,e in enumerate(events) if e['type']=='response.function_call_arguments.delta' and e['output_index']==i);done=next(j for j,e in enumerate(events) if e['type']=='response.output_item.done' and e['output_index']==i);self.assertLess(added,delta);self.assertLess(delta,done)
    def test_response_incomplete_and_truncated(self):
        events=self.events('response-incomplete');self.assertEqual(events[-1]['type'],'response.incomplete');self.assertEqual(events[-1]['response']['incomplete_details']['reason'],'max_output_tokens')
        self.assertEqual(self.events('response-truncated')[-1]['type'],'error')
        error=self.events('response-stream-error')[-1];self.assertEqual(error['type'],'error');self.assertEqual(error['message'],'mock failure')
    def test_response_upstream_timeout_and_errors(self):
        status,_,data=self.post({'model':'slow','input':'x'});self.assertEqual(status,504,data)
        status,_,data=self.post({'model':'bad','input':'x','stream':True});self.assertEqual(status,429);self.assertEqual(json.loads(data)['error']['message'],'backend limit')
    def test_response_errors(self):
        self.assertEqual(self.post({'model':'bad','input':'x'})[0],429)
        for payload in [ {}, {'model':'x','input':'a','previous_response_id':'resp_1'}, {'model':'x','input':'a','include':['web_search_call.action.sources']}, {'model':'x','input':'a','client_metadata':'invalid'}, {'model':'x','input':'a','tools':[{'type':'namespace','name':'shell','tools':[]}]}, {'model':'x','input':[{'type':'function_call','call_id':'c','name':'x','arguments':'{}','status':'incomplete'}]}, {'model':'x','input':'a','store':True}, {'model':'x','input':'a','tools':[{'type':'web_search'}]}, {'model':'x','input':[{'type':'function_call_output','call_id':'c','output':{'nested':1}}]}, {'model':'x','input':'a','text':{'verbosity':'extreme'}}, {'model':'x','input':'a','reasoning':{'summary':'invalid'}} ]:
            status,_,data=self.post(payload);self.assertEqual(status,400,(payload,data));self.assertIn('error',json.loads(data))
        self.assertEqual(request(self.port,'POST','/v1/responses','{')[0],400)
        self.assertEqual(request(self.port,'POST','/v1/responses',{'model':'x','input':'x'},key=None)[0],401)
    def test_unsupported_tool_type_is_diagnosed(self):
        status,_,body=self.post({'model':'response-echo','input':'hi',
                                 'tools':[{'type':'web_search'}]})
        self.assertEqual(status,400,body)
        self.assertIn('web_search',json.loads(body)['error']['message'])

    def test_empty_include_is_safe(self):
        status,_,data=self.post({'model':'response-echo','input':'x','include':[]})
        self.assertEqual(status,200,data)
        status,_,data=self.post({'model':'response-echo','input':'x','include':['reasoning.encrypted_content']})
        self.assertEqual(status,200,data)
        self.assertTrue(all(item['type']!='reasoning' for item in json.loads(data)['output']))
        status,_,data=self.post({'model':'response-echo','input':'x','include':['web_search_call.action.sources']})
        self.assertEqual(status,400,data)
        self.assertIn('include',json.loads(data)['error']['message'])
    def test_optional_reasoning_summary_selector_does_not_fabricate_content(self):
        status,_,body=self.post({'model':'response-echo','input':'hello',
                                'reasoning':{'effort':'medium','summary':'auto'}})
        self.assertEqual(status,200,body)
        response=json.loads(body)
        self.assertTrue(all(item['type']!='reasoning' for item in response['output']))
        translated=json.loads(response['output'][0]['content'][0]['text'])
        self.assertEqual(translated['reasoning_effort'],'medium')
        self.assertNotIn('summary',translated)
        status,_,body=self.post({'model':'response-echo','input':'hello',
                                'reasoning':{'generate_summary':'concise'}})
        self.assertEqual(status,200,body)

    def test_client_metadata_is_not_forwarded(self):
        status,_,data=self.post({'model':'response-echo','input':'hello','client_metadata':{'client':'codex','trace':'test'}})
        self.assertEqual(status,200,data)
        translated=json.loads(json.loads(data)['output'][0]['content'][0]['text'])
        self.assertNotIn('client_metadata',translated)
    def test_response_stream_is_incremental(self):
        conn=http.client.HTTPConnection('127.0.0.1',self.port,timeout=4)
        body=json.dumps({'model':'response-stream-slow','input':'x','stream':True})
        start=time.monotonic();conn.request('POST','/v1/responses',body,{'Authorization':'Bearer '+KEY,'Content-Type':'application/json'})
        response=conn.getresponse();line=response.readline();self.assertIn(b'response.created',line);self.assertLess(time.monotonic()-start,.4);response.read();conn.close()
    def test_response_cancels_quiet_upstream(self):
        s=socket.create_connection(('127.0.0.1',self.port));body=b'{"model":"slow","input":"x"}'
        s.sendall(b'POST /v1/responses HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer '+KEY.encode()+b'\r\nContent-Length: '+str(len(body)).encode()+b'\r\n\r\n'+body)
        time.sleep(.1);s.close()
        deadline=time.monotonic()+.85
        while time.monotonic()<deadline:
            count=json.loads(request(self.port,'GET','/api/status')[2])['active_connections']
            if count==1: break
            time.sleep(.05)
        self.assertEqual(count,1,'upstream transfer did not cancel promptly on disconnect')
    def test_response_disconnect(self):
        s=socket.create_connection(('127.0.0.1',self.port));body=json.dumps({'model':'response-stream-slow','input':'x','stream':True}).encode();s.sendall(b'POST /v1/responses HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer '+KEY.encode()+b'\r\nContent-Length: '+str(len(body)).encode()+b'\r\n\r\n'+body);self.assertIn(b'200',s.recv(1024));s.close();time.sleep(.1);self.assertEqual(request(self.port,'GET','/health',key=None)[0],200)
if __name__=='__main__': unittest.main(argv=[__file__])
