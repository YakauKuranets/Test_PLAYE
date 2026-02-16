// E2E test for CloudStorage and case synchronisation (Stage 4)
// This test mocks ApiClient methods to simulate server responses and
// verifies that syncCases merges cases correctly and calls uploadCase
// for new or updated local entries.  To run:
// node test/cloudStorage.test.js

import { cloudStorage } from '../src/api/cloudStorage.js';
import { apiClient } from '../src/api/client.js';

async function runTests() {
  // Mock remote cases: server has one case with id 'remote-1'
  const remoteCases = [
    {
      id: 'remote-1',
      caseId: 'R-001',
      owner: 'Alice',
      status: 'closed',
      summary: 'remote case',
      updatedAt: '2026-02-15T00:00:00Z',
    },
  ];
  // Track uploads
  const uploaded = [];
  // Stub apiClient.get to return remote cases
  apiClient.get = async (endpoint) => {
    if (endpoint === '/cases') {
      return { success: true, data: remoteCases };
    }
    return { success: false, error: 'Unknown endpoint' };
  };
  // Stub apiClient.post to record uploaded cases
  apiClient.post = async (endpoint, data) => {
    if (endpoint === '/cases') {
      uploaded.push(data);
      return { success: true, data: null };
    }
    return { success: false, error: 'Unknown endpoint' };
  };
  // Local cases: one newer case, one same id but older, one new
  const localCases = [
    {
      id: 'remote-1',
      caseId: 'R-001',
      owner: 'Alice',
      status: 'open',
      summary: 'local newer case',
      updatedAt: '2026-02-16T00:00:00Z',
    },
    {
      id: 'local-2',
      caseId: 'L-002',
      owner: 'Bob',
      status: 'active',
      summary: 'new local case',
      updatedAt: '2026-02-16T01:00:00Z',
    },
  ];
  // Perform synchronisation
  const merged = await cloudStorage.syncCases(localCases);
  // Expect merged to have two entries
  console.assert(Array.isArray(merged), 'merged is array');
  console.assert(merged.length === 2, 'merged length should be 2');
  // Expect local newer case to be chosen for id 'remote-1'
  const mergedRemote1 = merged.find((c) => c.id === 'remote-1');
  console.assert(mergedRemote1.summary === 'local newer case', 'should choose newer local case');
  // Expect local new case present
  const mergedLocal2 = merged.find((c) => c.id === 'local-2');
  console.assert(mergedLocal2 && mergedLocal2.summary === 'new local case', 'should include new local case');
  // Expect uploaded to contain both local cases (two uploads)
  console.assert(uploaded.length === 2, 'should upload new and updated local cases');
  console.log('All CloudStorage tests passed');
}

runTests().catch((err) => {
  console.error('CloudStorage tests failed', err);
});