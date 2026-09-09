(() => {
  // DIVxPAPA 💀 v10.0 — He built this. Stays true.
  const EXT = globalThis.browser ?? globalThis.chrome;
  if (!EXT?.runtime?.getURL) return;

  const injectorUrl = EXT.runtime.getURL('core/injector.js');

  function sendHeartbeat() {
    try {
      const result = EXT.runtime.sendMessage({ 
        type: 'DIVxPAPA_HEARTBEAT' 
      });
      if (result?.catch) result.catch(() => {});
    } catch (_) {}
  }

  function inject() {
    if (window.__divxpapaLoaderBusy) return;
    window.__divxpapaLoaderBusy = true;

    const alreadyInjected = document.documentElement?.dataset?.divxpapaLoaderInjected === '1';
    if (alreadyInjected && window.__divxpapaInjectorReady) {
      window.__divxpapaLoaderBusy = false;
      sendHeartbeat();
      return;
    }

    const script = document.createElement('script');
    script.src = injectorUrl;
    script.async = false;
    script.dataset.divxpapaMic = 'injector';
    script.onload = () => {
      document.documentElement.dataset.divxpapaLoaderInjected = '1';
      window.__divxpapaLoaderBusy = false;
      sendHeartbeat();
      script.remove();
    };
    script.onerror = () => {
      window.__divxpapaLoaderBusy = false;
      script.remove();
    };
    (document.head || document.documentElement).appendChild(script);
  }

  // Initial injection
  inject();

  // Watch for DOM changes — re-inject if missing
  const observer = new MutationObserver(() => {
    if (window.__divxpapaInjectorReady) {
      observer.disconnect();
      return;
    }
    inject();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  // Safety net — periodic re-injection
  setInterval(() => {
    if (!window.__divxpapaInjectorReady) inject();
  }, 2500);

  // Post-injection heartbeat
  sendHeartbeat();

  console.info('[DIVxPAPA 💀] loader active — He built this.');
})();