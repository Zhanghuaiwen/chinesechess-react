import { useEffect, useState } from 'react';

// PWA 辅助组件：安装引导（beforeinstallprompt）+ 离线状态提示。
// 已安装 / 已在独立窗口运行时自动隐藏安装按钮。
export default function PwaControls() {
  const [deferred, setDeferred] = useState(null);
  const [installed, setInstalled] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [offline, setOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const onBeforeInstall = (e) => {
      e.preventDefault();
      setDeferred(e);
    };
    const onInstalled = () => {
      setDeferred(null);
      setInstalled(true);
    };
    const onOffline = () => setOffline(true);
    const onOnline = () => setOffline(false);

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);

    // 已处于独立窗口（安装后）模式，无需再引导。
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    if (standalone) setInstalled(true);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, []);

  const promptInstall = async () => {
    if (!deferred) return;
    deferred.prompt();
    const { outcome } = await deferred.userChoice;
    if (outcome !== 'accepted') setDismissed(true);
    setDeferred(null);
  };

  const showInstall = deferred && !installed && !dismissed;

  return (
    <>
      {showInstall && (
        <div className="install-prompt">
          <button className="install-btn" onClick={promptInstall}>
            安装到桌面
          </button>
          <button
            className="install-dismiss"
            aria-label="关闭安装提示"
            onClick={() => setDismissed(true)}
          >
            ×
          </button>
        </div>
      )}
      {offline && <div className="offline-badge">离线模式</div>}
    </>
  );
}
