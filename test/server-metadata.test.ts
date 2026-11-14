import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseCatalog, defaultConfiguration, zedSettings} from '../src/catalog.ts';
const group = 'ZGVmYXVsdA', upstream = 'future-model';
const id = `lmm:${group}:${Buffer.from(upstream).toString('base64url')}`;
const metadata = {context_window:128000,max_input_tokens:100000,max_output_tokens:16000,
  input_modalities:['text'],output_modalities:['text'],reasoning:true,tool_call:true,source:'server'};
const row = {id,group_id:group,group:'default',name:upstream,upstream_model:upstream,apis:['openai-completions'],metadata,
  pricing:{currency:'USD',unit:'million_tokens',input:1,output:2,group_multiplier:2,trust_multiplier:0.5}};
const read = (models: unknown[]) => parseCatalog({schema_version:1,resource:'https://lmm.test/api/oauth2',groups:[{id:group,name:'default',scope:`group:${group}`}],models},'https://lmm.test/api/oauth2',`group:${group}`);
test('Zed synchronizes new model metadata and preserves raw prices without static model IDs', () => {
  const models = read([row]);
  const settings = zedSettings(models,defaultConfiguration(models),7391).language_models.openai_compatible.lmm;
  assert.equal(settings.available_models[0]!.max_tokens,100000);
  assert.equal(settings.available_models[0]!.max_output_tokens,16000);
  assert.equal(settings.available_models[0]!.capabilities.tools,true);
  assert.equal(models[0]!.pricing!.input,1);
  assert.equal(models[0]!.upstream,upstream);
  const changed = read([{...row,metadata:{...metadata,context_window:64000}}]);
  assert.equal(defaultConfiguration(changed)[0]!.max_tokens,64000);
  assert.deepEqual(defaultConfiguration(read([])),[]);
  assert.deepEqual(zedSettings([], [], 7391).language_models.openai_compatible.lmm.available_models, []);
  assert.deepEqual(defaultConfiguration(read([{...row,metadata:{...metadata,context_window:null,max_input_tokens:null}}])),[]);
  assert.throws(() => read([{...row,metadata:{...metadata,max_output_tokens:-1}}]));
});
