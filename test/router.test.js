// Simple tests for the SmartRouter class.
// These tests can be run with `node` in an environment without a DOM.

// Create minimal globals expected by the router module
global.navigator = { onLine: false };
global.window = {
  addEventListener: () => {},
};

(async () => {
  const { smartRouter } = await import('../src/router.js');
  // Test: auto mode should fallback to offline when offline
  smartRouter.setMode('auto');
  if (smartRouter.getEffectiveMode() !== 'offline') {
    throw new Error('Auto mode did not fallback to offline when offline');
  }
  // Test: online mode should fallback to offline when offline
  smartRouter.setMode('online');
  if (smartRouter.getEffectiveMode() !== 'offline') {
    throw new Error('Online mode did not fallback to offline when offline');
  }
  // Simulate network coming online. Update both navigator and router state.
  global.navigator.onLine = true;
  smartRouter.online = true;
  smartRouter.setMode('online');
  if (smartRouter.getEffectiveMode() !== 'online') {
    throw new Error('Online mode should be online when network is available');
  }
  // Test offline mode always returns offline
  smartRouter.setMode('offline');
  if (smartRouter.getEffectiveMode() !== 'offline') {
    throw new Error('Offline mode should always be offline');
  }
  console.log('SmartRouter tests passed successfully.');
})();