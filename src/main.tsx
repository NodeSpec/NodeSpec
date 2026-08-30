import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.js';
import { ThemeProvider } from './ui/theme/ThemeContext.js';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <ThemeProvider defaultMode="light">
      <App />
    </ThemeProvider>
  </StrictMode>
);
