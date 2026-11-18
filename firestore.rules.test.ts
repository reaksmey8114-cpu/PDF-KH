export const dirtyDozenSecurityCases = [
  { name: 'Shadow Field Injection on User Create', expected: 'PERMISSION_DENIED' },
  { name: 'Identity Spoof on Project Create', expected: 'PERMISSION_DENIED' },
  { name: 'Unverified Email Write', expected: 'PERMISSION_DENIED' },
  { name: 'Client Timestamp Forgery', expected: 'PERMISSION_DENIED' },
  { name: 'ID Poisoning with Invalid Characters', expected: 'PERMISSION_DENIED' },
  { name: 'PII Blanket Read Across Users', expected: 'PERMISSION_DENIED' },
  { name: 'Unfiltered List Query Scraping', expected: 'PERMISSION_DENIED' },
  { name: 'Orphaned Subcollection Document Write', expected: 'PERMISSION_DENIED' },
  { name: 'Cross-Owner Subcollection Access', expected: 'PERMISSION_DENIED' },
  { name: 'Owner Transfer Attack', expected: 'PERMISSION_DENIED' },
  { name: 'Value Poisoning Oversized Title', expected: 'PERMISSION_DENIED' },
  { name: 'Immutable Creation Timestamp Tampering', expected: 'PERMISSION_DENIED' },
];
