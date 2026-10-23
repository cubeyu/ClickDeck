// Both changes are one coordinated protocol: never enable only half of it.
export function collaborationProtocolOptions(value?: string) {
  const protocol = (value ?? '').trim();
  if (protocol !== '' && protocol !== 'legacy' && protocol !== 'invited-v1') {
    throw new Error('Unsupported collaboration protocol configuration');
  }
  const enabled = protocol === 'invited-v1';
  return { invitedGuestAdmission: enabled, controlledProjectRead: enabled };
}
