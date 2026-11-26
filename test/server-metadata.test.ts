import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseCatalog, defaultConfiguration, zedSettings} from '../src/catalog.ts';
import {ModelsDevCatalog} from '../src/models-dev-cache.ts';
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
  assert.equal(settings.available_models[0]!.max_tokens,64000);
  assert.equal(settings.available_models[0]!.max_output_tokens,16000);
  assert.equal(settings.available_models[0]!.capabilities.tools,true);
  assert.equal(models[0]!.pricing!.input,1);
  assert.equal(models[0]!.upstream,upstream);
  const changed = read([{...row,metadata:{...metadata,context_window:64000}}]);
  assert.equal(defaultConfiguration(changed)[0]!.max_tokens,32000);
  assert.deepEqual(defaultConfiguration(read([])),[]);
  assert.deepEqual(zedSettings([], [], 7391).language_models.openai_compatible.lmm.available_models, []);
  assert.equal(defaultConfiguration(read([{...row,metadata:{...metadata,context_window:null,max_input_tokens:null}}]))[0]?.max_tokens,32768);
  assert.throws(() => read([{...row,metadata:{...metadata,max_output_tokens:-1}}]));
});


test('fuzzy public metadata fills missing fields and keeps every compatible authorized route', () => {
  const references = new ModelsDevCatalog({ example: { id: 'example', models: { 'nebula-pro-1': {
    id:'nebula-pro-1', name:'Nebula Pro 1', limit:{context:256000,output:16000},
    modalities:{input:['text','image'],output:['text','audio']},tool_call:true,reasoning:true,
  } } } });
  const upstream = 'gateway/NEBULA_Pro.1';
  const known = {...row,upstream_model:upstream,name:upstream,id:`lmm:${group}:${Buffer.from(upstream).toString('base64url')}`,
    metadata:{...metadata,context_window:64000,max_input_tokens:null,max_output_tokens:null,input_modalities:null,output_modalities:null,tool_call:false}};
  const data = {schema_version:1,resource:'https://lmm.test/api/oauth2',groups:[{id:group,name:'default',scope:`group:${group}`}],models:[known,{...row,metadata:undefined}]};
  const models = parseCatalog(data,'https://lmm.test/api/oauth2',`group:${group}`,references);
  const configured = defaultConfiguration(models);
  assert.equal(models.length,2);
  assert.equal(configured.length,2);
  assert.equal(configured[0]!.id,known.id);
  assert.equal(configured[0]!.max_tokens,32000);
  assert.equal(configured[0]!.max_output_tokens,16000);
  assert.equal(configured[0]!.capabilities!.tools,false);
  assert.equal(configured[0]!.capabilities!.images,true);
  assert.equal(configured[1]!.max_tokens,32768);
});

test('declared non-chat types with text output remain in the directory but not Zed chat settings', () => {
  const types = ['embedding','reranking','transcription'];
  const records = Object.fromEntries(types.map((type,index) => [`future-${index}`, {
    id:`future-${index}`,name:`Future ${index}`,type,limit:{context:128000,output:4096},
    modalities:{input:['text'],output:['text']},reasoning:false,tool_call:false,
  }]));
  const references = new ModelsDevCatalog({ example:{id:'example',models:records} });
  const rows = types.map((_type,index) => ({...row,upstream_model:`future-${index}`,
    id:`lmm:${group}:${Buffer.from(`future-${index}`).toString('base64url')}`,metadata:undefined}));
  const models = parseCatalog({schema_version:1,resource:'https://lmm.test/api/oauth2',
    groups:[{id:group,name:'default',scope:`group:${group}`}],models:rows},
    'https://lmm.test/api/oauth2',`group:${group}`,references);
  assert.equal(models.length,types.length);
  assert.deepEqual(defaultConfiguration(models),[]);
});

test('public zero limits are unknown and do not remove an authorized chat route', () => {
  const references = new ModelsDevCatalog({custom:{id:'custom',models:{future:{
    id:'future',name:'Future',limit:{context:0,output:0},
    modalities:{input:['text'],output:['text']},reasoning:false,tool_call:false,
  }}}});
  const model = {...read([{...row,metadata:undefined}])[0]!,upstream:'future',reference:references.resolve('future')};
  const config=defaultConfiguration([model]);
  assert.equal(config.length,1);
  assert.equal(config[0]!.max_tokens,32768);
  assert.equal(config[0]!.max_output_tokens,4096);
});

test('Zed uses half the context, keeps explicit context overrides, and respects the gateway output cap', () => {
  const models = read([{ ...row, metadata: {
    ...metadata, context_window: 128001, max_input_tokens: 60000, gateway_max_output_tokens: 2048,
  } }]);
  assert.equal(defaultConfiguration(models)[0]!.max_tokens, 60000);
  assert.equal(defaultConfiguration(models)[0]!.max_output_tokens, 2048);
  const settings = zedSettings(models, [{ id, max_tokens: 83000, max_output_tokens: 4000 }], 7391);
  const [configured] = settings.language_models.openai_compatible.lmm.available_models;
  assert.equal(configured?.max_tokens, 83000);
  assert.equal(configured?.max_output_tokens, 2048);
  assert.throws(() => read([{ ...row, metadata: { ...metadata, gateway_max_output_tokens: 0 } }]));
});

test('an exact models.dev identity cannot suppress a competing typo match', () => {
  const profile = (id: string, context: number, canonical_model_id?: string) => ({
    id, name: id, canonical_model_id, limit: { context, output: 8192 },
    modalities: { input: ['text'], output: ['text'] }, reasoning: true, tool_call: true,
  });
  const directory = new ModelsDevCatalog({
    first: { models: { 'nebula-spark-1': profile('nebula-spark-1', 128000) } },
    second: { models: { 'nebula-shark-1': profile('nebula-shark-1', 64000) } },
    mirror: { models: { 'nebula-spark-1': profile('nebula-spark-1', 128000, 'first/nebula-spark-1') } },
  });
  assert.equal(directory.resolve('first/nebula-spark-1')?.limit.context, 128000);
  assert.equal(directory.resolve('first/nebula-stark-1')?.limit.context, 128000);
  assert.equal(directory.resolve('nebula-stark-1'), undefined);
});
