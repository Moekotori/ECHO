import React from 'react'
import ReactDOM from 'react-dom/client'
import './i18n'
import App from './App'
import PluginHostProvider from './plugins/PluginHost'
import './index.css'
import './styles/tokens.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <PluginHostProvider>
      <App />
    </PluginHostProvider>
  </React.StrictMode>
)
