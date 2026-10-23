import { describe, expect, it } from 'vitest';
import { collaborationProtocolOptions } from './collaboration-protocol';
describe('coordinated collaboration protocol', () => {
  it.each([undefined, '', 'legacy'])('preserves existing builds for %s', value => {
    expect(collaborationProtocolOptions(value)).toEqual({invitedGuestAdmission:false,controlledProjectRead:false});
  });
  it('enables invitation admission and controlled reads together', () => {
    expect(collaborationProtocolOptions('invited-v1')).toEqual({invitedGuestAdmission:true,controlledProjectRead:true});
  });
  it.each(['true','invited','controlled-read','invited-v2'])('rejects ambiguous or unsupported %s', value => {
    expect(()=>collaborationProtocolOptions(value)).toThrow('Unsupported collaboration protocol');
  });
});
