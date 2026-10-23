import { describe, expect, it, vi } from 'vitest';
import { createCollaborationClient } from './collaboration-client';
import { encodeCollaborationInvite } from '../shared/collaboration-invite';

const config={projectUrl:'https://example.supabase.co',publishableKey:'sb_publishable_test'};
const projectId='16710000-0000-4000-8000-000000000001';
const inviteToken='a'.repeat(36), pageFingerprint='b'.repeat(64);
const inviteCode=encodeCollaborationInvite({projectId,inviteToken});
const key='clickdeck:collaboration-auth:v1';
const expiry=new Date(Date.now()+3600_000).toISOString();
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
function storage() {
  const values:Record<string,unknown>={};
  return {values,get:vi.fn(async(k:string)=>({[k]:values[k]})),set:vi.fn(async(data:Record<string,unknown>)=>{Object.assign(values,data);}),remove:vi.fn(async(k:string)=>{delete values[k];})};
}
function backend() {
  return vi.fn<typeof fetch>(async(input)=>{
    const url=String(input);
    if(url.includes('/preview_clickdeck_guest_invite'))return json(expiry);
    if(url.includes('/signup'))return json({access_token:'guest-token',refresh_token:'guest-refresh',expires_in:3600,user:{id:'guest',is_anonymous:true}});
    if(url.includes('/accept_clickdeck_guest_invite'))return json('member');
    if(url.includes('/clickdeck_projects?'))return json([{id:projectId,title:'Test',page_fingerprint:pageFingerprint,expires_at:expiry}]);
    if(url.includes('/clickdeck_members?'))return json([{id:'member',project_id:projectId,user_id:'guest',display_name:'Guest',role:'member'}]);
    if(url.includes('/clickdeck_submissions?'))return json([]);
    throw new Error('Unexpected test request');
  });
}
const join={action:'join',inviteCode,displayName:'Guest',pageFingerprint} as const;
const preview={action:'preview-join',inviteCode,pageFingerprint} as const;
describe('opt-in invited guest admission prototype',()=>{
  it('preserves hosted Auth Hook error codes from the numeric-code/msg envelope',async()=>{
    for (const error of ['invalid-invite','fingerprint-mismatch','member-limit']) {
      const store=storage();
      const fetcher=vi.fn<typeof fetch>(async input=>String(input).includes('/signup')
        ?json({code:403,msg:error},403):json(expiry));
      const client=createCollaborationClient({config,storage:store,fetcher,invitedGuestAdmission:true});
      expect(await client.handle(join)).toEqual({ok:false,error});
      expect(store.values[key]).toBeUndefined();
      expect(Object.keys(store.values)).toHaveLength(0);
      expect(await client.handle(join)).toEqual({ok:false,error});
    }
  });
  it('previews expiry without registering an identity or saving credentials',async()=>{
    const store=storage(),fetcher=backend();
    const client=createCollaborationClient({config,storage:store,fetcher,invitedGuestAdmission:true});
    expect(await client.handle(preview)).toEqual({ok:true,data:{inviteExpiresAt:Date.parse(expiry)}});
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0][0])).toContain('/preview_clickdeck_guest_invite');
    expect(store.set).not.toHaveBeenCalled();
  });
  it('does not dispatch signup if the durable attempt marker cannot be saved',async()=>{
    const store=storage(),fetcher=backend();
    store.set.mockRejectedValue(new Error('disk unavailable'));
    const client=createCollaborationClient({config,storage:store,fetcher,invitedGuestAdmission:true});
    for(let i=0;i<2;i++) expect(await client.handle(join)).toEqual({ok:false,error:'identity-storage-failed'});
    expect(fetcher.mock.calls.some(([url])=>String(url).includes('/signup'))).toBe(false);
  });
  it('blocks ambiguous registration retries across client restarts and does not start Google',async()=>{
    const store=storage(),base=backend(),googleLogin=vi.fn();
    const fetcher=vi.fn<typeof fetch>(async(input,init)=>{
      if(String(input).includes('/signup')) throw new TypeError('response lost after commit');
      return base(input,init);
    });
    const options={config,storage:store,fetcher,googleLogin,invitedGuestAdmission:true};
    for(let i=0;i<2;i++) {
      const client=createCollaborationClient(options);
      expect(await client.handle(join)).toEqual({ok:false,error:'guest-registration-uncertain'});
      expect(await client.loginGoogle()).toEqual({ok:false,error:'guest-registration-uncertain'});
      expect(await client.recoverIdentity()).toEqual({ok:false,error:'guest-registration-uncertain'});
    }
    expect(fetcher.mock.calls.filter(([url])=>String(url).includes('/signup'))).toHaveLength(1);
    expect(googleLogin).not.toHaveBeenCalled();
    expect(JSON.stringify(store.values)).not.toContain(inviteToken);
    expect(JSON.stringify(store.values)).not.toContain(pageFingerprint);
  });
  it('retries saving the same received identity instead of signing up again',async()=>{
    const store=storage(),fetcher=backend();
    const save=store.set.getMockImplementation()!;
    let fail=true;
    store.set.mockImplementation(async data=>{
      if(data[key]&&fail)throw new Error('disk unavailable');
      await save(data);
    });
    const client=createCollaborationClient({config,storage:store,fetcher,invitedGuestAdmission:true});
    expect(await client.handle(join)).toEqual({ok:false,error:'identity-storage-failed'});
    expect(store.values[key]).toBeUndefined();
    fail=false;
    expect(await client.handle(join)).toMatchObject({ok:true});
    expect(store.values[key]).toMatchObject({userId:'guest'});
    expect(Object.keys(store.values)).toEqual([key]);
    expect(fetcher.mock.calls.filter(([url])=>String(url).includes('/signup'))).toHaveLength(1);
  });
  it('keeps the durable guard if the worker stops before the received identity is saved',async()=>{
    const store=storage(),fetcher=backend(),save=store.set.getMockImplementation()!;
    store.set.mockImplementation(async data=>{if(data[key])throw new Error('disk unavailable');await save(data);});
    const options={config,storage:store,fetcher,invitedGuestAdmission:true};
    expect(await createCollaborationClient(options).handle(join)).toEqual({ok:false,error:'identity-storage-failed'});
    store.set.mockImplementation(save);
    expect(await createCollaborationClient(options).handle(join)).toEqual({ok:false,error:'guest-registration-uncertain'});
    expect(fetcher.mock.calls.filter(([url])=>String(url).includes('/signup'))).toHaveLength(1);
  });
  it('does not treat a server failure containing a rejection word as proof of rollback',async()=>{
    const store=storage(),base=backend();
    const fetcher=vi.fn<typeof fetch>(async(input,init)=>String(input).includes('/signup')
      ?json({code:500,msg:'invalid-invite'},500):base(input,init));
    const client=createCollaborationClient({config,storage:store,fetcher,invitedGuestAdmission:true});
    for(let i=0;i<2;i++)expect(await client.handle(join)).toEqual({ok:false,error:'guest-registration-uncertain'});
    expect(fetcher.mock.calls.filter(([url])=>String(url).includes('/signup'))).toHaveLength(1);
  });
  it('restores a received session after worker recreation without a second registration',async()=>{
    const store=storage(),recovery=storage(),fetcher=backend(),save=store.set.getMockImplementation()!;
    store.set.mockImplementation(async data=>{if(data[key])throw new Error('disk unavailable');await save(data);});
    const options={config,storage:store,recoveryStorage:recovery,fetcher,invitedGuestAdmission:true};
    expect(await createCollaborationClient(options).handle(join)).toEqual({ok:false,error:'identity-storage-failed'});
    expect(Object.values(recovery.values)[0]).toMatchObject({session:{userId:'guest'}});
    expect(JSON.stringify(recovery.values)).not.toContain(inviteToken);
    store.set.mockImplementation(save);
    const result=await createCollaborationClient(options).handle(join);
    expect(result).toMatchObject({ok:true});
    expect(JSON.stringify(result)).not.toContain('guest-refresh');
    expect(store.values[key]).toMatchObject({userId:'guest'});
    expect(recovery.values).toEqual({});
    expect(fetcher.mock.calls.filter(([url])=>String(url).includes('/signup'))).toHaveLength(1);
  });
  it('cannot restore an unrelated backup or one lost on browser restart',async()=>{
    for(const mode of ['mismatch','missing']) {
      const store=storage(),recovery=storage(),fetcher=backend();
      const attemptKey=key+':guest-attempt:'+config.projectUrl;
      store.values[attemptKey]={attemptId:'current',startedAt:1};
      if(mode==='mismatch')recovery.values[attemptKey+':response']={attemptId:'old',session:{userId:'other',accessToken:'old',refreshToken:'old',expiresAt:9999999999999}};
      const client=createCollaborationClient({config,storage:store,recoveryStorage:recovery,fetcher,invitedGuestAdmission:true});
      expect(await client.handle(join)).toEqual({ok:false,error:'guest-registration-uncertain'});
      expect(store.values[key]).toBeUndefined();
      expect(fetcher.mock.calls.some(([url])=>String(url).includes('/signup'))).toBe(false);
    }
  });
  it('still saves the primary identity when the secondary store is unavailable',async()=>{
    const store=storage(),recovery=storage(),fetcher=backend();
    recovery.set.mockRejectedValue(new Error('session quota'));
    const client=createCollaborationClient({config,storage:store,recoveryStorage:recovery,fetcher,invitedGuestAdmission:true});
    expect(await client.handle(join)).toMatchObject({ok:true});
    expect(store.values[key]).toMatchObject({userId:'guest'});
    expect(fetcher.mock.calls.filter(([url])=>String(url).includes('/signup'))).toHaveLength(1);
  });
  it('never creates an unbound identity on read or recovery',async()=>{
    const store=storage(),fetcher=backend();
    const client=createCollaborationClient({config,storage:store,fetcher,invitedGuestAdmission:true});
    expect(await client.handle({action:'read',projectId})).toEqual({ok:false,error:'authentication-required'});
    expect(await client.recoverIdentity()).toEqual({ok:false,error:'authentication-required'});
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects malformed or missing-backend invitations without signup',async()=>{
    const store=storage(),fetcher=vi.fn<typeof fetch>(async()=>json({code:'PGRST202'},404));
    const client=createCollaborationClient({config,storage:store,fetcher,invitedGuestAdmission:true});
    expect(await client.handle({...preview,inviteCode:'wrong'})).toEqual({ok:false,error:'invalid-invite'});
    expect(fetcher).not.toHaveBeenCalled();
    expect(await client.handle(join)).toEqual({ok:false,error:'migration-required'});
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(store.set).not.toHaveBeenCalled();
  });
  it('sends the invitation only on explicit join, saves the guest, and uses idempotent acceptance',async()=>{
    const store=storage(),fetcher=backend();
    const client=createCollaborationClient({config,storage:store,fetcher,invitedGuestAdmission:true});
    const result=await client.handle(join);
    expect(result).toMatchObject({ok:true,data:{participation:{projectId,memberId:'member',role:'member'}}});
    expect(fetcher.mock.calls.slice(0,3).map(([url])=>String(url).split('/').at(-1))).toEqual(['preview_clickdeck_guest_invite','signup','accept_clickdeck_guest_invite']);
    const signup=fetcher.mock.calls.find(([url])=>String(url).includes('/signup'))!;
    expect(JSON.parse(String(signup[1]?.body))).toEqual({data:{clickdeck_guest:{project_id:projectId,invite_token:inviteToken,page_fingerprint:pageFingerprint,display_name:'Guest'}}});
    expect(store.values[key]).toMatchObject({userId:'guest',accessToken:'guest-token'});
    expect(JSON.stringify(result)).not.toContain(inviteToken);
    expect(JSON.stringify(result)).not.toContain('guest-token');
    expect(JSON.stringify(result)).not.toContain('guest-refresh');
    expect(await client.handle(join)).toMatchObject({ok:true});
    expect(fetcher.mock.calls.filter(([url])=>String(url).includes('/signup'))).toHaveLength(1);
  });
  it('retains a successfully registered identity if follow-up acceptance fails',async()=>{
    const store=storage(),base=backend();
    let failed=true;
    const fetcher=vi.fn<typeof fetch>(async(input,init)=>String(input).includes('/accept_')&&failed?json({message:'network'},500):base(input,init));
    const client=createCollaborationClient({config,storage:store,fetcher,invitedGuestAdmission:true});
    expect(await client.handle(join)).toEqual({ok:false,error:'network-error'});
    expect(store.values[key]).toMatchObject({userId:'guest'});
    failed=false;
    expect(await client.handle(join)).toMatchObject({ok:true});
    expect(base.mock.calls.filter(([url])=>String(url).includes('/signup'))).toHaveLength(1);
  });
  it('does not share a pending registration with a second join intent or Google login',async()=>{
    const store=storage(),base=backend();
    let release:(()=>void)|undefined;
    const held=new Promise<void>(resolve=>{release=resolve;});
    let signupStarted=false;
    const fetcher=vi.fn<typeof fetch>(async(input,init)=>{
      if(String(input).includes('/signup')){signupStarted=true;await held;}
      return base(input,init);
    });
    const googleLogin=vi.fn();
    const client=createCollaborationClient({config,storage:store,fetcher,googleLogin,invitedGuestAdmission:true});
    const first=client.handle(join);
    await vi.waitFor(()=>expect(signupStarted).toBe(true));
    expect(await client.handle(join)).toEqual({ok:false,error:'rate-limit'});
    expect(await client.loginGoogle()).toEqual({ok:false,error:'rate-limit'});
    release!();expect(await first).toMatchObject({ok:true});
    expect(googleLogin).not.toHaveBeenCalled();
  });
  it('preserves expired credentials and drafts rather than registering a replacement',async()=>{
    const store=storage();store.values[key]={accessToken:'old',refreshToken:'old-refresh',userId:'old',expiresAt:1};store.values.draft='keep';
    const fetcher=vi.fn<typeof fetch>(async()=>json({error_code:'refresh_token_not_found'},400));
    const client=createCollaborationClient({config,storage:store,fetcher,invitedGuestAdmission:true});
    expect(await client.recoverIdentity()).toEqual({ok:false,error:'session-expired'});
    expect(store.values[key]).toMatchObject({userId:'old'});expect(store.values.draft).toBe('keep');
    expect(fetcher.mock.calls.every(([url])=>String(url).includes('/token?'))).toBe(true);
    expect(store.set).not.toHaveBeenCalled();
  });
});
