import { BrowserRouter, Routes, Route } from 'react-router-dom'
import TV from './TV'
import Admin from './Admin'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<TV />} />
        <Route path="/admin" element={<Admin />} />
      </Routes>
    </BrowserRouter>
  )
}
