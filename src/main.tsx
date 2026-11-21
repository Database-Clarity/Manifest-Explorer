import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.scss';
import { applySettingsToDom, useSettingsStore } from './stores/settings';
import { App } from './App';

applySettingsToDom(useSettingsStore.getState());

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
