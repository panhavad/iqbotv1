// Toolbar button: show / hide the panel on the traderoom tab (or start the extension again after
// Exit), or open the traderoom.
const TRADEROOM = 'https://iqoption.com/traderoom';

chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'nmat-toggle-panel' });
  } catch (_) {
    // No panel in this tab (not the traderoom).
    await chrome.tabs.create({ url: TRADEROOM });
  }
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || !sender.tab) return;
  // A discarded tab cannot trade: keep the traderoom tab out of Chrome's Memory Saver.
  if (msg.type === 'nmat-keep-tab') {
    chrome.tabs.update(sender.tab.id, { autoDiscardable: false }).catch(() => {});
  }
  // "OFF" on the toolbar icon after Exit: a click on it starts the extension again.
  if (msg.type === 'nmat-badge') {
    chrome.action.setBadgeText({ tabId: sender.tab.id, text: msg.text || '' }).catch(() => {});
    chrome.action.setBadgeBackgroundColor({ tabId: sender.tab.id, color: '#db4931' }).catch(() => {});
  }
});
