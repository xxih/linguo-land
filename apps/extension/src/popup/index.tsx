import React from 'react';
import ReactDOM from 'react-dom/client';
import Popup from './Popup';
import { ErrorBoundary } from '../lib/ErrorBoundary';
import '../index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary scope="Popup">
      <Popup />
    </ErrorBoundary>
  </React.StrictMode>,
);
