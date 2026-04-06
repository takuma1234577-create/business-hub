import { Routes, Route } from 'react-router-dom'
import Home from './pages/Home'
import InvoiceTool from './pages/InvoiceTool'
import TaskManager from './pages/TaskManager'
import AmazonAutoShip from './pages/AmazonAutoShip'
import LineCrm from './pages/LineCrm'
import AccountingTool from './pages/AccountingTool'
import ApiSettings from './pages/ApiSettings'
import ReturnRequest from './pages/ReturnRequest'
import ReturnSettings from './pages/ReturnSettings'
import ReturnLogs from './pages/ReturnLogs'

function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/settings" element={<ApiSettings />} />
      <Route path="/invoice/*" element={<InvoiceTool />} />
      <Route path="/tasks/*" element={<TaskManager />} />
      <Route path="/amazon/*" element={<AmazonAutoShip />} />
      <Route path="/line-crm/*" element={<LineCrm />} />
      <Route path="/accounting/*" element={<AccountingTool />} />
      <Route path="/return-request" element={<ReturnRequest />} />
      <Route path="/return-settings" element={<ReturnSettings />} />
      <Route path="/return-logs" element={<ReturnLogs />} />
    </Routes>
  )
}

export default App
