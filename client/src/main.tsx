import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { LibraryProvider } from './store/LibraryContext';
import { ToastProvider } from './store/ToastContext';
import { ThemeProvider } from './store/ThemeContext';
import { UploadProvider } from './store/UploadContext';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <ToastProvider>
        <LibraryProvider>
          <UploadProvider>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </UploadProvider>
        </LibraryProvider>
      </ToastProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
