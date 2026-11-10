#!/usr/bin/env python3
"""Anthropic text-only Messages adapter contract tests against mock Chat upstream."""
import json
import unittest
import integration as base

class Messages(unittest.TestCase):
    setUpClass = classmethod(base.Integration.setUpClass.__func__)
    tearDownClass = classmethod(base.Integration.tearDownClass.__func__)

    def post(self, payload):
        return base.request(self.port, 'POST', '/v1/messages', payload)

    def test_native_anthropic_header_uses_gateway_key(self):
        payload={'model':'response-echo','max_tokens':16,
                 'messages':[{'role':'user','content':'hello'}]}
        status,_,body=base.request(self.port,'POST','/v1/messages',payload,
                                   key=None,headers={'X-API-Key':base.KEY,'anthropic-version':'2023-06-01'})
        self.assertEqual(status,200,body)
        status,_,_=base.request(self.port,'POST','/v1/messages',payload,key=None,
                                headers={'X-API-Key':'invalid'})
        self.assertEqual(status,401)
        status,_,_=base.request(self.port,'GET','/v1/models',key=None,
                                headers={'X-API-Key':base.KEY})
        self.assertEqual(status,401)

    def test_text_message_and_usage(self):
        status,_,data=self.post({'model':'response-echo','max_tokens':20,
                                 'system':'be brief','messages':[{'role':'user','content':'hello'}]})
        self.assertEqual(status,200,data)
        answer=json.loads(data)
        self.assertEqual(answer['type'],'message')
        self.assertTrue(answer['id'].startswith('msg_'))
        self.assertEqual(answer['stop_reason'],'end_turn')
        self.assertEqual(answer['usage'],{'input_tokens':10,'output_tokens':3})
        upstream=json.loads(answer['content'][0]['text'])
        self.assertEqual(upstream['messages'],[{'role':'system','content':'be brief'},
                                             {'role':'user','content':'hello'}])
        self.assertEqual(upstream['max_tokens'],20)
        self.assertFalse(upstream['stream'])

    def test_text_blocks_and_generation_settings(self):
        payload={'model':'response-echo','max_tokens':50,
                 'messages':[{'role':'user','content':[{'type':'text','text':'one'},
                                                       {'type':'text','text':'two'}]}],
                 'temperature':0.5,'top_p':0.8,'stop_sequences':['DONE']}
        status,_,data=self.post(payload)
        self.assertEqual(status,200,data)
        upstream=json.loads(json.loads(data)['content'][0]['text'])
        self.assertEqual(upstream['messages'][0]['content'],payload['messages'][0]['content'])
        self.assertEqual(upstream['temperature'],0.5)
        self.assertEqual(upstream['top_p'],0.8)
        self.assertEqual(upstream['stop'],['DONE'])

    def test_tool_definitions_translate_to_chat_functions(self):
        payload={'model':'response-echo','max_tokens':128,'messages':[{'role':'user','content':'test'}],
                 'tools':[{'name':'read_file','description':'Read a file',
                           'input_schema':{'type':'object','properties':{'path':{'type':'string'}},'required':['path']}}]}
        status,_,body=self.post(payload)
        self.assertEqual(status,200,body)
        request=json.loads(json.loads(body)['content'][0]['text'])
        self.assertEqual(request['tools'],[{'type':'function','function':{
            'name':'read_file','description':'Read a file','parameters':payload['tools'][0]['input_schema']}}])

    def test_assistant_tool_use_is_replayed_as_chat_tool_call(self):
        payload={'model':'response-echo','max_tokens':100,'messages':[
            {'role':'user','content':'Read file'},
            {'role':'assistant','content':[{'type':'text','text':'Reading now'},
                {'type':'tool_use','id':'call_1','name':'read_file',
                 'input':{'path':'docs/README.md'}}]}]}
        status,_,body=self.post(payload)
        self.assertEqual(status,200,body)
        converted=json.loads(json.loads(body)['content'][0]['text'])
        assistant=converted['messages'][1]
        self.assertEqual(assistant['role'],'assistant')
        self.assertEqual(assistant['content'],[{'type':'text','text':'Reading now'}])
        self.assertEqual(assistant['tool_calls'],[{'type':'function','id':'call_1',
            'function':{'name':'read_file','arguments':'{"path":"docs/README.md"}'}}])

    def test_replay_tool_result_only_user_turn(self):
        payload={'model':'response-echo','max_tokens':40,'messages':[
            {'role':'assistant','content':[{'type':'tool_use','id':'call_1','name':'read_file',
                'input':{'path':'a.txt'}}]},
            {'role':'user','content':[{'type':'tool_result','tool_use_id':'call_1',
                'content':'hello world'}]}]}
        status,_,body=self.post(payload)
        self.assertEqual(status,200,body)
        converted=json.loads(json.loads(body)['content'][0]['text'])
        self.assertEqual(converted['messages'],[
            {'role':'assistant','tool_calls':[{'type':'function','id':'call_1',
               'function':{'name':'read_file','arguments':'{"path":"a.txt"}'}}],
               'content':None},
            {'role':'tool','tool_call_id':'call_1','content':'hello world'}])

    def test_tool_choice_maps_to_chat_selection(self):
        payload={'model':'response-echo','max_tokens':64,
                 'messages':[{'role':'user','content':'Do it'}],
                 'tools':[{'name':'read_file','input_schema':{'type':'object'}}],
                 'tool_choice':{'type':'tool','name':'read_file','disable_parallel_tool_use':True}}
        status,_,body=self.post(payload)
        self.assertEqual(status,200,body)
        chat=json.loads(json.loads(body)['content'][0]['text'])
        self.assertEqual(chat['tool_choice'],{'type':'function','function':{'name':'read_file'}})
        self.assertFalse(chat['parallel_tool_calls'])
        payload['tool_choice']={'type':'any'}
        status,_,body=self.post(payload)
        self.assertEqual(status,200,body)
        chat=json.loads(json.loads(body)['content'][0]['text'])
        self.assertEqual(chat['tool_choice'],'required')

    def test_chat_tool_calls_become_anthropic_tool_use(self):
        status,_,body=self.post({'model':'anthropic-tools','max_tokens':64,
            'messages':[{'role':'user','content':'Read a file'}]})
        self.assertEqual(status,200,body)
        reply=json.loads(body)
        self.assertEqual(reply['stop_reason'],'tool_use')
        self.assertEqual(reply['content'],[
            {'type':'text','text':'I need the file'},
            {'type':'tool_use','id':'call_read','name':'read_file',
             'input':{'path':'src/main.c'}}])
        self.assertEqual(reply['usage'],{'input_tokens':15,'output_tokens':7})

    def test_errors_are_not_misrepresented(self):
        basic={'model':'response-echo','max_tokens':15,'messages':[{'role':'user','content':'hi'}]}
        for payload in [
            {'model':'response-echo','messages':[{'role':'user','content':'hi'}]},
            dict(basic,stream=True),
            dict(basic,tools=[{'name':'read'}]),
            dict(basic,messages=[{'role':'user','content':[{'type':'tool_result','tool_use_id':'id','content':{'unsupported':1}}]}]),
            dict(basic,max_tokens=0),
        ]:
            status,_,body=self.post(payload)
            self.assertEqual(status,400,(payload,body))
            self.assertEqual(json.loads(body)['type'],'error')
        self.assertEqual(base.request(self.port,'POST','/v1/messages',basic,key=None)[0],401)
        self.assertEqual(base.request(self.port,'POST','/v1/messages/count_tokens',basic)[0],501)
        self.assertEqual(self.post(dict(basic,model='glm-test'))[0],502)
        self.assertEqual(self.post(dict(basic,model='bad'))[0],429)

if __name__ == '__main__':
    unittest.main(argv=[__file__])
