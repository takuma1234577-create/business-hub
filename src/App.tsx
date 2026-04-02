import { Routes, Route } from 'react-router-dom'
import Home from './pages/Home'
import InvoiceTool from './pages/InvoiceTool'
import TaskManager from './pages/TaskManager'
import AmazonAutoShip from './pages/AmazonAutoShip'
import LineCrm from './pages/LineCrm'
import AccountingTool from './pages/AccountingTool'

function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/invoice/*" element={<InvoiceTool />} />
      <Route path="/tasks/*" element={<TaskManager />} />
      <Route path="/amazon/*" element={<AmazonAutoShip />} />
      <Route path="/line-crm/*" element={<LineCrm />} />
      <Route path="/accounting/*" element={<AccountingTool />} />
    </Routes>
  )
}

export default App
