import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { VendorPage } from './components/VendorPage.tsx'

const isVendor = window.location.pathname.replace(/\/+$/, '').startsWith('/vendor')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isVendor ? <VendorPage /> : <App />}
  </StrictMode>,
)
